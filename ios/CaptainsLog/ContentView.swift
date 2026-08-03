import MapKit
import SwiftUI

struct ContentView: View {
    @EnvironmentObject private var authentication: AuthenticationManager

    var body: some View {
        Group {
            if authentication.token == nil {
                SignInView()
            } else {
                ChartroomView()
            }
        }
        .background(Chartroom.paper.ignoresSafeArea())
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
    var body: some View {
        TabView {
            CurrentPositionView()
                .tabItem { Label("Now", systemImage: "location.fill") }
            PlanView()
                .tabItem { Label("Plan", systemImage: "map") }
            VoyagesView()
                .tabItem { Label("Voyages", systemImage: "sailboat") }
            LogbookView()
                .tabItem { Label("Logbook", systemImage: "book.closed") }
            TodoView()
                .tabItem { Label("To Do", systemImage: "checklist") }
        }
    }
}

private struct CurrentPositionView: View {
    @EnvironmentObject private var authentication: AuthenticationManager
    @EnvironmentObject private var tracker: JourneyTracker
    @State private var journeyName = ""
    @State private var camera: MapCameraPosition = .automatic

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 16) {
                    statusCard
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
                await tracker.refresh()
                tracker.resumeTracking()
            }
            .refreshable { await tracker.refresh() }
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
            Text(statusMessage)
                .font(.subheadline)
                .foregroundStyle(.white.opacity(0.75))
            HStack(alignment: .top, spacing: 10) {
                statusReading(statusMetricOne.label, statusMetricOne.value)
                Divider().overlay(.white.opacity(0.18))
                statusReading(statusMetricTwo.label, statusMetricTwo.value)
                Divider().overlay(.white.opacity(0.18))
                statusReading(statusMetricThree.label, statusMetricThree.value)
            }
            .frame(minHeight: 44)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(22)
        .foregroundStyle(.white)
        .background(Chartroom.ink, in: RoundedRectangle(cornerRadius: 24))
    }

    private var map: some View {
        Map(position: $camera) {
            if let track = tracker.currentJourney?.track, track.count > 1 {
                MapPolyline(coordinates: track.map(\.coordinate))
                    .stroke(Chartroom.signal, lineWidth: 4)
            }
            if let point = tracker.currentJourney?.position {
                Annotation("Skibidi", coordinate: point.coordinate) {
                    Image(systemName: "sailboat.fill")
                        .padding(10)
                        .foregroundStyle(Chartroom.ink)
                        .background(.white, in: Circle())
                        .overlay(Circle().stroke(Chartroom.signal, lineWidth: 3))
                }
            } else if let place = tracker.currentStatus?.current, let coordinate = place.coordinate {
                Annotation(place.name, coordinate: coordinate) {
                    Image(systemName: "anchor")
                        .padding(10)
                        .foregroundStyle(Chartroom.ink)
                        .background(.white, in: Circle())
                        .overlay(Circle().stroke(Chartroom.sea, lineWidth: 3))
                }
            }
        }
        .mapStyle(.standard(elevation: .realistic))
        .frame(height: 330)
        .clipShape(RoundedRectangle(cornerRadius: 24))
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
                Button("End journey", role: .destructive) {
                    Task { await tracker.endJourney() }
                }
                .buttonStyle(.borderedProminent)
                .tint(.red)
                .disabled(tracker.isWorking)
            }
            .frame(maxWidth: .infinity)
            .padding(20)
            .background(.white.opacity(0.72), in: RoundedRectangle(cornerRadius: 20))
        } else {
            VStack(alignment: .leading, spacing: 12) {
                Text("Begin a journey")
                    .font(.system(.title2, design: .serif, weight: .semibold))
                TextField("Journey name (optional)", text: $journeyName)
                    .textFieldStyle(.roundedBorder)
                Button {
                    Task { await tracker.startJourney(name: journeyName) }
                } label: {
                    Label("Start journey", systemImage: "location.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(Chartroom.sea)
                .disabled(tracker.isWorking)
            }
            .padding(20)
            .background(.white.opacity(0.72), in: RoundedRectangle(cornerRadius: 20))
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
            return firstParagraph?.isEmpty == false ? firstParagraph! : "Skibidi’s last logged position in \(place.listName ?? "this area")."
        }
        if tracker.currentStatus?.status == "underway" {
            return "Live GPS is not available; the chart shows the logged passage."
        }
        return "Previous voyages and planned stops remain available."
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
