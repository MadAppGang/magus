import SwiftUI

@available(macOS 14.0, *)
@main
struct ClaudeProfilesApp: App {
    @State private var appState = AppState()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environment(appState)
        }
        .defaultSize(width: 800, height: 600)
    }
}
