import SwiftUI
import AturiCore

/// The settings screens, in the order the root lists them. Pushed by value
/// on the Settings tab's stack, so another screen can send someone to a
/// page with `router.settingsPath.append(SettingsPage.waypoints)`.
enum SettingsPage: String, CaseIterable, Identifiable, Hashable {
    case general
    case waypoints
    case redirects
    case custom
    case account
    case about

    var id: String { rawValue }

    var title: String {
        switch self {
        case .general: return "General"
        case .waypoints: return "Waypoint groups"
        case .redirects: return "Redirects"
        case .custom: return "Custom waypoints"
        case .account: return "Account"
        case .about: return "About"
        }
    }

    var detail: String {
        switch self {
        case .general: return "Color scheme, dark or light, picker layout"
        case .waypoints: return "Which clients the picker shows, and in what groups"
        case .redirects: return "Open links straight in a preferred client"
        case .custom: return "Your own destinations, built from URL templates"
        case .account: return "Sign in to sync settings to your PDS"
        case .about: return "Version, links, licence and privacy"
        }
    }

    var systemImage: String {
        switch self {
        case .general: return "paintpalette"
        case .waypoints: return "square.grid.2x2"
        case .redirects: return "arrow.triangle.turn.up.right.diamond"
        case .custom: return "link.badge.plus"
        case .account: return "person.crop.circle"
        case .about: return "info.circle"
        }
    }
}

/// The Settings tab's root: port of `SettingsShell.tsx` with the tab strip
/// turned into a list of pages. Anyone can change every preference; the
/// banner at the top says where those changes live until they sign in.
struct SettingsView: View {
    @Environment(\.sessionStore) private var sessionStore
    @Environment(\.aturiTheme) private var theme

    private var accountDetail: String {
        if let identifier = sessionStore.state.displayIdentifier {
            return "Signed in as \(identifier)"
        }
        return SettingsPage.account.detail
    }

    var body: some View {
        List {
            if !sessionStore.state.isSignedIn {
                SettingsSection {
                    NavigationLink(value: SettingsPage.account) {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: "icloud.slash")
                                .foregroundStyle(theme.textAccent)
                                .accessibilityHidden(true)
                            Text("Settings are saved on this device only. Sign in to sync them to your PDS and carry them across devices.")
                                .font(.footnote)
                                .foregroundStyle(theme.textSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.vertical, 4)
                    }
                }
            }

            SettingsSection("Preferences") {
                pageLink(.general)
                pageLink(.waypoints)
                pageLink(.redirects)
                pageLink(.custom)
            }

            SettingsSection("Account") {
                NavigationLink(value: SettingsPage.account) {
                    SettingsRowLabel(SettingsPage.account.title, detail: accountDetail, systemImage: SettingsPage.account.systemImage)
                }
            }

            SettingsSection {
                pageLink(.about)
            }
        }
        .settingsList()
        .navigationTitle("Settings")
        .navigationDestination(for: SettingsPage.self) { page in
            SettingsPageDestination(page: page)
        }
    }

    private func pageLink(_ page: SettingsPage) -> some View {
        NavigationLink(value: page) {
            SettingsRowLabel(page.title, detail: page.detail, systemImage: page.systemImage)
        }
    }
}

/// The one place a `SettingsPage` becomes a screen.
struct SettingsPageDestination: View {
    let page: SettingsPage

    var body: some View {
        switch page {
        case .general:
            GeneralSettingsView()
        case .waypoints:
            WaypointGroupsView()
        case .redirects:
            RedirectsSettingsView()
        case .custom:
            CustomWaypointsView()
        case .account:
            AccountSettingsView()
        case .about:
            AboutView()
        }
    }
}
