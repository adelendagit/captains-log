import MapKit
import PhotosUI
import SwiftUI
import UIKit

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
    @State private var hasManuallySelectedPlace = false
    @State private var selectedMooringLabelID = ""
    @State private var showAllPlaces = false
    @State private var action: String
    @State private var journeyName = ""
    @State private var litres = ""
    @State private var temperature = ""
    @State private var customText = ""
    @State private var todoLists: [TodoList] = []
    @State private var selectedTodoListID = ""
    @State private var todoName = ""
    @State private var timestamp = Date()
    @State private var notificationMode: LogNotificationMode
    @State private var isSaving = false
    @State private var logWasSaved = false
    @State private var errorMessage: String?
    @State private var todoLoadErrorMessage: String?

    private let initialAction: String?
    private let nearbyPlaceLimit = 10
    private let logTextLimit = 160

    init(initialAction: String?, initialTodoListID: String? = nil) {
        self.initialAction = initialAction
        let action = initialAction ?? ""
        _action = State(initialValue: action)
        _selectedTodoListID = State(initialValue: initialTodoListID ?? "")
        _notificationMode = State(initialValue: Self.defaultNotificationMode(for: action))
    }

    var body: some View {
        NavigationStack {
            Group {
                if action.isEmpty {
                    List {
                        Section {
                            ForEach(actions, id: \.key) { item in
                                Button {
                                    action = item.key
                                } label: {
                                    HStack(spacing: 14) {
                                        Image(systemName: item.icon)
                                            .frame(width: 24)
                                            .foregroundStyle(Chartroom.sea)
                                        Text(item.label)
                                            .foregroundStyle(.primary)
                                        Spacer()
                                        Image(systemName: "chevron.right")
                                            .font(.caption.bold())
                                            .foregroundStyle(.tertiary)
                                    }
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                            }
                        } header: {
                            Text("What would you like to add?")
                        }
                    }
                    .scrollContentBackground(.hidden)
                    .background(Chartroom.paper)
                } else if action == "todo" {
                    Form {
                        Section("List") {
                            if todoLists.isEmpty {
                                ProgressView("Loading lists…")
                            } else {
                                TodoListPills(
                                    lists: todoLists,
                                    selectedListID: $selectedTodoListID,
                                    showsAddButton: false,
                                    onAdd: nil
                                )
                            }
                        }

                        Section("Task") {
                            TextField("Name", text: $todoName)
                                .submitLabel(.done)
                                .onSubmit {
                                    if canSave { Task { await save() } }
                                }
                        }

                        if let todoErrorMessage = errorMessage ?? todoLoadErrorMessage {
                            Section {
                                Label(todoErrorMessage, systemImage: "exclamationmark.triangle")
                                    .font(.footnote)
                                    .foregroundStyle(.red)
                            }
                        }
                    }
                    .scrollContentBackground(.hidden)
                    .background(Chartroom.paper)
                } else {
                    Form {
                        Section("Where?") {
                            if places.isEmpty {
                                ProgressView("Finding nearby places…")
                            } else {
                                Picker("Place", selection: placeSelection) {
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

                        if action == "temperature" || action == "arrived" {
                            Section(action == "arrived" ? "Sea Temp (optional)" : "Sea Temp") {
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
                }
            }
            .background(Chartroom.paper)
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    if initialAction == nil, !action.isEmpty {
                        Button {
                            action = ""
                        } label: {
                            Label("Actions", systemImage: "chevron.left")
                        }
                    } else {
                        Button("Cancel") { dismiss() }
                    }
                }
                if !action.isEmpty {
                    ToolbarItem(placement: .confirmationAction) {
                        Button(confirmationButtonTitle) {
                            if logWasSaved {
                                dismiss()
                            } else {
                                Task { await save() }
                            }
                        }
                        .disabled(isSaving || (!logWasSaved && !canSave))
                    }
                }
            }
            .onChange(of: selectedPlaceID) {
                selectedMooringLabelID = ""
                updateSuggestedJourneyName()
            }
            .onChange(of: locatorCoordinateKey) { updateSortedPlaces() }
            .onChange(of: action) {
                if action != "arrived" { selectedMooringLabelID = "" }
                selectClosestPlaceForArrival()
                updateSuggestedJourneyName()
                notificationMode = Self.defaultNotificationMode(for: action)
                if action == "todo", todoLists.isEmpty {
                    Task { await refreshTodoLists() }
                }
            }
            .task { await load() }
        }
    }

    private static func defaultNotificationMode(for action: String) -> LogNotificationMode {
        ["arrived", "departed", "visited"].contains(action) ? .people : .none
    }

    private var navigationTitle: String {
        if action.isEmpty { return "Add" }
        if action == "todo" { return "New To Do" }
        switch initialAction {
        case "departed": return "Start Journey"
        case "arrived": return "End Journey"
        default: return actions.first(where: { $0.key == action }).map { "Log \($0.label)" } ?? "New Log Entry"
        }
    }

    private var confirmationButtonTitle: String {
        if logWasSaved { return "Done" }
        if action == "todo" { return "Add" }
        switch initialAction {
        case "departed": return "Start"
        case "arrived": return "End"
        default: return "Save"
        }
    }

    private var actions: [(key: String, label: String, icon: String)] {
        CaptainLogAction.allCases.map { ($0.rawValue, $0.label, $0.systemImage) }
    }

    private var selectedPlace: PlaceSummary? {
        places.first { $0.id == selectedPlaceID }
    }

    private var placeSelection: Binding<String> {
        Binding(
            get: { selectedPlaceID },
            set: { placeID in
                hasManuallySelectedPlace = true
                selectedPlaceID = placeID
            }
        )
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
        if action == "todo" {
            return !selectedTodoListID.isEmpty &&
                !todoName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        }
        return selectedPlace != nil &&
            logCoordinate != nil &&
            (action != "arrived" || !selectedMooringLabelID.isEmpty) &&
            (action != "other" || !customText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            && (action != "temperature" || parsedTemperature != nil)
            && (action != "arrived" || temperature.isEmpty || parsedTemperature != nil)
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
        selectClosestPlaceForArrival()
    }

    private func selectClosestPlaceForArrival() {
        guard
            action == "arrived",
            !hasManuallySelectedPlace,
            sortingOriginCoordinate != nil,
            let closestPlace = sortedPlaces.first(where: { $0.coordinate != nil })
        else { return }
        selectedPlaceID = closestPlace.id
    }

    private func distance(from origin: CLLocation, to place: PlaceSummary) -> CLLocationDistance {
        guard let coordinate = place.coordinate else { return .greatestFiniteMagnitude }
        return origin.distance(from: CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude))
    }

    @MainActor private func load() async {
        if let cachedTodo = await authentication.api.cachedTodoData() {
            applyTodoData(cachedTodo)
        }
        if action == "todo" {
            await refreshTodoLists()
            return
        }

        locator.locate()
        seedKnownPlace()
        guard let token = authentication.token else { return }

        if let cachedPlanning = await authentication.api.cachedPlanning() {
            applyPlanning(cachedPlanning)
        }

        do {
            let planning = try await authentication.api.planning(token: token)
            applyPlanning(planning)
        } catch {
            errorMessage = error.localizedDescription
        }

        if action.isEmpty {
            await refreshTodoLists()
        }
    }

    @MainActor private func refreshTodoLists() async {
        guard let token = authentication.token else { return }
        do {
            applyTodoData(try await authentication.api.todoData(token: token))
            todoLoadErrorMessage = nil
        } catch {
            todoLoadErrorMessage = error.localizedDescription
        }
    }

    private func applyTodoData(_ data: TodoDataResponse) {
        todoLists = data.lists
        if !todoLists.contains(where: { $0.id == selectedTodoListID }) {
            selectedTodoListID = todoLists.first?.id ?? ""
        }
    }

    private func seedKnownPlace() {
        guard let current = tracker.currentStatus?.current ?? tracker.currentStatus?.from else { return }
        places = [current]
        sortedPlaces = [current]
        selectedPlaceID = current.id
        updateSuggestedJourneyName()
    }

    private func applyPlanning(_ planning: PlanningResponse) {
        boardLabels = planning.boardLabels ?? []
        var byID = Dictionary(uniqueKeysWithValues: planning.places.map { ($0.placeCardID, $0) })
        for stop in planning.stops where byID[stop.placeCardID] == nil {
            byID[stop.placeCardID] = stop
        }
        if let current = tracker.currentStatus?.current ?? tracker.currentStatus?.from {
            byID[current.id] = current
            if selectedPlaceID.isEmpty { selectedPlaceID = current.id }
        }
        places = Array(byID.values).sorted { $0.name < $1.name }
        updateSortedPlaces()
        if selectedPlaceID.isEmpty { selectedPlaceID = sortedPlaces.first?.id ?? "" }
        updateSuggestedJourneyName()
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
        guard let token = authentication.token else { return }
        isSaving = true
        errorMessage = nil
        defer { isSaving = false }

        if action == "todo" {
            let name = todoName.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !name.isEmpty, !selectedTodoListID.isEmpty else { return }
            do {
                _ = try await authentication.api.addTodo(
                    name: name,
                    listID: selectedTodoListID,
                    token: token
                )
                NotificationCenter.default.post(name: .captainsLogTodoDidChange, object: nil)
                dismiss()
            } catch {
                errorMessage = error.localizedDescription
            }
            return
        }

        guard let place = selectedPlace, let coordinate = logCoordinate else { return }
        do {
            if action == "arrived", tracker.currentJourney?.active == true {
                try await tracker.flushPendingPositions()
            }
            let quantity = Double(litres)
            let temperatureValue = parsedTemperature
            let details = action == "other" ? customText.trimmingCharacters(in: .whitespacesAndNewlines) : nil
            let startsJourney = action == "departed"
            let requestID = UUID().uuidString
            _ = try await authentication.api.addLogEntry(
                action: action,
                cardID: place.placeCardID,
                latitude: coordinate.latitude,
                longitude: coordinate.longitude,
                requestID: requestID,
                journeyName: action == "departed" ? journeyName : nil,
                mooringLabelID: action == "arrived" ? selectedMooringLabelID : nil,
                placeName: place.name,
                customText: details,
                timestamp: timestamp,
                litres: quantity,
                temperature: temperatureValue,
                token: token,
                queueImmediately: startsJourney
            )
            logWasSaved = true
            if startsJourney {
                let localName = journeyName.trimmingCharacters(in: .whitespacesAndNewlines)
                tracker.startJourneyLocally(
                    name: localName.isEmpty ? "Journey from \(place.name)" : localName,
                    startedAt: timestamp
                )
            }
            if notificationMode != .none {
                do {
                    _ = try await authentication.api.sendLogNotification(
                        mode: notificationMode.rawValue,
                        action: action,
                        cardID: place.placeCardID,
                        latitude: coordinate.latitude,
                        longitude: coordinate.longitude,
                        timestamp: timestamp,
                        litres: quantity,
                        temperature: temperatureValue,
                        customText: details,
                        token: token,
                        queueImmediately: startsJourney
                    )
                } catch {
                    if startsJourney {
                        tracker.errorMessage = "Journey started and saved on this iPhone, but the notification could not be queued: \(error.localizedDescription)"
                        await authentication.refreshPendingMutationCount()
                        dismiss()
                        Task { await authentication.syncPendingMutations() }
                        return
                    }
                    await tracker.refresh()
                    errorMessage = "The log was saved, but the email could not be sent: \(error.localizedDescription)"
                    return
                }
            }
            if startsJourney {
                await authentication.refreshPendingMutationCount()
                dismiss()
                Task {
                    await authentication.syncPendingMutations()
                }
                return
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

private enum PlanningPeriod: Int, CaseIterable, Identifiable {
    case morning
    case lunch
    case lateAfternoon
    case evening

    var id: Int { rawValue }

    var label: String {
        switch self {
        case .morning: "Morning"
        case .lunch: "Lunch time"
        case .lateAfternoon: "Late afternoon"
        case .evening: "Evening"
        }
    }

    var hour: Int {
        switch self {
        case .morning: 8
        case .lunch: 12
        case .lateAfternoon: 16
        case .evening: 20
        }
    }

    static func period(for date: Date, calendar: Calendar = .current) -> PlanningPeriod {
        switch calendar.component(.hour, from: date) {
        case ..<11: .morning
        case 11..<15: .lunch
        case 15..<19: .lateAfternoon
        default: .evening
        }
    }
}

private struct PlanningDay: Identifiable {
    let date: Date
    var id: Date { date }
}

struct PlaceDetailView<Actions: View>: View {
    let place: PlaceSummary
    let due: Date?
    let api: APIClient
    let token: String?
    let onDismiss: () -> Void
    let onNavilySaved: () -> Void
    let actions: Actions

    @State private var isCheckingNavily = false

    init(
        place: PlaceSummary,
        due: Date?,
        api: APIClient,
        token: String?,
        onDismiss: @escaping () -> Void,
        onNavilySaved: @escaping () -> Void,
        @ViewBuilder actions: () -> Actions
    ) {
        self.place = place
        self.due = due
        self.api = api
        self.token = token
        self.onDismiss = onDismiss
        self.onNavilySaved = onNavilySaved
        self.actions = actions()
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    HStack(alignment: .top, spacing: 14) {
                        Image(systemName: place.mooringSystemImage)
                            .font(.title2)
                            .frame(width: 46, height: 46)
                            .foregroundStyle(.white)
                            .background(Chartroom.ink, in: Circle())
                        VStack(alignment: .leading, spacing: 4) {
                            Text(place.name)
                                .font(.system(.title2, design: .serif, weight: .semibold))
                            if let listName = place.listName {
                                Text(listName).font(.subheadline).foregroundStyle(.secondary)
                            }
                        }
                    }

                    if let description = place.desc?.trimmingCharacters(in: .whitespacesAndNewlines), !description.isEmpty {
                        Text(description)
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        if let rating = place.rating {
                            Label("\(rating) out of 5 stars", systemImage: "star.fill")
                        }
                        if let mooring = place.mooringSummary {
                            Label(mooring, systemImage: place.mooringSystemImage)
                        }
                        if let visits = place.visitCount, visits > 0 {
                            Label("Visited \(visits) \(visits == 1 ? "time" : "times")", systemImage: "arrow.trianglehead.2.clockwise.rotate.90")
                        }
                        if let lastVisitedAt = place.lastVisitedAt {
                            Label("Last visit \(lastVisitedAt.formatted(date: .abbreviated, time: .omitted))", systemImage: "calendar")
                        }
                        if let due {
                            Label("Planned for \(due.formatted(date: .abbreviated, time: .shortened))", systemImage: "calendar.badge.clock")
                        }
                        if let snapshot = place.navilySnapshot {
                            Label(
                                "Navily checked \(snapshot.checkedAt.formatted(date: .abbreviated, time: .omitted))",
                                systemImage: "checkmark.icloud"
                            )
                        }
                    }
                    .foregroundStyle(Chartroom.ink)

                    HStack(spacing: 16) {
                        if let trelloUrl = place.trelloUrl { Link("Trello", destination: trelloUrl) }
                        if let navilyUrl = place.navilyUrl { Link("Navily", destination: navilyUrl) }
                    }

                    if place.navilyUrl != nil {
                        Button {
                            isCheckingNavily = true
                        } label: {
                            if isCheckingNavily {
                                HStack {
                                    ProgressView()
                                    Text("Opening Navily…")
                                }
                            } else {
                                Label("Check Navily", systemImage: "arrow.trianglehead.2.clockwise")
                            }
                        }
                        .frame(maxWidth: .infinity)
                        .buttonStyle(.bordered)
                        .disabled(token == nil || isCheckingNavily)
                        .accessibilityLabel(isCheckingNavily ? "Opening Navily" : "Check Navily")
                    }

                    actions
                }
                .padding(22)
            }
            .background(Chartroom.paper)
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("Done", action: onDismiss)
                }
            }
            .sheet(isPresented: $isCheckingNavily) {
                if let token {
                    NavilyCheckView(
                        place: place,
                        api: api,
                        token: token,
                        onSaved: { _ in
                            isCheckingNavily = false
                            onNavilySaved()
                        }
                    )
                }
            }
        }
    }
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
    @State private var selectedMapPlace: PlaceSummary?
    @State private var isAddingPlace = false
    @State private var plannedDueOverrides: [String: Date] = [:]
    @State private var planningOrderMessage: String?
    @State private var planningOrderFailed = false
    @State private var isSavingPlanningOrder = false
    @State private var isRefiningPlan = false
    @State private var scheduleDraft = Date()
    @State private var isSavingSchedule = false
    @State private var scheduleMessage: String?
    @State private var scheduleSaveFailed = false

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
                    } else if isRefiningPlan {
                        Label("Drag stops between days and rough times. Their order is the plan; times are approximate.", systemImage: "line.3.horizontal")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    } else {
                        ForEach(plannedStops) { stop in
                            placeRow(stop, isPlanned: true)
                        }
                    }
                    if isRefiningPlan, let planningOrderMessage {
                        Text(planningOrderMessage)
                            .font(.footnote)
                            .foregroundStyle(planningOrderFailed ? .red : .secondary)
                    }
                }
                if isRefiningPlan {
                    ForEach(planningDays) { day in
                        Section {
                            ForEach(PlanningPeriod.allCases) { period in
                                planningPeriodHeader(day: day.date, period: period)
                                ForEach(plannedStops(on: day.date, in: period)) { stop in
                                    placeRow(stop, isPlanned: true)
                                        .draggable(stop.id) {
                                            Label(stop.name, systemImage: "mappin.and.ellipse")
                                                .padding(10)
                                                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                                        }
                                        .dropDestination(for: String.self) { cardIDs, _ in
                                            guard let cardID = cardIDs.first else { return false }
                                            return movePlannedStop(
                                                cardID: cardID,
                                                to: day.date,
                                                period: period,
                                                before: stop.id
                                            )
                                        }
                                    }
                                }
                            } header: {
                                Text(planningDayLabel(day.date))
                        }
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
            .toolbar {
                ToolbarItemGroup(placement: .topBarTrailing) {
                    if !plannedStops.isEmpty {
                        Button(isRefiningPlan ? "Done" : "Refine") {
                            isRefiningPlan.toggle()
                        }
                        .disabled(isSavingPlanningOrder)
                    }
                    Button {
                        isAddingPlace = true
                    } label: {
                        Label("Add place", systemImage: "plus")
                    }
                }
            }
            .task { await load() }
            .refreshable { await load() }
            .sheet(item: $selectedMapPlace) { place in
                placeCard(place)
                    .presentationDetents([.medium, .large])
            }
            .sheet(isPresented: $isAddingPlace) {
                if let token = authentication.token {
                    AddPlaceView(
                        api: authentication.api,
                        token: token,
                        initialCoordinate: visibleRegion?.center ?? currentMapCoordinate,
                        onSaved: { _ in
                            isAddingPlace = false
                            Task { await load() }
                        },
                        onCancel: { isAddingPlace = false }
                    )
                }
            }
        }
    }

    private var plannedStops: [PlaceSummary] {
        (data?.stops ?? [])
            .filter { $0.dueComplete != true }
            .sorted {
                switch (effectiveDue(for: $0), effectiveDue(for: $1)) {
                case let (left?, right?): left < right
                case (_?, nil): true
                case (nil, _?): false
                case (nil, nil): $0.name < $1.name
                }
            }
    }

    private var planningDays: [PlanningDay] {
        let calendar = Calendar.current
        let dates = plannedStops.compactMap { effectiveDue(for: $0) }
        guard let firstDue = dates.min(), let lastDue = dates.max() else { return [] }
        var day = min(calendar.startOfDay(for: Date()), calendar.startOfDay(for: firstDue))
        guard let finalDay = calendar.date(
            byAdding: .day,
            value: 1,
            to: calendar.startOfDay(for: lastDue)
        ) else { return [] }
        var result: [PlanningDay] = []
        while day <= finalDay {
            result.append(PlanningDay(date: day))
            guard let nextDay = calendar.date(byAdding: .day, value: 1, to: day) else { break }
            day = nextDay
        }
        return result
    }

    private func effectiveDue(for stop: PlaceSummary) -> Date? {
        plannedDueOverrides[stop.id] ?? stop.due
    }

    private func plannedStops(on day: Date, in period: PlanningPeriod) -> [PlaceSummary] {
        let calendar = Calendar.current
        return plannedStops.filter { stop in
            guard let due = effectiveDue(for: stop) else { return false }
            return calendar.isDate(due, inSameDayAs: day) &&
                PlanningPeriod.period(for: due, calendar: calendar) == period
        }
    }

    private func planningDayLabel(_ day: Date) -> String {
        let calendar = Calendar.current
        if calendar.isDateInToday(day) { return "Today" }
        if calendar.isDateInTomorrow(day) { return "Tomorrow" }
        return day.formatted(.dateTime.weekday(.abbreviated).month(.abbreviated).day())
    }

    private func planningPeriodHeader(day: Date, period: PlanningPeriod) -> some View {
        HStack {
            Text(period.label.uppercased())
                .font(.caption.bold())
                .tracking(0.8)
            Spacer()
            Text("Drop here")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .foregroundStyle(Chartroom.sea)
        .contentShape(Rectangle())
        .dropDestination(for: String.self) { cardIDs, _ in
            guard let cardID = cardIDs.first else { return false }
            return movePlannedStop(
                cardID: cardID,
                to: day,
                period: period,
                before: nil
            )
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
        if let start, start.coordinate != nil, stops.first?.placeCardID != start.placeCardID {
            stops.insert(start, at: 0)
        }
        return stops
    }

    private var mapPlaces: [PlaceSummary] {
        var byID: [String: PlaceSummary] = [:]
        for place in data?.places ?? [] { byID[place.placeCardID] = place }
        for stop in data?.stops ?? [] where byID[stop.placeCardID] == nil {
            byID[stop.placeCardID] = stop
        }
        if let current = currentStatus?.current ?? currentStatus?.from {
            if byID[current.placeCardID] == nil { byID[current.placeCardID] = current }
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
                        Button { selectPlace(place) } label: {
                            mapMarker(for: place)
                        }
                        .buttonStyle(.plain)
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
        let plannedIndex = plannedStops.firstIndex(where: { $0.placeCardID == place.placeCardID }).map { $0 + 1 }
        let rating = place.rating.map { min(5, max(1, $0)) }
        let visits = max(0, place.visitCount ?? 0)
        let isCurrent = place.placeCardID == currentStatus?.current?.placeCardID ||
            place.placeCardID == currentStatus?.from?.placeCardID
        return ZStack {
            Circle()
                .fill(Chartroom.ink)
                .frame(width: 38, height: 38)
                .overlay {
                    Image(systemName: place.mooringSystemImage)
                        .font(.caption.bold())
                        .foregroundStyle(.white)
                }
                .overlay {
                    Circle()
                        .stroke(
                            isCurrent ? Color(red: 0.25, green: 0.78, blue: 0.73) : (plannedIndex == nil ? .white.opacity(0.9) : Chartroom.signal),
                            style: StrokeStyle(lineWidth: isCurrent ? 4 : 3, dash: plannedIndex == nil || isCurrent ? [] : [4, 3])
                        )
                }
                .shadow(color: .black.opacity(0.2), radius: 2, y: 1)
            if let plannedIndex {
                Text("\(plannedIndex)")
                    .font(.caption2.bold())
                    .foregroundStyle(.white)
                    .frame(width: 17, height: 17)
                    .background(Chartroom.signal, in: Circle())
                    .offset(x: -17, y: -17)
            }
            if visits > 1 {
                Text(visits > 9 ? "9+" : "\(visits)")
                    .font(.caption2.bold())
                    .foregroundStyle(.white)
                    .frame(minWidth: 17, minHeight: 17)
                    .padding(.horizontal, visits > 9 ? 1 : 0)
                    .background(Chartroom.ink, in: Capsule())
                    .overlay(Capsule().stroke(.white, lineWidth: 1.5))
                    .offset(x: 17, y: -17)
            }
            if let rating {
                HStack(spacing: 1) {
                    Image(systemName: "star.fill").font(.system(size: 7))
                    Text("\(rating)")
                }
                .font(.caption2.bold())
                .foregroundStyle(Color(red: 0.24, green: 0.18, blue: 0))
                .padding(.horizontal, 4)
                .frame(minHeight: 17)
                .background(Color(red: 1, green: 0.83, blue: 0.35), in: Capsule())
                .overlay(Capsule().stroke(.white, lineWidth: 1.5))
                .offset(x: 16, y: 17)
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
        if let mooring = place.mooringSummary { parts.append(mooring) }
        if let rating = place.rating { parts.append("\(rating) out of 5 stars") }
        if let visits = place.visitCount, visits > 0 { parts.append("\(visits) \(visits == 1 ? "visit" : "visits")") }
        if let plannedIndex { parts.append("planned stop \(plannedIndex)") }
        return parts.joined(separator: ", ")
    }

    private var scheduleTimeBinding: Binding<Date> {
        Binding(
            get: { scheduleDraft },
            set: { scheduleDraft = nearestHour(to: $0) }
        )
    }

    private func nearestHour(to date: Date) -> Date {
        let calendar = Calendar.current
        guard let hour = calendar.dateInterval(of: .hour, for: date)?.start else { return date }
        return date.timeIntervalSince(hour) >= 30 * 60
            ? calendar.date(byAdding: .hour, value: 1, to: hour) ?? hour
            : hour
    }

    private func selectPlace(_ place: PlaceSummary) {
        scheduleDraft = nearestHour(to: effectiveDue(for: place) ?? Date())
        scheduleMessage = nil
        scheduleSaveFailed = false
        selectedMapPlace = place
    }

    private func placeCard(_ place: PlaceSummary) -> some View {
        PlaceDetailView(
            place: place,
            due: effectiveDue(for: place),
            api: authentication.api,
            token: authentication.token,
            onDismiss: { selectedMapPlace = nil },
            onNavilySaved: {
                selectedMapPlace = nil
                Task { await load() }
            }
        ) {
            Group {
                    if place.due != nil {
                        VStack(alignment: .leading, spacing: 12) {
                            Label("Already in your plan", systemImage: "checkmark.circle.fill")
                                .foregroundStyle(Chartroom.sea)
                            DatePicker(
                                "Date",
                                selection: $scheduleDraft,
                                displayedComponents: .date
                            )
                            DatePicker(
                                "Time",
                                selection: scheduleTimeBinding,
                                displayedComponents: .hourAndMinute
                            )
                            Text("The time is saved to the nearest hour.")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            if let scheduleMessage {
                                Text(scheduleMessage)
                                    .font(.caption)
                                    .foregroundStyle(scheduleSaveFailed ? .red : .secondary)
                            }
                            Button {
                                Task { await saveSchedule(for: place) }
                            } label: {
                                if isSavingSchedule {
                                    ProgressView().frame(maxWidth: .infinity)
                                } else {
                                    Label("Save date and time", systemImage: "calendar.badge.checkmark")
                                        .frame(maxWidth: .infinity)
                                }
                            }
                            .buttonStyle(.borderedProminent)
                            .tint(Chartroom.sea)
                            .disabled(isSavingSchedule || !scheduleHasChanges(for: place))
                        }
                        .padding()
                        .background(Chartroom.surface, in: RoundedRectangle(cornerRadius: 14))
                    } else {
                        Button {
                            Task {
                                await plan(place)
                                if workingCardID == nil && errorMessage == nil { selectedMapPlace = nil }
                            }
                        } label: {
                            if workingCardID == place.id {
                                ProgressView().frame(maxWidth: .infinity)
                            } else {
                                Label("Plan", systemImage: "plus").frame(maxWidth: .infinity)
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(Chartroom.sea)
                        .disabled(workingCardID != nil)
                    }
            }
        }
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
            Button { selectPlace(place) } label: {
                HStack(spacing: 12) {
                    Image(systemName: place.rating == nil ? (isPlanned ? "mappin.and.ellipse" : "mappin") : "star.circle.fill")
                        .foregroundStyle(markerColor(for: place, isPlanned: isPlanned))
                        .frame(width: 24)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(place.name).font(.headline)
                        HStack(spacing: 6) {
                            if let listName = place.listName { Text(listName) }
                            if let due = effectiveDue(for: place) { Text("· \(due.formatted(date: .abbreviated, time: .omitted))") }
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
                }
            }
            .buttonStyle(.plain)
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
        async let cachedPlanning = authentication.api.cachedPlanning()
        async let cachedStatus = authentication.api.cachedCurrentStatus()
        let (savedPlanning, savedStatus) = await (cachedPlanning, cachedStatus)
        if let savedPlanning {
            data = savedPlanning
            plannedDueOverrides = [:]
        }
        if let savedStatus { currentStatus = savedStatus }
        focusInitialMapIfNeeded()

        if let savedPlanning {
            await loadCachedRoute(for: savedPlanning)
        }

        guard let token = authentication.token, !authentication.isOffline else {
            errorMessage = nil
            return
        }
        do {
            async let planningRequest = authentication.api.planning(token: token)
            async let statusRequest = authentication.api.currentStatus(token: token)
            let (planning, status) = try await (planningRequest, statusRequest)
            data = planning
            plannedDueOverrides = [:]
            currentStatus = status
            errorMessage = nil
            focusInitialMapIfNeeded()
            await loadRoute(token: token)
        } catch {
            if data == nil { errorMessage = error.localizedDescription }
        }
    }

    @MainActor private func loadCachedRoute(for planning: PlanningResponse) async {
        let previousData = data
        data = planning
        let points = routeStops.compactMap { stop -> PlanningRoutePoint? in
            guard let lat = stop.lat, let lng = stop.lng else { return nil }
            return PlanningRoutePoint(lat: lat, lng: lng)
        }
        data = previousData
        guard points.count > 1,
              let cached = await authentication.api.cachedPlanningRoute(points: points)
        else { return }
        route = cached
        let sequence = routeStops
        legByDestinationID = Dictionary(
            uniqueKeysWithValues: zip(sequence.dropFirst(), cached.legs).map { ($0.id, $1) }
        )
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

    private func scheduleHasChanges(for place: PlaceSummary) -> Bool {
        guard let due = effectiveDue(for: place) else { return false }
        return nearestHour(to: due) != nearestHour(to: scheduleDraft)
    }

    @MainActor private func saveSchedule(for place: PlaceSummary) async {
        guard let token = authentication.token else {
            scheduleSaveFailed = true
            scheduleMessage = "Sign in again to save this stop."
            return
        }
        let due = nearestHour(to: scheduleDraft)
        let previousOverride = plannedDueOverrides[place.id]
        plannedDueOverrides[place.id] = due
        scheduleDraft = due
        scheduleSaveFailed = false
        scheduleMessage = "Saving…"
        isSavingSchedule = true
        defer { isSavingSchedule = false }

        do {
            let queued = try await authentication.api.planStop(
                placeID: place.placeCardID,
                planID: place.planCardID,
                due: due,
                token: token,
                queueImmediately: authentication.isOffline
            )
            await authentication.refreshPendingMutationCount()
            if !queued {
                await load()
                if let refreshedPlace = plannedStops.first(where: { $0.id == place.id }) {
                    selectedMapPlace = refreshedPlace
                }
            }
            scheduleSaveFailed = false
            scheduleMessage = queued
                ? "Saved on this iPhone. The change will sync when connected."
                : "Date and time saved."
        } catch {
            plannedDueOverrides[place.id] = previousOverride
            scheduleSaveFailed = true
            scheduleMessage = "The date and time couldn’t be saved. Please try again."
        }
    }

    @MainActor private func movePlannedStop(
        cardID: String,
        to day: Date,
        period: PlanningPeriod,
        before destinationCardID: String?
    ) -> Bool {
        guard !isSavingPlanningOrder,
              let movedStop = plannedStops.first(where: { $0.id == cardID }),
              destinationCardID != cardID,
              let originalDue = effectiveDue(for: movedStop)
        else { return false }

        let calendar = Calendar.current
        let sourceDay = calendar.startOfDay(for: originalDue)
        let sourcePeriod = PlanningPeriod.period(for: originalDue, calendar: calendar)
        let targetDay = calendar.startOfDay(for: day)
        let sameSlot = calendar.isDate(sourceDay, inSameDayAs: targetDay) &&
            sourcePeriod == period

        func stops(in slotDay: Date, period slotPeriod: PlanningPeriod) -> [PlaceSummary] {
            plannedStops.filter { stop in
                guard stop.id != cardID, let due = effectiveDue(for: stop) else { return false }
                return calendar.isDate(due, inSameDayAs: slotDay) &&
                    PlanningPeriod.period(for: due, calendar: calendar) == slotPeriod
            }
        }

        var targetStops = stops(in: targetDay, period: period)
        if let destinationCardID,
           let destinationIndex = targetStops.firstIndex(where: { $0.id == destinationCardID }) {
            targetStops.insert(movedStop, at: destinationIndex)
        } else {
            targetStops.append(movedStop)
        }

        var slotStops: [(Date, PlanningPeriod, [PlaceSummary])] = [
            (targetDay, period, targetStops)
        ]
        if !sameSlot {
            slotStops.append((sourceDay, sourcePeriod, stops(in: sourceDay, period: sourcePeriod)))
        }

        var updates: [PlanningStopUpdate] = []
        for (slotDay, slotPeriod, stops) in slotStops {
            for (index, stop) in stops.enumerated() {
                guard let due = planningDue(
                    on: slotDay,
                    period: slotPeriod,
                    position: index,
                    calendar: calendar
                ) else { continue }
                if effectiveDue(for: stop) != due {
                    updates.append(PlanningStopUpdate(planId: stop.id, due: due))
                }
            }
        }
        guard !updates.isEmpty else {
            planningOrderFailed = false
            planningOrderMessage = "Plan unchanged."
            return false
        }

        let previousOverrides = plannedDueOverrides
        for update in updates { plannedDueOverrides[update.planId] = update.due }
        planningOrderFailed = false
        planningOrderMessage = "Saving plan…"
        isSavingPlanningOrder = true
        Task { await savePlanningOrder(updates, restoring: previousOverrides) }
        return true
    }

    private func planningDue(
        on day: Date,
        period: PlanningPeriod,
        position: Int,
        calendar: Calendar
    ) -> Date? {
        guard let base = calendar.date(
            bySettingHour: period.hour,
            minute: 0,
            second: 0,
            of: day
        ) else { return nil }
        return calendar.date(byAdding: .minute, value: position * 5, to: base)
    }

    @MainActor private func savePlanningOrder(
        _ updates: [PlanningStopUpdate],
        restoring previousOverrides: [String: Date]
    ) async {
        defer { isSavingPlanningOrder = false }
        guard let token = authentication.token else {
            plannedDueOverrides = previousOverrides
            planningOrderFailed = true
            planningOrderMessage = "Sign in again to save the plan."
            return
        }
        do {
            let queued = try await authentication.api.reorderStops(
                updates: updates,
                token: token,
                queueImmediately: authentication.isOffline
            )
            await authentication.refreshPendingMutationCount()
            if !queued { await load() }
            planningOrderFailed = false
            planningOrderMessage = queued
                ? "Saved on this iPhone. The plan will sync when connected."
                : "Plan saved."
        } catch {
            plannedDueOverrides = previousOverrides
            planningOrderFailed = true
            planningOrderMessage = "The plan couldn’t be saved. Please try again."
        }
    }

    @MainActor private func plan(_ place: PlaceSummary) async {
        guard let token = authentication.token else { return }
        workingCardID = place.id
        defer { workingCardID = nil }
        do {
            let lastDate = plannedStops.compactMap(\.due).max() ?? Date()
            let due = Calendar.current.date(byAdding: .day, value: 1, to: max(lastDate, Date())) ?? Date()
            let queued = try await authentication.api.planStop(
                placeID: place.placeCardID,
                due: due,
                token: token,
                queueImmediately: authentication.isOffline
            )
            await authentication.refreshPendingMutationCount()
            await load()
            if queued { planningOrderMessage = "Stop queued and will sync when connected." }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    @MainActor private func remove(_ place: PlaceSummary) async {
        guard let token = authentication.token else { return }
        workingCardID = place.id
        defer { workingCardID = nil }
        do {
            let queued = try await authentication.api.removeStop(
                planID: place.planCardID ?? place.id,
                token: token,
                queueImmediately: authentication.isOffline
            )
            await authentication.refreshPendingMutationCount()
            await load()
            if queued { planningOrderMessage = "Change queued and will sync when connected." }
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

struct LogbookView: View {
    @EnvironmentObject private var authentication: AuthenticationManager
    @State private var logs: [LogEntry] = []
    @State private var voyages: [VoyageSummary] = []
    @State private var journeyHistory: [JourneyHistory] = []
    @State private var selectedVoyageIDs: Set<String> = []
    @State private var hasInitialVoyageSelection = false
    @State private var errorMessage: String?
    @State private var loading = true
    @State private var mapCamera: MapCameraPosition = .automatic
    @State private var estimatedBreadcrumbRoutes: [PlanningRouteResponse] = []

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

                        Section("Map") {
                            logbookMap
                                .listRowInsets(EdgeInsets())
                                .listRowBackground(Color.clear)
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
                    .environment(\.editMode, .constant(.active))
                }
            }
            .navigationTitle("Logbook")
            .task { await load() }
            .refreshable { await load() }
        }
    }

    private var logbookMap: some View {
        Map(position: $mapCamera) {
            ForEach(Array(estimatedBreadcrumbRoutes.enumerated()), id: \.offset) { _, route in
                ForEach(Array(route.legs.enumerated()), id: \.offset) { _, leg in
                    if leg.mapCoordinates.count > 1 {
                        MapPolyline(coordinates: leg.mapCoordinates)
                            .stroke(
                                ChartroomRouteKind.estimated.color,
                                style: ChartroomRouteKind.estimated.strokeStyle
                            )
                    }
                }
            }

            ForEach(filteredJourneyHistory) { journey in
                if journey.track.count > 1 {
                    MapPolyline(coordinates: journey.track.map(\.coordinate))
                        .stroke(
                            ChartroomRouteKind.recorded.color,
                            style: ChartroomRouteKind.recorded.strokeStyle
                        )
                }
            }

            ForEach(historicalMapEntries) { marker in
                Annotation(marker.entry.cardName, coordinate: marker.coordinate) {
                    Circle()
                        .fill(marker.entry.type.caseInsensitiveCompare("Departed") == .orderedSame
                            ? Chartroom.signal
                            : Chartroom.sea)
                        .frame(width: 12, height: 12)
                        .overlay(Circle().stroke(.white, lineWidth: 2))
                        .shadow(color: .black.opacity(0.2), radius: 2, y: 1)
                        .accessibilityLabel(
                            "\(marker.entry.cardName), \(marker.entry.type), \(marker.entry.timestamp.formatted(date: .abbreviated, time: .omitted))"
                        )
                }
            }
        }
        .mapStyle(.standard(elevation: .realistic))
        .frame(height: 300)
        .clipShape(RoundedRectangle(cornerRadius: 18))
        .overlay(alignment: .bottomTrailing) {
            BreadcrumbLegend()
        }
        .onChange(of: mapContentKey, initial: true) {
            mapCamera = .automatic
        }
        .task(id: mapContentKey) {
            await loadEstimatedBreadcrumbRoutes()
        }
        .accessibilityLabel("Logbook map")
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

    private var filteredJourneyHistory: [JourneyHistory] {
        guard !selectedVoyageIDs.isEmpty else { return journeyHistory }
        return journeyHistory.filter { journey in
            selectedVoyages.contains { voyage in
                overlaps(
                    start: journey.startedAt,
                    end: journey.endedAt ?? journey.startedAt,
                    voyage: voyage
                )
            }
        }
    }

    private var historicalMapEntries: [LogbookMapMarker] {
        let ordered = filteredLogs.sorted { $0.timestamp < $1.timestamp }
        var seenCardIDs = Set<String>()
        var markers = ordered.compactMap { entry -> LogbookMapMarker? in
            guard ["arrived", "visited"].contains(entry.type.lowercased()),
                  let lat = entry.lat, let lng = entry.lng,
                  seenCardIDs.insert(entry.cardId).inserted else { return nil }
            return LogbookMapMarker(
                id: "visit-\(entry.cardId)",
                entry: entry,
                coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng)
            )
        }

        if let departure = ordered.first(where: {
            $0.type.caseInsensitiveCompare("Departed") == .orderedSame && $0.lat != nil && $0.lng != nil
        }), let lat = departure.lat, let lng = departure.lng {
            markers.insert(
                LogbookMapMarker(
                    id: "departure-\(departure.id)",
                    entry: departure,
                    coordinate: CLLocationCoordinate2D(latitude: lat, longitude: lng)
                ),
                at: 0
            )
        }
        return markers
    }

    private var estimatedBreadcrumbGroups: [[LogbookMapMarker]] {
        var groups: [[LogbookMapMarker]] = []
        var current: [LogbookMapMarker] = []

        for marker in historicalMapEntries.sorted(by: { $0.entry.timestamp < $1.entry.timestamp }) {
            if isCoveredByRecordedJourney(marker.entry.timestamp) {
                if current.count > 1 { groups.append(current) }
                current = []
            } else {
                current.append(marker)
            }
        }
        if current.count > 1 { groups.append(current) }
        return groups
    }

    private func isCoveredByRecordedJourney(_ timestamp: Date) -> Bool {
        filteredJourneyHistory.contains { journey in
            timestamp >= journey.startedAt && timestamp <= (journey.endedAt ?? journey.startedAt)
        }
    }

    @MainActor private func loadEstimatedBreadcrumbRoutes() async {
        let requestKey = mapContentKey
        let pointGroups = estimatedBreadcrumbGroups.compactMap { group -> [PlanningRoutePoint]? in
            var points: [PlanningRoutePoint] = []
            for marker in group {
                let point = PlanningRoutePoint(
                    lat: marker.coordinate.latitude,
                    lng: marker.coordinate.longitude
                )
                if points.last?.lat != point.lat || points.last?.lng != point.lng {
                    points.append(point)
                }
            }
            return points.count > 1 ? points : nil
        }

        guard !pointGroups.isEmpty else {
            estimatedBreadcrumbRoutes = []
            return
        }

        var routes: [PlanningRouteResponse] = []
        for points in pointGroups {
            if let cached = await authentication.api.cachedPlanningRoute(points: points) {
                routes.append(cached)
            }
        }
        if mapContentKey == requestKey {
            estimatedBreadcrumbRoutes = routes
        }

        guard let token = authentication.token, !authentication.isOffline else { return }
        routes = []
        for points in pointGroups {
            guard !Task.isCancelled else { return }
            do {
                routes.append(try await authentication.api.planningRoute(points: points, token: token))
            } catch {
                if let cached = await authentication.api.cachedPlanningRoute(points: points) {
                    routes.append(cached)
                }
            }
        }
        if !Task.isCancelled, mapContentKey == requestKey {
            estimatedBreadcrumbRoutes = routes
        }
    }

    private var mapContentKey: String {
        let markers = historicalMapEntries.map(\.id).joined(separator: ",")
        let tracks = filteredJourneyHistory.map(\.id).joined(separator: ",")
        return "\(markers)|\(tracks)"
    }

    private func includes(_ entry: LogEntry, in voyage: VoyageSummary) -> Bool {
        if let start = voyage.start, entry.timestamp < start { return false }
        if let end = voyage.end, entry.timestamp > end { return false }
        return true
    }

    private func overlaps(start: Date, end: Date, voyage: VoyageSummary) -> Bool {
        if let voyageStart = voyage.start, end < voyageStart { return false }
        if let voyageEnd = voyage.end, start > voyageEnd { return false }
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
        errorMessage = nil

        async let cachedLogs = authentication.api.cachedLogs()
        async let cachedVoyages = authentication.api.cachedVoyages()
        async let cachedJourneyHistory = authentication.api.cachedJourneyHistory()
        let (savedLogs, savedVoyages, savedJourneyHistory) = await (
            cachedLogs,
            cachedVoyages,
            cachedJourneyHistory
        )

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

        if journeyHistory.isEmpty, let savedJourneyHistory {
            journeyHistory = savedJourneyHistory.journeys
        }

        defer { loading = false }
        guard let token = authentication.token, !authentication.isOffline else { return }

        async let freshLogs = authentication.api.logs(token: token)
        async let freshVoyages = authentication.api.voyages(token: token)
        async let freshJourneyHistory = authentication.api.journeyHistory(token: token)

        do {
            voyages = try await freshVoyages.voyages
            selectCurrentVoyageIfNeeded(allowAll: true)
        } catch {
            // Voyage metadata is optional; the complete logbook remains useful.
        }

        do {
            journeyHistory = try await freshJourneyHistory.journeys
        } catch {
            // Recorded tracks are optional; mapped log entries remain useful.
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

private struct LogbookMapMarker: Identifiable {
    let id: String
    let entry: LogEntry
    let coordinate: CLLocationCoordinate2D
}

private struct TodoListPills: View {
    let lists: [TodoList]
    @Binding var selectedListID: String
    let showsAddButton: Bool
    let onAdd: (() -> Void)?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(lists) { list in
                    let isSelected = selectedListID == list.id
                    Button {
                        selectedListID = list.id
                    } label: {
                        Text(list.name)
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(isSelected ? Color.white : Color.primary)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(
                                isSelected ? Chartroom.sea : Color.secondary.opacity(0.16),
                                in: Capsule()
                            )
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(isSelected ? .isSelected : [])
                }

                if showsAddButton {
                    Button {
                        onAdd?()
                    } label: {
                        Image(systemName: "plus")
                            .font(.subheadline.bold())
                            .foregroundStyle(.white)
                            .frame(width: 34, height: 34)
                            .background(Chartroom.sea, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Add task")
                }
            }
            .padding(.vertical, 2)
        }
    }
}

struct TodoView: View {
    @EnvironmentObject private var authentication: AuthenticationManager
    @EnvironmentObject private var tracker: JourneyTracker
    @State private var lists: [TodoList] = []
    @State private var selectedListID = ""
    @State private var errorMessage: String?
    @State private var actionErrorMessage: String?
    @State private var pendingCardIDs: Set<String> = []
    @State private var editingCard: TodoCard?
    @State private var isShowingAddTask = false
    @State private var queuedReorders: [String: PendingTodoOrder] = [:]
    @State private var isSavingOrder = false
    @State private var loading = true
    @State private var keepAwakeTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            Group {
                if loading { ProgressView("Loading tasks…") }
                else if let errorMessage, lists.isEmpty { ContentUnavailableView("Couldn’t load tasks", systemImage: "exclamationmark.triangle", description: Text(errorMessage)) }
                else {
                    List {
                        TodoListPills(
                            lists: lists,
                            selectedListID: $selectedListID,
                            showsAddButton: true,
                            onAdd: { isShowingAddTask = true }
                        )
                        .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 0))
                        .listRowBackground(Chartroom.paper)
                        .listRowSeparator(.hidden)

                        Section("Open") {
                            ForEach(selectedList?.cards.filter { !$0.dueComplete } ?? []) { card in
                                todoRow(card)
                            }
                            .onMove(perform: moveOpenCards)
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
            .task { await load() }
            .refreshable { await load() }
            .onReceive(NotificationCenter.default.publisher(for: .captainsLogTodoDidChange)) { _ in
                Task { await load() }
            }
            .onAppear(perform: beginKeepAwakeWindow)
            .onDisappear(perform: endKeepAwakeWindow)
            .onChange(of: tracker.isUnderway) { _, isUnderway in
                if keepAwakeTask != nil {
                    UIApplication.shared.isIdleTimerDisabled = true
                } else {
                    UIApplication.shared.isIdleTimerDisabled = isUnderway
                }
            }
            .sheet(item: $editingCard) { card in
                TodoDetailView(
                    card: card,
                    onSave: { name, desc in
                        await edit(card, name: name, desc: desc)
                    },
                    onAddPhoto: { imageData, filename in
                        try await addPhoto(to: card, imageData: imageData, filename: filename)
                    },
                    onArchive: {
                        try await archive(card)
                    }
                )
            }
            .sheet(isPresented: $isShowingAddTask) {
                AddLogEntryView(initialAction: "todo", initialTodoListID: selectedListID)
            }
            .alert("Couldn’t update task", isPresented: actionErrorIsPresented) {
                Button("OK", role: .cancel) { actionErrorMessage = nil }
            } message: {
                Text(actionErrorMessage ?? "Please try again.")
            }
        }
    }

    private var actionErrorIsPresented: Binding<Bool> {
        Binding(
            get: { actionErrorMessage != nil },
            set: { if !$0 { actionErrorMessage = nil } }
        )
    }

    private var selectedList: TodoList? {
        lists.first { $0.id == selectedListID } ?? lists.first
    }

    private func todoRow(_ card: TodoCard) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Button { Task { await toggle(card) } } label: {
                if pendingCardIDs.contains(card.id) {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Image(systemName: card.dueComplete ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(card.dueComplete ? Chartroom.sea : .secondary)
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel(card.dueComplete ? "Mark as open" : "Mark as completed")

            Button { editingCard = card } label: {
                VStack(alignment: .leading, spacing: 3) {
                    Text(card.name)
                        .strikethrough(card.dueComplete)
                        .foregroundStyle(.primary)
                    if let desc = card.desc, !desc.isEmpty {
                        Text(desc).font(.caption).foregroundStyle(.secondary).lineLimit(2)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open \(card.name)")
        }
        .disabled(pendingCardIDs.contains(card.id))
        .swipeActions {
            Button { editingCard = card } label: {
                Label("Edit", systemImage: "pencil")
            }
            .tint(Chartroom.sea)
        }
    }

    @MainActor private func load() async {
        loading = lists.isEmpty
        defer { loading = false }
        if lists.isEmpty, let cached = await authentication.api.cachedTodoData() {
            lists = cached.lists
            if !lists.contains(where: { $0.id == selectedListID }) {
                selectedListID = lists.first?.id ?? ""
            }
        }
        guard let token = authentication.token, !authentication.isOffline else {
            errorMessage = nil
            return
        }
        do {
            lists = try await authentication.api.todoData(token: token).lists
            if !lists.contains(where: { $0.id == selectedListID }) { selectedListID = lists.first?.id ?? "" }
            errorMessage = nil
        } catch { errorMessage = error.localizedDescription }
    }

    @MainActor private func toggle(_ card: TodoCard) async {
        guard !pendingCardIDs.contains(card.id),
              let token = authentication.token else { return }
        let complete = !card.dueComplete

        pendingCardIDs.insert(card.id)
        withAnimation {
            setCompletion(cardID: card.id, complete: complete)
        }

        do {
            try await authentication.api.setTodoCompletion(cardID: card.id, complete: complete, token: token)
        } catch {
            withAnimation {
                setCompletion(cardID: card.id, complete: card.dueComplete)
            }
            actionErrorMessage = error.localizedDescription
        }
        pendingCardIDs.remove(card.id)
    }

    @MainActor private func edit(_ card: TodoCard, name: String, desc: String) async -> Bool {
        guard !pendingCardIDs.contains(card.id),
              let token = authentication.token else { return false }

        pendingCardIDs.insert(card.id)
        do {
            try await authentication.api.updateTodo(
                cardID: card.id,
                name: name,
                desc: desc,
                token: token
            )
            let current = currentCard(withID: card.id) ?? card
            replaceCard(
                card.id,
                with: TodoCard(
                    id: card.id,
                    name: name,
                    desc: desc.isEmpty ? nil : desc,
                    due: current.due,
                    dueComplete: current.dueComplete,
                    pos: current.pos,
                    attachments: current.attachments
                )
            )
            pendingCardIDs.remove(card.id)
            return true
        } catch {
            pendingCardIDs.remove(card.id)
            actionErrorMessage = error.localizedDescription
            return false
        }
    }

    @MainActor private func archive(_ card: TodoCard) async throws {
        guard !pendingCardIDs.contains(card.id),
              let token = authentication.token else {
            throw APIClientError.server("Not authenticated")
        }

        pendingCardIDs.insert(card.id)
        defer { pendingCardIDs.remove(card.id) }
        try await authentication.api.archiveTodo(cardID: card.id, token: token)
        withAnimation {
            for list in lists where list.cards.contains(where: { $0.id == card.id }) {
                updateCards(in: list.id) { cards in
                    cards.filter { $0.id != card.id }
                }
            }
        }
    }

    @MainActor private func addPhoto(
        to card: TodoCard,
        imageData: Data,
        filename: String
    ) async throws -> TodoAttachment {
        guard let token = authentication.token else {
            throw APIClientError.server("Not authenticated")
        }
        let attachment = try await authentication.api.addTodoPhoto(
            cardID: card.id,
            imageData: imageData,
            filename: filename,
            token: token
        )
        let current = currentCard(withID: card.id) ?? card
        replaceCard(
            card.id,
            with: TodoCard(
                id: current.id,
                name: current.name,
                desc: current.desc,
                due: current.due,
                dueComplete: current.dueComplete,
                pos: current.pos,
                attachments: (current.attachments ?? []) + [attachment]
            )
        )
        return attachment
    }

    @MainActor private func moveOpenCards(from source: IndexSet, to destination: Int) {
        guard let list = selectedList,
              let token = authentication.token else { return }

        var openCards = list.cards.filter { !$0.dueComplete }
        openCards.move(fromOffsets: source, toOffset: destination)
        let cardIDs = openCards.map(\.id)
        let positions = Dictionary(
            uniqueKeysWithValues: cardIDs.enumerated().map {
                ($0.element, Double(($0.offset + 1) * 16384))
            }
        )

        withAnimation {
            updateCards(in: list.id) { cards in
                (openCards + cards.filter(\.dueComplete)).map { card in
                    TodoCard(
                        id: card.id,
                        name: card.name,
                        desc: card.desc,
                        due: card.due,
                        dueComplete: card.dueComplete,
                        pos: positions[card.id] ?? card.pos,
                        attachments: card.attachments
                    )
                }
            }
        }

        queuedReorders[list.id] = PendingTodoOrder(
            listID: list.id,
            cardIDs: cardIDs,
            token: token
        )
        guard !isSavingOrder else { return }
        isSavingOrder = true
        Task { await saveQueuedReorders() }
    }

    @MainActor private func saveQueuedReorders() async {
        while let reorder = queuedReorders.values.first {
            queuedReorders[reorder.listID] = nil
            do {
                try await authentication.api.reorderTodos(
                    listID: reorder.listID,
                    cardIDs: reorder.cardIDs,
                    token: reorder.token
                )
            } catch {
                actionErrorMessage = error.localizedDescription
            }
        }
        isSavingOrder = false
    }

    private func updateCards(in listID: String, transform: ([TodoCard]) -> [TodoCard]) {
        guard let listIndex = lists.firstIndex(where: { $0.id == listID }) else { return }
        let list = lists[listIndex]
        lists[listIndex] = TodoList(
            id: list.id,
            name: list.name,
            pos: list.pos,
            cards: transform(list.cards)
        )
    }

    private func replaceCard(_ cardID: String, with replacement: TodoCard) {
        guard let listIndex = lists.firstIndex(where: { list in
            list.cards.contains(where: { $0.id == cardID })
        }) else { return }
        let list = lists[listIndex]
        lists[listIndex] = TodoList(
            id: list.id,
            name: list.name,
            pos: list.pos,
            cards: list.cards.map { $0.id == cardID ? replacement : $0 }
        )
    }

    private func currentCard(withID cardID: String) -> TodoCard? {
        lists.lazy.flatMap(\.cards).first { $0.id == cardID }
    }

    private func setCompletion(cardID: String, complete: Bool) {
        guard let listIndex = lists.firstIndex(where: { list in
            list.cards.contains(where: { $0.id == cardID })
        }) else { return }
        let list = lists[listIndex]
        lists[listIndex] = TodoList(
            id: list.id,
            name: list.name,
            pos: list.pos,
            cards: list.cards.map { card in
                guard card.id == cardID else { return card }
                return TodoCard(
                    id: card.id,
                    name: card.name,
                    desc: card.desc,
                    due: card.due,
                    dueComplete: complete,
                    pos: card.pos,
                    attachments: card.attachments
                )
            }
        )
    }

    private func beginKeepAwakeWindow() {
        keepAwakeTask?.cancel()
        UIApplication.shared.isIdleTimerDisabled = true
        keepAwakeTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(300))
            guard !Task.isCancelled else { return }
            keepAwakeTask = nil
            UIApplication.shared.isIdleTimerDisabled = tracker.isUnderway
        }
    }

    private func endKeepAwakeWindow() {
        keepAwakeTask?.cancel()
        keepAwakeTask = nil
        UIApplication.shared.isIdleTimerDisabled = tracker.isUnderway
    }
}

private struct PendingTodoOrder {
    let listID: String
    let cardIDs: [String]
    let token: String
}

private struct TodoDetailView: View {
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var authentication: AuthenticationManager
    @State private var name: String
    @State private var desc: String
    @State private var attachments: [TodoAttachment]
    @State private var photoSelection: PhotosPickerItem?
    @State private var isSaving = false
    @State private var isArchiving = false
    @State private var isUploadingPhoto = false
    @State private var showingCamera = false
    @State private var photoError: String?
    @State private var archiveError: String?
    @State private var showingArchiveConfirmation = false

    let onSave: (String, String) async -> Bool
    let onAddPhoto: (Data, String) async throws -> TodoAttachment
    let onArchive: () async throws -> Void
    let cardID: String

    init(
        card: TodoCard,
        onSave: @escaping (String, String) async -> Bool,
        onAddPhoto: @escaping (Data, String) async throws -> TodoAttachment,
        onArchive: @escaping () async throws -> Void
    ) {
        _name = State(initialValue: card.name)
        _desc = State(initialValue: card.desc ?? "")
        _attachments = State(initialValue: card.attachments ?? [])
        self.onSave = onSave
        self.onAddPhoto = onAddPhoto
        self.onArchive = onArchive
        cardID = card.id
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("Task") {
                    TextField("Task name", text: $name, axis: .vertical)
                }
                Section("Description") {
                    TextField("Optional notes", text: $desc, axis: .vertical)
                        .lineLimit(3...10)
                }
                Section("Photos") {
                    if !attachments.isEmpty {
                        ScrollView(.horizontal) {
                            HStack(spacing: 12) {
                                ForEach(attachments) { attachment in
                                    attachmentPreview(attachment)
                                }
                            }
                        }
                        .scrollIndicators(.hidden)
                    }

                    PhotosPicker(selection: $photoSelection, matching: .images) {
                        Label("Choose from Photo Library", systemImage: "photo.on.rectangle")
                    }
                    .disabled(isUploadingPhoto)

                    Button { showingCamera = true } label: {
                        Label("Take Photo", systemImage: "camera")
                    }
                    .disabled(isUploadingPhoto || !UIImagePickerController.isSourceTypeAvailable(.camera))

                    if isUploadingPhoto {
                        ProgressView("Adding photo to Trello…")
                    }
                }
                Section {
                    Button(role: .destructive) {
                        showingArchiveConfirmation = true
                    } label: {
                        Label("Archive", systemImage: "archivebox")
                            .frame(maxWidth: .infinity)
                    }
                    .disabled(isSaving || isUploadingPhoto || isArchiving)
                }
            }
            .navigationTitle("Task Details")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .disabled(isSaving)
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") {
                        Task {
                            isSaving = true
                            let saved = await onSave(
                                name.trimmingCharacters(in: .whitespacesAndNewlines),
                                desc.trimmingCharacters(in: .whitespacesAndNewlines)
                            )
                            isSaving = false
                            if saved { dismiss() }
                        }
                    }
                    .disabled(
                        isSaving ||
                        name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ||
                        name.count > 512 ||
                        desc.count > 16384
                    )
                }
            }
            .onChange(of: photoSelection) { _, item in
                guard let item else { return }
                Task {
                    defer { photoSelection = nil }
                    do {
                        guard let data = try await item.loadTransferable(type: Data.self),
                              let image = UIImage(data: data) else {
                            throw APIClientError.server("That photo could not be read.")
                        }
                        await upload(image)
                    } catch {
                        photoError = error.localizedDescription
                    }
                }
            }
            .fullScreenCover(isPresented: $showingCamera) {
                TodoCameraPicker { image in
                    showingCamera = false
                    if let image {
                        Task { await upload(image) }
                    }
                }
                .ignoresSafeArea()
            }
            .alert("Couldn’t add photo", isPresented: photoErrorIsPresented) {
                Button("OK", role: .cancel) { photoError = nil }
            } message: {
                Text(photoError ?? "Please try again.")
            }
            .alert("Couldn’t archive task", isPresented: archiveErrorIsPresented) {
                Button("OK", role: .cancel) { archiveError = nil }
            } message: {
                Text(archiveError ?? "Please try again.")
            }
            .confirmationDialog(
                "Archive this task in Trello?",
                isPresented: $showingArchiveConfirmation,
                titleVisibility: .visible
            ) {
                Button("Archive", role: .destructive) {
                    Task { await performArchive() }
                }
                Button("Cancel", role: .cancel) {}
            }
            .interactiveDismissDisabled(isSaving || isUploadingPhoto || isArchiving)
        }
    }

    private var photoErrorIsPresented: Binding<Bool> {
        Binding(
            get: { photoError != nil },
            set: { if !$0 { photoError = nil } }
        )
    }

    private var archiveErrorIsPresented: Binding<Bool> {
        Binding(
            get: { archiveError != nil },
            set: { if !$0 { archiveError = nil } }
        )
    }

    @ViewBuilder private func attachmentPreview(_ attachment: TodoAttachment) -> some View {
        TodoAttachmentThumbnail(
            cardID: cardID,
            attachment: attachment,
            api: authentication.api,
            token: authentication.token
        )
    }

    @MainActor private func upload(_ image: UIImage) async {
        guard !isUploadingPhoto else { return }
        guard let data = image.todoJPEGData(maxDimension: 2048, quality: 0.82) else {
            photoError = "That photo could not be prepared for upload."
            return
        }

        isUploadingPhoto = true
        defer { isUploadingPhoto = false }
        do {
            let attachment = try await onAddPhoto(
                data,
                "todo-\(UUID().uuidString).jpg"
            )
            attachments.append(attachment)
        } catch {
            photoError = error.localizedDescription
        }
    }

    @MainActor private func performArchive() async {
        guard !isArchiving else { return }
        isArchiving = true
        defer { isArchiving = false }
        do {
            try await onArchive()
            dismiss()
        } catch {
            archiveError = error.localizedDescription
        }
    }
}

private struct TodoAttachmentThumbnail: View {
    let cardID: String
    let attachment: TodoAttachment
    let api: APIClient
    let token: String?

    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image)
                    .resizable()
                    .scaledToFill()
            } else {
                VStack(spacing: 5) {
                    Image(systemName: "photo")
                    Text(attachment.name)
                        .font(.caption2)
                        .lineLimit(2)
                }
                .foregroundStyle(.secondary)
                .padding(8)
            }
        }
        .frame(width: 112, height: 84)
        .background(.quaternary)
        .clipShape(RoundedRectangle(cornerRadius: 10))
        .task(id: attachment.id) {
            guard let token,
                  let data = try? await api.todoPhoto(
                    cardID: cardID,
                    attachmentID: attachment.id,
                    token: token
                  ) else { return }
            image = UIImage(data: data)
        }
    }
}

private struct TodoCameraPicker: UIViewControllerRepresentable {
    let onFinish: (UIImage?) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onFinish: onFinish)
    }

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let onFinish: (UIImage?) -> Void

        init(onFinish: @escaping (UIImage?) -> Void) {
            self.onFinish = onFinish
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            onFinish(info[.originalImage] as? UIImage)
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            onFinish(nil)
        }
    }
}

private extension UIImage {
    func todoJPEGData(maxDimension: CGFloat, quality: CGFloat) -> Data? {
        let scale = min(1, maxDimension / max(size.width, size.height))
        guard scale < 1 else { return jpegData(compressionQuality: quality) }

        let targetSize = CGSize(width: size.width * scale, height: size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: targetSize)
        let resized = renderer.image { _ in
            draw(in: CGRect(origin: .zero, size: targetSize))
        }
        return resized.jpegData(compressionQuality: quality)
    }
}
