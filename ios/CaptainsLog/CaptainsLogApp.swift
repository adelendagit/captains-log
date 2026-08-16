import SwiftUI
import UIKit

@main
struct CaptainsLogApp: App {
    @StateObject private var authentication: AuthenticationManager
    @StateObject private var tracker: JourneyTracker

    init() {
        let authentication = AuthenticationManager()
        _authentication = StateObject(wrappedValue: authentication)
        _tracker = StateObject(wrappedValue: JourneyTracker(authentication: authentication))
        CaptainsLogShortcuts.updateAppShortcutParameters()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(authentication)
                .environmentObject(tracker)
                .tint(Chartroom.sea)
                .onChange(of: tracker.isUnderway, initial: true) { _, isUnderway in
                    UIApplication.shared.isIdleTimerDisabled = isUnderway
                }
                .onReceive(NotificationCenter.default.publisher(for: .captainsLogDidChange)) { _ in
                    Task { await tracker.refresh() }
                }
        }
    }
}

enum Chartroom {
    static let ink = Color("ChartroomInk")
    static let sea = Color("ChartroomSea")
    static let paper = Color("ChartroomPaper")
    static let surface = Color("ChartroomSurface")
    static let signal = Color("ChartroomSignal")
    static let route = Color("ChartroomRoute")
}

enum ChartroomRouteKind {
    case planned
    case estimated
    case recorded

    var color: Color {
        switch self {
        case .planned: Chartroom.sea
        case .estimated: Chartroom.route.opacity(0.62)
        case .recorded: Chartroom.signal
        }
    }

    var strokeStyle: StrokeStyle {
        switch self {
        case .planned: StrokeStyle(lineWidth: 3, lineCap: .round, dash: [10, 7])
        case .estimated: StrokeStyle(lineWidth: 3, dash: [8, 8])
        case .recorded: StrokeStyle(lineWidth: 4)
        }
    }
}

struct BreadcrumbLegend: View {
    var body: some View {
        HStack(spacing: 12) {
            item("Recorded GPS", kind: .recorded)
            item("Estimated from logbook", kind: .estimated)
        }
        .font(.caption2.bold())
        .foregroundStyle(Chartroom.ink)
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
        .padding(10)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("Map key: solid orange is recorded GPS; dashed gray is estimated from logbook")
    }

    private func item(_ label: String, kind: ChartroomRouteKind) -> some View {
        HStack(spacing: 5) {
            RouteKeyLine(kind: kind)
            Text(label)
        }
    }
}

private struct RouteKeyLine: View {
    let kind: ChartroomRouteKind

    var body: some View {
        RouteKeyShape()
            .stroke(kind.color, style: kind.strokeStyle)
            .frame(width: 28, height: 8)
    }
}

private struct RouteKeyShape: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.minX, y: rect.midY))
        path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        return path
    }
}
