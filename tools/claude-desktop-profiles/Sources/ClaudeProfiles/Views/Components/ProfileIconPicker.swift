import SwiftUI

@available(macOS 14.0, *)
struct ProfileIconPicker: View {
    @Binding var selectedIcon: String
    var accentColor: Color

    private static let icons: [String] = [
        "briefcase.fill",
        "person.fill",
        "laptopcomputer",
        "star.fill",
        "heart.fill",
        "house.fill",
        "building.2.fill",
        "globe",
        "bolt.fill",
        "leaf.fill",
        "book.fill",
        "gamecontroller.fill",
        "paintbrush.fill",
        "wrench.fill",
        "flask.fill",
        "music.note",
    ]

    private let columns = Array(repeating: GridItem(.adaptive(minimum: 44), spacing: 8), count: 1)

    var body: some View {
        LazyVGrid(columns: columns, spacing: 8) {
            ForEach(Self.icons, id: \.self) { icon in
                Button {
                    selectedIcon = icon
                } label: {
                    Image(systemName: icon)
                        .font(.system(size: 18))
                        .frame(width: 40, height: 40)
                        .foregroundStyle(selectedIcon == icon ? .white : ClaudeTheme.secondaryText)
                        .background(
                            RoundedRectangle(cornerRadius: 8)
                                .fill(selectedIcon == icon ? accentColor : ClaudeTheme.background)
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(
                                    selectedIcon == icon ? accentColor : ClaudeTheme.border,
                                    lineWidth: 1
                                )
                        )
                }
                .buttonStyle(.plain)
            }
        }
    }
}
