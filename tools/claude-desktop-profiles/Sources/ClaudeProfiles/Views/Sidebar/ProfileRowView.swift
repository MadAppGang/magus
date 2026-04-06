import SwiftUI

@available(macOS 14.0, *)
struct ProfileRowView: View {
    let profile: Profile
    let isRunning: Bool
    let isSelected: Bool

    @State private var isHovered = false

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: profile.iconName)
                .font(.system(size: 14))
                .foregroundStyle(isSelected ? ClaudeTheme.text : ClaudeTheme.secondaryText)
                .frame(width: 16, height: 16)
                .padding(4)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(profileAccentColor.opacity(isSelected ? 0.2 : 0.0))
                )

            Text(profile.name)
                .font(.system(size: 14, weight: isSelected ? .medium : .regular))
                .foregroundStyle(isSelected ? ClaudeTheme.text : (isHovered ? ClaudeTheme.text : ClaudeTheme.secondaryText))
                .lineLimit(1)

            Spacer()

            if isRunning {
                StatusIndicator(isRunning: isRunning)
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(isSelected ? ClaudeTheme.cardBackground : (isHovered ? ClaudeTheme.cardBackground.opacity(0.5) : Color.clear))
        )
        .contentShape(Rectangle())
        .onHover { hovering in
            isHovered = hovering
        }
    }

    private var profileAccentColor: Color {
        Color(hex: profile.accentColorHex) ?? ClaudeTheme.accent
    }
}
