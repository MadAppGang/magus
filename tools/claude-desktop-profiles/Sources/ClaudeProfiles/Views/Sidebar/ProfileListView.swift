import SwiftUI

@available(macOS 14.0, *)
struct ProfileListView: View {
    @Environment(AppState.self) private var appState
    @State private var showCreateSheet = false

    var body: some View {
        @Bindable var state = appState

        List(selection: $state.selectedProfileID) {
            Section {
                ForEach(appState.profiles) { profile in
                    ProfileRowView(
                        profile: profile,
                        isRunning: appState.isRunning(profile)
                    )
                    .tag(profile.id)
                }
            } header: {
                Text("PROFILES")
                    .font(.caption)
                    .fontWeight(.semibold)
                    .foregroundStyle(ClaudeTheme.secondaryText)
            }
        }
        .listStyle(.sidebar)
        .scrollContentBackground(.hidden)
        .background(ClaudeTheme.sidebar)
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button {
                    showCreateSheet = true
                } label: {
                    Image(systemName: "plus")
                }
                .help("Create a new profile")
            }
        }
        .sheet(isPresented: $showCreateSheet) {
            CreateProfileSheet()
                .environment(appState)
        }
    }
}
