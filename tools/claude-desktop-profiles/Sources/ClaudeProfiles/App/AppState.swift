#if canImport(AppKit)
import AppKit
#endif
import Foundation
import Observation
import SwiftUI

@available(macOS 14.0, *)
@MainActor
@Observable
final class AppState {
    var profiles: [Profile] = []
    var selectedProfileID: UUID?
    var isCreating = false
    var creationProgress: BundleManager.Step?
    var errorMessage: String?
    var showError = false

    private let store = ProfileStore()
    private let bundleManager = BundleManager()
    let processMonitor = ProcessMonitor()

    func loadProfiles() {
        Task {
            do {
                let loaded = try await store.loadAll()
                self.profiles = loaded
            } catch {
                self.errorMessage = error.localizedDescription
                self.showError = true
            }
        }
        processMonitor.startMonitoring()
    }

    func createProfile(name: String, icon: String, color: String) {
        NSLog("[ClaudeProfiles] createProfile called: name=\(name) isCreating=\(isCreating)")
        guard !isCreating else { print("[ClaudeProfiles] SKIPPED: already creating"); return }

        let existingSlugs = profiles.map(\.slug)
        let id = UUID()
        let slug = SlugGenerator.generate(from: name, id: id, existing: existingSlugs)
        let version = sourceAppVersion() ?? "unknown"

        let profile = Profile(
            id: id,
            name: name,
            slug: slug,
            iconName: icon,
            accentColorHex: color,
            createdAt: Date(),
            bundleVersion: version
        )

        isCreating = true
        Task {
            do {
                NSLog("[ClaudeProfiles] Creating profile: \(profile.name) slug=\(profile.slug)")

                // Build the bundle now (copy + patch + icon + sign)
                try await bundleManager.createProfile(profile) { step in
                    NSLog("[ClaudeProfiles] Step: \(step.rawValue)")
                    Task { @MainActor [weak self] in
                        self?.creationProgress = step
                    }
                }

                // Create user data directory
                try FileManager.default.createDirectory(
                    at: profile.userDataDirURL, withIntermediateDirectories: true)

                NSLog("[ClaudeProfiles] Profile created successfully")
                self.profiles.append(profile)
                try await store.save(profiles)
                self.selectedProfileID = profile.id
            } catch {
                NSLog("[ClaudeProfiles] ERROR: \(error)")
                self.errorMessage = error.localizedDescription
                self.showError = true
            }
            self.isCreating = false
            self.creationProgress = nil
        }
    }

    func launchProfile(_ profile: Profile) {
        Task {
            do {
                // Lazy rebuild: ensure bundle exists and matches current Claude version
                try await ensureBundleCurrent(profile)
                try ProfileLauncher.launch(profile)
            } catch {
                NSLog("[ClaudeProfiles] Launch error: \(error)")
                self.errorMessage = error.localizedDescription
                self.showError = true
            }
        }
    }

    /// Check if profile bundle exists and matches the current Claude Desktop version.
    /// If not, rebuild the bundle (copy + patch + sign).
    private func ensureBundleCurrent(_ profile: Profile) async throws {
        let fm = FileManager.default
        let bundleExists = fm.fileExists(atPath: profile.appBundleURL.path)
        let currentVersion = sourceAppVersion()

        let needsRebuild: Bool
        if !bundleExists {
            NSLog("[ClaudeProfiles] Bundle missing, will create")
            needsRebuild = true
        } else if let currentVersion, currentVersion != profile.bundleVersion {
            NSLog("[ClaudeProfiles] Version mismatch: profile=\(profile.bundleVersion) current=\(currentVersion), rebuilding")
            needsRebuild = true
        } else {
            needsRebuild = false
        }

        if needsRebuild {
            isCreating = true
            defer {
                isCreating = false
                creationProgress = nil
            }
            try await bundleManager.createProfile(profile) { step in
                NSLog("[ClaudeProfiles] Rebuild step: \(step.rawValue)")
                Task { @MainActor [weak self] in
                    self?.creationProgress = step
                }
            }
            // Update stored version
            if let currentVersion, let index = profiles.firstIndex(where: { $0.id == profile.id }) {
                profiles[index].bundleVersion = currentVersion
                try? await store.save(profiles)
            }
        }
    }

    func deleteProfile(_ profile: Profile) {
        #if canImport(AppKit)
        if isRunning(profile) {
            let apps = NSWorkspace.shared.runningApplications
            for app in apps {
                if app.bundleIdentifier == profile.patchedBundleID {
                    app.terminate()
                }
            }
        }
        #endif

        Task {
            do {
                try await bundleManager.deleteProfile(profile)
                self.profiles.removeAll { $0.id == profile.id }
                if self.selectedProfileID == profile.id {
                    self.selectedProfileID = nil
                }
                try await store.save(profiles)
            } catch {
                self.errorMessage = error.localizedDescription
                self.showError = true
            }
        }
    }

    func rebuildProfile(_ profile: Profile) {
        let name = profile.name
        let icon = profile.iconName
        let color = profile.accentColorHex

        Task {
            do {
                try await bundleManager.deleteProfile(profile)
                self.profiles.removeAll { $0.id == profile.id }
                try await store.save(profiles)
                self.createProfile(name: name, icon: icon, color: color)
            } catch {
                self.errorMessage = error.localizedDescription
                self.showError = true
            }
        }
    }

    func updateProfile(_ profile: Profile, icon: String? = nil, color: String? = nil, name: String? = nil) {
        guard let index = profiles.firstIndex(where: { $0.id == profile.id }) else { return }
        if let icon { profiles[index].iconName = icon }
        if let color { profiles[index].accentColorHex = color }
        if let name { profiles[index].name = name }
        Task { try? await store.save(profiles) }
    }

    func isRunning(_ profile: Profile) -> Bool {
        processMonitor.runningProfiles.contains(profile.slug)
    }

    func sourceAppVersion() -> String? {
        let plistPath = "/Applications/Claude.app/Contents/Info.plist"
        guard let plistData = FileManager.default.contents(atPath: plistPath),
            let plist = try? PropertyListSerialization.propertyList(
                from: plistData, options: [], format: nil
            ) as? [String: Any],
            let version = plist["CFBundleShortVersionString"] as? String
        else {
            return nil
        }
        return version
    }

    func isSourceAppInstalled() -> Bool {
        FileManager.default.fileExists(atPath: "/Applications/Claude.app")
    }
}
