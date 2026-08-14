import MapKit
import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var authentication: AuthenticationManager

    var body: some View {
        Group {
            if shouldShowMainInterface {
                ChartroomView()
            } else {
                SignInView()
            }
        }
        .background(Chartroom.paper.ignoresSafeArea())
    }

    private var shouldShowMainInterface: Bool {
#if DEBUG
        if ProcessInfo.processInfo.environment["CAPTAINS_LOG_FORCE_EMPTY_PLAN"] == "1" {
            return true
        }
#endif
        return authentication.canOpenApp
    }
}

private struct SignInView: View {
    @EnvironmentObject private var authentication: AuthenticationManager

    var body: some View {
        VStack(spacing: 24) {
            Spacer()
            Image(systemName: "sailboat.fill")
                .font(.system(size: 58))
                .foregroundStyle(Chartroom.sea)
            VStack(spacing: 8) {
                Text("Captain’s Log")
                    .font(.system(.largeTitle, design: .serif, weight: .semibold))
                    .foregroundStyle(Chartroom.ink)
                Text("The private onboard companion for Skibidi.")
                    .foregroundStyle(.secondary)
                    .multilineTextAlignment(.center)
            }
            Button {
                authentication.signIn()
            } label: {
                HStack {
                    if authentication.isSigningIn { ProgressView().tint(.white) }
                    Text("Continue with Trello")
                }
                .frame(maxWidth: .infinity)
                .padding()
                .foregroundStyle(.white)
                .background(Chartroom.ink, in: Capsule())
            }
            .disabled(authentication.isSigningIn)

            if let message = authentication.errorMessage {
                Text(message).font(.footnote).foregroundStyle(.red)
            }
            Spacer()
        }
        .padding(28)
    }
}

private struct ChartroomView: View {
    @EnvironmentObject private var authentication: AuthenticationManager
    @State private var selectedTab = ChartroomTab.now
    @State private var logEntryIntent: LogEntryIntent?

    var body: some View {
        TabView(selection: selectedTabBinding) {
            CurrentPositionView(
                onStartJourney: {
                    logEntryIntent = LogEntryIntent(action: "departed")
                },
                onEndJourney: {
                    logEntryIntent = LogEntryIntent(action: "arrived")
                }
            )
                .tabItem { Label("Now", systemImage: "location.fill") }
                .tag(ChartroomTab.now)
            PlanView()
                .tabItem { Label("Plan", systemImage: "map") }
                .tag(ChartroomTab.plan)
            Color.clear
                .tabItem { Label("Add", systemImage: "plus") }
                .tag(ChartroomTab.add)
            LogbookView()
                .tabItem { Label("Logbook", systemImage: "book.closed") }
                .tag(ChartroomTab.logbook)
            TodoView()
                .tabItem { Label("To Do", systemImage: "checklist") }
                .tag(ChartroomTab.todo)
        }
        .sheet(item: $logEntryIntent) { intent in
            AddLogEntryView(initialAction: intent.action)
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if authentication.isOffline || authentication.pendingMutationCount > 0 {
                HStack(spacing: 8) {
                    Image(systemName: authentication.isOffline ? "wifi.slash" : "arrow.trianglehead.2.clockwise.rotate.90")
                    Text(connectionMessage)
                        .font(.footnote.weight(.medium))
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 8)
                .foregroundStyle(Chartroom.ink)
                .background(Chartroom.signal.opacity(0.92))
            }
        }
    }

    private var selectedTabBinding: Binding<ChartroomTab> {
        Binding(
            get: { selectedTab },
            set: { tab in
                if tab == .add {
                    logEntryIntent = LogEntryIntent(action: nil)
                } else {
                    selectedTab = tab
                }
            }
        )
    }

    private var connectionMessage: String {
        let count = authentication.pendingMutationCount
        if authentication.isOffline {
            return count == 0
                ? "Offline — showing saved data."
                : "Offline — showing saved data; \(count) plan change\(count == 1 ? "" : "s") queued."
        }
        return "Syncing \(count) queued plan change\(count == 1 ? "" : "s")…"
    }
}

private enum ChartroomTab: Hashable {
    case now
    case plan
    case add
    case logbook
    case todo
}

private struct CurrentPositionView: View {
    @EnvironmentObject private var authentication: AuthenticationManager
    @EnvironmentObject private var tracker: JourneyTracker
    @State private var camera: MapCameraPosition = .automatic
    @State private var mapViewportSource: String?
    @State private var plannedStops: [PlaceSummary]?
    @State private var plannedRoute: PlanningRouteResponse?
    @State private var supplyLogs: [LogEntry] = []
    @State private var selectedMapPlace: PlaceSummary?
    @State private var isEditingDescription = false
    @State private var descriptionDraft = ""
    @State private var isSavingDescription = false
    @State private var descriptionError: String?
    @FocusState private var descriptionIsFocused: Bool

    let onStartJourney: () -> Void
    let onEndJourney: () -> Void

    private let emptyPlanMapRadiusMeters: CLLocationDistance = 1_000

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    statusCard
                    suppliesSection
                    map
                    journeyControls
                    if let error = tracker.errorMessage {
                        Text(error)
                            .font(.footnote)
                            .foregroundStyle(.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                .padding()
            }
            .background(Chartroom.paper)
            .navigationTitle("Skibidi")
            .toolbar {
                ToolbarItem(placement: .topBarTrailing) {
                    Menu {
                        if tracker.currentJourney?.active == true {
                            Text("End the active journey before signing out")
                        } else {
                            Button("Sign out", role: .destructive) { authentication.signOut() }
                        }
                    } label: {
                        Image(systemName: "person.crop.circle")
                    }
                }
            }
            .task {
                await refreshMapData()
                tracker.resumeTracking()
            }
            .refreshable { await refreshMapData() }
            .sheet(item: $selectedMapPlace) { place in
                PlaceDetailView(
                    place: place,
                    due: place.due,
                    api: authentication.api,
                    token: authentication.token,
                    onDismiss: { selectedMapPlace = nil },
                    onNavilySaved: {
                        selectedMapPlace = nil
                        Task { await refreshMapData() }
                    }
                ) { EmptyView() }
                .presentationDetents([.medium, .large])
            }
            .onChange(of: tracker.currentStatus?.current?.id) {
                isEditingDescription = false
                descriptionError = nil
            }
        }
    }

    private var statusCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(statusEyebrow.uppercased())
                .font(.caption.bold())
                .tracking(1.5)
                .foregroundStyle(.white.opacity(0.65))
            HStack(spacing: 10) {
                Circle()
                    .fill(statusColor)
                    .frame(width: 10, height: 10)
                Text(statusTitle)
                    .font(.system(.title2, design: .serif, weight: .semibold))
            }
            statusDescription
            HStack(alignment: .top, spacing: 10) {
                statusReading(statusMetricOne.label, statusMetricOne.value)
                Divider().overlay(.white.opacity(0.18))
                statusReading(statusMetricTwo.label, statusMetricTwo.value)
                Divider().overlay(.white.opacity(0.18))
                statusReading(statusMetricThree.label, statusMetricThree.value)
                if tracker.currentJourney?.active != true && tracker.currentStatus?.status == "arrived" {
                    Divider().overlay(.white.opacity(0.18))
                    statusReading("Sea Temp", statusTemperature)
                }
            }
            .frame(minHeight: 44)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(22)
        .foregroundStyle(.white)
        .background(Chartroom.ink, in: RoundedRectangle(cornerRadius: 24))
    }

    @ViewBuilder
    private var statusDescription: some View {
        if canEditDescription {
            if isEditingDescription {
                VStack(alignment: .leading, spacing: 8) {
                    TextField("Description", text: $descriptionDraft, axis: .vertical)
                        .lineLimit(1...8)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 10)
                        .foregroundStyle(Chartroom.ink)
                        .background(.white, in: RoundedRectangle(cornerRadius: 12))
                        .focused($descriptionIsFocused)
                        .disabled(isSavingDescription)
                        .onChange(of: descriptionDraft) { enforceDescriptionLimit() }

                    HStack(spacing: 10) {
                        Spacer()
                        Button("Cancel") { cancelDescriptionEditing() }
                            .buttonStyle(.bordered)
                            .tint(.white)
                            .disabled(isSavingDescription)
                        Button {
                            Task { await saveDescription() }
                        } label: {
                            if isSavingDescription {
                                ProgressView().tint(Chartroom.ink)
                            } else {
                                Text("Save")
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(.white)
                        .foregroundStyle(Chartroom.ink)
                        .disabled(isSavingDescription)
                    }

                    if let descriptionError {
                        Text(descriptionError)
                            .font(.caption)
                            .foregroundStyle(Color(red: 1, green: 0.72, blue: 0.65))
                    }
                }
            } else {
                Text(statusMessage)
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.75))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 6)
                    .background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 8))
                    .contentShape(Rectangle())
                    .onTapGesture { beginDescriptionEditing() }
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(.isButton)
                    .accessibilityLabel("Edit current stop description")
            }
        } else {
            Text(statusMessage)
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.75))
        }
    }

    private var map: some View {
        Map(position: $camera) {
            if let plannedRoute {
                ForEach(Array(plannedRoute.legs.enumerated()), id: \.offset) { _, leg in
                    if leg.mapCoordinates.count > 1 {
                        MapPolyline(coordinates: leg.mapCoordinates)
                            .stroke(Chartroom.route, style: StrokeStyle(lineWidth: 4, dash: [8, 6]))
                    }
                }
            }
            if let track = tracker.currentJourney?.track, track.count > 1 {
                MapPolyline(coordinates: track.map(\.coordinate))
                    .stroke(Chartroom.signal, lineWidth: 4)
            }
            if let point = tracker.currentJourney?.position {
                Annotation("Skibidi", coordinate: point.coordinate) {
                    Image(systemName: "sailboat.fill")
                        .padding(10)
                        .foregroundStyle(Chartroom.ink)
                        .background(Chartroom.surface, in: Circle())
                        .overlay(Circle().stroke(Chartroom.signal, lineWidth: 3))
                }
            } else if let place = tracker.currentStatus?.current, let coordinate = place.coordinate {
                Annotation(place.name, coordinate: coordinate) {
                    Button { selectedMapPlace = place } label: {
                        Image(systemName: "sailboat.fill")
                            .padding(10)
                            .foregroundStyle(Chartroom.ink)
                            .background(Chartroom.surface, in: Circle())
                            .overlay(Circle().stroke(Chartroom.sea, lineWidth: 3))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Open \(place.name)")
                }
            }
            ForEach(plannedStops ?? []) { stop in
                if let coordinate = stop.coordinate {
                    Annotation(stop.name, coordinate: coordinate) {
                        Button { selectedMapPlace = stop } label: {
                            plannedStopMarker(stop)
                        }
                        .buttonStyle(.plain)
                        .accessibilityHint("Opens place details")
                    }
                }
            }
        }
        .mapStyle(.standard(elevation: .realistic))
        .frame(height: 330)
        .clipShape(RoundedRectangle(cornerRadius: 24))
        .onChange(of: mapFocusKey, initial: true) {
            focusMapOnCurrentPosition()
        }
    }

    private var suppliesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .firstTextBaseline) {
                Text("Supplies")
                    .font(.system(.title2, design: .serif, weight: .semibold))
                Spacer()
                Text("Estimated from the logbook")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
                ForEach(supplyInsights) { insight in
                    supplyCard(insight)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func supplyCard(_ insight: SupplyInsight) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 7) {
                Image(systemName: insight.systemImage)
                    .foregroundStyle(Chartroom.sea)
                Text(insight.title)
                    .font(.subheadline.weight(.semibold))
                    .lineLimit(1)
            }
            HStack(spacing: 8) {
                Text(insight.value)
                    .font(.system(.title3, design: .rounded, weight: .bold))
                    .foregroundStyle(.primary)
                    .minimumScaleFactor(0.72)
                    .lineLimit(2)
                Spacer(minLength: 0)
                supplyGauge(insight)
            }
            Text(insight.detail)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
                .frame(maxWidth: .infinity, minHeight: 32, alignment: .topLeading)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Chartroom.surface, in: RoundedRectangle(cornerRadius: 18))
        .accessibilityElement(children: .combine)
    }

    private func supplyGauge(_ insight: SupplyInsight) -> some View {
        let fraction = min(1, max(0, insight.fractionRemaining ?? 0))
        return ZStack {
            Circle()
                .stroke(.secondary.opacity(0.18), lineWidth: 6)
            Circle()
                .trim(from: 0, to: fraction)
                .stroke(
                    insight.fractionRemaining == nil ? Color.secondary.opacity(0.25) : Chartroom.sea,
                    style: StrokeStyle(lineWidth: 6, lineCap: .round)
                )
                .rotationEffect(.degrees(-90))
            Text(insight.fractionRemaining.map { "\(Int(($0 * 100).rounded()))%" } ?? "—")
                .font(.caption2.bold())
                .foregroundStyle(.primary)
        }
        .frame(width: 48, height: 48)
        .accessibilityLabel(insight.fractionRemaining.map { "\(Int(($0 * 100).rounded())) percent remaining" } ?? "Level unavailable")
    }

    private var supplyInsights: [SupplyInsight] {
        SupplyEstimator.insights(
            from: supplyLogs,
            additionalDieselDistanceNM: activeJourneyDistanceNM
        )
    }

    private var activeJourneyDistanceNM: Double {
        guard tracker.currentJourney?.active == true,
              let track = tracker.currentJourney?.track,
              track.count > 1 else { return 0 }
        return zip(track, track.dropFirst()).reduce(0) { total, pair in
            let from = CLLocation(latitude: pair.0.lat, longitude: pair.0.lng)
            let to = CLLocation(latitude: pair.1.lat, longitude: pair.1.lng)
            return total + from.distance(from: to) / 1_852
        }
    }

    private func plannedStopMarker(_ stop: PlaceSummary) -> some View {
        let index = (plannedStops?.firstIndex(where: { $0.id == stop.id }) ?? 0) + 1
        let rating = stop.rating.map { min(5, max(1, $0)) }
        let visits = max(0, stop.visitCount ?? 0)
        return ZStack {
            Circle()
                .fill(Chartroom.ink)
                .frame(width: 38, height: 38)
                .overlay {
                    Image(systemName: stop.mooringSystemImage)
                        .font(.caption.bold())
                        .foregroundStyle(.white)
                }
                .overlay {
                    Circle().stroke(
                        Chartroom.signal,
                        style: StrokeStyle(lineWidth: 3, dash: [4, 3])
                    )
                }
                .shadow(color: .black.opacity(0.2), radius: 2, y: 1)
            Text("\(index)")
                .font(.caption2.bold())
                .foregroundStyle(.white)
                .frame(width: 17, height: 17)
                .background(Chartroom.signal, in: Circle())
                .offset(x: -17, y: -17)
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
        .accessibilityLabel(
            [
                stop.name,
                stop.mooringSummary,
                rating.map { "\($0) out of 5 stars" },
                visits > 0 ? "\(visits) \(visits == 1 ? "visit" : "visits")" : nil,
                "planned stop \(index)",
            ].compactMap { $0 }.joined(separator: ", ")
        )
    }

    private var mapFocusKey: String {
        if let plannedStops, !plannedStops.isEmpty {
            return "planned-stops:\(plannedStops.map(\.id).joined(separator: ","))"
        }
        guard let focus = mapFocus else { return "none" }
        return "\(focus.source):\(focus.coordinate.latitude):\(focus.coordinate.longitude)"
    }

    private var mapFocus: (coordinate: CLLocationCoordinate2D, source: String)? {
        guard plannedStops?.isEmpty != false else { return nil }
        if let point = tracker.currentJourney?.position {
            return (point.coordinate, "live")
        }
        if let coordinate = tracker.currentStatus?.current?.coordinate {
            return (coordinate, "status")
        }
        return nil
    }

    private func focusMapOnCurrentPosition() {
        if plannedStops?.isEmpty == false {
            camera = .automatic
            mapViewportSource = nil
            return
        }

        guard let focus = mapFocus else { return }
        guard mapViewportSource != "live", mapViewportSource != focus.source else { return }

        camera = .region(
            MKCoordinateRegion(
                center: focus.coordinate,
                latitudinalMeters: emptyPlanMapRadiusMeters * 2,
                longitudinalMeters: emptyPlanMapRadiusMeters * 2
            )
        )
        mapViewportSource = focus.source
    }

    @MainActor private func refreshMapData() async {
        async let trackerRefresh: Void = tracker.refresh()
        async let planningRefresh: Void = refreshPlanningStatus()
        async let suppliesRefresh: Void = refreshSupplyLogs()
        _ = await (trackerRefresh, planningRefresh, suppliesRefresh)
    }

    @MainActor private func refreshSupplyLogs() async {
        if supplyLogs.isEmpty, let cached = await authentication.api.cachedLogs() {
            supplyLogs = cached.logs
        }
        guard let token = authentication.token, !authentication.isOffline else { return }
        do {
            supplyLogs = try await authentication.api.logs(token: token).logs
        } catch {
            // Keep cached estimates visible when connectivity is intermittent.
        }
    }

    @MainActor private func refreshPlanningStatus() async {
#if DEBUG
        if ProcessInfo.processInfo.environment["CAPTAINS_LOG_FORCE_EMPTY_PLAN"] == "1" {
            plannedStops = []
            return
        }
#endif
        if plannedStops == nil, let cached = await authentication.api.cachedPlanning() {
            plannedStops = cached.stops
                .filter { $0.dueComplete != true }
                .sorted {
                    switch ($0.due, $1.due) {
                    case let (left?, right?): left < right
                    case (_?, nil): true
                    case (nil, _?): false
                    case (nil, nil): $0.name < $1.name
                    }
                }
        }
        guard let token = authentication.token, !authentication.isOffline else { return }
        do {
            let stops = try await authentication.api.planning(token: token).stops
                .filter { $0.dueComplete != true }
                .sorted {
                    switch ($0.due, $1.due) {
                    case let (left?, right?): left < right
                    case (_?, nil): true
                    case (nil, _?): false
                    case (nil, nil): $0.name < $1.name
                    }
                }
            plannedStops = stops
            plannedRoute = await loadPlannedRoute(stops: stops, token: token)
        } catch {
            // Retain the last visible chart when the device moves in and out of coverage.
        }
    }

    @MainActor private func loadPlannedRoute(stops: [PlaceSummary], token: String) async -> PlanningRouteResponse? {
        guard tracker.currentJourney?.active == true || tracker.currentStatus?.status == "underway" else { return nil }
        var points: [PlanningRoutePoint] = []
        if let point = tracker.currentJourney?.position {
            points.append(PlanningRoutePoint(lat: point.lat, lng: point.lng))
        } else if let start = tracker.currentStatus?.from ?? tracker.currentStatus?.current,
                  let lat = start.lat, let lng = start.lng {
            points.append(PlanningRoutePoint(lat: lat, lng: lng))
        }
        points.append(contentsOf: stops.compactMap { stop in
            guard let lat = stop.lat, let lng = stop.lng else { return nil }
            return PlanningRoutePoint(lat: lat, lng: lng)
        })
        guard points.count > 1 else { return nil }
        return try? await authentication.api.planningRoute(points: points, token: token)
    }

    @ViewBuilder
    private var journeyControls: some View {
        if tracker.currentJourney?.active == true {
            VStack(spacing: 12) {
                Label(
                    tracker.isTracking ? "Live position is public" : "Location sharing is paused",
                    systemImage: tracker.isTracking ? "location.fill" : "location.slash"
                )
                .font(.headline)
                .foregroundStyle(tracker.isTracking ? Chartroom.sea : .secondary)
                Button("End Journey", role: .destructive) {
                    onEndJourney()
                }
                .buttonStyle(.borderedProminent)
                .tint(.red)
                .disabled(tracker.isWorking)
            }
            .frame(maxWidth: .infinity)
            .padding(20)
            .background(Chartroom.surface, in: RoundedRectangle(cornerRadius: 20))
        } else {
            VStack(alignment: .leading, spacing: 12) {
                Text("Ready to depart?")
                    .font(.system(.title2, design: .serif, weight: .semibold))
                Text("Start Journey records your departure and begins live position tracking.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                Button {
                    onStartJourney()
                } label: {
                    Label("Start Journey", systemImage: "sailboat.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(Chartroom.sea)
                .disabled(tracker.isWorking)
            }
            .padding(20)
            .background(Chartroom.surface, in: RoundedRectangle(cornerRadius: 20))
        }
    }

    private var statusEyebrow: String {
        if tracker.currentJourney?.active == true { return "Underway · Live position" }
        if let place = tracker.currentStatus?.current, tracker.currentStatus?.status == "arrived" {
            return place.looksLikeAnchorage ? "At anchor" : "Current stop"
        }
        if tracker.currentStatus?.status == "underway" { return "Underway · Last report" }
        return "Last known position"
    }

    private var statusTitle: String {
        if let journey = tracker.currentJourney?.journey, tracker.currentJourney?.active == true { return journey.name }
        if let place = tracker.currentStatus?.current, tracker.currentStatus?.status == "arrived" { return place.name }
        if tracker.currentStatus?.status == "underway" {
            let from = tracker.currentStatus?.from?.name
            let destination = tracker.currentStatus?.destination?.name ?? tracker.currentStatus?.plannedDestination?.name
            if let from, let destination { return "\(from) → \(destination)" }
            return destination ?? "Underway"
        }
        return "Position not yet logged"
    }

    private var statusMessage: String {
        if tracker.currentJourney?.active == true {
            if let point = tracker.currentJourney?.position {
                return String(format: "%.4f°, %.4f°", point.lat, point.lng)
            }
            return "The journey has started. Waiting for the first GPS report."
        }
        if let place = tracker.currentStatus?.current, tracker.currentStatus?.status == "arrived" {
            let firstParagraph = place.desc?.components(separatedBy: "\n\n").first?.trimmingCharacters(in: .whitespacesAndNewlines)
            return firstParagraph?.isEmpty == false ? firstParagraph! : "Add a description…"
        }
        if tracker.currentStatus?.status == "underway" {
            return "Live GPS is not available; the chart shows the logged passage."
        }
        return "Previous voyages and planned stops remain available."
    }

    private var canEditDescription: Bool {
        tracker.currentJourney?.active != true &&
            tracker.currentStatus?.status == "arrived" &&
            tracker.currentStatus?.current != nil
    }

    private func beginDescriptionEditing() {
        guard canEditDescription else { return }
        descriptionDraft = tracker.currentStatus?.current?.desc ?? ""
        descriptionError = nil
        isEditingDescription = true
        descriptionIsFocused = true
    }

    private func cancelDescriptionEditing() {
        isEditingDescription = false
        descriptionError = nil
        descriptionIsFocused = false
    }

    private func enforceDescriptionLimit() {
        while descriptionDraft.utf16.count > 16_384 {
            descriptionDraft.removeLast()
        }
    }

    @MainActor private func saveDescription() async {
        guard let token = authentication.token else { return }
        isSavingDescription = true
        descriptionError = nil
        defer { isSavingDescription = false }
        do {
            try await authentication.api.updateCurrentStopDescription(
                descriptionDraft,
                token: token
            )
            await tracker.refresh()
            isEditingDescription = false
            descriptionIsFocused = false
        } catch {
            descriptionError = error.localizedDescription
        }
    }

    private var statusColor: Color {
        if tracker.currentJourney?.active == true { return Chartroom.signal }
        if tracker.currentStatus?.status == "arrived" { return Color(red: 97 / 255, green: 198 / 255, blue: 185 / 255) }
        return .gray
    }

    private var statusMetricOne: (label: String, value: String) {
        if let point = tracker.currentJourney?.position, tracker.currentJourney?.active == true {
            return ("Last report", point.timestamp.formatted(.relative(presentation: .named)))
        }
        if tracker.currentJourney?.active == true { return ("Last report", "Waiting") }
        if tracker.currentStatus?.status == "arrived" {
            return ("Arrived", tracker.currentStatus?.arrivedAt?.formatted(date: .abbreviated, time: .omitted) ?? "Not recorded")
        }
        return ("Last report", "Not recorded")
    }

    private var statusMetricTwo: (label: String, value: String) {
        if let point = tracker.currentJourney?.position, tracker.currentJourney?.active == true {
            return ("Speed", point.speedKts.map { String(format: "%.1f kn", $0) } ?? "—")
        }
        if tracker.currentJourney?.active == true { return ("Speed", "—") }
        if tracker.currentStatus?.status == "arrived" {
            let count = max(1, tracker.currentStatus?.visitCount ?? 1)
            return ("Visits", "\(count) \(count == 1 ? "visit" : "visits")")
        }
        return ("Status", tracker.currentStatus?.status == "underway" ? "Underway" : "Standing by")
    }

    private var statusMetricThree: (label: String, value: String) {
        if let point = tracker.currentJourney?.position, tracker.currentJourney?.active == true {
            return ("Course", point.course.map { "\(Int($0.rounded()))°" } ?? "—")
        }
        if tracker.currentJourney?.active == true { return ("Course", "—") }
        if let place = tracker.currentStatus?.current, tracker.currentStatus?.status == "arrived" {
            return ("Area", place.listName ?? "—")
        }
        return ("Position", tracker.currentStatus?.status == "underway" ? "Logged" : "—")
    }

    private var statusTemperature: String {
        tracker.currentStatus?.temperature.map { String(format: "%g °C", $0) } ?? "—"
    }

    private func statusReading(_ label: String, _ value: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label.uppercased())
                .font(.caption2.bold())
                .tracking(0.7)
                .foregroundStyle(.white.opacity(0.6))
            Text(value)
                .font(.caption.bold())
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct SupplyInsight: Identifiable {
    let id: String
    let title: String
    let systemImage: String
    let value: String
    let detail: String
    let fractionRemaining: Double?
}

private enum SupplyEstimator {
    private static let dieselCapacityLitres = 140.0
    private static let waterTankCapacityLitres = 140.0
    private static let waterCapacityLitres = 280.0
    private static let secondsPerDay = 86_400.0

    static func insights(
        from logs: [LogEntry],
        now: Date = Date(),
        additionalDieselDistanceNM: Double = 0
    ) -> [SupplyInsight] {
        [
            dieselInsight(from: logs, additionalDistanceNM: additionalDieselDistanceNM),
            waterInsight(from: logs, now: now),
            cycleInsight(
                id: "gas",
                title: "Cooking gas",
                systemImage: "cylinder.fill",
                eventTypes: ["gas tank change", "gas tank refill"],
                action: "changed",
                logs: logs,
                now: now
            ),
            cycleInsight(
                id: "bbq-gas",
                title: "BBQ gas",
                systemImage: "flame.fill",
                eventTypes: ["bbq gas change"],
                action: "changed",
                logs: logs,
                now: now
            ),
        ]
    }

    private static func dieselInsight(
        from logs: [LogEntry],
        additionalDistanceNM: Double
    ) -> SupplyInsight {
        let ordered = logs.sorted { $0.timestamp < $1.timestamp }
        var distanceSinceFill = 0.0
        var efficiencies: [Double] = []
        var lastPoint: CLLocation?
        var lastFill: Date?

        for entry in ordered {
            let point = coordinate(for: entry)
            switch entry.type.lowercased() {
            case "departed":
                lastPoint = point
            case "visited":
                if let lastPoint, let point {
                    distanceSinceFill += lastPoint.distance(from: point) / 1_852
                }
                lastPoint = point
            case "arrived":
                if let lastPoint, let point {
                    distanceSinceFill += lastPoint.distance(from: point) / 1_852
                }
                lastPoint = nil
            case "diesel":
                if let litres = entry.dieselLitres, litres > 0, distanceSinceFill > 0 {
                    efficiencies.append(distanceSinceFill / litres)
                }
                distanceSinceFill = 0
                lastFill = entry.timestamp
            default:
                break
            }
        }

        guard let lastFill else {
            return SupplyInsight(
                id: "diesel", title: "Diesel", systemImage: "fuelpump.fill",
                value: "No fill logged", detail: "Log a diesel fill to start tracking range.",
                fractionRemaining: nil
            )
        }
        guard let economy = efficiencies.last, economy.isFinite, economy > 0 else {
            return SupplyInsight(
                id: "diesel", title: "Diesel", systemImage: "fuelpump.fill",
                value: "Learning economy", detail: "Last filled \(relativeAge(lastFill)). A completed fuel cycle is needed.",
                fractionRemaining: nil
            )
        }

        distanceSinceFill += max(0, additionalDistanceNM)
        let remainingLitres = max(0, min(dieselCapacityLitres, dieselCapacityLitres - distanceSinceFill / economy))
        let range = remainingLitres * economy
        return SupplyInsight(
            id: "diesel", title: "Diesel", systemImage: "fuelpump.fill",
            value: "≈\(Int(range.rounded())) NM range",
            detail: String(format: "%.0f L left · %.2f NM/L · filled %@", remainingLitres, economy, relativeAge(lastFill)),
            fractionRemaining: remainingLitres / dieselCapacityLitres
        )
    }

    private static func waterInsight(from logs: [LogEntry], now: Date) -> SupplyInsight {
        let events = logs
            .filter { ["water", "water tank change"].contains($0.type.lowercased()) }
            .sorted { $0.timestamp < $1.timestamp }
        guard let lastTopUpIndex = events.lastIndex(where: { $0.type.caseInsensitiveCompare("Water") == .orderedSame }) else {
            return SupplyInsight(
                id: "water", title: "Water", systemImage: "drop.fill",
                value: "No top-up logged", detail: "A Water log resets both 140 L tanks.",
                fractionRemaining: nil
            )
        }

        var completedTankCycles: [Double] = []
        var cycleStartedAt: Date?
        for event in events {
            if event.type.caseInsensitiveCompare("Water") == .orderedSame {
                cycleStartedAt = event.timestamp
            } else if event.type.caseInsensitiveCompare("Water Tank Change") == .orderedSame {
                if let cycleStartedAt {
                    let days = event.timestamp.timeIntervalSince(cycleStartedAt) / secondsPerDay
                    if days > 0 { completedTankCycles.append(days) }
                }
                cycleStartedAt = event.timestamp
            }
        }

        let lastTopUp = events[lastTopUpIndex]
        let changesSinceTopUp = events[(lastTopUpIndex + 1)...]
            .filter { $0.type.caseInsensitiveCompare("Water Tank Change") == .orderedSame }
        let wholeTanksRemaining = max(0, 2 - changesSinceTopUp.count)
        let currentCycleStartedAt = changesSinceTopUp.last?.timestamp ?? lastTopUp.timestamp
        let recentCycles = completedTankCycles.suffix(4).sorted()

        guard !recentCycles.isEmpty else {
            let knownLitres = Double(wholeTanksRemaining) * waterTankCapacityLitres
            return SupplyInsight(
                id: "water", title: "Water", systemImage: "drop.fill",
                value: "Up to \(Int(knownLitres)) L",
                detail: "Topped up \(relativeAge(lastTopUp.timestamp, now: now)) · learning usage",
                fractionRemaining: knownLitres / waterCapacityLitres
            )
        }

        let tankCycleDays = median(recentCycles)
        let elapsedInCurrentTank = max(0, now.timeIntervalSince(currentCycleStartedAt) / secondsPerDay)
        let currentTankFraction = max(0, 1 - elapsedInCurrentTank / tankCycleDays)
        let untouchedTanks = max(0, wholeTanksRemaining - 1)
        let remainingLitres = wholeTanksRemaining == 0 ? 0 : min(
            waterCapacityLitres,
            Double(untouchedTanks) * waterTankCapacityLitres + currentTankFraction * waterTankCapacityLitres
        )
        let dailyUse = waterTankCapacityLitres / tankCycleDays
        let remainingDays = remainingLitres / dailyUse

        return SupplyInsight(
            id: "water", title: "Water", systemImage: "drop.fill",
            value: "≈\(Int(remainingDays.rounded())) days left",
            detail: String(format: "≈%.0f L left · %.0f L/day · topped up %@", remainingLitres, dailyUse, relativeAge(lastTopUp.timestamp, now: now)),
            fractionRemaining: remainingLitres / waterCapacityLitres
        )
    }

    private static func cycleInsight(
        id: String,
        title: String,
        systemImage: String,
        eventTypes: Set<String>,
        action: String,
        logs: [LogEntry],
        now: Date
    ) -> SupplyInsight {
        let events = logs
            .filter { eventTypes.contains($0.type.lowercased()) }
            .map(\.timestamp)
            .sorted()
        guard let lastEvent = events.last else {
            return SupplyInsight(
                id: id, title: title, systemImage: systemImage,
                value: "No change logged", detail: "Log each \(title.lowercased()) change to learn usage.",
                fractionRemaining: nil
            )
        }

        let recentIntervals = zip(events, events.dropFirst())
            .map { $1.timeIntervalSince($0) / secondsPerDay }
            .filter { $0 > 0 }
            .suffix(4)
            .sorted()
        guard !recentIntervals.isEmpty else {
            return SupplyInsight(
                id: id, title: title, systemImage: systemImage,
                value: "Learning usage", detail: "Last \(action) \(relativeAge(lastEvent, now: now)). Log one more change for an estimate.",
                fractionRemaining: nil
            )
        }

        let typicalDays = median(recentIntervals)
        let elapsedDays = max(0, now.timeIntervalSince(lastEvent) / secondsPerDay)
        let remainingDays = max(0, typicalDays - elapsedDays)
        return SupplyInsight(
            id: id, title: title, systemImage: systemImage,
            value: "≈\(Int(remainingDays.rounded())) days left",
            detail: "Typical \(formattedDays(typicalDays))-day cycle · \(action) \(relativeAge(lastEvent, now: now))",
            fractionRemaining: typicalDays > 0 ? remainingDays / typicalDays : 0
        )
    }

    private static func coordinate(for entry: LogEntry) -> CLLocation? {
        guard let lat = entry.lat, let lng = entry.lng else { return nil }
        return CLLocation(latitude: lat, longitude: lng)
    }

    private static func median(_ values: [Double]) -> Double {
        let middle = values.count / 2
        if values.count.isMultiple(of: 2) {
            return (values[middle - 1] + values[middle]) / 2
        }
        return values[middle]
    }

    private static func formattedDays(_ value: Double) -> String {
        String(format: value < 10 ? "%.1f" : "%.0f", value)
    }

    private static func relativeAge(_ date: Date, now: Date = Date()) -> String {
        let days = max(0, Int((now.timeIntervalSince(date) / secondsPerDay).rounded(.down)))
        if days == 0 { return "today" }
        if days == 1 { return "1 day ago" }
        return "\(days) days ago"
    }
}
