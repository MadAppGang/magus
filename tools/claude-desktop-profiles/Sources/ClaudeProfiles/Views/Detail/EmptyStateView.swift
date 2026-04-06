import SwiftUI

@available(macOS 14.0, *)
struct EmptyStateView: View {
    @Environment(AppState.self) private var appState
    @State private var showCreateSheet = false

    private var hasProfiles: Bool {
        !appState.profiles.isEmpty
    }

    var body: some View {
        VStack(spacing: 20) {
            Spacer()

            Image(systemName: hasProfiles ? "person.crop.circle" : "person.2.circle")
                .font(.system(size: 56))
                .foregroundStyle(ClaudeTheme.secondaryText.opacity(0.5))

            Text(hasProfiles ? "No Profile Selected" : "Create Your First Profile")
                .font(.title2)
                .fontWeight(.medium)
                .foregroundStyle(ClaudeTheme.text)

            Text(
                hasProfiles
                    ? "Select a profile from the sidebar to view its details."
                    : "Profiles let you run multiple instances of Claude Desktop with separate settings and data."
            )
            .font(.body)
            .foregroundStyle(ClaudeTheme.secondaryText)
            .multilineTextAlignment(.center)
            .frame(maxWidth: 340)

            if !hasProfiles {
                Button {
                    showCreateSheet = true
                } label: {
                    Label("Create Profile", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
                .tint(ClaudeTheme.accent)
                .controlSize(.large)
                .padding(.top, 8)
            }

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(ClaudeTheme.background)
        .sheet(isPresented: $showCreateSheet) {
            CreateProfileSheet()
                .environment(appState)
        }
    }
}
