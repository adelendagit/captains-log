import Foundation

enum APIClientError: LocalizedError {
    case invalidResponse
    case server(String)

    var errorDescription: String? {
        switch self {
        case .invalidResponse: "The server returned an invalid response."
        case .server(let message): message
        }
    }
}

final class APIClient: Sendable {
    let baseURL: URL
    private let responseCache = ResponseCache()
    private let mutationQueue = OfflineMutationQueue()

    init() {
        let configured = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String
        baseURL = URL(string: configured ?? "https://where.is.achilleas.co.uk")!
    }

    var loginURL: URL {
        baseURL.appending(path: "auth/trello").appending(queryItems: [
            URLQueryItem(name: "client", value: "ios")
        ])
    }

    var hasCachedPlanning: Bool {
        ResponseCache.hasData(for: "planning")
    }

    func pendingMutationCount() async -> Int {
        await mutationQueue.count
    }

    func flushPendingMutations(token: String) async throws {
        while let mutation = await mutationQueue.first {
            do {
                try await performMutation(
                    path: mutation.path,
                    method: mutation.method,
                    data: mutation.body,
                    token: token
                )
                try await mutationQueue.removeFirst(id: mutation.id)
            } catch {
                throw error
            }
        }
    }

    func exchange(code: String) async throws -> String {
        let response: TokenResponse = try await send(
            path: "auth/ios/exchange",
            method: "POST",
            body: ["code": code],
            token: nil
        )
        return response.token
    }

    func currentJourney(token: String?) async throws -> CurrentJourneyResponse {
        try await send(path: "api/journeys/current", token: token, cacheKey: "current-journey")
    }

    func cachedCurrentJourney() async -> CurrentJourneyResponse? {
        guard let data = await responseCache.data(for: "current-journey") else { return nil }
        return try? JSONDecoder.captainsLog.decode(CurrentJourneyResponse.self, from: data)
    }

    func currentStatus(token: String?) async throws -> CurrentStatusResponse {
        try await send(path: "api/current-stop", token: token, cacheKey: "current-status")
    }

    func updateCurrentStopDescription(_ description: String, token: String) async throws {
        let _: CurrentStopDescriptionResponse = try await send(
            path: "api/current-stop/description",
            method: "PUT",
            encodableBody: CurrentStopDescriptionBody(description: description),
            token: token
        )
    }

    func cachedCurrentStatus() async -> CurrentStatusResponse? {
        guard let data = await responseCache.data(for: "current-status") else { return nil }
        return try? JSONDecoder.captainsLog.decode(CurrentStatusResponse.self, from: data)
    }

    func planning(token: String) async throws -> PlanningResponse {
        try await send(path: "api/data", token: token, cacheKey: "planning")
    }

    func cachedPlanning() async -> PlanningResponse? {
        guard let data = await responseCache.data(for: "planning") else { return nil }
        return try? JSONDecoder.captainsLog.decode(PlanningResponse.self, from: data)
    }

    func planningRoute(points: [PlanningRoutePoint], token: String) async throws -> PlanningRouteResponse {
        let cacheKey = planningRouteCacheKey(points)
        return try await send(
            path: "api/planning-route",
            method: "POST",
            encodableBody: PlanningRouteBody(points: points),
            token: token,
            cacheKey: cacheKey
        )
    }

    func cachedPlanningRoute(points: [PlanningRoutePoint]) async -> PlanningRouteResponse? {
        guard let data = await responseCache.data(for: planningRouteCacheKey(points)) else { return nil }
        return try? JSONDecoder.captainsLog.decode(PlanningRouteResponse.self, from: data)
    }

    func voyages(token: String) async throws -> VoyagesResponse {
        try await send(path: "api/voyages", token: token, cacheKey: "voyages")
    }

    func cachedVoyages() async -> VoyagesResponse? {
        guard let data = await responseCache.data(for: "voyages") else { return nil }
        return try? JSONDecoder.captainsLog.decode(VoyagesResponse.self, from: data)
    }

    func logs(token: String) async throws -> LogsResponse {
        try await send(
            path: "api/logs",
            queryItems: [URLQueryItem(name: "trip", value: "all")],
            token: token,
            cacheKey: "logs-all"
        )
    }

    func cachedLogs() async -> LogsResponse? {
        guard let data = await responseCache.data(for: "logs-all") else { return nil }
        return try? JSONDecoder.captainsLog.decode(LogsResponse.self, from: data)
    }

    func journeyHistory(token: String) async throws -> JourneyHistoryResponse {
        try await send(
            path: "api/journeys/history",
            token: token,
            cacheKey: "journey-history"
        )
    }

    func cachedJourneyHistory() async -> JourneyHistoryResponse? {
        guard let data = await responseCache.data(for: "journey-history") else { return nil }
        return try? JSONDecoder.captainsLog.decode(JourneyHistoryResponse.self, from: data)
    }

    func todoData(token: String) async throws -> TodoDataResponse {
        try await send(path: "to-do/api/data", token: token, cacheKey: "todo-data")
    }

    func cachedTodoData() async -> TodoDataResponse? {
        guard let data = await responseCache.data(for: "todo-data") else { return nil }
        return try? JSONDecoder.captainsLog.decode(TodoDataResponse.self, from: data)
    }

    @discardableResult
    func planStop(
        placeID: String,
        planID: String? = nil,
        due: Date,
        token: String,
        queueImmediately: Bool = false
    ) async throws -> Bool {
        let queued = try await performOrQueue(
            path: "api/plan-stop",
            method: "POST",
            body: PlanStopBody(placeId: placeID, planId: planID, due: due),
            token: token,
            queueImmediately: queueImmediately
        )
        await updateCachedPlanning { planning in
            // Creating a plan produces a server-assigned occurrence ID, so a
            // queued/offline creation cannot be represented safely as a fake
            // stop. Existing occurrences can still be updated optimistically.
            guard let planID,
                  let place = planning.stops.first(where: { $0.id == planID }) else {
                return planning
            }
            let updated = place.withPlanningState(due: due, dueComplete: false)
            return PlanningResponse(
                stops: planning.stops.map { $0.id == planID ? updated : $0 },
                places: planning.places,
                boardLabels: planning.boardLabels,
                placeLists: planning.placeLists
            )
        }
        return queued
    }

    @discardableResult
    func removeStop(planID: String, token: String, queueImmediately: Bool = false) async throws -> Bool {
        let queued = try await performOrQueue(
            path: "api/remove-stop",
            method: "POST",
            body: ["planId": planID],
            token: token,
            queueImmediately: queueImmediately
        )
        await updateCachedPlanning { planning in
            PlanningResponse(
                stops: planning.stops.filter { $0.id != planID },
                places: planning.places,
                boardLabels: planning.boardLabels,
                placeLists: planning.placeLists
            )
        }
        return queued
    }

    @discardableResult
    func reorderStops(updates: [PlanningStopUpdate], token: String, queueImmediately: Bool = false) async throws -> Bool {
        let queued = try await performOrQueue(
            path: "api/reorder-stops",
            method: "POST",
            body: ReorderStopsBody(updates: updates),
            token: token,
            queueImmediately: queueImmediately
        )
        let dueByID = Dictionary(uniqueKeysWithValues: updates.map { ($0.planId, $0.due) })
        await updateCachedPlanning { planning in
            PlanningResponse(
                stops: planning.stops.map { stop in
                    dueByID[stop.id].map { stop.withPlanningState(due: $0) } ?? stop
                },
                places: planning.places,
                boardLabels: planning.boardLabels,
                placeLists: planning.placeLists
            )
        }
        return queued
    }

    func createPlace(
        name: String,
        description: String,
        listID: String,
        latitude: Double,
        longitude: Double,
        navilyURL: String,
        token: String
    ) async throws -> PlaceSummary {
        let response: CreatePlaceResponse = try await send(
            path: "api/places",
            method: "POST",
            encodableBody: CreatePlaceBody(
                name: name,
                description: description,
                listId: listID,
                lat: latitude,
                lng: longitude,
                navilyUrl: navilyURL
            ),
            token: token
        )
        return response.place
    }

    func saveNavilySnapshot(
        cardID: String,
        draft: NavilySnapshotDraft,
        token: String
    ) async throws -> NavilySnapshot {
        let response: NavilySnapshotResponse = try await send(
            path: "api/places/\(cardID)/navily-snapshots",
            method: "POST",
            encodableBody: draft,
            token: token
        )
        return response.snapshot
    }

    func addTodo(name: String, listID: String, token: String) async throws -> String {
        let response: CreateTodoResponse = try await send(
            path: "to-do/items",
            method: "POST",
            body: ["name": name, "listId": listID],
            token: token
        )
        return response.cardId
    }

    func setTodoCompletion(cardID: String, complete: Bool, token: String) async throws {
        let _: SuccessResponse = try await send(
            path: "to-do/\(cardID)/completion",
            method: "POST",
            encodableBody: TodoCompletionBody(complete: complete),
            token: token
        )
    }

    func updateTodo(cardID: String, name: String, desc: String, token: String) async throws {
        let _: SuccessResponse = try await send(
            path: "to-do/\(cardID)",
            method: "PATCH",
            encodableBody: UpdateTodoBody(name: name, desc: desc),
            token: token
        )
    }

    func archiveTodo(cardID: String, token: String) async throws {
        let _: SuccessResponse = try await send(
            path: "to-do/\(cardID)/archive",
            method: "POST",
            body: [:],
            token: token
        )
    }

    func reorderTodos(listID: String, cardIDs: [String], token: String) async throws {
        let _: SuccessResponse = try await send(
            path: "to-do/reorder",
            method: "POST",
            encodableBody: ReorderTodosBody(listId: listID, cardIds: cardIDs),
            token: token
        )
    }

    func addTodoPhoto(
        cardID: String,
        imageData: Data,
        filename: String,
        token: String
    ) async throws -> TodoAttachment {
        let boundary = "CaptainsLog-\(UUID().uuidString)"
        var request = URLRequest(url: baseURL.appending(path: "to-do/\(cardID)/attachments"))
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        request.setValue(
            "multipart/form-data; boundary=\(boundary)",
            forHTTPHeaderField: "Content-Type"
        )
        request.httpBody = Self.multipartImageBody(
            imageData,
            filename: filename,
            boundary: boundary
        )

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            let message = (try? JSONDecoder.captainsLog.decode(APIErrorResponse.self, from: data))?.error
            throw APIClientError.server(message ?? "Photo upload failed (\(httpResponse.statusCode)).")
        }
        return try JSONDecoder.captainsLog.decode(TodoAttachmentResponse.self, from: data).attachment
    }

    func todoPhoto(cardID: String, attachmentID: String, token: String) async throws -> Data {
        var request = URLRequest(
            url: baseURL.appending(path: "to-do/\(cardID)/attachments/\(attachmentID)/image")
        )
        request.setValue("image/*", forHTTPHeaderField: "Accept")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            throw APIClientError.server("Photo download failed (\(httpResponse.statusCode)).")
        }
        return data
    }

    @discardableResult
    func addLogEntry(
        action: String,
        cardID: String,
        latitude: Double,
        longitude: Double,
        requestID: String? = nil,
        journeyName: String? = nil,
        mooringLabelID: String? = nil,
        placeName: String? = nil,
        customText: String? = nil,
        timestamp: Date = Date(),
        litres: Double? = nil,
        temperature: Double? = nil,
        token: String,
        queueImmediately: Bool = false
    ) async throws -> Bool {
        let body = LogEntryBody(
            action: action,
            cardId: cardID,
            lat: latitude,
            lng: longitude,
            timestamp: timestamp,
            source: "ios",
            requestId: requestID,
            litres: litres,
            temperature: temperature,
            journeyName: journeyName,
            mooringLabelId: mooringLabelID,
            placeName: placeName,
            customText: customText
        )
        if queueImmediately {
            return try await performOrQueue(
                path: "api/log-entry",
                method: "POST",
                body: body,
                token: token,
                queueImmediately: true
            )
        }
        let _: SuccessResponse = try await send(
            path: "api/log-entry",
            method: "POST",
            encodableBody: body,
            token: token
        )
        return false
    }

    func sendLogNotification(
        mode: String,
        requestID: String = UUID().uuidString,
        action: String,
        cardID: String,
        latitude: Double,
        longitude: Double,
        timestamp: Date,
        litres: Double? = nil,
        temperature: Double? = nil,
        customText: String? = nil,
        token: String,
        queueImmediately: Bool = false
    ) async throws -> LogNotificationResponse? {
        if queueImmediately {
            _ = try await performOrQueue(
                path: "api/log-notification",
                method: "POST",
                body: LogNotificationBody(
                    mode: mode,
                    requestId: requestID,
                    action: action,
                    cardId: cardID,
                    lat: latitude,
                    lng: longitude,
                    timestamp: timestamp,
                    litres: litres,
                    temperature: temperature,
                    customText: customText
                ),
                token: token,
                queueImmediately: true
            )
            return nil
        }
        return try await send(
            path: "api/log-notification",
            method: "POST",
            encodableBody: LogNotificationBody(
                mode: mode,
                requestId: requestID,
                action: action,
                cardId: cardID,
                lat: latitude,
                lng: longitude,
                timestamp: timestamp,
                litres: litres,
                temperature: temperature,
                customText: customText
            ),
            token: token
        )
    }

    func startJourney(name: String, token: String) async throws -> StartJourneyResponse {
        try await send(
            path: "api/journeys/start",
            method: "POST",
            body: ["name": name],
            token: token
        )
    }

    func uploadPosition(_ position: PositionPoint, journeyID: String, token: String) async throws {
        let _: PositionAcceptedResponse = try await send(
            path: "api/journeys/\(journeyID)/positions",
            method: "POST",
            encodableBody: position,
            token: token
        )
    }

    func endJourney(_ journeyID: String, token: String) async throws -> EndJourneyResponse {
        try await send(
            path: "api/journeys/\(journeyID)/end",
            method: "POST",
            body: [String: String](),
            token: token
        )
    }

    private func send<Response: Decodable>(
        path: String,
        method: String = "GET",
        body: [String: String]? = nil,
        queryItems: [URLQueryItem] = [],
        token: String?,
        cacheKey: String? = nil
    ) async throws -> Response {
        let data = body.map { try? JSONEncoder.captainsLog.encode($0) } ?? nil
        return try await request(path: path, method: method, data: data, queryItems: queryItems, token: token, cacheKey: cacheKey)
    }

    private func send<Response: Decodable, Body: Encodable>(
        path: String,
        method: String,
        encodableBody: Body,
        token: String?,
        cacheKey: String? = nil
    ) async throws -> Response {
        try await request(
            path: path,
            method: method,
            data: JSONEncoder.captainsLog.encode(encodableBody),
            queryItems: [],
            token: token,
            cacheKey: cacheKey
        )
    }

    private func request<Response: Decodable>(
        path: String,
        method: String,
        data: Data?,
        queryItems: [URLQueryItem],
        token: String?,
        cacheKey: String?
    ) async throws -> Response {
        let url = baseURL.appending(path: path).appending(queryItems: queryItems)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = data
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if data != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }

        let responseData: Data
        let response: URLResponse
        do {
            (responseData, response) = try await URLSession.shared.data(for: request)
        } catch {
            if let cacheKey, let cachedData = await responseCache.data(for: cacheKey) {
                return try JSONDecoder.captainsLog.decode(Response.self, from: cachedData)
            }
            throw error
        }
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            let message = (try? JSONDecoder.captainsLog.decode(APIErrorResponse.self, from: responseData))?.error
            throw APIClientError.server(message ?? "Request failed (\(httpResponse.statusCode)).")
        }
        let decoded = try JSONDecoder.captainsLog.decode(Response.self, from: responseData)
        if let cacheKey {
            await responseCache.store(responseData, for: cacheKey)
        }
        return decoded
    }

    private func performOrQueue<Body: Encodable>(
        path: String,
        method: String,
        body: Body,
        token: String,
        queueImmediately: Bool
    ) async throws -> Bool {
        let data = try JSONEncoder.captainsLog.encode(body)
        if queueImmediately {
            try await mutationQueue.append(path: path, method: method, body: data)
            return true
        }
        do {
            try await performMutation(path: path, method: method, data: data, token: token)
            return false
        } catch where Self.isConnectivityError(error) {
            try await mutationQueue.append(path: path, method: method, body: data)
            return true
        }
    }

    private func planningRouteCacheKey(_ points: [PlanningRoutePoint]) -> String {
        "planning-route-\(points.map { "\($0.lat),\($0.lng)" }.joined(separator: ";"))"
    }

    private func performMutation(path: String, method: String, data: Data, token: String) async throws {
        var request = URLRequest(url: baseURL.appending(path: path))
        request.httpMethod = method
        request.httpBody = data
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        let (responseData, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            let message = (try? JSONDecoder.captainsLog.decode(APIErrorResponse.self, from: responseData))?.error
            throw APIClientError.server(message ?? "Request failed (\(httpResponse.statusCode)).")
        }
    }

    private func updateCachedPlanning(
        _ update: @Sendable (PlanningResponse) -> PlanningResponse
    ) async {
        guard
            let data = await responseCache.data(for: "planning"),
            let planning = try? JSONDecoder.captainsLog.decode(PlanningResponse.self, from: data),
            let updatedData = try? JSONEncoder.captainsLog.encode(update(planning))
        else { return }
        await responseCache.store(updatedData, for: "planning")
    }

    private static func isConnectivityError(_ error: Error) -> Bool {
        guard let urlError = error as? URLError else { return false }
        return [
            .notConnectedToInternet,
            .networkConnectionLost,
            .cannotConnectToHost,
            .cannotFindHost,
            .dnsLookupFailed,
            .timedOut,
            .internationalRoamingOff,
            .dataNotAllowed
        ].contains(urlError.code)
    }

    private static func multipartImageBody(
        _ imageData: Data,
        filename: String,
        boundary: String
    ) -> Data {
        var body = Data()
        body.append("--\(boundary)\r\n".data(using: .utf8)!)
        body.append(
            "Content-Disposition: form-data; name=\"file\"; filename=\"\(filename)\"\r\n"
                .data(using: .utf8)!
        )
        body.append("Content-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
        body.append(imageData)
        body.append("\r\n--\(boundary)--\r\n".data(using: .utf8)!)
        return body
    }
}

private actor ResponseCache {
    private let directory: URL
    private let legacyDirectory: URL

    init() {
        directory = Self.directory
        legacyDirectory = Self.legacyDirectory
    }

    func data(for key: String) -> Data? {
        if let data = try? Data(contentsOf: Self.fileURL(for: key, in: directory)) { return data }
        return try? Data(contentsOf: Self.fileURL(for: key, in: legacyDirectory))
    }

    func store(_ data: Data, for key: String) {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try data.write(to: Self.fileURL(for: key, in: directory), options: .atomic)
        } catch {
            // A cache write must never make an otherwise successful request fail.
        }
    }

    nonisolated static func hasData(for key: String) -> Bool {
        FileManager.default.fileExists(atPath: fileURL(for: key, in: directory).path) ||
            FileManager.default.fileExists(atPath: fileURL(for: key, in: legacyDirectory).path)
    }

    private nonisolated static var directory: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appending(path: "CaptainsLogResponses", directoryHint: .isDirectory)
    }

    private nonisolated static var legacyDirectory: URL {
        FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
            .appending(path: "CaptainsLogResponses", directoryHint: .isDirectory)
    }

    private nonisolated static func fileURL(for key: String, in directory: URL) -> URL {
        let encoded = Data(key.utf8).base64EncodedString()
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "+", with: "-")
        return directory.appending(path: encoded).appendingPathExtension("json")
    }
}

private struct OfflineMutation: Codable, Sendable {
    let id: UUID
    let path: String
    let method: String
    let body: Data
    let createdAt: Date
}

private actor OfflineMutationQueue {
    private var mutations: [OfflineMutation]
    private let fileURL: URL

    init() {
        let directory = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        fileURL = directory.appending(path: "CaptainsLogPendingMutations.json")
        if let data = try? Data(contentsOf: fileURL),
           let saved = try? JSONDecoder.captainsLog.decode([OfflineMutation].self, from: data) {
            mutations = saved
        } else {
            mutations = []
        }
    }

    var count: Int { mutations.count }
    var first: OfflineMutation? { mutations.first }

    func append(path: String, method: String, body: Data) throws {
        var updated = mutations
        updated.append(OfflineMutation(id: UUID(), path: path, method: method, body: body, createdAt: Date()))
        try persist(updated)
        mutations = updated
    }

    func removeFirst(id: UUID) throws {
        guard mutations.first?.id == id else { return }
        let updated = Array(mutations.dropFirst())
        try persist(updated)
        mutations = updated
    }

    private func persist(_ mutations: [OfflineMutation]) throws {
        try FileManager.default.createDirectory(at: fileURL.deletingLastPathComponent(), withIntermediateDirectories: true)
        try JSONEncoder.captainsLog.encode(mutations).write(to: fileURL, options: .atomic)
    }
}

private struct PositionAcceptedResponse: Codable {
    let success: Bool
}

private struct PlanStopBody: Codable {
    let placeId: String
    let planId: String?
    let due: Date
}

private struct CreatePlaceBody: Codable {
    let name: String
    let description: String
    let listId: String
    let lat: Double
    let lng: Double
    let navilyUrl: String
}

private struct CurrentStopDescriptionBody: Codable {
    let description: String
}

private struct CurrentStopDescriptionResponse: Codable {
    let success: Bool
    let description: String
}

private struct PlanningRouteBody: Codable, Sendable {
    let points: [PlanningRoutePoint]
}

private struct ReorderStopsBody: Codable, Sendable {
    let updates: [PlanningStopUpdate]
}

private struct TodoCompletionBody: Codable {
    let complete: Bool
}

private struct UpdateTodoBody: Codable {
    let name: String
    let desc: String
}

private struct ReorderTodosBody: Codable {
    let listId: String
    let cardIds: [String]
}

private struct CreateTodoResponse: Codable {
    let success: Bool
    let cardId: String
}

private struct TodoAttachmentResponse: Codable {
    let success: Bool
    let attachment: TodoAttachment
}

private struct LogEntryBody: Codable {
    let action: String
    let cardId: String
    let lat: Double
    let lng: Double
    let timestamp: Date
    let source: String
    let requestId: String?
    let litres: Double?
    let temperature: Double?
    let journeyName: String?
    let mooringLabelId: String?
    let placeName: String?
    let customText: String?
}

private struct LogNotificationBody: Codable {
    let mode: String
    let requestId: String
    let action: String
    let cardId: String
    let lat: Double
    let lng: Double
    let timestamp: Date
    let litres: Double?
    let temperature: Double?
    let customText: String?
}
