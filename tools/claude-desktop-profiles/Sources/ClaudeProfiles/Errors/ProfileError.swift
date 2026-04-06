import Foundation

enum ProfileError: LocalizedError {
    case claudeNotInstalled
    case insufficientDiskSpace(available: UInt64)
    case invalidPlist(String)
    case processFailure(command: String, exitCode: Int32, stderr: String)
    case slugConflict(String)
    case launchFailed(String)
    case deleteFailed(String)
    case unknown(String)

    var errorDescription: String? {
        switch self {
        case .claudeNotInstalled:
            return "Claude.app not found in /Applications"
        case .insufficientDiskSpace(let available):
            let availableMB = available / (1024 * 1024)
            return "Insufficient disk space: \(availableMB) MB available, need at least 700 MB"
        case .invalidPlist(let detail):
            return "Invalid property list: \(detail)"
        case .processFailure(let command, let exitCode, let stderr):
            return "\(command) failed with exit code \(exitCode): \(stderr)"
        case .slugConflict(let slug):
            return "Profile slug '\(slug)' already exists"
        case .launchFailed(let detail):
            return "Failed to launch profile: \(detail)"
        case .deleteFailed(let detail):
            return "Failed to delete profile: \(detail)"
        case .unknown(let detail):
            return "Unknown error: \(detail)"
        }
    }
}
