import AppIntents
import CoreLocation
import Foundation

enum CaptainLogAction: String, AppEnum, CaseIterable {
    case todo
    case arrived
    case departed
    case visited
    case water
    case diesel
    case temperature
    case bins
    case bbqGasChange = "bbq-gas-change"
    case gasTankChange = "gas-tank-change"
    case waterTankChange = "water-tank-change"
    case power
    case boom
    case other

    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Action")

    static let caseDisplayRepresentations: [CaptainLogAction: DisplayRepresentation] = [
        .todo: DisplayRepresentation(title: "To Do", synonyms: ["Task", "To-do", "Reminder"]),
        .arrived: DisplayRepresentation(title: "Arrived", synonyms: ["Arrival", "We arrived"]),
        .departed: DisplayRepresentation(title: "Departed", synonyms: ["Departure", "We left", "Set off"]),
        .visited: DisplayRepresentation(title: "Visited", synonyms: ["Visit"]),
        .water: DisplayRepresentation(title: "Water", synonyms: ["Filled water", "Added water"]),
        .diesel: DisplayRepresentation(title: "Diesel", synonyms: ["Fuel", "Fueled", "Refueled"]),
        .temperature: DisplayRepresentation(title: "Sea Temp", synonyms: ["Sea temperature", "Water temperature"]),
        .bins: DisplayRepresentation(title: "Bins", synonyms: ["Rubbish", "Trash", "Garbage"]),
        .bbqGasChange: DisplayRepresentation(title: "BBQ Gas Change", synonyms: ["Barbecue gas", "BBQ bottle"]),
        .gasTankChange: DisplayRepresentation(title: "Gas Tank Change", synonyms: ["Gas bottle", "Gas cylinder"]),
        .waterTankChange: DisplayRepresentation(title: "Water Tank Change", synonyms: ["Changed water tank"]),
        .power: DisplayRepresentation(title: "Shore power", synonyms: ["Power", "Electricity"]),
        .boom: DisplayRepresentation(title: "Boom", synonyms: ["Boom repair", "Boom maintenance"]),
        .other: DisplayRepresentation(title: "Other", synonyms: ["Something else", "Note"]),
    ]

    var label: String {
        switch self {
        case .todo: "To Do"
        case .arrived: "Arrived"
        case .departed: "Departed"
        case .visited: "Visited"
        case .water: "Water"
        case .diesel: "Diesel"
        case .temperature: "Sea Temp"
        case .bins: "Bins"
        case .bbqGasChange: "BBQ Gas Change"
        case .gasTankChange: "Gas Tank Change"
        case .waterTankChange: "Water Tank Change"
        case .power: "Shore power"
        case .boom: "Boom"
        case .other: "Other"
        }
    }

    var systemImage: String {
        switch self {
        case .todo: "checklist"
        case .arrived: "sailboat.fill"
        case .departed: "sailboat"
        case .visited: "mappin.and.ellipse"
        case .water: "drop.fill"
        case .diesel: "fuelpump"
        case .temperature: "thermometer.medium"
        case .bins: "trash"
        case .bbqGasChange: "flame.fill"
        case .gasTankChange: "cylinder.fill"
        case .waterTankChange: "drop.triangle.fill"
        case .power: "bolt.fill"
        case .boom: "wrench.and.screwdriver"
        case .other: "square.and.pencil"
        }
    }

    var sendsNotificationByDefault: Bool {
        self == .arrived || self == .departed || self == .visited
    }
}

struct CaptainsLogVoiceIntent: AppIntent {
    static let title: LocalizedStringResource = "Captain’s Log"
    static let description = IntentDescription("Adds a log entry or to-do using a spoken conversation.")
    static let openAppWhenRun = false
    static let authenticationPolicy: IntentAuthenticationPolicy = .alwaysAllowed

    @Parameter(title: "Action")
    var action: CaptainLogAction?

    @Parameter(title: "Place")
    var placeName: String?

    @Parameter(title: "Journey name")
    var journeyName: String?

    @Parameter(title: "Mooring type")
    var mooringName: String?

    @Parameter(title: "Quantity")
    var quantityAnswer: String?

    @Parameter(title: "Sea temperature")
    var temperatureAnswer: String?

    @Parameter(title: "Details")
    var details: String?

    @Parameter(title: "Task name")
    var todoName: String?

    @Parameter(title: "To-do list")
    var todoListName: String?

    static var parameterSummary: some ParameterSummary {
        Summary("Add \(\.$action)")
    }

    func perform() async throws -> some IntentResult & ProvidesDialog {
        let resolvedAction = try await resolvedAction()
        guard let token = KeychainStore.read() else {
            throw CaptainsLogIntentError.notSignedIn
        }

        let api = APIClient()
        if resolvedAction == .todo {
            let lists = try await api.todoData(token: token).lists
            let list = try await resolvedTodoList(from: lists)
            let name = try await resolvedTodoName()
            _ = try await api.addTodo(name: name, listID: list.id, token: token)
            await MainActor.run {
                NotificationCenter.default.post(name: .captainsLogTodoDidChange, object: nil)
            }
            return .result(dialog: "Added \(name) to \(list.name).")
        }

        async let planningRequest = api.planning(token: token)
        async let statusRequest = api.currentStatus(token: token)
        async let journeyRequest = api.currentJourney(token: token)
        let (planning, status, journey) = try await (planningRequest, statusRequest, journeyRequest)

        let places = uniquePlaces(from: planning, status: status)
        let place = try await resolvedPlace(
            from: places,
            status: status,
            coordinate: journey.position?.coordinate
        )
        let mooringLabelID = try await resolvedMooringLabelID(
            for: resolvedAction,
            labels: planning.boardLabels ?? []
        )
        let resolvedJourneyName = try await resolvedJourneyName(
            for: resolvedAction,
            place: place,
            status: status
        )
        let litres = try await resolvedLitres(for: resolvedAction)
        let temperature = try await resolvedTemperature(for: resolvedAction)
        let customText = try await resolvedDetails(for: resolvedAction)

        guard let coordinate = journey.position?.coordinate ?? place.coordinate else {
            throw CaptainsLogIntentError.placeHasNoPosition(place.name)
        }

        let timestamp = Date()
        if resolvedAction == .arrived, let journeyID = journey.journey?.id, journey.active {
            try await flushPendingPositions(journeyID: journeyID, api: api, token: token)
        }
        try await api.addLogEntry(
            action: resolvedAction.rawValue,
            cardID: place.placeCardID,
            latitude: coordinate.latitude,
            longitude: coordinate.longitude,
            journeyName: resolvedJourneyName,
            mooringLabelID: mooringLabelID,
            placeName: place.name,
            customText: customText,
            timestamp: timestamp,
            litres: litres,
            temperature: temperature,
            token: token
        )

        if resolvedAction == .departed,
           let activeJourney = try? await api.currentJourney(token: token),
           let journeyID = activeJourney.journey?.id {
            UserDefaults.standard.set(journeyID, forKey: "active-journey-id")
        } else if resolvedAction == .arrived {
            UserDefaults.standard.removeObject(forKey: "active-journey-id")
        }

        var notificationWarning: String?
        if resolvedAction.sendsNotificationByDefault {
            do {
                _ = try await api.sendLogNotification(
                    mode: "people",
                    action: resolvedAction.rawValue,
                    cardID: place.placeCardID,
                    latitude: coordinate.latitude,
                    longitude: coordinate.longitude,
                    timestamp: timestamp,
                    litres: litres,
                    temperature: temperature,
                    customText: customText,
                    token: token
                )
            } catch {
                notificationWarning = error.localizedDescription
            }
        }

        await MainActor.run {
            NotificationCenter.default.post(name: .captainsLogDidChange, object: nil)
        }
        if let notificationWarning {
            return .result(
                dialog: "Logged \(resolvedAction.label) at \(place.name), but the email could not be sent: \(notificationWarning)"
            )
        }
        return .result(dialog: "Logged \(resolvedAction.label) at \(place.name).")
    }

    private func flushPendingPositions(journeyID: String, api: APIClient, token: String) async throws {
        let key = "pending-position-points-\(journeyID)"
        guard
            let data = UserDefaults.standard.data(forKey: key),
            let points = try? JSONDecoder.captainsLog.decode([PositionPoint].self, from: data),
            !points.isEmpty
        else { return }

        for point in points {
            try await api.uploadPosition(point, journeyID: journeyID, token: token)
        }
        UserDefaults.standard.removeObject(forKey: key)
    }

    private func resolvedAction() async throws -> CaptainLogAction {
        if let action { return action }
        return try await $action.requestValue("What would you like to add?")
    }

    private func resolvedTodoName() async throws -> String {
        let answer: String
        if let suppliedName = nonempty(todoName) {
            answer = suppliedName
        } else {
            answer = try await $todoName.requestValue("What should I add to your to-do list?")
        }
        let name = answer.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !name.isEmpty else { throw CaptainsLogIntentError.missingTodoName }
        return String(name.prefix(512))
    }

    private func resolvedTodoList(from lists: [TodoList]) async throws -> TodoList {
        guard !lists.isEmpty else { throw CaptainsLogIntentError.noTodoLists }

        if let suppliedName = nonempty(todoListName) {
            let matches = fuzzyMatches(suppliedName, in: lists, name: \TodoList.name)
            guard !matches.isEmpty else { throw CaptainsLogIntentError.todoListNotFound(suppliedName) }
            if matches.count == 1 { return matches[0] }
            let chosenName = try await $todoListName.requestDisambiguation(
                among: matches.map(\.name),
                dialog: "Which to-do list did you mean?"
            )
            return matches.first { $0.name == chosenName } ?? matches[0]
        }

        if lists.count == 1 { return lists[0] }
        let chosenName = try await $todoListName.requestDisambiguation(
            among: lists.map(\.name),
            dialog: "Which list should I add it to?"
        )
        return lists.first { $0.name == chosenName } ?? lists[0]
    }

    private func uniquePlaces(from planning: PlanningResponse, status: CurrentStatusResponse) -> [PlaceSummary] {
        var placesByID = Dictionary(uniqueKeysWithValues: planning.places.map { ($0.placeCardID, $0) })
        for stop in planning.stops where placesByID[stop.placeCardID] == nil {
            placesByID[stop.placeCardID] = stop
        }
        for place in [status.current, status.from, status.destination, status.plannedDestination].compactMap({ $0 }) {
            placesByID[place.placeCardID] = place
        }
        return placesByID.values.sorted {
            $0.name.localizedCaseInsensitiveCompare($1.name) == .orderedAscending
        }
    }

    private func resolvedPlace(
        from places: [PlaceSummary],
        status: CurrentStatusResponse,
        coordinate: CLLocationCoordinate2D?
    ) async throws -> PlaceSummary {
        let spokenName = placeName?.trimmingCharacters(in: .whitespacesAndNewlines)
        let answer: String
        if let spokenName, !spokenName.isEmpty {
            answer = spokenName
        } else if let suggestion = suggestedPlace(from: places, status: status, coordinate: coordinate) {
            let confirmed = try await $placeName.requestConfirmation(
                for: suggestion.name,
                dialog: IntentDialog(stringLiteral: "I think you’re at \(suggestion.name). Is that correct?")
            )
            if confirmed { return suggestion }
            answer = try await $placeName.requestValue("What is the name of the place?")
        } else {
            answer = try await $placeName.requestValue("What is the name of the place?")
        }

        let matches = fuzzyMatches(answer, in: places, name: \PlaceSummary.name)
        guard !matches.isEmpty else { throw CaptainsLogIntentError.placeNotFound(answer) }
        if matches.count == 1 { return matches[0] }

        let chosenName = try await $placeName.requestDisambiguation(
            among: matches.map(\.name),
            dialog: "Which place did you mean?"
        )
        return matches.first { $0.name == chosenName } ?? matches[0]
    }

    private func suggestedPlace(
        from places: [PlaceSummary],
        status: CurrentStatusResponse,
        coordinate: CLLocationCoordinate2D?
    ) -> PlaceSummary? {
        if let coordinate {
            let origin = CLLocation(latitude: coordinate.latitude, longitude: coordinate.longitude)
            let closest = places
                .compactMap { place -> (place: PlaceSummary, distance: CLLocationDistance)? in
                    guard let placeCoordinate = place.coordinate else { return nil }
                    let location = CLLocation(
                        latitude: placeCoordinate.latitude,
                        longitude: placeCoordinate.longitude
                    )
                    return (place, origin.distance(from: location))
                }
                .min { $0.distance < $1.distance }
            if let closest { return closest.place }
        }

        return status.current ?? status.from ?? status.destination ?? status.plannedDestination ?? places.first
    }

    private func resolvedMooringLabelID(for action: CaptainLogAction, labels: [PlaceLabel]) async throws -> String? {
        guard action == .arrived else { return nil }
        let mooringLabels = labels.filter {
            $0.trelloColor?.localizedCaseInsensitiveCompare("orange") == .orderedSame ||
                $0.color?.localizedCaseInsensitiveCompare("#ff9f1a") == .orderedSame
        }
        guard !mooringLabels.isEmpty else { throw CaptainsLogIntentError.noMooringTypes }

        let spokenName = mooringName?.trimmingCharacters(in: .whitespacesAndNewlines)
        let answer = if let spokenName, !spokenName.isEmpty {
            spokenName
        } else {
            try await $mooringName.requestValue("What type of mooring are you on?")
        }
        let matches = fuzzyMatches(answer, in: mooringLabels, name: \PlaceLabel.name)
        guard !matches.isEmpty else { throw CaptainsLogIntentError.mooringNotFound(answer) }
        if matches.count == 1 { return matches[0].id }

        let chosenName = try await $mooringName.requestDisambiguation(
            among: matches.map(\.name),
            dialog: "Which mooring type did you mean?"
        )
        return matches.first { $0.name == chosenName }?.id ?? matches[0].id
    }

    private func resolvedJourneyName(
        for action: CaptainLogAction,
        place: PlaceSummary,
        status: CurrentStatusResponse
    ) async throws -> String? {
        guard action == .departed else { return nil }
        if let journeyName = nonempty(journeyName) { return limited(journeyName) }
        let suggestion = status.plannedDestination?.name ?? status.destination?.name
        let prompt = suggestion.map { "What should this journey be called? The planned route is \(place.name) to \($0)." }
            ?? "What should this journey be called?"
        return limited(try await $journeyName.requestValue(IntentDialog(stringLiteral: prompt)))
    }

    private func resolvedLitres(for action: CaptainLogAction) async throws -> Double? {
        guard action == .water || action == .diesel else { return nil }
        let answer: String
        if let suppliedAnswer = nonempty(quantityAnswer) {
            answer = suppliedAnswer
        } else {
            answer = try await $quantityAnswer.requestValue(
                "How many litres? You can say skip if you don’t know."
            )
        }
        if isSkipAnswer(answer) { return nil }
        guard let value = number(in: answer), value >= 0 else {
            throw CaptainsLogIntentError.invalidQuantity
        }
        return value
    }

    private func resolvedTemperature(for action: CaptainLogAction) async throws -> Double? {
        guard action == .temperature || action == .arrived else { return nil }
        let prompt: IntentDialog = action == .arrived
            ? "What was the sea temperature? You can say skip."
            : "What was the sea temperature in degrees Celsius?"
        let answer: String
        if let suppliedAnswer = nonempty(temperatureAnswer) {
            answer = suppliedAnswer
        } else {
            answer = try await $temperatureAnswer.requestValue(prompt)
        }
        if action == .arrived, isSkipAnswer(answer) { return nil }
        guard let value = number(in: answer) else {
            throw CaptainsLogIntentError.invalidTemperature
        }
        return value
    }

    private func resolvedDetails(for action: CaptainLogAction) async throws -> String? {
        guard action == .other else { return nil }
        let answer: String
        if let suppliedDetails = nonempty(details) {
            answer = suppliedDetails
        } else {
            answer = try await $details.requestValue("What happened?")
        }
        let value = limited(answer.trimmingCharacters(in: .whitespacesAndNewlines))
        guard !value.isEmpty else { throw CaptainsLogIntentError.missingDetails }
        return value
    }

    private func fuzzyMatches<Item>(
        _ answer: String,
        in items: [Item],
        name: KeyPath<Item, String>
    ) -> [Item] {
        let needle = normalized(answer)
        let exact = items.filter { normalized($0[keyPath: name]) == needle }
        if !exact.isEmpty { return exact }
        return items.filter {
            let candidate = normalized($0[keyPath: name])
            return candidate.contains(needle) || needle.contains(candidate)
        }
    }

    private func normalized(_ value: String) -> String {
        value.folding(options: [.caseInsensitive, .diacriticInsensitive], locale: .current)
            .components(separatedBy: CharacterSet.alphanumerics.inverted)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
    }

    private func number(in answer: String) -> Double? {
        let normalized = answer.replacingOccurrences(of: ",", with: ".")
        guard let match = normalized.range(of: #"-?\d+(?:\.\d+)?"#, options: .regularExpression) else {
            return nil
        }
        return Double(normalized[match])
    }

    private func isSkipAnswer(_ answer: String) -> Bool {
        let value = normalized(answer)
        return ["skip", "unknown", "do not know", "dont know", "no"].contains(value)
    }

    private func nonempty(_ value: String?) -> String? {
        guard let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }

    private func limited(_ value: String) -> String {
        var result = value
        while result.utf16.count > 160 { result.removeLast() }
        return result
    }
}

struct CaptainsLogShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: CaptainsLogVoiceIntent(),
            phrases: [
                "\(.applicationName)",
                "Make an entry in \(.applicationName)",
                "Add an entry to \(.applicationName)",
                "Add to the log with \(.applicationName)",
                "Add a to-do with \(.applicationName)",
            ],
            shortTitle: "Captain’s Log",
            systemImageName: "book.closed.fill"
        )
    }

    static var shortcutTileColor: ShortcutTileColor { .navy }
}

private enum CaptainsLogIntentError: LocalizedError {
    case notSignedIn
    case placeNotFound(String)
    case placeHasNoPosition(String)
    case noMooringTypes
    case mooringNotFound(String)
    case invalidQuantity
    case invalidTemperature
    case missingDetails
    case noTodoLists
    case todoListNotFound(String)
    case missingTodoName

    var errorDescription: String? {
        switch self {
        case .notSignedIn: "Open Captain’s Log and sign in before using it."
        case .placeNotFound(let name): "I couldn’t find a saved place matching \(name)."
        case .placeHasNoPosition(let name): "\(name) doesn’t have a position to attach to the log."
        case .noMooringTypes: "No orange mooring labels are configured on the Trello board."
        case .mooringNotFound(let name): "I couldn’t find a mooring type matching \(name)."
        case .invalidQuantity: "The quantity needs to be a number of litres, or skip."
        case .invalidTemperature: "The sea temperature needs to be a number."
        case .missingDetails: "Please describe what happened."
        case .noTodoLists: "No to-do lists are available."
        case .todoListNotFound(let name): "I couldn’t find a to-do list matching \(name)."
        case .missingTodoName: "Please say what task you want to add."
        }
    }
}

extension Notification.Name {
    static let captainsLogDidChange = Notification.Name("CaptainsLogDidChange")
    static let captainsLogTodoDidChange = Notification.Name("CaptainsLogTodoDidChange")
}
