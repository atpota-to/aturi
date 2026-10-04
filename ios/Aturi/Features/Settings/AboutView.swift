import SwiftUI
import AturiCore

/// Port of `AboutTab.tsx` with the version line an app needs and the
/// privacy summary the web keeps on its own pages. The privacy copy is
/// adapted from `extension/PRIVACY.txt`: the app behaves the same way,
/// local-first and with no server of its own in the loop.
struct AboutView: View {
    @Environment(\.aturiTheme) private var theme

    private struct AboutLink: Identifiable {
        let title: String
        let url: String
        let detail: String

        var id: String { url }
    }

    private static let links: [AboutLink] = [
        AboutLink(title: "aturi.to", url: Endpoints.aturiBase.absoluteString, detail: "The web app"),
        AboutLink(title: "Documentation", url: Endpoints.aturiBase.absoluteString + "/docs", detail: "Guides and the API"),
        AboutLink(title: "Universal links", url: Endpoints.aturiBase.absoluteString + "/links", detail: "How the link pages work"),
        AboutLink(title: "Browser extension", url: Endpoints.aturiBase.absoluteString + "/extension", detail: "Waypoints in your browser"),
        AboutLink(title: "Source on Tangled", url: "https://tangled.org/atpota.to/aturi", detail: "GPL-3.0-or-later"),
        AboutLink(title: "Project on GitHub", url: "https://github.com/atpota-to/aturi", detail: "Mirror, issues and releases"),
        AboutLink(title: "AT Protocol", url: "https://atproto.com", detail: "The protocol underneath"),
        AboutLink(title: "Terms and privacy", url: Endpoints.aturiBase.absoluteString + "/terms", detail: "The full text"),
    ]

    private static let privacyParagraphs: [String] = [
        "Aturi does not collect, transmit or sell any personal data. The app has no analytics, no telemetry, no tracking, no advertising and no remote code. Everything you configure stays on your device, in the app group the share extension reads.",
        "The only network requests the app makes go directly from your device to public atproto services: the Bluesky AppView for profiles, posts and handle resolution, the PLC directory and did:web hosts for DID documents, your own or another account's Personal Data Server for records, the Jetstream relay for the live feed, and the Microcosm services (Constellation, Slingshot, UFOs) for backlinks, record hydration and lexicon statistics. Each of these has its own privacy policy. The app never contacts an Aturi-operated server during normal use.",
        "Signing in stores an OAuth session for your PDS in the device keychain and, when you change a preference, writes it to a record in your own repo so other devices can read it. Signing out removes the session from this device. Nothing else leaves the device.",
    ]

    private var appVersion: String {
        let info = Bundle.main.infoDictionary
        let short = info?["CFBundleShortVersionString"] as? String ?? "0"
        if let build = info?["CFBundleVersion"] as? String, !build.isEmpty {
            return "\(short) (\(build))"
        }
        return short
    }

    var body: some View {
        List {
            SettingsSection {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Aturi")
                        .font(AturiFont.display)
                        .foregroundStyle(theme.textPrimary)
                    Text("A toolkit for exploring the atproto atmosphere: deep-link any record, browse repos, jump across apps with waypoints.")
                        .font(.body)
                        .foregroundStyle(theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 6)
                CopyRow(label: "App version", value: appVersion)
                CopyRow(label: "AturiCore", value: AturiCoreInfo.version)
            }

            SettingsSection("Links") {
                ForEach(Self.links) { link in
                    OutboundLinkRow(title: link.title, url: link.url, detail: link.detail)
                }
            }

            SettingsSection(
                "Licence",
                footer: "The iOS app, the web app and the extension share one codebase and one licence."
            ) {
                Text("Aturi is free software, released under the GNU General Public License, version 3 or later. You may study, change and redistribute it under the same terms.")
                    .font(.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, 2)
            }

            SettingsSection("Privacy") {
                ForEach(Array(Self.privacyParagraphs.enumerated()), id: \.offset) { _, paragraph in
                    Text(paragraph)
                        .font(.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.vertical, 2)
                }
            }
        }
        .settingsList()
        .navigationTitle("About")
    }
}
