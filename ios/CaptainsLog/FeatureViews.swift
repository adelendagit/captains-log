import MapKit
import SwiftUI

struct LogEntryIntent: Identifiable {
    let id = UUID()
    let action: String?
}

private enum LogNotificationMode: String, CaseIterable, Identifiable {
    case people
    case test
    case none

    var id: String { rawValue }

    var label: String {
        switch self {
        case .people: "Notify people"
        case .test: "Send test to me"
        case .none: "Don’t email"
        }
    }

    var detail: String {
        switch self {
        case .people: "Email the configured notification list."
        case .test: "Email the configured reply-to address."
        case .none: "Save the log entry only."
        }
    }
}

struct AddLogEntryView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var authentication: AuthenticationManager
    @EnvironmentObject private var tracker: JourneyTracker
    @StateObject private var locator = LogLocationProvider()
    @State private var places: [PlaceSummary] = []
    @State private var sortedPlaces: [PlaceSummary] = []
    @State private var boardLabels: [PlaceLabel] = []
    @State private var selectedPlaceID = ""
    @State private var selectedMooringLabelID = ""
    @State private var showAllPlaces = false
    @State private var action: String
    @State private var journeyName = ""
    @State private var litres = ""
    @State private var temperature = ""
    @State private var customText = ""
    @State private var timestamp = Date()
    @State private var notificationMode: LogNotificationMode
    @State private var isSaving = false
    @State private var logWasSaved = false
    @State private var errorMessage: String?

    private let initialAction: String?
    private let nearbyPlaceLimit = 10
    private let logTextLimit = 160

    init(initialAction: String?) {
        self.initialAction = initialAction
        let action = initialAction ?? "arrived"
        _action = State(initialValue: action)
        _notificationMode = State(initialValue: Self.defaultNotificationMode(for: action))
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("What happened?") {
                    Picker("Action", selection: $action) {
                        ForEach(actions, id: \.key) { item in
                            Label(item.label, systemImage: item.icon).tag(item.key)
                        }
                    }
                    .disabled(initialAction == "departed")
                }

                Section("Where?") {
                    if places.isEmpty {
                        ProgressView("Finding nearby places…")
                    } else {
                        Picker("Place", selection: $selectedPlaceID) {
                            ForEach(displayedPlaces) { place in
                                Text(place.listName.map { "\(place.name) · \($0)" } ?? place.name)
                                    .tag(place.id)
                            }
                        }
                        if canToggleAllPlaces {
                            Button(showAllPlaces ? "Show nearby only" : "Show all \(sortedPlaces.count) places") {
                                showAllPlaces.toggle()
                            }
                            .font(.footnote)
                        }
                    }
                    if let coordinate = logCoordinate {
                        LabeledContent("Position", value: String(format: "%.4f°, %.4f°", coordinate.latitude, coordinate.longitude))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                if action == "arrived" {
                    Section("Mooring") {
                        if mooringLabels.isEmpty {
                            Label("No orange mooring labels are configured on the Trello board.", systemImage: "exclamationmark.triangle")
                                .font(.footnote)
                                .foregroundStyle(.orange)
                        } else {
                            Picker("Mooring type", selection: $selectedMooringLabelID) {
                                Text("Select a mooring type").tag("")
                                ForEach(mooringLabels) { label in
                                    Text(label.name).tag(label.id)
                                }
                            }
                        }
                    }
                }

                if action == "departed" {
                    Section("Journey") {
                        TextField("Journey name", text: $journeyName)
                            .onChange(of: journeyName) { enforceLogTextLimit(on: $journeyName) }
                        Text("\(journeyName.utf16.count)/\(logTextLimit)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text("Saving the Departure entry starts live GPS tracking.")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                if action == "water" || action == "diesel" {
                    Section("Quantity (optional)") {
                        TextField("Litres", text: $litres)
                            .keyboardType(.decimalPad)
                    }
                }

                if action == "temperature" {
                    Section("Temperature") {
                        TextField("Degrees °C", text: $temperature)
                            .keyboardType(.decimalPad)
                    }
                }

                if action == "other" {
                    Section("Details") {
                        TextField("What happened?", text: $customText)
                            .onChange(of: customText) { enforceLogTextLimit(on: $customText) }
                        Text("\(customText.utf16.count)/\(logTextLimit)")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                Section("When?") {
                    DatePicker("Date and time", selection: $timestamp, in: ...Date())
                }

                Section("Notification") {
                    Picker("Email", selection: $notificationMode) {
                        ForEach(LogNotificationMode.allCases) { mode in
                            Text(mode.label).tag(mode)
                        }
                    }
                    Text(notificationMode.detail)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }

                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }
            }
            .scrollContentBackground(.hidden)
            .background(Chartroom.paper)
            .navigationTitle(initialAction == "departed" ? "Start Journey" : "New Log Entry")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(logWasSaved ? "Done" : (action == "departed" ? "Start" : "Save")) {
                        if logWasSaved {
                            dismiss()
                        } else {
                            Task { await save() }
                        }
                    }
                    .disabled(isSaving || (!logWasSaved && !canSave))
                }
            }
            .onChange(of: selectedPlaceID) {
                selectedMooringLabelID = ""
                updateSuggestedJourneyName()
            }
            .onChange(of: locatorCoordinateKey) { updateSortedPlaces() }
            .onChange(of: action) {
                if action != "arrived" { selectedMooringLabelID = "" }
                updateSuggestedJourneyName()
                notificationMode = Self.defaultNotificationMode(for: action)
            }
            .task { await load() }
        }
    }

    private static func defaultNotificationMode(for action: String) -> LogNotificationMode {
        ["arrived", "departed", "visited"].contains(action) ? .people : .none
    }

    private var actions: [(key: String, label: String, icon: String)] {
        [
            ("arrived", "Arrived", "sailboat.fill"),
            ("departed", "Departed", "sailboat"),
            ("visited", "Visited", "mappin.and.ellipse"),
            ("water", "Water", "drop.fill"),
            ("diesel", "Diesel", "fuelpump"),
            ("temperature", "Temperature", "thermometer.medium"),
            ("bins", "Bins", "trash"),
            ("bbq-gas-change", "BBQ Gas Change", "flame.fill"),
            ("gas-tank-change", "Gas Tank Change", "cylinder.fill"),
            ("water-tank-change", "Water Tank Change", "drop.triangle.fill"),
            ("power", "Shore power", "bolt.fill"),
            ("boom", "Boom", "wrench.and.screwdriver"),
            ("other", "Other", "square.and.pencil")
        ]
    }

    private var selectedPlace: PlaceSummary? {
        places.first { $0.id == selectedPlaceID }
    }

    private var mooringLabels: [PlaceLabel] {
        boardLabels
            .filter {
                $0.trelloColor?.lowercased() == "orange" ||
                    $0.color?.lowercased() == "#ff9f1a"
            }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private var canToggleAllPlaces: Bool {
        sortingOriginCoordinate != nil && sortedPlaces.count > nearbyPlaceLimit
    }

    private var displayedPlaces: [PlaceSummary] {
        guard canToggleAllPlaces, !showAllPlaces else { return sortedPlaces }
        var nearby = Array(sortedPlaces.prefix(nearbyPlaceLimit))
        if let selectedPlace, !nearby.contains(where: { $0.id == selectedPlace.id }) {
            nearby.append(selectedPlace)
        }
        return nearby
    }

    private var canSave: Bool {
        selectedPlace != nil &&
            logCoordinate != nil &&
            (action != "arrived" || !selectedMooringLabelID.isEmpty) &&
            (action != "other" || !customText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            && (action != "temperature" || parsedTemperature != nil)
    }

    private var logCoordinate: CLLocationCoordinate2D? {
        locator.coordinate ?? tracker.currentJourney?.position?.coordinate ?? selectedPlace?.coordinate
    }

    private var parsedTemperature: Double? {
        Double(temperature.replacingOccurrences(of: ",", with: "."))
    }

    private var locatorCoordinateKey: String? {
        locator.coordinate.map { "\($0.latitude),\($0.longitude)" }
    }

    private var sortingOriginCoordinate: CLLocationCoordinate2D? {
        locator.coordinate ??
            tracker.currentJourney?.position?.coordinate ??
            tracker.currentStatus?.current?.coordinate ??
            tracker.currentStatus?.from?.coordinate
    }

    private func sortedByDistance(_ places: [PlaceSummary]) -> [PlaceSummary] {
        guard let coordinate = sortingOriginCoordinate else { return places }
        let origin = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        return places.sorted { left, right in
            distance(from: origin, to: left) < distance(from: origin, to: right)
        }
    }

    private func updateSortedPlaces() {
        sortedPlaces = sortedByDistance(places)
    }

    private func distance(from origin: CLLocation, to place: PlaceSummary) -> CLLocationDistance {
        guard let coordinate = place.coordinate else { return .greatestFiniteMagnitude }
        return origin.distance(from: CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude))
    }

    @MainActor private func load() async {
        locator.locate()
        guard let token = authentication.token else { return }
        do {
            let planning = try await authentication.api.planning(token: token)
            boardLabels = planning.boardLabels ?? []
            var byID = Dictionary(uniqueKeysWithValues: planning.places.map { ($0.id, $0) })
            for stop in planning.stops { byID[stop.id] = stop }
            if let current = tracker.currentStatus?.current ?? tracker.currentStatus?.from {
                byID[current.id] = current
                selectedPlaceID = current.id
            }
            places = Array(byID.values).sorted { $0.name < $1.name }
            updateSortedPlaces()
            if selectedPlaceID.isEmpty { selectedPlaceID = sortedPlaces.first?.id ?? "" }
            updateSuggestedJourneyName()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func updateSuggestedJourneyName() {
        guard action == "departed", journeyName.isEmpty, let place = selectedPlace else { return }
        let destination = tracker.currentStatus?.plannedDestination?.name ?? tracker.currentStatus?.destination?.name
        journeyName = destination.map { "\(place.name) → \($0)" } ?? "Journey from \(place.name)"
    }

    private func enforceLogTextLimit(on text: Binding<String>) {
        var limited = text.wrappedValue
        while limited.utf16.count > logTextLimit {
            limited.removeLast()
        }
        if limited != text.wrappedValue {
            text.wrappedValue = limited
        }
    }

    @MainActor private func save() async {
        guard let token = authentication.token, let place = selectedPlace, let coordinate = logCoordinate else { return }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            let quantity = Double(litres)
            let temperatureValue = parsedTemperature
            let details = action == "other" ? customText.trimmingCharacters(in: .whitespacesAndNewlines) : nil
            try await authentication.api.addLogEntry(
                action: action,
                cardID: place.id,
                latitude: coordinate.latitude,
                longitude: coordinate.longitude,
                journeyName: action == "departed" ? journeyName : nil,
                mooringLabelID: action == "arrived" ? selectedMooringLabelID : nil,
                placeName: place.name,
                customText: details,
                timestamp: timestamp,
                litres: quantity,
                temperature: temperatureValue,
                token: token
            )
            logWasSaved = true
            if notificationMode != .none {
                do {
                    _ = try await authentication.api.sendLogNotification(
                        mode: notificationMode.rawValue,
                        action: action,
                        cardID: place.id,
                        latitude: coordinate.latitude,
                        longitude: coordinate.longitude,
                        timestamp: timestamp,
                        litres: quantity,
                        temperature: temperatureValue,
                        customText: details,
                        token: token
                    )
                } catch {
                    await tracker.refresh()
                    errorMessage = "The log was saved, but the email could not be sent: \(error.localizedDescription)"
                    return
                }
            }
            await tracker.refresh()
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

@MainActor
private final class LogLocationProvider: NSObject, ObservableObject, @preconcurrency CLLocationManagerDelegate {
    @Published private(set) var coordinate: CLLocationCoordinate2D?
    private let manager = CLLocationManager()

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    func locate() {
        manager.requestWhenInUseAuthorization()
        manager.requestLocation()
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        coordinate = locations.last?.coordinate
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {}
}

struct PlanView: View {
    @EnvironmentObject private var authentication: AuthenticationManager
    @EnvironmentObject private var tracker: JourneyTracker
    @State private var data: PlanningResponse?
    @State private var currentStatus: CurrentStatusResponse?
    @State private var route: PlanningRouteResponse?
    @State private var legByDestinationID: [String: PlanningRouteLeg] = [:]
    @State private var routeLoading = false
    @State private var speedKnots = 6.0
    @State private var camera: MapCameraPosition = .automatic
    @State private var visibleRegion: MKCoordinateRegion?
    @State private var hasSetInitialCamera = false
    @State private var errorMessage: String?
    @State private var searchText = ""
    @State private var workingCardID: String?

    private let initialMapRadiusMeters: CLLocationDistance = 1_000

    var body: some View {
        NavigationStack {
            List {
                Section {
                    planningMap
                    if !plannedStops.isEmpty {
                        routeSummary
                    }
                }
                if let errorMessage {
                    Section {
                        Label(errorMessage, systemImage: "exclamationmark.triangle")
                            .font(.footnote)
                            .foregroundStyle(.red)
                    }
                }
                Section("Planned stops") {
                    if data == nil {
                        ProgressView("Loading planned stops…")
                    } else if plannedStops.isEmpty {
                        ContentUnavailableView("No stops planned", systemImage: "map", description: Text("Choose a place below to add the next stop."))
                    }
                    ForEach(plannedStops) { stop in
                        placeRow(stop, isPlanned: true)
                    }
                }
                Section("Places in map") {
                    if data == nil {
                        ProgressView("Loading places…")
                    } else if filteredPlaces.isEmpty {
                        ContentUnavailableView(
                            searchText.isEmpty ? "No places in this map area" : "No matching places in this map area",
                            systemImage: "mappin.slash",
                            description: Text("Pan or zoom the map to see saved places here.")
                        )
                    }
                    ForEach(filteredPlaces) { place in
                        placeRow(place, isPlanned: false)
                    }
                }
            }
            .navigationTitle("Planning")
            .searchable(text: $searchText, prompt: "Search places")
            .task { await load() }
            .refreshable { await load() }
        }
    }

    private var plannedStops: [PlaceSummary] {
        (data?.stops ?? [])
            .filter { $0.dueComplete != true }
            .sorted {
                switch ($0.due, $1.due) {
                case let (left?, right?): left < right
                case (_?, nil): true
                case (nil, _?): false
                case (nil, nil): $0.name < $1.name
                }
            }
    }

    private var routeStops: [PlaceSummary] {
        var stops = plannedStops.filter { $0.coordinate != nil }
        let start: PlaceSummary?
        if currentStatus?.status == "underway" {
            start = currentStatus?.from
        } else {
            start = currentStatus?.current
        }
        if let start, start.coordinate != nil, stops.first?.id != start.id {
            stops.insert(start, at: 0)
        }
        return stops
    }

    private var mapPlaces: [PlaceSummary] {
        var byID: [String: PlaceSummary] = [:]
        for place in data?.places ?? [] { byID[place.id] = place }
        for stop in data?.stops ?? [] { byID[stop.id] = stop }
        if let current = currentStatus?.current ?? currentStatus?.from {
            byID[current.id] = current
        }
        return byID.values
            .filter { $0.coordinate != nil }
            .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private var currentMapCoordinate: CLLocationCoordinate2D? {
        tracker.currentJourney?.position?.coordinate ??
            currentStatus?.current?.coordinate ??
            currentStatus?.from?.coordinate ??
            tracker.currentStatus?.current?.coordinate ??
            tracker.currentStatus?.from?.coordinate
    }

    private var planningMap: some View {
        Map(position: $camera) {
            if let route {
                ForEach(Array(route.legs.enumerated()), id: \.offset) { _, leg in
                    if leg.mapCoordinates.count > 1 {
                        MapPolyline(coordinates: leg.mapCoordinates)
                            .stroke(Chartroom.signal, lineWidth: 4)
                    }
                }
            }
            ForEach(mapPlaces) { place in
                if let coordinate = place.coordinate {
                    Annotation(place.name, coordinate: coordinate) {
                        mapMarker(for: place)
                    }
                }
            }
            if let coordinate = currentMapCoordinate {
                Annotation("Skibidi", coordinate: coordinate) {
                    Image(systemName: "sailboat.fill")
                        .padding(9)
                        .foregroundStyle(Chartroom.ink)
                        .background(Chartroom.surface, in: Circle())
                        .overlay(Circle().stroke(Chartroom.sea, lineWidth: 3))
                }
            }
        }
        .mapStyle(.standard(elevation: .realistic))
        .frame(height: 300)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .listRowInsets(EdgeInsets())
        .onMapCameraChange(frequency: .onEnd) { context in
            visibleRegion = context.region
        }
        .accessibilityLabel("Saved places and planned sea route")
    }

    private func mapMarker(for place: PlaceSummary) -> some View {
        let plannedIndex = plannedStops.firstIndex(where: { $0.id == place.id }).map { $0 + 1 }
        let rating = place.rating.map { min(5, max(1, $0)) }
        return ZStack(alignment: .topTrailing) {
            Circle()
                .fill(markerColor(for: place, isPlanned: plannedIndex != nil))
                .frame(width: 34, height: 34)
                .overlay {
                    Image(systemName: rating == nil ? (plannedIndex == nil ? "mappin" : "mappin.and.ellipse") : "star.fill")
                        .font(.caption.bold())
                        .foregroundStyle(markerForeground(for: rating))
                }
                .overlay(Circle().stroke(.white.opacity(0.9), lineWidth: 2))
                .shadow(color: .black.opacity(0.2), radius: 2, y: 1)
            if let plannedIndex {
                Text("\(plannedIndex)")
                    .font(.caption2.bold())
                    .foregroundStyle(.white)
                    .frame(width: 17, height: 17)
                    .background(Chartroom.signal, in: Circle())
                    .offset(x: 6, y: -6)
            }
        }
        .accessibilityLabel(markerAccessibilityLabel(for: place, plannedIndex: plannedIndex))
    }

    private func markerColor(for place: PlaceSummary, isPlanned: Bool) -> Color {
        guard let rating = place.rating else {
            if isPlanned { return Chartroom.signal }
            let visited = place.labels?.contains { $0.name.localizedCaseInsensitiveCompare("visited") == .orderedSame } == true
            return visited ? Color(white: 0.33) : Color(white: 0.74)
        }
        switch rating {
        case 5...: return Color(red: 0, green: 0.5, blue: 0)
        case 4: return Color(red: 0.56, green: 0.93, blue: 0.56)
        case 3: return Color(red: 1, green: 1, blue: 0.72)
        case 2: return Color(red: 1, green: 0.72, blue: 0.71)
        default: return .red
        }
    }

    private func markerForeground(for rating: Int?) -> Color {
        guard let rating else { return .white }
        return (2...4).contains(rating) ? .black : .white
    }

    private func markerAccessibilityLabel(for place: PlaceSummary, plannedIndex: Int?) -> String {
        var parts = [place.name]
        if let rating = place.rating { parts.append("\(rating) out of 5 stars") }
        if let plannedIndex { parts.append("planned stop \(plannedIndex)") }
        return parts.joined(separator: ", ")
    }

    private var routeSummary: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Label(distanceText(totalDistance), systemImage: "point.topleft.down.to.point.bottomright.curvepath")
                Spacer()
                Label(durationText(for: totalDistance), systemImage: "clock")
            }
            .font(.headline)
            HStack {
                Text("Passage speed")
                Spacer()
                Stepper(value: $speedKnots, in: 1...15, step: 0.5) {
                    Text("\(speedKnots, specifier: "%.1f") kn")
                        .monospacedDigit()
                }
                .fixedSize()
            }
            .font(.subheadline)
            if routeLoading {
                ProgressView("Calculating coastline-aware route…")
                    .font(.caption)
            } else if route?.legs.contains(where: { $0.distanceNm == nil }) == true {
                Label("One or more legs could not be routed safely.", systemImage: "exclamationmark.triangle")
                    .font(.caption)
                    .foregroundStyle(.orange)
            }
        }
        .padding(.vertical, 6)
    }

    private var totalDistance: Double? {
        guard let legs = route?.legs, !legs.isEmpty else { return nil }
        let distances = legs.compactMap(\.distanceNm)
        guard distances.count == legs.count else { return nil }
        return distances.reduce(0, +)
    }

    private var filteredPlaces: [PlaceSummary] {
        guard let places = data?.places else { return [] }
        return places.filter { place in
            guard let coordinate = place.coordinate else { return false }
            let matchesSearch = searchText.isEmpty ||
                place.name.localizedCaseInsensitiveContains(searchText) ||
                (place.listName?.localizedCaseInsensitiveContains(searchText) ?? false)
            return matchesSearch && isVisible(coordinate)
        }
        .sorted { $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending }
    }

    private func isVisible(_ coordinate: CLLocationCoordinate2D) -> Bool {
        guard let visibleRegion else { return true }
        let latitudeDistance = abs(coordinate.latitude - visibleRegion.center.latitude)
        let rawLongitudeDistance = abs(coordinate.longitude - visibleRegion.center.longitude)
        let longitudeDistance = min(rawLongitudeDistance, 360 - rawLongitudeDistance)
        return latitudeDistance <= abs(visibleRegion.span.latitudeDelta) / 2 &&
            longitudeDistance <= abs(visibleRegion.span.longitudeDelta) / 2
    }

    private func placeRow(_ place: PlaceSummary, isPlanned: Bool) -> some View {
        HStack(spacing: 12) {
            Image(systemName: place.rating == nil ? (isPlanned ? "mappin.and.ellipse" : "mappin") : "star.circle.fill")
                .foregroundStyle(markerColor(for: place, isPlanned: isPlanned))
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 3) {
                Text(place.name).font(.headline)
                HStack(spacing: 6) {
                    if let listName = place.listName { Text(listName) }
                    if let due = place.due { Text("· \(due.formatted(date: .abbreviated, time: .omitted))") }
                    if let rating = place.rating { Text("· \(rating)★") }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
                if isPlanned, let leg = legByDestinationID[place.id] {
                    HStack(spacing: 8) {
                        Label(distanceText(leg.distanceNm), systemImage: "ruler")
                        Label(durationText(for: leg.distanceNm), systemImage: "clock")
                    }
                    .font(.caption)
                    .foregroundStyle(Chartroom.sea)
                }
            }
            Spacer()
            if workingCardID == place.id {
                ProgressView()
            } else if isPlanned {
                Button(role: .destructive) { Task { await remove(place) } } label: {
                    Image(systemName: "minus.circle")
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Remove \(place.name) from plan")
            } else {
                Button { Task { await plan(place) } } label: {
                    Image(systemName: "plus.circle.fill")
                }
                .buttonStyle(.borderless)
                .accessibilityLabel("Plan \(place.name)")
            }
        }
    }

    @MainActor private func load() async {
        focusInitialMapIfNeeded()
        guard let token = authentication.token else { return }
        do {
            async let planningRequest = authentication.api.planning(token: token)
            async let statusRequest = authentication.api.currentStatus(token: token)
            let (planning, status) = try await (planningRequest, statusRequest)
            data = planning
            currentStatus = status
            errorMessage = nil
            focusInitialMapIfNeeded()
            await loadRoute(token: token)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor private func focusInitialMapIfNeeded() {
        guard !hasSetInitialCamera else { return }
        guard let coordinate = currentMapCoordinate ?? mapPlaces.first?.coordinate else { return }
        let region = MKCoordinateRegion(
            center: coordinate,
            latitudinalMeters: initialMapRadiusMeters * 2,
            longitudinalMeters: initialMapRadiusMeters * 2
        )
        camera = .region(region)
        visibleRegion = region
        hasSetInitialCamera = true
    }

    @MainActor private func loadRoute(token: String) async {
        let sequence = routeStops
        guard sequence.count > 1 else {
            route = nil
            legByDestinationID = [:]
            return
        }
        let points = sequence.compactMap { stop -> PlanningRoutePoint? in
            guard let lat = stop.lat, let lng = stop.lng else { return nil }
            return PlanningRoutePoint(lat: lat, lng: lng)
        }
        routeLoading = true
        defer { routeLoading = false }
        do {
            let response = try await authentication.api.planningRoute(points: points, token: token)
            route = response
            legByDestinationID = Dictionary(
                uniqueKeysWithValues: zip(sequence.dropFirst(), response.legs).map { ($0.id, $1) }
            )
        } catch {
            route = nil
            legByDestinationID = [:]
            errorMessage = error.localizedDescription
        }
    }

    private func distanceText(_ distance: Double?) -> String {
        guard let distance else { return "Route unavailable" }
        return String(format: "%.1f NM", distance)
    }

    private func durationText(for distance: Double?) -> String {
        guard let distance, speedKnots > 0 else { return "—" }
        let minutes = Int((distance / speedKnots * 60).rounded())
        let hours = minutes / 60
        let remainingMinutes = minutes % 60
        return hours > 0 ? "\(hours)h \(remainingMinutes)m" : "\(remainingMinutes)m"
    }

    @MainActor private func plan(_ place: PlaceSummary) async {
        guard let token = authentication.token else { return }
        workingCardID = place.id
        defer { workingCardID = nil }
        do {
            let lastDate = plannedStops.compactMap(\.due).max() ?? Date()
            let due = Calendar.current.date(byAdding: .day, value: 1, to: max(lastDate, Date())) ?? Date()
            try await authentication.api.planStop(cardID: place.id, due: due, token: token)
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor private func remove(_ place: PlaceSummary) async {
        guard let token = authentication.token else { return }
        workingCardID = place.id
        defer { workingCardID = nil }
        do {
            try await authentication.api.removeStop(cardID: place.id, token: token)
            await load()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct LogbookView: View {
    @EnvironmentObject private var authentication: AuthenticationManager
    @State private var logs: [LogEntry] = []
    @State private var voyages: [VoyageSummary] = []
    @State private var selectedVoyageIDs: Set<String> = []
    @State private var hasInitialVoyageSelection = false
    @State private var errorMessage: String?
    @State private var loading = true

    var body: some View {
        NavigationStack {
            Group {
                if loading { ProgressView("Opening logbook…") }
                else if let errorMessage { ContentUnavailableView("Couldn’t open logbook", systemImage: "exclamationmark.triangle", description: Text(errorMessage)) }
                else {
                    List {
                        if !voyages.isEmpty {
                            Section("Voyage") {
                                voyageSelector
                            }
                        }

                        if filteredLogs.isEmpty {
                            ContentUnavailableView(
                                "No entries in this selection",
                                systemImage: "book.closed",
                                description: Text("Choose another voyage or show all entries.")
                            )
                            .listRowBackground(Color.clear)
                        } else {
                            Section {
                                ForEach(filteredLogs.sorted { $0.timestamp > $1.timestamp }) { entry in
                                    HStack(alignment: .top, spacing: 12) {
                                        Image(systemName: icon(for: entry.type))
                                            .foregroundStyle(Chartroom.sea)
                                            .frame(width: 24)
                                        VStack(alignment: .leading, spacing: 4) {
                                            HStack {
                                                Text(entry.type).font(.caption.bold()).foregroundStyle(Chartroom.sea)
                                                Spacer()
                                                Text(entry.timestamp.formatted(date: .abbreviated, time: .shortened))
                                                    .font(.caption2).foregroundStyle(.secondary)
                                            }
                                            Text(entry.cardName).font(.headline)
                                            if let area = entry.area { Text(area).font(.caption).foregroundStyle(.secondary) }
                                        }
                                    }
                                    .padding(.vertical, 3)
                                }
                            }
                        }
                    }
                }
            }
            .navigationTitle("Logbook")
            .task { await load() }
            .refreshable { await load() }
        }
    }

    private var voyageSelector: some View {
        Menu {
            Button {
                selectedVoyageIDs.removeAll()
                hasInitialVoyageSelection = true
            } label: {
                Label("All entries", systemImage: selectedVoyageIDs.isEmpty ? "checkmark" : "circle")
            }

            Divider()

            ForEach(voyages) { voyage in
                Button {
                    toggle(voyage)
                } label: {
                    Label(
                        voyage.name,
                        systemImage: selectedVoyageIDs.contains(voyage.id) ? "checkmark" : "circle"
                    )
                }
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "sailboat")
                    .foregroundStyle(Chartroom.sea)
                    .frame(width: 24)
                VStack(alignment: .leading, spacing: 2) {
                    Text(selectionTitle).foregroundStyle(.primary)
                    Text(selectionDetail).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.up.chevron.down")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .contentShape(Rectangle())
        }
    }

    private var selectedVoyages: [VoyageSummary] {
        voyages.filter { selectedVoyageIDs.contains($0.id) }
    }

    private var filteredLogs: [LogEntry] {
        guard !selectedVoyageIDs.isEmpty else { return logs }
        return logs.filter { entry in
            selectedVoyages.contains { includes(entry, in: $0) }
        }
    }

    private func includes(_ entry: LogEntry, in voyage: VoyageSummary) -> Bool {
        if let start = voyage.start, entry.timestamp < start { return false }
        if let end = voyage.end, entry.timestamp > end { return false }
        return true
    }

    private var selectionTitle: String {
        if selectedVoyageIDs.isEmpty { return "All entries" }
        if selectedVoyages.count == 1 { return selectedVoyages[0].name }
        return "\(selectedVoyages.count) voyages"
    }

    private var selectionDetail: String {
        if selectedVoyageIDs.isEmpty { return "Every logbook entry" }
        if selectedVoyages.count == 1 { return dateRange(selectedVoyages[0]) }
        return "Combined logbook entries"
    }

    private func dateRange(_ voyage: VoyageSummary) -> String {
        let start = voyage.start?.formatted(date: .abbreviated, time: .omitted) ?? "Beginning"
        let end = voyage.end?.formatted(date: .abbreviated, time: .omitted) ?? "Present"
        return "\(start) – \(end)"
    }

    private func toggle(_ voyage: VoyageSummary) {
        hasInitialVoyageSelection = true
        if selectedVoyageIDs.contains(voyage.id) {
            selectedVoyageIDs.remove(voyage.id)
        } else {
            selectedVoyageIDs.insert(voyage.id)
        }
    }

    private func selectCurrentVoyageIfNeeded(allowAll: Bool = false) {
        guard !hasInitialVoyageSelection else { return }
        let now = Date()
        if let current = voyages.first(where: { voyage in
            guard let start = voyage.start, start <= now else { return false }
            return voyage.end.map { now <= $0 } ?? true
        }) {
            selectedVoyageIDs = [current.id]
            hasInitialVoyageSelection = true
        } else if allowAll {
            selectedVoyageIDs.removeAll()
            hasInitialVoyageSelection = true
        }
    }

    private func icon(for type: String) -> String {
        switch type.lowercased() {
        case "arrived", "visited": "sailboat.fill"
        case "departed": "sailboat"
        case "diesel": "fuelpump"
        case "water": "drop.fill"
        case "broken": "wrench.and.screwdriver"
        default: "book.closed"
        }
    }

    @MainActor private func load() async {
        guard let token = authentication.token else { return }
        errorMessage = nil

        async let cachedLogs = authentication.api.cachedLogs()
        async let cachedVoyages = authentication.api.cachedVoyages()
        let (savedLogs, savedVoyages) = await (cachedLogs, cachedVoyages)

        if logs.isEmpty, let savedLogs {
            logs = savedLogs.logs
            loading = false
        } else {
            loading = logs.isEmpty
        }

        if voyages.isEmpty, let savedVoyages {
            voyages = savedVoyages.voyages
            if !voyages.isEmpty { selectCurrentVoyageIfNeeded() }
        }

        defer { loading = false }

        async let freshLogs = authentication.api.logs(token: token)
        async let freshVoyages = authentication.api.voyages(token: token)

        do {
            voyages = try await freshVoyages.voyages
            selectCurrentVoyageIfNeeded(allowAll: true)
        } catch {
            // Voyage metadata is optional; the complete logbook remains useful.
        }

        do {
            logs = try await freshLogs.logs
            errorMessage = nil
        } catch {
            if logs.isEmpty {
                errorMessage = error.localizedDescription
            }
        }
    }
}

struct TodoView: View {
    @EnvironmentObject private var authentication: AuthenticationManager
    @State private var lists: [TodoList] = []
    @State private var selectedListID = ""
    @State private var newItem = ""
    @State private var errorMessage: String?
    @State private var loading = true

    var body: some View {
        NavigationStack {
            Group {
                if loading { ProgressView("Loading tasks…") }
                else if let errorMessage, lists.isEmpty { ContentUnavailableView("Couldn’t load tasks", systemImage: "exclamationmark.triangle", description: Text(errorMessage)) }
                else {
                    List {
                        Section {
                            HStack {
                                TextField("New task", text: $newItem)
                                Button("Add") { Task { await addItem() } }
                                    .disabled(newItem.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                            }
                        }
                        Section("Open") {
                            ForEach(selectedList?.cards.filter { !$0.dueComplete } ?? []) { card in
                                todoRow(card)
                            }
                        }
                        Section("Completed") {
                            ForEach(selectedList?.cards.filter(\.dueComplete) ?? []) { card in
                                todoRow(card)
                            }
                        }
                    }
                }
            }
            .navigationTitle("To Do")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    if lists.count > 1 {
                        Picker("List", selection: $selectedListID) {
                            ForEach(lists) { Text($0.name).tag($0.id) }
                        }
                    }
                }
            }
            .task { await load() }
            .refreshable { await load() }
        }
    }

    private var selectedList: TodoList? {
        lists.first { $0.id == selectedListID } ?? lists.first
    }

    private func todoRow(_ card: TodoCard) -> some View {
        Button { Task { await toggle(card) } } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: card.dueComplete ? "checkmark.circle.fill" : "circle")
                    .foregroundStyle(card.dueComplete ? Chartroom.sea : .secondary)
                VStack(alignment: .leading, spacing: 3) {
                    Text(card.name)
                        .strikethrough(card.dueComplete)
                        .foregroundStyle(.primary)
                    if let desc = card.desc, !desc.isEmpty {
                        Text(desc).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }
                }
            }
        }
        .buttonStyle(.plain)
    }

    @MainActor private func load() async {
        guard let token = authentication.token else { return }
        loading = true
        defer { loading = false }
        do {
            lists = try await authentication.api.todoData(token: token).lists
            if !lists.contains(where: { $0.id == selectedListID }) { selectedListID = lists.first?.id ?? "" }
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription }
    }

    @MainActor private func addItem() async {
        guard let token = authentication.token, let listID = selectedList?.id else { return }
        let name = newItem.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { return }
        do {
            try await authentication.api.addTodo(name: name, listID: listID, token: token)
            newItem = ""
            await load()
        } catch { errorMessage = error.localizedDescription }
    }

    @MainActor private func toggle(_ card: TodoCard) async {
        guard let token = authentication.token else { return }
        do {
            try await authentication.api.setTodoCompletion(cardID: card.id, complete: !card.dueComplete, token: token)
            await load()
        } catch { errorMessage = error.localizedDescription }
    }
}
