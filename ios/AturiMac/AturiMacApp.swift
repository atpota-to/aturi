import AppKit
import SwiftUI

/// The bundle ID of the Safari web extension this app carries (the
/// AturiSafari-macOS target in project.yml). The iOS app's extension uses
/// the same ID, so Safari treats the two as one extension across devices.
let safariExtensionIdentifier = "to.aturi.app.safari"

/// The Mac app. Its job is to carry Aturi's Safari web extension and to say
/// how to turn it on, as the app in Xcode's Safari extension template does:
/// one window with the extension's state and a button to Safari's
/// Extensions settings. Everything else lives in the extension itself.
@main
struct AturiMacApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate

    var body: some Scene {
        Window("Aturi", id: "main") {
            SafariExtensionView()
        }
        .windowResizability(.contentSize)
    }
}

/// Quits when the window closes. The app has nothing to show without it,
/// and a windowless app left running in the Dock reads as stuck.
final class AppDelegate: NSObject, NSApplicationDelegate {
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }
}
