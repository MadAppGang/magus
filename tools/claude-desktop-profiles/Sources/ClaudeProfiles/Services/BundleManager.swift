#if canImport(AppKit)
import AppKit
#endif
import Foundation

actor BundleManager {
    enum Step: String, Sendable {
        case validating = "Validating environment"
        case copying = "Copying application bundle"
        case patching = "Patching bundle identity"
        case signing = "Code signing"
        case settingIcon = "Setting profile icon"
    }

    private static let sourceAppURL = URL(fileURLWithPath: "/Applications/Claude.app")
    private static let requiredDiskSpaceBytes: UInt64 = 700 * 1024 * 1024

    // MARK: - Public API

    /// Build a profile bundle. Proven minimal approach:
    /// 1. Copy entire Claude.app
    /// 2. Patch ONLY the main Info.plist (bundle ID, display name, remove URL scheme)
    /// 3. Sign ONLY the outer app (no --deep, no helper changes)
    ///
    /// DO NOT patch or sign helpers — doing so breaks Electron's helper discovery
    /// with "Unable to find helper app" fatal error.
    func createProfile(
        _ profile: Profile,
        progress: @escaping @Sendable (Step) -> Void
    ) async throws {
        let dest = profile.appBundleURL
        var didCopy = false

        do {
            progress(.validating)
            try validate()

            progress(.copying)
            try copyBundle(to: dest)
            didCopy = true

            progress(.patching)
            try await patchMainPlist(at: dest, profile: profile)

            progress(.signing)
            try await run("/usr/bin/codesign", ["--force", "--sign", "-", dest.path])

            // Set custom icon via NSWorkspace (extended attributes, no re-signing needed)
            progress(.settingIcon)
            setProfileIcon(at: dest, name: profile.name, colorHex: profile.accentColorHex)
        } catch {
            if didCopy { try? FileManager.default.removeItem(at: dest) }
            throw error
        }
    }

    func deleteProfile(_ profile: Profile) throws {
        let fm = FileManager.default
        if fm.fileExists(atPath: profile.appBundleURL.path) {
            try fm.removeItem(at: profile.appBundleURL)
        }
        if fm.fileExists(atPath: profile.dataDirectoryURL.path) {
            try fm.removeItem(at: profile.dataDirectoryURL)
        }
    }

    // MARK: - Icon

    #if canImport(AppKit)
    private func setProfileIcon(at bundleURL: URL, name: String, colorHex: String) {
        let sourceIconPath = Self.sourceAppURL.appendingPathComponent("Contents/Resources/electron.icns").path
        guard let sourceIcon = NSImage(contentsOfFile: sourceIconPath) else { return }

        let hex = colorHex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        let r, g, b: CGFloat
        if hex.count == 6, let num = UInt64(hex, radix: 16) {
            r = CGFloat((num >> 16) & 0xFF) / 255
            g = CGFloat((num >> 8) & 0xFF) / 255
            b = CGFloat(num & 0xFF) / 255
        } else {
            r = 0.85; g = 0.47; b = 0.02 // fallback amber
        }
        let accent = NSColor(calibratedRed: r, green: g, blue: b, alpha: 1.0)
        let initial = String(name.trimmingCharacters(in: .whitespacesAndNewlines).prefix(1)).uppercased()

        let size: CGFloat = 1024
        let img = NSImage(size: NSMakeSize(size, size))
        img.lockFocus()

        sourceIcon.draw(in: NSMakeRect(0, 0, size, size), from: .zero, operation: .sourceOver, fraction: 1.0)

        // Badge circle bottom-right
        let bs = size * 0.38, bx = size - bs - size * 0.02, by = size * 0.02, pad = size * 0.03
        NSColor.white.setFill()
        NSBezierPath(ovalIn: NSMakeRect(bx - pad, by - pad, bs + pad * 2, bs + pad * 2)).fill()
        accent.setFill()
        NSBezierPath(ovalIn: NSMakeRect(bx, by, bs, bs)).fill()

        // Initial letter
        if !initial.isEmpty {
            let font = NSFont.boldSystemFont(ofSize: bs * 0.5)
            let attrs: [NSAttributedString.Key: Any] = [.font: font, .foregroundColor: NSColor.white]
            let ts = (initial as NSString).size(withAttributes: attrs)
            (initial as NSString).draw(
                at: NSMakePoint(bx + (bs - ts.width) / 2, by + (bs - ts.height) / 2),
                withAttributes: attrs
            )
        }

        img.unlockFocus()
        NSWorkspace.shared.setIcon(img, forFile: bundleURL.path)
    }
    #else
    private func setProfileIcon(at bundleURL: URL, name: String, colorHex: String) {}
    #endif

    // MARK: - Private

    private func validate() throws {
        guard FileManager.default.fileExists(atPath: Self.sourceAppURL.path) else {
            throw ProfileError.claudeNotInstalled
        }
        if let attrs = try? FileManager.default.attributesOfFileSystem(forPath: "/Applications"),
           let free = attrs[.systemFreeSize] as? UInt64,
           free < Self.requiredDiskSpaceBytes {
            throw ProfileError.insufficientDiskSpace(available: free)
        }
    }

    private func copyBundle(to dest: URL) throws {
        let fm = FileManager.default
        if fm.fileExists(atPath: dest.path) { try fm.removeItem(at: dest) }
        try fm.copyItem(at: Self.sourceAppURL, to: dest)
    }

    private func patchMainPlist(at bundleURL: URL, profile: Profile) async throws {
        let plist = bundleURL.appendingPathComponent("Contents/Info.plist").path
        try await run("/usr/libexec/PlistBuddy", [
            "-c", "Set :CFBundleIdentifier \(profile.patchedBundleID)",
            "-c", "Set :CFBundleDisplayName Claude (\(profile.name))",
            "-c", "Delete :CFBundleURLTypes",
            plist
        ])
    }

    private func run(_ path: String, _ arguments: [String]) async throws {
        try await withCheckedThrowingContinuation { (cont: CheckedContinuation<Void, Error>) in
            let proc = Process()
            let errPipe = Pipe()
            proc.executableURL = URL(fileURLWithPath: path)
            proc.arguments = arguments
            proc.standardError = errPipe
            proc.terminationHandler = { p in
                if p.terminationStatus == 0 {
                    cont.resume()
                } else {
                    let data = errPipe.fileHandleForReading.readDataToEndOfFile()
                    let msg = String(data: data, encoding: .utf8) ?? ""
                    cont.resume(throwing: ProfileError.processFailure(
                        command: URL(fileURLWithPath: path).lastPathComponent,
                        exitCode: p.terminationStatus, stderr: msg))
                }
            }
            do { try proc.run() }
            catch { cont.resume(throwing: error) }
        }
    }
}
