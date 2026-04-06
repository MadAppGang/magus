import SwiftUI

@available(macOS 14.0, *)
struct StatusIndicator: View {
    let isRunning: Bool

    @State private var isPulsing = false

    var body: some View {
        Circle()
            .fill(isRunning ? Color.green : Color.gray.opacity(0.4))
            .frame(width: 8, height: 8)
            .scaleEffect(isRunning && isPulsing ? 1.3 : 1.0)
            .opacity(isRunning && isPulsing ? 0.6 : 1.0)
            .animation(
                isRunning
                    ? .easeInOut(duration: 1.0).repeatForever(autoreverses: true)
                    : .default,
                value: isPulsing
            )
            .onChange(of: isRunning) { _, newValue in
                isPulsing = newValue
            }
            .onAppear {
                isPulsing = isRunning
            }
    }
}
