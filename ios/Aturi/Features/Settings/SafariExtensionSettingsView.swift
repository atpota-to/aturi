import SafariServices
import SwiftUI

/// How to turn on Aturi's Safari web extension, which ships inside this app
/// (the AturiSafari-iOS target in project.yml) and stays off until it is
/// turned on in Safari. Up to iOS 26.1 an app can neither ask whether its
/// Safari extension is on nor open Safari's settings for it, so the page is
/// directions. From iOS 26.2 it also shows the extension's state, read again
/// whenever the app comes back to the front, and a button to the extension's
/// page in Settings.
struct SafariExtensionSettingsView: View {
    /// The extension's bundle ID. The Mac app's extension uses the same one,
    /// so Safari treats the two as one extension across devices.
    static let extensionIdentifier = "to.aturi.app.safari"

    private enum Status: Equatable {
        case checking
        case on
        case off
        /// Safari reported no state for the extension.
        case unknown
    }

    @Environment(\.aturiTheme) private var theme
    @Environment(\.scenePhase) private var scenePhase

    @State private var status: Status = .checking
    @State private var openFailed = false

    /// Safari's menu for the page, where extensions are turned on and
    /// opened: the More button from iOS 26 (Apple's own directions say
    /// "tap the More menu, then tap Extensions"), the page menu in the
    /// address bar before that.
    private var pageMenu: String {
        if #available(iOS 26, *) {
            return "the More menu"
        }
        return "the page menu"
    }

    private var openExtensionsStep: String {
        if #available(iOS 26, *) {
            return "In Safari, tap the More button, then Extensions."
        }
        return "In Safari, tap the page menu in the address bar, then Manage Extensions."
    }

    private var useItStep: String {
        "Tap Aturi in \(pageMenu) on any page."
    }

    /// Where Settings keeps Safari's extensions. iOS 18 moved the apps'
    /// settings under Apps.
    private var settingsPath: String {
        if #available(iOS 18, *) {
            return "Settings > Apps > Safari > Extensions"
        }
        return "Settings > Safari > Extensions"
    }

    /// The manifest asks for Safari 18.4 or later
    /// (`browser_specific_settings.safari.strict_min_version` in
    /// extension/wxt.config.ts), and Safari on iOS carries the iOS version
    /// number. Safari should refuse to run the extension on an older system;
    /// what it shows there has not been checked on a device.
    private var safariIsTooOld: Bool {
        if #available(iOS 18.4, *) {
            return false
        }
        return true
    }

    var body: some View {
        List {
            SettingsSection {
                Text("Shows the clients that can open the page you\u{2019}re on, copies aturi.to links and redirects to your preferred client. Included with this app.")
                    .font(AturiFont.body)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, 4)
            }

            if safariIsTooOld {
                SettingsSection("Needs iOS 18.4") {
                    Label {
                        Text("Update in Settings > General > Software Update.")
                            .font(AturiFont.footnote)
                            .foregroundStyle(theme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    } icon: {
                        Image(systemName: "exclamationmark.triangle")
                            .foregroundStyle(theme.danger)
                    }
                    .padding(.vertical, 2)
                }
            }

            if #available(iOS 26.2, *) {
                statusSection
            }

            /* Once Safari reports the extension on, the steps to turn it on
               are done, so only the last one, how to use it, is left. Every
               other state, including no report at all, keeps the steps. */
            if status == .on {
                SettingsSection(
                    "Use it",
                    footer: "To turn it off, use \(settingsPath) > Aturi."
                ) {
                    Text(useItStep)
                        .font(AturiFont.body)
                        .foregroundStyle(theme.textPrimary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.vertical, 2)
                }
            } else {
                SettingsSection(
                    "Turn it on",
                    footer: "Or turn it on in \(settingsPath) > Aturi."
                ) {
                    StepRow(number: 1, text: openExtensionsStep)
                    StepRow(number: 2, text: "Turn on Aturi.")
                    StepRow(number: 3, text: useItStep)
                }
            }

            SettingsSection(
                "Site access",
                footer: "The extension\u{2019}s settings page can request every site your redirects cover at once."
            ) {
                ForEach(Array(siteAccessParagraphs.enumerated()), id: \.offset) { _, paragraph in
                    Text(paragraph)
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.vertical, 2)
                }
            }
        }
        .settingsList()
        .navigationTitle("Safari extension")
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            if #available(iOS 26.2, *) {
                refreshStatus()
            }
        }
    }

    /* Safari's per-site model, which decides whether redirects fire. Read
       by people who turned the extension on and wonder why a link was not
       redirected. */
    private var siteAccessParagraphs: [String] {
        [
            "Safari lets an extension read a site only after you allow it. Until then, Aturi can\u{2019}t see the page and won\u{2019}t redirect links to that site.",
            "To allow a site, tap Aturi in \(pageMenu) there. Access allowed for one day expires, and redirects stop until you allow it again.",
            "\(settingsPath) > Aturi lists and changes allowed sites.",
        ]
    }

    @ViewBuilder
    private var statusRow: some View {
        switch status {
        case .checking:
            statusLabel("Checking", systemImage: "hourglass", tint: theme.textTertiary)
        case .on:
            statusLabel("On in Safari", systemImage: "checkmark.circle.fill", tint: theme.textAccent)
        case .off:
            statusLabel("Off", systemImage: "circle", tint: theme.textTertiary)
        case .unknown:
            statusLabel("Unknown. Check with the steps below.", systemImage: "questionmark.circle", tint: theme.textTertiary)
        }
    }

    private func statusLabel(_ text: String, systemImage: String, tint: Color) -> some View {
        Label {
            Text(text)
                .font(AturiFont.body)
                .foregroundStyle(theme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: systemImage)
                .foregroundStyle(tint)
        }
        .padding(.vertical, 2)
    }

    /// The status card with the button to Settings beneath it. The button
    /// sits in the section's footer, not in a row of its own: inset grouped
    /// rows clip their content to the section's rounded corners, which are
    /// far larger than the button's, so a row the button fills edge to edge
    /// cuts its corners off.
    @available(iOS 26.2, *)
    private var statusSection: some View {
        Section {
            statusRow
                .listRowBackground(theme.bgSecondary)
        } header: {
            Text("Status")
                .foregroundStyle(theme.textTertiary)
        } footer: {
            VStack(alignment: .leading, spacing: 8) {
                Button("Open Safari Extension Settings", action: openSettings)
                    .buttonStyle(.aturiPrimary)

                if openFailed {
                    Text("Settings did not open. Use the steps below instead.")
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .textCase(nil)
            .padding(.top, 12)
        }
    }

    /// The completion-handler form rather than the async one: the
    /// documentation allows a nil state with no error (the system cannot find
    /// the extension), and Swift's async import of the method assumes a state
    /// whenever there is no error. The handler is not main-actor bound, so
    /// the result hops back before it touches view state.
    @available(iOS 26.2, *)
    private func refreshStatus() {
        SFSafariExtensionManager.getStateOfExtension(withIdentifier: Self.extensionIdentifier) { state, error in
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

    /// Opens the extension's own page in Settings. The system refuses unless
    /// the app is in the foreground, which a tap guarantees.
    @available(iOS 26.2, *)
    private func openSettings() {
        openFailed = false
        SFSafariSettings.openExtensionsSettings(forIdentifiers: [Self.extensionIdentifier]) { error in
            let failed = error != nil
            Task { @MainActor in
                openFailed = failed
            }
        }
    }
}

/// One numbered step: the number in the soft accent disc, the instruction
/// beside it.
private struct StepRow: View {
    let number: Int
    let text: String

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Text("\(number)")
                .font(AturiFont.sans(.footnote, weight: .semibold))
                .foregroundStyle(theme.accentSoftFg)
                .frame(width: 24, height: 24)
                .background(theme.accentSoft, in: Circle())
            Text(text)
                .font(AturiFont.body)
                .foregroundStyle(theme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.vertical, 2)
        .accessibilityElement(children: .combine)
    }
}
