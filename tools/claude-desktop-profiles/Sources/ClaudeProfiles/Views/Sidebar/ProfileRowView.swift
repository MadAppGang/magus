import SwiftUI

@available(macOS 14.0, *)
struct ProfileRowView: View {
    let profile: Profile
    let isRunning: Bool

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: profile.iconName)
                .font(.system(size: 16))
                .foregroundStyle(profileAccentColor)
                .frame(width: 28, height: 28)
                .background(
                    RoundedRectangle(cornerRadius: 6)
                        .fill(profileAccentColor.opacity(0.12))
                )

            Text(profile.name)
                .font(.body)
                .foregroundStyle(ClaudeTheme.text)
                .lineLimit(1)

            Spacer()

            StatusIndicator(isRunning: isRunning)
        }
        .padding(.vertical, 4)
    }

    private var profileAccentColor: Color {
        Color(hex: profile.accentColorHex) ?? ClaudeTheme.accent
    }
}

// MARK: - Hex Color Extension

extension Color {
    init?(hex: String) {
        var hexString = hex.trimmingCharacters(in: .whitespacesAndNewlines)
        if hexString.hasPrefix("#") {
            hexString.removeFirst()
        }

        guard hexString.count == 6,
            let hexValue = UInt64(hexString, radix: 16)
        else {
            return nil
        }

        let red = Double((hexValue >> 16) & 0xFF) / 255.0
        let green = Double((hexValue >> 8) & 0xFF) / 255.0
        let blue = Double(hexValue & 0xFF) / 255.0

        self.init(red: red, green: green, blue: blue)
    }
}
