import Foundation

/// Launch profile bundles using direct Process execution.
/// NSWorkspace.openApplication / `open -n` triggers additional LaunchServices
/// security checks that cause EXC_BREAKPOINT on ad-hoc signed Electron bundles.
/// Direct binary execution bypasses this and works reliably.
enum ProfileLauncher {
    static func launch(_ profile: Profile) throws {
        let binaryURL = profile.appBundleURL
            .appendingPathComponent("Contents/MacOS/Claude")

        guard FileManager.default.fileExists(atPath: binaryURL.path) else {
            throw ProfileError.launchFailed("Binary not found at \(binaryURL.path)")
        }

        let process = Process()
        process.executableURL = binaryURL
        // Default profile uses the standard userData path (no --user-data-dir needed)
        if !profile.isDefault {
            process.arguments = ["--user-data-dir=\(profile.userDataDirURL.path)"]
        }
        process.standardOutput = FileHandle.nullDevice
        process.standardError = FileHandle.nullDevice

        try process.run()
    }
}
