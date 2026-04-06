import SwiftUI

@available(macOS 14.0, *)
struct ContentView: View {
    @Environment(AppState.self) private var appState

    var body: some View {
        Group {
            if !appState.isSourceAppInstalled() {
                claudeNotFoundView
            } else {
                mainNavigationView
            }
        }
        .frame(minWidth: 700, minHeight: 500)
        .onAppear {
            appState.loadProfiles()
        }
        .alert("Error", isPresented: Bindable(appState).showError) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(appState.errorMessage ?? "An unknown error occurred.")
        }
    }

    private var mainNavigationView: some View {
        HStack(spacing: 0) {
            ProfileListView()
                .environment(appState)
                .frame(width: 260)
            
            // Subtle separator line
            Rectangle()
                .fill(Color.black.opacity(0.2))
                .frame(width: 1)
                .ignoresSafeArea()
            
            Group {
                if let selectedID = appState.selectedProfileID,
                    let profile = appState.profiles.first(where: { $0.id == selectedID })
                {
                    ProfileDetailView(profile: profile)
                        .environment(appState)
                        .id(profile.id)
                } else {
                    EmptyStateView()
                        .environment(appState)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
        .ignoresSafeArea(.all, edges: .top)
    }

    private var claudeNotFoundView: some View {
        VStack(spacing: 20) {
            Spacer()

            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 56))
                .foregroundStyle(.yellow)

            Text("Claude Desktop Not Found")
                .font(.title)
                .fontWeight(.semibold)
                .foregroundStyle(ClaudeTheme.text)

            Text(
                "Claude.app must be installed in /Applications before you can create profiles."
            )
            .font(.body)
            .foregroundStyle(ClaudeTheme.secondaryText)
            .multilineTextAlignment(.center)
            .frame(maxWidth: 400)

            Link(destination: URL(string: "https://claude.ai/download")!) {
                Label("Download Claude Desktop", systemImage: "arrow.down.circle.fill")
            }
            .buttonStyle(.borderedProminent)
            .tint(ClaudeTheme.accent)
            .controlSize(.large)
            .padding(.top, 8)

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(ClaudeTheme.background)
    }
}
