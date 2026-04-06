import SwiftUI

@available(macOS 14.0, *)
struct ProfileDetailView: View {
    @Environment(AppState.self) private var appState
    let profile: Profile

    @State private var showDeleteConfirmation = false
    @State private var showCustomize = false

    private var isRunning: Bool {
        appState.isRunning(profile)
    }

    private var profileAccentColor: Color {
        Color(hex: profile.accentColorHex) ?? ClaudeTheme.accent
    }

    private var needsUpdate: Bool {
        guard let sourceVersion = appState.sourceAppVersion() else { return false }
        return profile.bundleVersion != sourceVersion
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 24) {
                headerSection
                actionButtonsSection
                infoSection

                if needsUpdate {
                    updateBanner
                }

                dangerZoneSection
            }
            .padding(32)
        }
        .background(ClaudeTheme.background)
        .confirmationDialog(
            "Delete Profile",
            isPresented: $showDeleteConfirmation,
            titleVisibility: .visible
        ) {
            Button("Delete", role: .destructive) {
                appState.deleteProfile(profile)
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text(
                "This will remove the application bundle and all data for \"\(profile.name)\". This action cannot be undone."
            )
        }
        .overlay {
            if appState.isCreating, appState.creationProgress != nil {
                progressOverlay
            }
        }
    }

    // MARK: - Header

    private static let presetColors: [(name: String, hex: String)] = [
        ("Amber", "#D97706"),
        ("Blue", "#2563EB"),
        ("Green", "#16A34A"),
        ("Purple", "#9333EA"),
        ("Red", "#DC2626"),
        ("Pink", "#DB2777"),
        ("Teal", "#0D9488"),
        ("Indigo", "#4F46E5"),
    ]

    private var headerSection: some View {
        VStack(spacing: 12) {
            Button {
                showCustomize.toggle()
            } label: {
                Image(systemName: profile.iconName)
                    .font(.system(size: 48))
                    .foregroundStyle(profileAccentColor)
                    .frame(width: 80, height: 80)
                    .background(
                        RoundedRectangle(cornerRadius: 20)
                            .fill(profileAccentColor.opacity(0.12))
                    )
                    .overlay(alignment: .bottomTrailing) {
                        Image(systemName: "pencil.circle.fill")
                            .font(.system(size: 20))
                            .foregroundStyle(ClaudeTheme.secondaryText)
                            .background(Circle().fill(ClaudeTheme.background).padding(-2))
                            .offset(x: 4, y: 4)
                    }
            }
            .buttonStyle(.plain)
            .popover(isPresented: $showCustomize, arrowEdge: .bottom) {
                customizePopover
            }

            Text(profile.name)
                .font(.title)
                .fontWeight(.semibold)
                .foregroundStyle(ClaudeTheme.text)

            HStack(spacing: 8) {
                Text("v\(profile.bundleVersion)")
                    .font(.caption)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(
                        Capsule()
                            .fill(ClaudeTheme.border)
                    )
                    .foregroundStyle(ClaudeTheme.secondaryText)

                StatusIndicator(isRunning: isRunning)
                Text(isRunning ? "Running" : "Stopped")
                    .font(.caption)
                    .foregroundStyle(isRunning ? .green : ClaudeTheme.secondaryText)
            }
        }
        .frame(maxWidth: .infinity)
    }

    // MARK: - Customize Popover

    private var customizePopover: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Customize")
                .font(.headline)
                .foregroundStyle(ClaudeTheme.text)

            VStack(alignment: .leading, spacing: 6) {
                Text("Icon")
                    .font(.caption)
                    .foregroundStyle(ClaudeTheme.secondaryText)
                ProfileIconPicker(
                    selectedIcon: Binding(
                        get: { profile.iconName },
                        set: { appState.updateProfile(profile, icon: $0) }
                    ),
                    accentColor: profileAccentColor
                )
            }

            VStack(alignment: .leading, spacing: 6) {
                Text("Color")
                    .font(.caption)
                    .foregroundStyle(ClaudeTheme.secondaryText)
                HStack(spacing: 6) {
                    ForEach(Self.presetColors, id: \.hex) { preset in
                        Button {
                            appState.updateProfile(profile, color: preset.hex)
                        } label: {
                            Circle()
                                .fill(Color(hex: preset.hex) ?? ClaudeTheme.accent)
                                .frame(width: 24, height: 24)
                                .overlay(
                                    Circle()
                                        .stroke(Color.white, lineWidth: 2)
                                        .opacity(profile.accentColorHex == preset.hex ? 1 : 0)
                                )
                                .overlay(
                                    Circle()
                                        .stroke(Color(hex: preset.hex) ?? ClaudeTheme.accent, lineWidth: 2)
                                        .scaleEffect(1.25)
                                        .opacity(profile.accentColorHex == preset.hex ? 1 : 0)
                                )
                        }
                        .buttonStyle(.plain)
                        .help(preset.name)
                    }
                }
            }
        }
        .padding(16)
        .frame(width: 280)
    }

    // MARK: - Action Buttons

    private var actionButtonsSection: some View {
        HStack(spacing: 12) {
            if isRunning {
                Button {
                    terminateProfile()
                } label: {
                    Label("Stop", systemImage: "stop.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(.red)
                .controlSize(.large)
            } else {
                Button {
                    appState.launchProfile(profile)
                } label: {
                    Label("Launch", systemImage: "play.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(profileAccentColor)
                .controlSize(.large)
            }
        }
        .padding(.horizontal, 20)
    }

    // MARK: - Info Section

    private var infoSection: some View {
        VStack(alignment: .leading, spacing: 16) {
            infoRow(label: "Slug", value: profile.slug)
            infoRow(label: "Bundle ID", value: profile.patchedBundleID)
            infoRow(label: "Data Directory", value: profile.dataDirectoryURL.path)
            infoRow(
                label: "Created",
                value: profile.createdAt.formatted(date: .abbreviated, time: .shortened)
            )
            infoRow(label: "Version", value: profile.bundleVersion)
        }
        .padding(.vertical, 8)
    }

    private func infoRow(label: String, value: String) -> some View {
        HStack(alignment: .top) {
            Text(label)
                .font(.subheadline)
                .foregroundStyle(ClaudeTheme.secondaryText)
                .frame(width: 120, alignment: .leading)

            Text(value)
                .font(.subheadline)
                .foregroundStyle(ClaudeTheme.text)
                .textSelection(.enabled)
                .lineLimit(1)
                .truncationMode(.middle)

            Spacer()
        }
    }

    // MARK: - Update Banner

    private var updateBanner: some View {
        HStack {
            Image(systemName: "arrow.triangle.2.circlepath")
                .foregroundStyle(ClaudeTheme.accent)

            VStack(alignment: .leading, spacing: 2) {
                Text("Update Available")
                    .font(.subheadline)
                    .fontWeight(.medium)
                    .foregroundStyle(ClaudeTheme.text)

                Text("Source app version changed. Rebuild to apply.")
                    .font(.caption)
                    .foregroundStyle(ClaudeTheme.secondaryText)
            }

            Spacer()

            Button("Rebuild") {
                appState.rebuildProfile(profile)
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(ClaudeTheme.accent.opacity(0.1))
            .foregroundStyle(ClaudeTheme.accent)
            .clipShape(Capsule())
        }
        .padding(16)
        .background(ClaudeTheme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 12))
    }

    // MARK: - Danger Zone

    private var dangerZoneSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Delete Profile")
                        .font(.subheadline)
                        .foregroundStyle(ClaudeTheme.text)
                    Text("Removes the application bundle and all data.")
                        .font(.caption)
                        .foregroundStyle(ClaudeTheme.secondaryText)
                }

                Spacer()

                Button("Delete") {
                    showDeleteConfirmation = true
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .background(Color.red.opacity(0.1))
                .foregroundStyle(.red)
                .clipShape(Capsule())
            }
        }
        .padding(.top, 16)
    }

    // MARK: - Progress Overlay

    private var progressOverlay: some View {
        ZStack {
            Color.black.opacity(0.3)
                .ignoresSafeArea()

            VStack(spacing: 16) {
                ProgressView()
                    .scaleEffect(1.5)

                if let step = appState.creationProgress {
                    Text(step.rawValue)
                        .font(.subheadline)
                        .foregroundStyle(ClaudeTheme.text)
                }
            }
            .padding(32)
            .background(
                RoundedRectangle(cornerRadius: ClaudeTheme.cornerRadius)
                    .fill(ClaudeTheme.cardBackground)
                    .shadow(color: .black.opacity(0.1), radius: 20)
            )
        }
    }

    // MARK: - Helpers

    private func terminateProfile() {
        #if canImport(AppKit)
        let apps = NSWorkspace.shared.runningApplications
        for app in apps {
            if app.bundleIdentifier == profile.patchedBundleID {
                app.terminate()
            }
        }
        #endif
    }
}
