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
