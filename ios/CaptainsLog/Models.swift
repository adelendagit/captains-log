import CoreLocation
import Foundation

struct JourneySummary: Codable, Identifiable {
    let id: String
    let name: String
    let startedAt: Date
}

struct PositionPoint: Codable, Identifiable {
    var id: String { sampleId ?? timestamp.ISO8601Format() }
    let timestamp: Date
    let lat: Double
    let lng: Double
    let accuracy: Double?
    let speedKts: Double?
    let course: Double?
    let altitude: Double?
    let sampleId: String?
    let source: String?

    var coordinate: CLLocationCoordinate2D {
        CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }
}

struct CurrentJourneyResponse: Codable {
    let active: Bool
    let journey: JourneySummary?
    let position: PositionPoint?
    let track: [PositionPoint]?
}

struct PlaceLabel: Codable, Identifiable {
    let id: String
    let name: String
    let color: String?
}

struct PlaceSummary: Codable, Identifiable {
    let id: String
    let name: String
    let listName: String?
    let due: Date?
    let dueComplete: Bool?
    let lat: Double?
    let lng: Double?
    let rating: Int?
    let desc: String?
    let labels: [PlaceLabel]?

    var coordinate: CLLocationCoordinate2D? {
        guard let lat, let lng else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }

    var looksLikeAnchorage: Bool {
        let words = ([listName] + (labels ?? []).map(\.name)).compactMap { $0 }.joined(separator: " ")
        return words.range(of: "anchor|anchorage|bay|harbour|harbor|marina|port", options: .regularExpression) != nil
    }
}

struct CurrentStatusResponse: Codable {
    let status: String
    let plannedDestination: PlaceSummary?
    let from: PlaceSummary?
    let destination: PlaceSummary?
    let current: PlaceSummary?
    let departedAt: Date?
    let arrivedAt: Date?
    let visitCount: Int?
}

struct PlanningResponse: Codable {
    let stops: [PlaceSummary]
    let places: [PlaceSummary]
}

struct VoyageSummary: Codable, Identifiable {
    let id: String
    let name: String
    let start: Date?
    let end: Date?
    let desc: String?
}

struct VoyagesResponse: Codable {
    let voyages: [VoyageSummary]
}

struct LogEntry: Codable, Identifiable {
    var id: String { "\(cardId)-\(timestamp.timeIntervalSince1970)-\(type)" }
    let area: String?
    let cardName: String
    let type: String
    let timestamp: Date
    let comment: String?
    let cardId: String
    let lat: Double?
    let lng: Double?
}

struct LogsResponse: Codable {
    let logs: [LogEntry]
}

struct TodoCard: Codable, Identifiable {
    let id: String
    let name: String
    let desc: String?
    let due: Date?
    let dueComplete: Bool
}

struct TodoList: Codable, Identifiable {
    let id: String
    let name: String
    let pos: Double?
    let cards: [TodoCard]
}

struct TodoDataResponse: Codable {
    let lists: [TodoList]
}

struct SuccessResponse: Codable {
    let success: Bool
}

struct StartJourneyResponse: Codable {
    let success: Bool
    let journey: JourneySummary
}

struct EndJourneyResponse: Codable {
    let success: Bool
    let endedAt: Date
}

struct TokenResponse: Codable {
    let token: String
    let expiresIn: Int
}

struct APIErrorResponse: Codable {
    let error: String
}

extension JSONDecoder {
    static var captainsLog: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return decoder
    }
}

extension JSONEncoder {
    static var captainsLog: JSONEncoder {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        return encoder
    }
}
