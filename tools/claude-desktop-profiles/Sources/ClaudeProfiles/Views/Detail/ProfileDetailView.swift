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
        appState.needsUpdate(profile)
    }

    var body: some View {
        ScrollView {
            VStack(spacing: 36) {
                Spacer().frame(height: 20)
                
                headerSection
                actionButtonsSection
                
                VStack(spacing: 24) {
                    if needsUpdate {
                        updateBanner
                    }
                    infoSection
                    if !profile.isDefault {
                        dangerZoneSection
                    }
                }
                .frame(maxWidth: 500)
            }
            .padding(40)
            .frame(maxWidth: .infinity)
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
        VStack(spacing: 16) {
            Button {
                showCustomize.toggle()
            } label: {
                Image(systemName: profile.iconName)
                    .font(.system(size: 32))
                    .foregroundStyle(profileAccentColor)
                    .frame(width: 72, height: 72)
                    .background(
                        RoundedRectangle(cornerRadius: 16)
                            .fill(profileAccentColor.opacity(0.15))
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 16)
                            .stroke(Color.white.opacity(0.05), lineWidth: 1)
                    )
            }
            .buttonStyle(.plain)
            .popover(isPresented: $showCustomize, arrowEdge: .bottom) {
                customizePopover
            }

            VStack(spacing: 6) {
                Text(profile.name)
                    .font(.system(size: 28, weight: .semibold))
                    .foregroundStyle(ClaudeTheme.text)

                HStack(spacing: 8) {
                    Text("v\(profile.bundleVersion)")
                        .font(.system(size: 13))
                        .foregroundStyle(ClaudeTheme.secondaryText)
                    
                    Circle()
                        .fill(ClaudeTheme.secondaryText.opacity(0.5))
                        .frame(width: 4, height: 4)

                    HStack(spacing: 6) {
                        StatusIndicator(isRunning: isRunning)
                        Text(isRunning ? "Running" : "Stopped")
                            .font(.system(size: 13))
                            .foregroundStyle(isRunning ? Color.green : ClaudeTheme.secondaryText)
                    }
                }
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
        .background(ClaudeTheme.cardBackground)
    }

    // MARK: - Action Buttons

    private var actionButtonsSection: some View {
        HStack(spacing: 12) {
            if isRunning {
                Button {
                    terminateProfile()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "stop.fill")
                        Text("Stop")
                    }
                    .font(.system(size: 14, weight: .medium))
                    .frame(width: 120)
                    .padding(.vertical, 10)
                    .background(Color.red.opacity(0.1))
                    .foregroundStyle(.red)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            } else {
                Button {
                    appState.launchProfile(profile)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "play.fill")
                        Text("Launch")
                    }
                    .font(.system(size: 14, weight: .medium))
                    .frame(width: 120)
                    .padding(.vertical, 10)
                    .background(profileAccentColor)
                    .foregroundStyle(.white)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
            }

            if !profile.isDefault {
                Button {
                    appState.rebuildProfile(profile)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.triangle.2.circlepath")
                        Text("Update")
                    }
                    .font(.system(size: 14, weight: .medium))
                    .frame(width: 120)
                    .padding(.vertical, 10)
                    .background(needsUpdate ? ClaudeTheme.accent.opacity(0.15) : Color.white.opacity(0.05))
                    .foregroundStyle(needsUpdate ? ClaudeTheme.accent : ClaudeTheme.secondaryText)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .buttonStyle(.plain)
                .disabled(!needsUpdate)
                .help(needsUpdate ? "Claude Desktop was updated — rebuild this profile" : "Profile is up to date")
            }
        }
    }

    // MARK: - Info Section

    private var infoSection: some View {
        VStack(spacing: 0) {
            infoRow(label: "Slug", value: profile.slug, isFirst: true)
            infoRow(label: "Bundle ID", value: profile.patchedBundleID)
            infoRow(label: "Data Directory", value: profile.dataDirectoryURL.path)
            infoRow(label: "Created", value: profile.createdAt.formatted(date: .abbreviated, time: .shortened))
            infoRow(label: "Version", value: profile.bundleVersion, isLast: true)
        }
        .background(ClaudeTheme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(ClaudeTheme.border, lineWidth: 1)
        )
    }

    private func infoRow(label: String, value: String, isFirst: Bool = false, isLast: Bool = false) -> some View {
        VStack(spacing: 0) {
            HStack(alignment: .top) {
                Text(label)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(ClaudeTheme.secondaryText)
                    .frame(width: 120, alignment: .leading)

                Text(value)
                    .font(.system(size: 13))
                    .foregroundStyle(ClaudeTheme.text)
                    .textSelection(.enabled)
                    .lineLimit(1)
                    .truncationMode(.middle)

                Spacer()
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 14)
            
            if !isLast {
                Divider()
                    .background(ClaudeTheme.border)
                    .padding(.leading, 16)
            }
        }
    }

    // MARK: - Update Banner

    private var updateBanner: some View {
        HStack(spacing: 12) {
            Image(systemName: "arrow.triangle.2.circlepath")
                .font(.system(size: 16))
                .foregroundStyle(ClaudeTheme.accent)

            VStack(alignment: .leading, spacing: 2) {
                Text("Update Available")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(ClaudeTheme.text)

                Text("Source app version changed. Rebuild to apply.")
                    .font(.system(size: 13))
                    .foregroundStyle(ClaudeTheme.secondaryText)
            }

            Spacer()

            Button("Rebuild") {
                appState.rebuildProfile(profile)
            }
            .buttonStyle(.plain)
            .font(.system(size: 13, weight: .medium))
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(ClaudeTheme.accent.opacity(0.1))
            .foregroundStyle(ClaudeTheme.accent)
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .padding(16)
        .background(ClaudeTheme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(ClaudeTheme.border, lineWidth: 1)
        )
    }

    // MARK: - Danger Zone

    private var dangerZoneSection: some View {
        HStack {
            VStack(alignment: .leading, spacing: 4) {
                Text("Delete Profile")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(ClaudeTheme.text)
                Text("Removes the application bundle and all data.")
                    .font(.system(size: 13))
                    .foregroundStyle(ClaudeTheme.secondaryText)
            }

            Spacer()

            Button("Delete") {
                showDeleteConfirmation = true
            }
            .buttonStyle(.plain)
            .font(.system(size: 13, weight: .medium))
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(Color.red.opacity(0.1))
            .foregroundStyle(.red)
            .clipShape(RoundedRectangle(cornerRadius: 6))
        }
        .padding(16)
        .background(ClaudeTheme.cardBackground)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.red.opacity(0.2), lineWidth: 1)
        )
    }

    // MARK: - Progress Overlay

    private var progressOverlay: some View {
        ZStack {
            Color.black.opacity(0.4)
                .ignoresSafeArea()

            VStack(spacing: 16) {
                ProgressView()
                    .controlSize(.large)

                if let step = appState.creationProgress {
                    Text(step.rawValue)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(Color.white)
                }
            }
            .padding(32)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(ClaudeTheme.cardBackground)
                    .shadow(color: .black.opacity(0.2), radius: 20)
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
