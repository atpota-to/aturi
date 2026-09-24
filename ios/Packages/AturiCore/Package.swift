// swift-tools-version:5.9
import PackageDescription

// AturiCore is the platform-independent half of the iOS app: the waypoint
// catalog, the URI parsers, the atproto clients, preferences, and the screen
// state objects. It deliberately depends on Foundation and Observation only so
// it compiles and tests on Linux as well as in Xcode; everything that needs
// SwiftUI, UIKit, CryptoKit or AuthenticationServices lives in the app target.
let package = Package(
    name: "AturiCore",
    platforms: [.iOS(.v17), .macOS(.v14)],
    products: [
        .library(name: "AturiCore", targets: ["AturiCore"]),
    ],
    targets: [
        .target(
            name: "AturiCore",
            path: "Sources/AturiCore",
            swiftSettings: [.enableUpcomingFeature("BareSlashRegexLiterals")]
        ),
        .testTarget(
            name: "AturiCoreTests",
            dependencies: ["AturiCore"],
            path: "Tests/AturiCoreTests",
            swiftSettings: [.enableUpcomingFeature("BareSlashRegexLiterals")]
        ),
    ]
)
