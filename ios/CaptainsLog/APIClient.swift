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
        try await send(path: "api/journeys/current", token: token)
    }

    func currentStatus(token: String?) async throws -> CurrentStatusResponse {
        try await send(path: "api/current-stop", token: token)
    }

    func planning(token: String) async throws -> PlanningResponse {
        try await send(path: "api/data", token: token)
    }

    func planningRoute(points: [PlanningRoutePoint], token: String) async throws -> PlanningRouteResponse {
        try await send(
            path: "api/planning-route",
            method: "POST",
            encodableBody: PlanningRouteBody(points: points),
            token: token
        )
    }

    func voyages(token: String) async throws -> VoyagesResponse {
        try await send(path: "api/voyages", token: token)
    }

    func logs(token: String) async throws -> LogsResponse {
        try await send(
            path: "api/logs",
            queryItems: [URLQueryItem(name: "trip", value: "all")],
            token: token
        )
    }

    func todoData(token: String) async throws -> TodoDataResponse {
        try await send(path: "to-do/api/data", token: token)
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

    func addTodo(name: String, listID: String, token: String) async throws {
        let _: CreateTodoResponse = try await send(
            path: "to-do/items",
            method: "POST",
            body: ["name": name, "listId": listID],
            token: token
        )
    }

    func setTodoCompletion(cardID: String, complete: Bool, token: String) async throws {
        let _: SuccessResponse = try await send(
            path: "to-do/\(cardID)/completion",
            method: "POST",
            encodableBody: TodoCompletionBody(complete: complete),
            token: token
        )
    }

    func addLogEntry(
        action: String,
        cardID: String,
        latitude: Double,
        longitude: Double,
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
                timestamp: Date(),
                source: "ios"
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
        token: String?
    ) async throws -> Response {
        let data = body.map { try? JSONEncoder.captainsLog.encode($0) } ?? nil
        return try await request(path: path, method: method, data: data, queryItems: queryItems, token: token)
    }

    private func send<Response: Decodable, Body: Encodable>(
        path: String,
        method: String,
        encodableBody: Body,
        token: String?
    ) async throws -> Response {
        try await request(
            path: path,
            method: method,
            data: JSONEncoder.captainsLog.encode(encodableBody),
            queryItems: [],
            token: token
        )
    }

    private func request<Response: Decodable>(
        path: String,
        method: String,
        data: Data?,
        queryItems: [URLQueryItem],
        token: String?
    ) async throws -> Response {
        let url = baseURL.appending(path: path).appending(queryItems: queryItems)
        var request = URLRequest(url: url)
        request.httpMethod = method
        request.httpBody = data
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if data != nil { request.setValue("application/json", forHTTPHeaderField: "Content-Type") }
        if let token { request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization") }

        let (responseData, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIClientError.invalidResponse
        }
        guard (200..<300).contains(httpResponse.statusCode) else {
            let message = (try? JSONDecoder.captainsLog.decode(APIErrorResponse.self, from: responseData))?.error
            throw APIClientError.server(message ?? "Request failed (\(httpResponse.statusCode)).")
        }
        return try JSONDecoder.captainsLog.decode(Response.self, from: responseData)
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

private struct CreateTodoResponse: Codable {
    let success: Bool
    let cardId: String
}

private struct LogEntryBody: Codable {
    let action: String
    let cardId: String
    let lat: Double
    let lng: Double
    let timestamp: Date
    let source: String
}
