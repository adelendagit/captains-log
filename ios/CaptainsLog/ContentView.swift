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
            Text("CURRENT JOURNEY")
                .font(.caption.bold())
                .tracking(1.5)
                .foregroundStyle(.white.opacity(0.65))
            HStack(spacing: 10) {
                Circle()
                    .fill(tracker.currentJourney?.active == true ? Chartroom.signal : .gray)
                    .frame(width: 10, height: 10)
                Text(tracker.currentJourney?.journey?.name ?? "Not underway")
                    .font(.system(.title2, design: .serif, weight: .semibold))
            }
            if let point = tracker.currentJourney?.position {
                HStack {
                    Label(point.timestamp.formatted(.relative(presentation: .named)), systemImage: "clock")
                    Spacer()
                    if let speed = point.speedKts {
                        Text("\(speed, specifier: "%.1f") kn")
                    }
                }
                .font(.subheadline.weight(.medium))
                .foregroundStyle(.white.opacity(0.75))
            } else {
                Text(tracker.currentJourney?.active == true ? "Waiting for GPS…" : "Start a journey to share Skibidi’s position.")
                    .font(.subheadline)
                    .foregroundStyle(.white.opacity(0.75))
            }
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
}
