import SwiftUI
import AturiCore

/// The settings screens, in the order the root lists them. Pushed by value
/// on the Settings tab's stack, so another screen can send someone to a
/// page with `router.settingsPath.append(SettingsPage.waypoints)`.
enum SettingsPage: String, CaseIterable, Identifiable, Hashable {
    case general
    case sections
    case waypoints
    case redirects
    case custom
    case account
    case safari
    case about

    var id: String { rawValue }

    var title: String {
        switch self {
        case .general: return "General"
        case .sections: return "Sections"
        case .waypoints: return "Waypoint groups"
        case .redirects: return "Redirects"
        case .custom: return "Custom waypoints"
        case .account: return "Account"
        case .safari: return "Safari extension"
        case .about: return "About"
        }
    }

    var detail: String {
        switch self {
        case .general: return "Color scheme, dark or light, picker layout, pinned lexicons"
        case .sections: return "What the record and repo pages show, and in what order"
        case .waypoints: return "Which clients the picker shows, and in what groups"
        case .redirects: return "Open links straight in a preferred client"
        case .custom: return "Your own destinations, built from URL templates"
        /* Not listed in Settings any more: the account page is its own tab,
           and `AppRouter.openSettings(.account)` sends links there. */
        case .account: return "Sign in to sync settings to your PDS"
        case .safari: return "Turn on Aturi in Safari on this device"
        case .about: return "Version, links, licence and privacy"
        }
    }

    var systemImage: String {
        switch self {
        case .general: return "paintpalette"
        case .sections: return "rectangle.split.3x1"
        case .waypoints: return "square.grid.2x2"
        case .redirects: return "arrow.triangle.turn.up.right.diamond"
        case .custom: return "link.badge.plus"
        case .account: return "person.crop.circle"
        case .safari: return "safari"
        case .about: return "info.circle"
        }
    }
}

/// The Settings tab's root: port of `SettingsShell.tsx` with the tab strip
/// turned into a list of pages. Anyone can change every preference; the
/// banner at the top says where those changes live until they sign in.
struct SettingsView: View {
    @Environment(AppRouter.self) private var router
    @Environment(\.sessionStore) private var sessionStore
    @Environment(\.aturiTheme) private var theme

    /// Ids of the rows the router's scroll-to-top lands on: the banner
    /// when it shows, else the first Preferences row.
    private static let bannerID = "settings-banner"
    private static let firstPageID = "settings-first-page"

    var body: some View {
        ScrollViewReader { proxy in
            list
                .onChange(of: router.scrollToTopRequest[.settings, default: 0]) { _, _ in
                    let top = sessionStore.state.isSignedIn ? Self.firstPageID : Self.bannerID
                    withAnimation(.easeOut(duration: 0.2)) {
                        proxy.scrollTo(top, anchor: .top)
                    }
                }
        }
        .navigationTitle("Settings")
        .navigationDestination(for: SettingsPage.self) { page in
            SettingsPageDestination(page: page)
        }
    }

    private var list: some View {
        List {
            /* Signing in lives on the Account tab; the banner points there. */
            if !sessionStore.state.isSignedIn {
                SettingsSection {
                    Button {
                        router.show(.account)
                    } label: {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: "icloud.slash")
                                .foregroundStyle(theme.textAccent)
                                .accessibilityHidden(true)
                            Text("Settings are saved on this device only. Sign in on the Account tab to sync them to your PDS and carry them across devices.")
                                .font(AturiFont.footnote)
                                .foregroundStyle(theme.textSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                            Spacer(minLength: 0)
                            Image(systemName: "chevron.right")
                                .font(AturiFont.footnote)
                                .foregroundStyle(theme.textTertiary)
                                .accessibilityHidden(true)
                        }
                        .padding(.vertical, 4)
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens the Account tab")
                    .id(Self.bannerID)
                }
            }

            SettingsSection("Preferences") {
                pageLink(.general)
                    .id(Self.firstPageID)
                pageLink(.sections)
                pageLink(.waypoints)
                pageLink(.redirects)
                pageLink(.custom)
            }

            SettingsSection {
                pageLink(.safari)
                pageLink(.about)
            }
        }
        .settingsList()
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
        case .sections:
            SectionsSettingsView()
        case .waypoints:
            WaypointGroupsView()
        case .redirects:
            RedirectsSettingsView()
        case .custom:
            CustomWaypointsView()
        case .account:
            AccountSettingsView()
        case .safari:
            SafariExtensionSettingsView()
        case .about:
            AboutView()
        }
    }
}
