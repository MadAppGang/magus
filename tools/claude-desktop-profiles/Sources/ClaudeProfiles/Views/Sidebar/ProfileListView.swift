import SwiftUI

@available(macOS 14.0, *)
struct ProfileListView: View {
    @Environment(AppState.self) private var appState
    @State private var showCreateSheet = false

    var body: some View {
        VStack(spacing: 0) {
            // macOS traffic lights spacer + logo
            HStack {
                Spacer()
                Link(destination: URL(string: "https://madappgang.com")!) {
                    if let nsImage = NSImage(named: "MadAppGangLogo.png") {
                        Image(nsImage: nsImage)
                            .resizable()
                            .scaledToFit()
                            .frame(height: 16)
                            .opacity(0.6)
                    } else {
                        Text("MadAppGang")
                            .font(.caption2)
                            .foregroundStyle(ClaudeTheme.secondaryText)
                    }
                }
                .buttonStyle(.plain)
                .help("Visit MadAppGang")
                Spacer()
            }
            .frame(height: 38)
            .padding(.top, 4)

            ScrollView {
                VStack(alignment: .leading, spacing: 4) {
                    Text("PROFILES")
                        .font(.caption)
                        .fontWeight(.semibold)
                        .foregroundStyle(ClaudeTheme.secondaryText)
                        .padding(.horizontal, 12)
                        .padding(.bottom, 4)

                    ForEach(appState.allProfiles) { profile in
                        Button {
                            appState.selectedProfileID = profile.id
                        } label: {
                            ProfileRowView(
                                profile: profile,
                                isRunning: appState.isRunning(profile),
                                isSelected: appState.selectedProfileID == profile.id
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.top, 16)
            }

            Spacer()
            
            // Bottom user area / Add profile
            VStack(spacing: 16) {
                Button {
                    showCreateSheet = true
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "plus")
                            .font(.system(size: 14, weight: .semibold))
                        Text("New Profile")
                            .font(.system(size: 14, weight: .medium))
                    }
                    .foregroundStyle(ClaudeTheme.text)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.white.opacity(0.05))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            }
            .padding(16)
        }
        .background(ClaudeTheme.sidebar)
        .sheet(isPresented: $showCreateSheet) {
            CreateProfileSheet()
                .environment(appState)
        }
    }
}
