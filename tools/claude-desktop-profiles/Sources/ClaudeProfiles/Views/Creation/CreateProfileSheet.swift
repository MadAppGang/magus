import SwiftUI

@available(macOS 14.0, *)
struct CreateProfileSheet: View {
    @Environment(AppState.self) private var appState
    @Environment(\.dismiss) private var dismiss

    @State private var name = ""
    @State private var selectedIcon = "briefcase.fill"
    @State private var selectedColorHex = "#D97706"

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

    private var canCreate: Bool {
        !name.trimmingCharacters(in: .whitespaces).isEmpty && !appState.isCreating
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("New Profile")
                    .font(.headline)
                    .foregroundStyle(ClaudeTheme.text)
                Spacer()
            }
            .padding(.horizontal, 24)
            .padding(.top, 24)
            .padding(.bottom, 16)

            VStack(alignment: .leading, spacing: 20) {
                // Name field
                VStack(alignment: .leading, spacing: 8) {
                    Text("Profile Name")
                        .font(.subheadline)
                        .foregroundStyle(ClaudeTheme.secondaryText)

                    TextField("e.g., Work, Personal, Testing", text: $name)
                        .textFieldStyle(.plain)
                        .padding(10)
                        .background(ClaudeTheme.cardBackground)
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(ClaudeTheme.border, lineWidth: 1)
                        )
                }

                // Icon picker
                VStack(alignment: .leading, spacing: 8) {
                    Text("Icon")
                        .font(.subheadline)
                        .foregroundStyle(ClaudeTheme.secondaryText)

                    ProfileIconPicker(
                        selectedIcon: $selectedIcon,
                        accentColor: Color(hex: selectedColorHex) ?? ClaudeTheme.accent
                    )
                }

                // Color picker
                VStack(alignment: .leading, spacing: 8) {
                    Text("Accent Color")
                        .font(.subheadline)
                        .foregroundStyle(ClaudeTheme.secondaryText)

                    HStack(spacing: 12) {
                        ForEach(Self.presetColors, id: \.hex) { preset in
                            Button {
                                selectedColorHex = preset.hex
                            } label: {
                                Circle()
                                    .fill(Color(hex: preset.hex) ?? ClaudeTheme.accent)
                                    .frame(width: 24, height: 24)
                                    .overlay(
                                        Circle()
                                            .stroke(Color.white, lineWidth: 2)
                                            .opacity(selectedColorHex == preset.hex ? 1 : 0)
                                    )
                                    .overlay(
                                        Circle()
                                            .stroke(
                                                Color(hex: preset.hex) ?? ClaudeTheme.accent,
                                                lineWidth: 2
                                            )
                                            .scaleEffect(1.2)
                                            .opacity(selectedColorHex == preset.hex ? 1 : 0)
                                    )
                            }
                            .buttonStyle(.plain)
                            .help(preset.name)
                        }
                    }
                }
            }
            .padding(.horizontal, 24)

            Spacer()

            // Footer with buttons
            HStack {
                if appState.isCreating {
                    HStack(spacing: 8) {
                        ProgressView()
                            .controlSize(.small)
                        if let step = appState.creationProgress {
                            Text(step.rawValue)
                                .font(.caption)
                                .foregroundStyle(ClaudeTheme.secondaryText)
                        }
                    }
                }

                Spacer()

                Button("Cancel") {
                    dismiss()
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
                .foregroundStyle(ClaudeTheme.secondaryText)
                .keyboardShortcut(.cancelAction)

                Button("Create Profile") {
                    let trimmed = name.trimmingCharacters(in: .whitespaces)
                    appState.createProfile(
                        name: trimmed,
                        icon: selectedIcon,
                        color: selectedColorHex
                    )
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 16)
                .padding(.vertical, 6)
                .background(canCreate ? ClaudeTheme.accent : ClaudeTheme.border)
                .foregroundStyle(.white)
                .clipShape(Capsule())
                .disabled(!canCreate)
                .keyboardShortcut(.defaultAction)
            }
            .padding(24)
        }
        .frame(width: 400, height: 440)
        .background(ClaudeTheme.background)
        .onChange(of: appState.profiles.count) { oldCount, newCount in
            if newCount > oldCount {
                dismiss()
            }
        }
    }
}
