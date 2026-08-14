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
    let trelloColor: String?
}

struct PlacePresentation: Codable {
    let icon: String
    let iosSystemImage: String
    let webIconClass: String
    let mooringSummary: String?
}

struct PlaceSummary: Codable, Identifiable {
    let id: String
    let planId: String?
    let placeId: String?
    let name: String
    let listName: String?
    let due: Date?
    let dueComplete: Bool?
    let lat: Double?
    let lng: Double?
    let rating: Int?
    let desc: String?
    let labels: [PlaceLabel]?
    let trelloUrl: URL?
    let navilyUrl: URL?
    let navilySnapshot: NavilySnapshot?
    let visitCount: Int?
    let lastVisitedAt: Date?
    let presentation: PlacePresentation?

    var placeCardID: String { placeId ?? id }
    var planCardID: String? { planId }

    var coordinate: CLLocationCoordinate2D? {
        guard let lat, let lng else { return nil }
        return CLLocationCoordinate2D(latitude: lat, longitude: lng)
    }

    func withPlanningState(due: Date?, dueComplete: Bool? = nil) -> PlaceSummary {
        PlaceSummary(
            id: id,
            planId: planId,
            placeId: placeId,
            name: name,
            listName: listName,
            due: due,
            dueComplete: dueComplete ?? self.dueComplete,
            lat: lat,
            lng: lng,
            rating: rating,
            desc: desc,
            labels: labels,
            trelloUrl: trelloUrl,
            navilyUrl: navilyUrl,
            navilySnapshot: navilySnapshot,
            visitCount: visitCount,
            lastVisitedAt: lastVisitedAt,
            presentation: presentation
        )
    }

    var looksLikeAnchorage: Bool {
        let words = ([listName] + (labels ?? []).map(\.name)).compactMap { $0 }.joined(separator: " ")
        return words.range(of: "anchor|anchorage|bay|harbour|harbor|marina|port", options: .regularExpression) != nil
    }

    var mooringLabels: [PlaceLabel] {
        (labels ?? []).filter {
            $0.trelloColor?.localizedCaseInsensitiveCompare("orange") == .orderedSame ||
                $0.color?.localizedCaseInsensitiveCompare("#ff9f1a") == .orderedSame
        }
    }

    var mooringSummary: String? {
        if let summary = presentation?.mooringSummary { return summary }
        let names = mooringLabels.map(\.name)
        return names.isEmpty ? nil : names.joined(separator: ", ")
    }

    var mooringSystemImage: String {
        if let systemImage = presentation?.iosSystemImage { return systemImage }
        let text = mooringLabels.map(\.name).joined(separator: " ").lowercased()
        if text.range(of: "buoy|mooring", options: .regularExpression) != nil { return "lifepreserver.fill" }
        if text.range(of: "marina|berth|pontoon|quay|dock|harbou?r|port", options: .regularExpression) != nil { return "building.2.fill" }
        if text.range(of: "anchor|anchorage", options: .regularExpression) != nil { return "anchor" }
        return "mappin"
    }
}

struct NavilySnapshot: Codable {
    let checkedAt: Date
    let sourceUrl: URL
    let name: String?
    let lat: Double?
    let lng: Double?
    let summary: String
    let characteristics: [String]
    let seabed: [String]
    let facilities: [String]
}

struct NavilySnapshotResponse: Codable {
    let success: Bool
    let snapshot: NavilySnapshot
}

struct NavilySnapshotDraft: Codable {
    let sourceUrl: URL
    let name: String?
    let lat: Double?
    let lng: Double?
    let summary: String
    let characteristics: [String]
    let seabed: [String]
    let facilities: [String]
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
    let temperature: Double?
}

struct PlanningResponse: Codable {
    let stops: [PlaceSummary]
    let places: [PlaceSummary]
    let boardLabels: [PlaceLabel]?
    let placeLists: [PlaceListOption]?
}

struct PlanningStopUpdate: Codable, Sendable {
    let planId: String
    let due: Date
}

struct PlaceListOption: Codable, Identifiable {
    let id: String
    let name: String
}

struct CreatePlaceResponse: Codable {
    let success: Bool
    let place: PlaceSummary
}

struct PlanningRoutePoint: Codable, Sendable {
    let lat: Double
    let lng: Double
}

struct PlanningRouteLeg: Codable, Sendable {
    let coordinates: [[Double]]
    let distanceNm: Double?
    let method: String

    var mapCoordinates: [CLLocationCoordinate2D] {
        coordinates.compactMap { coordinate in
            guard coordinate.count >= 2 else { return nil }
            return CLLocationCoordinate2D(latitude: coordinate[1], longitude: coordinate[0])
        }
    }
}

struct PlanningRouteResponse: Codable, Sendable {
    let legs: [PlanningRouteLeg]
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
    let dieselLitres: Double?
}

struct LogsResponse: Codable {
    let logs: [LogEntry]
}

struct JourneyHistory: Codable, Identifiable {
    let id: String
    let name: String
    let startedAt: Date
    let endedAt: Date?
    let track: [PositionPoint]
}

struct JourneyHistoryResponse: Codable {
    let journeys: [JourneyHistory]
}

struct TodoCard: Codable, Identifiable {
    let id: String
    let name: String
    let desc: String?
    let due: Date?
    let dueComplete: Bool
    let pos: Double?
    let attachments: [TodoAttachment]?
}

struct TodoAttachment: Codable, Identifiable {
    let id: String
    let name: String
    let url: String?
    let mimeType: String?
    let previews: [TodoAttachmentPreview]?
}

struct TodoAttachmentPreview: Codable, Identifiable {
    var id: String { url }
    let url: String
    let width: Int?
    let height: Int?
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

struct LogNotificationResponse: Codable {
    let success: Bool
    let recipientCount: Int
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
