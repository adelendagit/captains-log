import MapKit
import SwiftUI

struct LogEntryIntent: Identifiable {
    let id = UUID()
    let action: String?
}

struct AddLogEntryView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var authentication: AuthenticationManager
    @EnvironmentObject private var tracker: JourneyTracker
    @StateObject private var locator = LogLocationProvider()
    @State private var places: [PlaceSummary] = []
    @State private var selectedPlaceID = ""
    @State private var action: String
    @State private var journeyName = ""
    @State private var litres = ""
    @State private var customText = ""
    @State private var timestamp = Date()
    @State private var isSaving = false
    @State private var errorMessage: String?

    private let initialAction: String?

    init(initialAction: String?) {
        self.initialAction = initialAction
        _action = State(initialValue: initialAction ?? "arrived")
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
                            ForEach(sortedPlaces) { place in
                                Text(place.listName.map { "\(place.name) · \($0)" } ?? place.name)
                                    .tag(place.id)
                            }
                        }
                    }
                    if let coordinate = logCoordinate {
                        LabeledContent("Position", value: String(format: "%.4f°, %.4f°", coordinate.latitude, coordinate.longitude))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                if action == "departed" {
                    Section("Journey") {
                        TextField("Journey name", text: $journeyName)
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

                if action == "other" {
                    Section("Details") {
                        TextField("What happened?", text: $customText)
                    }
                }

                Section("When?") {
                    DatePicker("Date and time", selection: $timestamp, in: ...Date())
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
                    Button(action == "departed" ? "Start" : "Save") {
                        Task { await save() }
                    }
                    .disabled(isSaving || selectedPlace == nil || logCoordinate == nil || (action == "other" && customText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty))
                }
            }
            .onChange(of: selectedPlaceID) { updateSuggestedJourneyName() }
            .onChange(of: action) { updateSuggestedJourneyName() }
            .task { await load() }
        }
    }

    private var actions: [(key: String, label: String, icon: String)] {
        [
            ("arrived", "Arrived", "sailboat.fill"),
            ("departed", "Departed", "sailboat"),
            ("visited", "Visited", "mappin.and.ellipse"),
            ("water", "Water", "drop.fill"),
            ("diesel", "Diesel", "fuelpump"),
            ("bins", "Bins", "trash"),
            ("water-tank-change", "Water Tank Change", "drop.triangle.fill"),
            ("power", "Shore power", "bolt.fill"),
            ("boom", "Boom", "wrench.and.screwdriver"),
            ("other", "Other", "square.and.pencil")
        ]
    }

    private var selectedPlace: PlaceSummary? {
        places.first { $0.id == selectedPlaceID }
    }

    private var logCoordinate: CLLocationCoordinate2D? {
        locator.coordinate ?? tracker.currentJourney?.position?.coordinate ?? selectedPlace?.coordinate
    }

    private var sortedPlaces: [PlaceSummary] {
        guard let coordinate = locator.coordinate else { return places }
        let origin = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
        return places.sorted { left, right in
            distance(from: origin, to: left) < distance(from: origin, to: right)
        }
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
            var byID = Dictionary(uniqueKeysWithValues: planning.places.map { ($0.id, $0) })
            for stop in planning.stops { byID[stop.id] = stop }
            if let current = tracker.currentStatus?.current ?? tracker.currentStatus?.from {
                byID[current.id] = current
                selectedPlaceID = current.id
            }
            places = Array(byID.values).sorted { $0.name < $1.name }
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

    @MainActor private func save() async {
        guard let token = authentication.token, let place = selectedPlace, let coordinate = logCoordinate else { return }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }
        do {
            try await authentication.api.addLogEntry(
                action: action,
                cardID: place.id,
                latitude: coordinate.latitude,
                longitude: coordinate.longitude,
                journeyName: action == "departed" ? journeyName : nil,
                placeName: place.name,
                customText: action == "other" ? customText.trimmingCharacters(in: .whitespacesAndNewlines) : nil,
                timestamp: timestamp,
                litres: Double(litres),
                token: token
            )
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
    @State private var data: PlanningResponse?
    @State private var currentStatus: CurrentStatusResponse?
    @State private var route: PlanningRouteResponse?
    @State private var legByDestinationID: [String: PlanningRouteLeg] = [:]
    @State private var routeLoading = false
    @State private var speedKnots = 6.0
    @State private var camera: MapCameraPosition = .automatic
    @State private var errorMessage: String?
    @State private var searchText = ""
    @State private var workingCardID: String?

    var body: some View {
        NavigationStack {
            Group {
                if data != nil {
                    List {
                        if !plannedStops.isEmpty {
                            Section {
                                planningMap
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
                            if plannedStops.isEmpty {
                                ContentUnavailableView("No stops planned", systemImage: "map", description: Text("Choose a place below to add the next stop."))
                            }
                            ForEach(plannedStops) { stop in
                                placeRow(stop, isPlanned: true)
                            }
                        }
                        Section("Places") {
                            ForEach(filteredPlaces) { place in
                                placeRow(place, isPlanned: false)
                            }
                        }
                    }
                } else if let errorMessage {
                    ContentUnavailableView("Couldn’t load planning", systemImage: "exclamationmark.triangle", description: Text(errorMessage))
                } else {
                    ProgressView("Loading chart…")
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
            ForEach(Array(routeStops.enumerated()), id: \.element.id) { index, stop in
                if let coordinate = stop.coordinate {
                    Annotation(stop.name, coordinate: coordinate) {
                        ZStack {
                            Circle()
                                .fill(index == 0 ? Chartroom.sea : Chartroom.signal)
                                .frame(width: 30, height: 30)
                            Text(index == 0 ? "●" : "\(index)")
                                .font(.caption.bold())
                                .foregroundStyle(.white)
                        }
                    }
                }
            }
        }
        .mapStyle(.standard(elevation: .realistic))
        .frame(height: 260)
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .listRowInsets(EdgeInsets())
        .accessibilityLabel("Planned sea route")
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
        guard !searchText.isEmpty else { return places }
        return places.filter {
            $0.name.localizedCaseInsensitiveContains(searchText) ||
            ($0.listName?.localizedCaseInsensitiveContains(searchText) ?? false)
        }
    }

    private func placeRow(_ place: PlaceSummary, isPlanned: Bool) -> some View {
        HStack(spacing: 12) {
            Image(systemName: isPlanned ? "mappin.and.ellipse" : "mappin")
                .foregroundStyle(isPlanned ? Chartroom.signal : Chartroom.sea)
                .frame(width: 24)
            VStack(alignment: .leading, spacing: 3) {
                Text(place.name).font(.headline)
                HStack(spacing: 6) {
                    if let listName = place.listName { Text(listName) }
                    if let due = place.due { Text("· \(due.formatted(date: .abbreviated, time: .omitted))") }
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
        guard let token = authentication.token else { return }
        do {
            async let planningRequest = authentication.api.planning(token: token)
            async let statusRequest = authentication.api.currentStatus(token: token)
            let (planning, status) = try await (planningRequest, statusRequest)
            data = planning
            currentStatus = status
            errorMessage = nil
            await loadRoute(token: token)
        } catch {
            errorMessage = error.localizedDescription
        }
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
            camera = .automatic
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

struct VoyagesView: View {
    @EnvironmentObject private var authentication: AuthenticationManager
    @State private var voyages: [VoyageSummary] = []
    @State private var errorMessage: String?
    @State private var loading = true

    var body: some View {
        NavigationStack {
            Group {
                if loading { ProgressView("Loading voyages…") }
                else if let errorMessage { ContentUnavailableView("Couldn’t load voyages", systemImage: "exclamationmark.triangle", description: Text(errorMessage)) }
                else if voyages.isEmpty { ContentUnavailableView("No voyages yet", systemImage: "sailboat") }
                else {
                    List(voyages) { voyage in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(voyage.name).font(.headline)
                            Text(dateRange(voyage))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            if let desc = voyage.desc, !desc.isEmpty {
                                Text(desc).font(.subheadline).lineLimit(3)
                            }
                        }
                        .padding(.vertical, 4)
                    }
                }
            }
            .navigationTitle("Voyages")
            .task { await load() }
            .refreshable { await load() }
        }
    }

    private func dateRange(_ voyage: VoyageSummary) -> String {
        let start = voyage.start?.formatted(date: .abbreviated, time: .omitted) ?? "?"
        let end = voyage.end?.formatted(date: .abbreviated, time: .omitted) ?? "present"
        return "\(start) – \(end)"
    }

    @MainActor private func load() async {
        guard let token = authentication.token else { return }
        loading = true
        defer { loading = false }
        do {
            voyages = try await authentication.api.voyages(token: token).voyages
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription }
    }
}

struct LogbookView: View {
    @EnvironmentObject private var authentication: AuthenticationManager
    @State private var logs: [LogEntry] = []
    @State private var errorMessage: String?
    @State private var loading = true

    var body: some View {
        NavigationStack {
            Group {
                if loading { ProgressView("Opening logbook…") }
                else if let errorMessage { ContentUnavailableView("Couldn’t open logbook", systemImage: "exclamationmark.triangle", description: Text(errorMessage)) }
                else if logs.isEmpty { ContentUnavailableView("No entries yet", systemImage: "book.closed") }
                else {
                    List(logs.sorted { $0.timestamp > $1.timestamp }) { entry in
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
            .navigationTitle("Logbook")
            .task { await load() }
            .refreshable { await load() }
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

        if logs.isEmpty, let cachedLogs = await authentication.api.cachedLogs() {
            logs = cachedLogs.logs
            loading = false
        } else {
            loading = logs.isEmpty
        }

        defer { loading = false }
        do {
            logs = try await authentication.api.logs(token: token).logs
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
