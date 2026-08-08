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

    init() {
        let configured = Bundle.main.object(forInfoDictionaryKey: "API_BASE_URL") as? String
        baseURL = URL(string: configured ?? "https://where.is.achilleas.co.uk")!
    }

    var loginURL: URL {
        baseURL.appending(path: "auth/trello").appending(queryItems: [
            URLQueryItem(name: "client", value: "ios")
        ])
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

    func cachedCurrentStatus() async -> CurrentStatusResponse? {
        guard let data = await responseCache.data(for: "current-status") else { return nil }
        return try? JSONDecoder.captainsLog.decode(CurrentStatusResponse.self, from: data)
    }

    func planning(token: String) async throws -> PlanningResponse {
        try await send(path: "api/data", token: token, cacheKey: "planning")
    }

    func planningRoute(points: [PlanningRoutePoint], token: String) async throws -> PlanningRouteResponse {
        try await send(
            path: "api/planning-route",
            method: "POST",
            encodableBody: PlanningRouteBody(points: points),
            token: token,
            cacheKey: "planning-route-\(points.map { "\($0.lat),\($0.lng)" }.joined(separator: ";"))"
        )
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

    func todoData(token: String) async throws -> TodoDataResponse {
        try await send(path: "to-do/api/data", token: token, cacheKey: "todo-data")
    }

    func planStop(cardID: String, due: Date, token: String) async throws {
        let _: SuccessResponse = try await send(
            path: "api/plan-stop",
            method: "POST",
            encodableBody: PlanStopBody(cardId: cardID, due: due),
            token: token
        )
    }

    func removeStop(cardID: String, token: String) async throws {
        let _: SuccessResponse = try await send(
            path: "api/remove-stop",
            method: "POST",
            body: ["cardId": cardID],
            token: token
        )
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

    func addLogEntry(
        action: String,
        cardID: String,
        latitude: Double,
        longitude: Double,
        journeyName: String? = nil,
        mooringLabelID: String? = nil,
        placeName: String? = nil,
        customText: String? = nil,
        timestamp: Date = Date(),
        litres: Double? = nil,
        temperature: Double? = nil,
        token: String
    ) async throws {
        let _: SuccessResponse = try await send(
            path: "api/log-entry",
            method: "POST",
            encodableBody: LogEntryBody(
                action: action,
                cardId: cardID,
                lat: latitude,
                lng: longitude,
                timestamp: timestamp,
                source: "ios",
                litres: litres,
                temperature: temperature,
                journeyName: journeyName,
                mooringLabelId: mooringLabelID,
                placeName: placeName,
                customText: customText
            ),
            token: token
        )
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
        token: String
    ) async throws -> LogNotificationResponse {
        try await send(
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

    init() {
        let caches = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
        directory = caches.appending(path: "CaptainsLogResponses", directoryHint: .isDirectory)
    }

    func data(for key: String) -> Data? {
        try? Data(contentsOf: fileURL(for: key))
    }

    func store(_ data: Data, for key: String) {
        do {
            try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
            try data.write(to: fileURL(for: key), options: .atomic)
        } catch {
            // A cache write must never make an otherwise successful request fail.
        }
    }

    private func fileURL(for key: String) -> URL {
        let encoded = Data(key.utf8).base64EncodedString()
            .replacingOccurrences(of: "/", with: "_")
            .replacingOccurrences(of: "+", with: "-")
        return directory.appending(path: encoded).appendingPathExtension("json")
    }
}

private struct PositionAcceptedResponse: Codable {
    let success: Bool
}

private struct PlanStopBody: Codable {
    let cardId: String
    let due: Date
}

private struct PlanningRouteBody: Codable, Sendable {
    let points: [PlanningRoutePoint]
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
