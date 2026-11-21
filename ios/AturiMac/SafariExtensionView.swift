import AppKit
import SafariServices
import SwiftUI

/// The Mac app's one window: what the extension does, whether it is on in
/// Safari, and a button that opens Safari's Extensions settings with Aturi
/// selected. The state is read again each time the app comes to the front,
/// since the usual round trip is to open Safari's settings from here, turn
/// the extension on, and come back.
struct SafariExtensionView: View {
    private enum Status: Equatable {
        case checking
        case on
        case off
        /// Safari reported no state. Usually the extension is not registered
        /// yet, which lasts until Safari has seen this copy of the app.
        case unknown
    }

    @State private var status: Status = .checking
    @State private var openFailed = false

    var body: some View {
        VStack(spacing: 20) {
            Image(nsImage: NSApplication.shared.applicationIconImage)
                .resizable()
                .interpolation(.high)
                .frame(width: 128, height: 128)
                .accessibilityHidden(true)

            VStack(spacing: 8) {
                Text("Aturi for Safari")
                    .font(.title2.weight(.semibold))
                Text("Aturi's Safari extension shows the other atproto clients that can open the page you are on, copies aturi.to links, and can send links straight to the client you prefer.")
                    .multilineTextAlignment(.center)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            statusLabel

            VStack(spacing: 8) {
                Button("Open Safari Extensions Settings", action: openSettings)
                    .controlSize(.large)
                    .keyboardShortcut(.defaultAction)
                if openFailed {
                    Text("Safari's settings did not open. In Safari, choose Safari > Settings, click Extensions, and turn on Aturi.")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.center)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }

            Text("Safari asks before Aturi can read a site, and links to a site are only redirected once you have allowed Aturi there. The extension needs Safari 18.4 or later.")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .multilineTextAlignment(.center)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(32)
        .frame(width: 440)
        .onAppear(perform: refresh)
        .onReceive(NotificationCenter.default.publisher(for: NSApplication.didBecomeActiveNotification)) { _ in
            refresh()
        }
    }

    @ViewBuilder
    private var statusLabel: some View {
        switch status {
        case .checking:
            statusRow("Checking whether the extension is on", systemImage: "hourglass", tint: .secondary)
        case .on:
            statusRow("The extension is on in Safari.", systemImage: "checkmark.circle.fill", tint: .green)
        case .off:
            statusRow("The extension is off. Turn it on in Safari Settings, under Extensions.", systemImage: "circle", tint: .secondary)
        case .unknown:
            statusRow("Safari has not reported the extension yet. Open Safari once, then come back to this window.", systemImage: "questionmark.circle", tint: .secondary)
        }
    }

    private func statusRow(_ text: String, systemImage: String, tint: some ShapeStyle) -> some View {
        Label {
            Text(text)
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: systemImage)
                .foregroundStyle(tint)
        }
    }

    /// The completion-handler form rather than the async one: the
    /// documentation allows a nil state with no error (the system cannot find
    /// the extension), and Swift's async import of the method assumes a state
    /// whenever there is no error.
    private func refresh() {
        SFSafariExtensionManager.getStateOfSafariExtension(withIdentifier: safariExtensionIdentifier) { state, error in
            let next: Status
            if let state, error == nil {
                next = state.isEnabled ? .on : .off
            } else {
                next = .unknown
            }
            Task { @MainActor in
                status = next
            }
        }
    }

    private func openSettings() {
        openFailed = false
        SFSafariApplication.showPreferencesForExtension(withIdentifier: safariExtensionIdentifier) { error in
            let failed = error != nil
            Task { @MainActor in
                openFailed = failed
            }
        }
    }
}
