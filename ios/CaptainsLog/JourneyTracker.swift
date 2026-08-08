import CoreLocation
import Foundation

@MainActor
final class JourneyTracker: NSObject, ObservableObject, @preconcurrency CLLocationManagerDelegate {
    @Published private(set) var currentJourney: CurrentJourneyResponse?
    @Published private(set) var currentStatus: CurrentStatusResponse?
    @Published private(set) var isTracking = false
    @Published private(set) var isWorking = false
    @Published var errorMessage: String?

    private let locationManager = CLLocationManager()
    private let authentication: AuthenticationManager
    private var lastAcceptedAt: Date?
    private let activeJourneyKey = "active-journey-id"

    var isUnderway: Bool {
        currentJourney?.active == true || currentStatus?.status == "underway"
    }

    init(authentication: AuthenticationManager) {
        self.authentication = authentication
        super.init()
        locationManager.delegate = self
        locationManager.activityType = .otherNavigation
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
        locationManager.distanceFilter = 50
        locationManager.pausesLocationUpdatesAutomatically = false
        isTracking = UserDefaults.standard.string(forKey: activeJourneyKey) != nil
    }

    func refresh() async {
        if currentJourney == nil || currentStatus == nil {
            async let cachedJourney = authentication.api.cachedCurrentJourney()
            async let cachedStatus = authentication.api.cachedCurrentStatus()
            let (journey, status) = await (cachedJourney, cachedStatus)
            if currentJourney == nil, let journey {
                currentJourney = journeyWithPendingPositions(journey)
            }
            if currentStatus == nil, let status {
                currentStatus = status
            }
        }

        do {
            async let journey = authentication.api.currentJourney(token: authentication.token)
            async let status = authentication.api.currentStatus(token: authentication.token)
            let (journeyResponse, statusResponse) = try await (journey, status)
            currentJourney = journeyWithPendingPositions(journeyResponse)
            currentStatus = statusResponse
            if
                currentJourney?.active == true,
                let journeyID = currentJourney?.journey?.id
            {
                UserDefaults.standard.set(journeyID, forKey: activeJourneyKey)
                if !isTracking { beginLocationUpdates() }
            } else {
                stopLocationUpdates()
            }
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func startJourney(name: String) async {
        guard let token = authentication.token else { return }
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            let response = try await authentication.api.startJourney(name: name, token: token)
            currentJourney = CurrentJourneyResponse(
                active: true,
                journey: response.journey,
                position: nil,
                track: []
            )
            UserDefaults.standard.set(response.journey.id, forKey: activeJourneyKey)
            beginLocationUpdates()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func resumeTracking() {
        guard currentJourney?.active == true else { return }
        beginLocationUpdates()
    }

    func flushPendingPositions() async throws {
        guard
            let token = authentication.token,
            let journeyID = currentJourney?.journey?.id
        else { return }
        try await flushPending(journeyID: journeyID, token: token)
    }

    func endJourney() async {
        guard
            let token = authentication.token,
            let journeyID = currentJourney?.journey?.id
        else { return }
        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            try await flushPending(journeyID: journeyID, token: token)
            _ = try await authentication.api.endJourney(journeyID, token: token)
            stopLocationUpdates()
            await refresh()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func beginLocationUpdates() {
        locationManager.requestAlwaysAuthorization()
        locationManager.allowsBackgroundLocationUpdates = true
        locationManager.showsBackgroundLocationIndicator = true
        locationManager.startUpdatingLocation()
        isTracking = true
    }

    private func stopLocationUpdates() {
        locationManager.stopUpdatingLocation()
        locationManager.allowsBackgroundLocationUpdates = false
        UserDefaults.standard.removeObject(forKey: activeJourneyKey)
        isTracking = false
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted {
            errorMessage = "Location permission is required to publish the journey."
            stopLocationUpdates()
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        errorMessage = error.localizedDescription
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let location = locations.last, location.horizontalAccuracy >= 0 else { return }
        if let lastAcceptedAt, location.timestamp.timeIntervalSince(lastAcceptedAt) < 60 { return }
        lastAcceptedAt = location.timestamp

        let point = PositionPoint(
            timestamp: location.timestamp,
            lat: location.coordinate.latitude,
            lng: location.coordinate.longitude,
            accuracy: location.horizontalAccuracy,
            speedKts: location.speed >= 0 ? location.speed * 1.94384 : nil,
            course: location.course >= 0 ? location.course : nil,
            altitude: location.verticalAccuracy >= 0 ? location.altitude : nil,
            sampleId: UUID().uuidString,
            source: "ios"
        )
        recordLocally(point)
        Task { await upload(point) }
    }

    private func recordLocally(_ point: PositionPoint) {
        guard let journey = currentJourney, journey.active else { return }
        var track = journey.track ?? []
        if !track.contains(where: { $0.id == point.id }) { track.append(point) }
        currentJourney = CurrentJourneyResponse(
            active: true,
            journey: journey.journey,
            position: point,
            track: track
        )
    }

    private func journeyWithPendingPositions(_ journey: CurrentJourneyResponse) -> CurrentJourneyResponse {
        guard journey.active, let journeyID = journey.journey?.id else { return journey }
        let pending = pendingPoints(journeyID: journeyID)
        guard !pending.isEmpty else { return journey }
        var track = journey.track ?? []
        let existingIDs = Set(track.map(\.id))
        track.append(contentsOf: pending.filter { !existingIDs.contains($0.id) })
        track.sort { $0.timestamp < $1.timestamp }
        return CurrentJourneyResponse(
            active: true,
            journey: journey.journey,
            position: track.last ?? journey.position,
            track: track
        )
    }

    private func upload(_ point: PositionPoint) async {
        guard
            let token = authentication.token,
            let journeyID = currentJourney?.journey?.id
        else { return }
        do {
            try await flushPending(journeyID: journeyID, token: token)
            try await authentication.api.uploadPosition(point, journeyID: journeyID, token: token)
            await refresh()
        } catch {
            queue(point, journeyID: journeyID)
            errorMessage = "Position saved on this iPhone and will retry when connected."
        }
    }

    private func pendingKey(for journeyID: String) -> String {
        "pending-position-points-\(journeyID)"
    }

    private func queue(_ point: PositionPoint, journeyID: String) {
        var points = pendingPoints(journeyID: journeyID)
        points.append(point)
        points = Array(points.suffix(200))
        UserDefaults.standard.set(
            try? JSONEncoder.captainsLog.encode(points),
            forKey: pendingKey(for: journeyID)
        )
    }

    private func pendingPoints(journeyID: String) -> [PositionPoint] {
        guard
            let data = UserDefaults.standard.data(forKey: pendingKey(for: journeyID)),
            let points = try? JSONDecoder.captainsLog.decode([PositionPoint].self, from: data)
        else { return [] }
        return points
    }

    private func flushPending(journeyID: String, token: String) async throws {
        let points = pendingPoints(journeyID: journeyID)
        guard !points.isEmpty else { return }
        for point in points {
            try await authentication.api.uploadPosition(point, journeyID: journeyID, token: token)
        }
        UserDefaults.standard.removeObject(forKey: pendingKey(for: journeyID))
    }
}
