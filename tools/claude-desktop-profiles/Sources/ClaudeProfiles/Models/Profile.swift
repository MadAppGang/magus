import Foundation

struct Profile: Identifiable, Codable, Hashable, Sendable {
    let id: UUID
    var name: String
    let slug: String
    var iconName: String
    var accentColorHex: String
    let createdAt: Date
    var bundleVersion: String
    var isDefault: Bool = false

    // MARK: - Computed paths (not stored in JSON)

    var appBundleURL: URL {
        if isDefault {
            return URL(fileURLWithPath: "/Applications/Claude.app")
        }
        return URL(fileURLWithPath: "/Applications/Claude-\(slug).app")
    }

    var dataDirectoryURL: URL {
        if isDefault {
            return FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Application Support/Claude")
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".claude-profiles")
            .appendingPathComponent(slug)
    }

    var userDataDirURL: URL {
        if isDefault {
            return FileManager.default.homeDirectoryForCurrentUser
                .appendingPathComponent("Library/Application Support/Claude")
        }
        return dataDirectoryURL
            .appendingPathComponent("Library")
            .appendingPathComponent("Application Support")
            .appendingPathComponent("Claude")
    }

    var patchedBundleID: String {
        if isDefault { return "com.anthropic.claudefordesktop" }
        return "com.anthropic.claudefordesktop-\(slug)"
    }

    var patchedHelperBundleID: String {
        if isDefault { return "com.anthropic.claudefordesktop.helper" }
        return "com.anthropic.claudefordesktop-\(slug).helper"
    }

    /// Create the default profile representing the original Claude.app
    static func defaultProfile(version: String) -> Profile {
        Profile(
            id: UUID(uuidString: "00000000-0000-0000-0000-000000000000")!,
            name: "Default",
            slug: "default",
            iconName: "star.fill",
            accentColorHex: "#D97757",
            createdAt: Date(),
            bundleVersion: version,
            isDefault: true
        )
    }

    // MARK: - CodingKeys (exclude computed properties)

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case slug
        case iconName
        case accentColorHex
        case createdAt
        case bundleVersion
    }
}
