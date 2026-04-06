// swift-tools-version: 6.0

import PackageDescription

let package = Package(
    name: "ClaudeProfiles",
    platforms: [
        .macOS(.v13),
    ],
    targets: [
        .executableTarget(
            name: "ClaudeProfiles",
            path: "Sources/ClaudeProfiles"
        ),
    ]
)
