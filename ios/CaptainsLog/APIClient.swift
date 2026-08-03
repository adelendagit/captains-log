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
        token: String?
    ) async throws -> Response {
        let data = body.map { try? JSONEncoder.captainsLog.encode($0) } ?? nil
        return try await request(path: path, method: method, data: data, token: token)
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
            token: token
        )
    }

    private func request<Response: Decodable>(
        path: String,
        method: String,
        data: Data?,
        token: String?
    ) async throws -> Response {
        var request = URLRequest(url: baseURL.appending(path: path))
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
