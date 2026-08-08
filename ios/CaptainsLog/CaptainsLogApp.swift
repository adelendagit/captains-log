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
