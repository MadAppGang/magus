#if canImport(AppKit)
import AppKit
#endif
import Foundation
import Observation

@available(macOS 14.0, *)
@Observable
final class ProcessMonitor: @unchecked Sendable {
    var runningProfiles: Set<String> = []

    private var timer: Timer?
    private static let bundleIDPrefix = "com.anthropic.claudefordesktop-"
    private static let pollingInterval: TimeInterval = 2.0

    func startMonitoring() {
        // Perform initial check
        pollRunningApplications()

        // Schedule repeating timer on main run loop
        let newTimer = Timer(
            timeInterval: Self.pollingInterval, repeats: true
        ) { [weak self] _ in
            self?.pollRunningApplications()
        }
        RunLoop.main.add(newTimer, forMode: .common)
        self.timer = newTimer
    }

    func stopMonitoring() {
        timer?.invalidate()
        timer = nil
    }

    private func pollRunningApplications() {
        #if canImport(AppKit)
        let apps = NSWorkspace.shared.runningApplications
        var slugs: Set<String> = []

        for app in apps {
            guard let bundleID = app.bundleIdentifier,
                bundleID.hasPrefix(Self.bundleIDPrefix)
            else { continue }

            let slug = String(bundleID.dropFirst(Self.bundleIDPrefix.count))
            if !slug.isEmpty {
                slugs.insert(slug)
            }
        }

        runningProfiles = slugs
        #endif
    }

    deinit {
        timer?.invalidate()
    }
}
