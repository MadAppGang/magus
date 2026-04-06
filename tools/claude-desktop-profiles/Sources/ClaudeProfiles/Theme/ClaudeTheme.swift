import SwiftUI

enum ClaudeTheme {
    static let background = Color(hex: "#1E1E1E") ?? Color(white: 0.12)
    static let sidebar = Color(hex: "#282828") ?? Color(white: 0.16)
    static let text = Color(hex: "#E5E5E5") ?? Color.white
    static let secondaryText = Color(hex: "#8E8E8E") ?? Color.gray
    static let accent = Color(hex: "#D97757") ?? Color.orange
    static let border = Color(hex: "#383838") ?? Color(white: 0.22)
    static let cardBackground = Color(hex: "#252525") ?? Color(white: 0.15)
    static let cornerRadius: CGFloat = 10
}

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
