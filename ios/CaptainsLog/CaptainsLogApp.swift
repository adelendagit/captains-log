import SwiftUI

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
        }
    }
}

enum Chartroom {
    static let ink = Color(red: 11 / 255, green: 41 / 255, blue: 54 / 255)
    static let sea = Color(red: 31 / 255, green: 112 / 255, blue: 133 / 255)
    static let paper = Color(red: 244 / 255, green: 240 / 255, blue: 231 / 255)
    static let signal = Color(red: 233 / 255, green: 120 / 255, blue: 74 / 255)
}
