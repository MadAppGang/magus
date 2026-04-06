import SwiftUI

@available(macOS 14.0, *)
struct EmptyStateView: View {
    @Environment(AppState.self) private var appState
    @State private var showCreateSheet = false

    private var hasProfiles: Bool {
        !appState.profiles.isEmpty
    }

    var body: some View {
        VStack(spacing: 24) {
            Spacer()

            if !hasProfiles {
                Image(systemName: "sparkles")
                    .font(.system(size: 32, weight: .light))
                    .foregroundStyle(ClaudeTheme.accent)
            }

            Text(hasProfiles ? "Select a profile" : "Let's create your first profile")
                .font(.system(size: 28, weight: .semibold))
                .foregroundStyle(ClaudeTheme.text)

            Text(
                hasProfiles
                    ? "Choose a profile from the sidebar to view its details and launch Claude Desktop."
                    : "Profiles let you run multiple instances of Claude Desktop with separate settings, histories, and data."
            )
            .font(.system(size: 15))
            .foregroundStyle(ClaudeTheme.secondaryText)
            .multilineTextAlignment(.center)
            .frame(maxWidth: 420)
            .lineSpacing(4)

            if !hasProfiles {
                Button {
                    showCreateSheet = true
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "plus")
                        Text("Create Profile")
                    }
                    .font(.system(size: 15, weight: .medium))
                    .padding(.horizontal, 20)
                    .padding(.vertical, 10)
                    .background(Color.white.opacity(0.08))
                    .foregroundStyle(ClaudeTheme.text)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .overlay(
                        RoundedRectangle(cornerRadius: 8)
                            .stroke(Color.white.opacity(0.1), lineWidth: 1)
                    )
                }
                .buttonStyle(.plain)
                .padding(.top, 16)
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
