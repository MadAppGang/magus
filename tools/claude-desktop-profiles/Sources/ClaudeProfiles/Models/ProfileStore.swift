import Foundation

actor ProfileStore {
    private let fileURL: URL

    private struct StorageFormat: Codable {
        let version: Int
        var profiles: [Profile]
    }

    init() {
        let appSupport = FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library")
            .appendingPathComponent("Application Support")
            .appendingPathComponent("ClaudeProfileManager")
        self.fileURL = appSupport.appendingPathComponent("profiles.json")
    }

    func loadAll() throws -> [Profile] {
        let fm = FileManager.default

        guard fm.fileExists(atPath: fileURL.path) else {
            return []
        }

        let data = try Data(contentsOf: fileURL)
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let storage = try decoder.decode(StorageFormat.self, from: data)
        return storage.profiles
    }

    func save(_ profiles: [Profile]) throws {
        let fm = FileManager.default
        let directory = fileURL.deletingLastPathComponent()

        if !fm.fileExists(atPath: directory.path) {
            try fm.createDirectory(at: directory, withIntermediateDirectories: true)
        }

        let storage = StorageFormat(version: 1, profiles: profiles)
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        let data = try encoder.encode(storage)
        try data.write(to: fileURL, options: .atomic)
    }
}
