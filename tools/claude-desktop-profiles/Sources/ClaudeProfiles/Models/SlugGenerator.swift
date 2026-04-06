import Foundation

enum SlugGenerator {
    /// Generate a URL-safe slug from a profile name.
    ///
    /// Rules:
    /// 1. Lowercase the input
    /// 2. Replace non-alphanumeric characters with hyphens
    /// 3. Collapse consecutive hyphens
    /// 4. Trim leading/trailing hyphens
    /// 5. Truncate to 30 characters
    /// 6. If empty, use first 8 characters of the provided UUID
    /// 7. If slug already exists in `existing`, append "-2", "-3", etc.
    static func generate(from name: String, id: UUID, existing: [String]) -> String {
        var slug = name.lowercased()

        // Replace non-alphanumeric with hyphens
        slug = slug.map { $0.isLetter || $0.isNumber ? String($0) : "-" }.joined()

        // Collapse consecutive hyphens
        while slug.contains("--") {
            slug = slug.replacingOccurrences(of: "--", with: "-")
        }

        // Trim leading/trailing hyphens
        slug = slug.trimmingCharacters(in: CharacterSet(charactersIn: "-"))

        // Truncate to 30 chars
        if slug.count > 30 {
            slug = String(slug.prefix(30))
            // Re-trim trailing hyphens after truncation
            slug = slug.trimmingCharacters(in: CharacterSet(charactersIn: "-"))
        }

        // If empty, use first 8 chars of UUID
        if slug.isEmpty {
            slug = String(id.uuidString.prefix(8)).lowercased()
        }

        // Deduplicate against existing slugs
        if existing.contains(slug) {
            var counter = 2
            while existing.contains("\(slug)-\(counter)") {
                counter += 1
            }
            slug = "\(slug)-\(counter)"
        }

        return slug
    }
}
