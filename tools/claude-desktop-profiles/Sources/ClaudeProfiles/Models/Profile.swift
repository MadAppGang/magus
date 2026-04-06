import Foundation

struct Profile: Identifiable, Codable, Hashable, Sendable {
    let id: UUID
    var name: String
    let slug: String
    var iconName: String
    var accentColorHex: String
    let createdAt: Date
    var bundleVersion: String

    // MARK: - Computed paths (not stored in JSON)

    var appBundleURL: URL {
        URL(fileURLWithPath: "/Applications/Claude-\(slug).app")
    }

    var dataDirectoryURL: URL {
        FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent(".claude-profiles")
            .appendingPathComponent(slug)
    }

    var userDataDirURL: URL {
        dataDirectoryURL
            .appendingPathComponent("Library")
            .appendingPathComponent("Application Support")
            .appendingPathComponent("Claude")
    }

    var patchedBundleID: String {
        "com.anthropic.claudefordesktop-\(slug)"
    }

    var patchedHelperBundleID: String {
        "com.anthropic.claudefordesktop-\(slug).helper"
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
