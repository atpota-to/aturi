import SwiftUI
import Observation
import AturiCore

/// The tab bar, in order. Links and Lexicons are not tabs: a pasted or
/// incoming link opens its preview on Explore, and the lexicon browser is a
/// page pushed from Explore, as `/explore/lexicons` is on the web.
enum Tab: String, CaseIterable, Identifiable, Hashable, Sendable {
    case explore
    case tools
    case settings
    case account

    var id: String { rawValue }

    var title: String {
        switch self {
        case .explore: return "Explore"
        case .tools: return "Tools"
        case .settings: return "Settings"
        case .account: return "Account"
        }
    }

    var systemImage: String {
        switch self {
        case .explore: return "magnifyingglass"
        case .tools: return "wrench.and.screwdriver"
        case .settings: return "gearshape"
        case .account: return "person.crop.circle"
        }
    }
}

/// The app's sections as a link or a shortcut can name them. Wider than
/// `Tab`: Links and Lexicons were tabs once, and `/links`, `/explore/lexicons`
/// and "Open Lexicons in Aturi" still name them, so they stay addressable
/// and land inside Explore (`AppRouter.show`). `Sendable` is spelled out
/// because the App Intents conformance (Intents/NavigationIntents.swift)
/// requires it, and Swift wants it declared in this file.
enum AppSection: String, CaseIterable, Hashable, Sendable {
    case explore
    case links
    case lexicons
    case tools
    case settings
    case account

    init(_ section: LinkSection) {
        switch section {
        case .explore: self = .explore
        case .links: self = .links
        case .lexicons: self = .lexicons
        case .tools: self = .tools
        case .settings: self = .settings
        }
    }
}

/// Every screen a `NavigationStack` can push. Values carry raw (decoded)
/// identifiers; the explorer path spelling is derived on the way out.
enum Route: Hashable {
    /// A repo page, opened on `tab` when a link names one: the web's
    /// `?tab=` value (`DeepLinkRouting.repoTabs`), left nil for Collections.
    case repo(String, tab: String? = nil)
    case collection(repo: String, collection: String)
    case record(repo: String, collection: String, rkey: String)
    /// A PDS page, with its accounts' filters and order when a link names
    /// them (`?status=`, `?commit=`, `?sort=`, `?dir=`).
    case pds(host: String, query: [String: String] = [:])
    case lexicon(nsid: String)
    case lexiconGroup(prefix: String)
    /// The lexicon browser (`/explore/lexicons`), pushed from Explore.
    case lexicons
    /// The universal-link page: preview card plus waypoint picker.
    case preview(AtUriComponents)
    /// Free-text search results from the explore landing.
    case search(String)
    /// A tool's page (`/tools/{slug}`), with the input a link handed it in
    /// the query the web tool reads (`?handle=`, `?actor=`, ...).
    case tool(slug: String, query: [String: String] = [:])
}

extension Route {
    /// The typed reading of an explorer path, when the path names a page
    /// this app models. Nil for the lexicons index, space pages and
    /// anything else `SearchDestination` carries verbatim. `repoTab` is a
    /// link's `?tab=`, which only a repo page reads.
    init?(destination: SearchDestination, repoTab: String? = nil, pdsQuery: [String: String] = [:]) {
        switch destination {
        case .repo(let repo):
            self = .repo(repo, tab: repoTab)
        case .collection(let repo, let collection):
            self = .collection(repo: repo, collection: collection)
        case .record(let repo, let collection, let rkey):
            self = .record(repo: repo, collection: collection, rkey: rkey)
        case .pds(let host):
            self = .pds(host: host, query: pdsQuery)
        case .lexicon(let nsid):
            self = .lexicon(nsid: nsid)
        case .lexiconGroup(let prefix):
            self = .lexiconGroup(prefix: prefix)
        case .explorer:
            return nil
        }
    }

    /// `/explore/...` as the web's link builders spell it.
    init?(explorePath: String) {
        self.init(destination: SearchDestination(explorePath: explorePath))
    }

    /// An `at://` URI as an explorer route. Nil for non-AT input and for
    /// space addresses, which have no public page.
    init?(atUri: String) {
        guard let uri = AtUri(parsing: atUri) else { return nil }
        if let collection = uri.collection, !collection.isEmpty {
            if let rkey = uri.rkey, !rkey.isEmpty {
                self = .record(repo: uri.repo, collection: collection, rkey: rkey)
            } else {
                self = .collection(repo: uri.repo, collection: collection)
            }
        } else {
            self = .repo(uri.repo)
        }
    }

    /// The explorer destination behind this route; nil for the preview
    /// page and search results, which are not explorer pages.
    var destination: SearchDestination? {
        switch self {
        case .repo(let repo, _):
            return .repo(repo)
        case .collection(let repo, let collection):
            return .collection(repo: repo, collection: collection)
        case .record(let repo, let collection, let rkey):
            return .record(repo: repo, collection: collection, rkey: rkey)
        case .pds(let host, _):
            return .pds(host: host)
        case .lexicon(let nsid):
            return .lexicon(nsid: nsid)
        case .lexiconGroup(let prefix):
            return .lexiconGroup(prefix: prefix)
        case .lexicons:
            return .explorer(path: "/explore/lexicons")
        case .preview, .search, .tool:
            return nil
        }
    }

    /// The canonical `/explore/...` path, for copy rows and history.
    var explorePath: String? {
        destination?.explorePath
    }

    /// The aturi.to page for this route, for share sheets. Nil for search.
    var webURL: URL? {
        switch self {
        case .preview(let components):
            return URL(string: generateAturiLink(components))
        case .search:
            return nil
        case .tool(let slug, let query):
            return URL(string: Endpoints.aturiBase.absoluteString + "/tools/" + slug + Route.queryString(query))
        default:
            guard let path = explorePath else { return nil }
            return URL(string: Endpoints.aturiBase.absoluteString + path + tabQuery)
        }
    }

    /// `?tab=` for a repo page opened on a tab, so the page handed to
    /// Handoff or Spotlight reopens on it, as the link that opened it did.
    private var tabQuery: String {
        switch self {
        case .repo(_, let tab?):
            return "?tab=" + URIEncoding.encodeComponent(tab)
        case .pds(_, let query):
            return Route.queryString(query)
        default:
            return ""
        }
    }

    /// `?a=1&b=2` with the keys sorted, so one input is always one URL;
    /// empty for no query.
    static func queryString(_ query: [String: String]) -> String {
        guard !query.isEmpty else { return "" }
        let pairs = query.keys.sorted().map { key in
            URIEncoding.encodeComponent(key) + "=" + URIEncoding.encodeComponent(query[key] ?? "")
        }
        return "?" + pairs.joined(separator: "&")
    }

    /// The tab a route belongs to when nothing else decides: tools on
    /// Tools, everything else (universal links and lexicons included) on
    /// Explore.
    var defaultTab: Tab {
        switch self {
        case .tool:
            return .tools
        case .repo, .collection, .record, .pds, .search, .preview, .lexicon, .lexiconGroup, .lexicons:
            return .explore
        }
    }
}

/// What a URL maps to: a route pushed on a tab, a section's root, or the
/// lexicon browser on its New section.
enum DeepLinkTarget: Hashable {
    case route(Route, tab: Tab)
    case section(AppSection)
    /// The lexicon browser on its New section
    /// (`AppRouter.showNewLexicons`).
    case newLexicons
}

/// URL-to-target mapping, kept separate from the router so it can be
/// exercised without a `NavigationPath`. The grammar itself, the web's
/// route tree and the query its pages read, is `DeepLinkRouting` in
/// AturiCore, where it is tested; this maps its destinations onto the
/// app's routes and tabs.
enum DeepLinks {
    static func target(for url: URL) -> DeepLinkTarget? {
        target(for: url.absoluteString)
    }

    static func target(for string: String) -> DeepLinkTarget? {
        guard let destination = DeepLinkRouting.destination(for: string) else { return nil }
        switch destination {
        case .preview(let components):
            return .route(.preview(components), tab: .explore)
        case .explore(let explorer, let repoTab, let pdsQuery):
            guard let route = Route(destination: explorer, repoTab: repoTab, pdsQuery: pdsQuery) else { return nil }
            return .route(route, tab: route.defaultTab)
        case .lexiconList(let list):
            /* New is the one list the lexicon browser can be sent to from
               outside; any other opens the browser as it stands. */
            if list == "new" {
                return .newLexicons
            }
            return .section(.lexicons)
        case .section(let section):
            return .section(AppSection(section))
        case .tool(let slug, let query):
            return .route(.tool(slug: slug, query: query), tab: .tools)
        }
    }

    /// Whether the link carries the web's `?stay=1`, looking through the
    /// share extension's `aturi://open?url=` wrapper.
    static func asksToStay(_ string: String) -> Bool {
        DeepLinkRouting.asksToStay(string)
    }

    /// `/account#redirects` and the other settings tabs, as the web's
    /// `SettingsShell` reads its hash. Nil for any other link.
    static func settingsPage(for string: String) -> SettingsPage? {
        DeepLinkRouting.settingsFragment(for: string).flatMap { SettingsPage(rawValue: $0) }
    }
}

/// Navigation state for the whole app: one path per tab plus the selected
/// tab. Screens push by value (`open`), incoming URLs are mapped by
/// `DeepLinks` and applied here.
@MainActor
@Observable
final class AppRouter {
    var selectedTab: Tab = .explore
    var explorePath = NavigationPath()
    var toolsPath = NavigationPath()
    var settingsPath = NavigationPath()
    var accountPath = NavigationPath()
    /// Set by the "Open Copied Link" shortcut, cleared by the Explore
    /// landing when it reads the clipboard. The read waits for the landing
    /// because iOS asks before an app reads what another app copied, and
    /// only an app that is on screen can be asked.
    private(set) var clipboardLinkRequested = false
    /// Set by the Explore landing's "All new lexicons", cleared by the
    /// lexicon browser when it turns to its New section: the web's link to
    /// `/explore/lexicons#new`, which lands on that card. An incoming link
    /// to that address, or to `?list=new`, sets it too.
    private(set) var newLexiconsRequested = false

    init() {}

    /// Push a route. Without a tab it goes on the stack the person is
    /// looking at, so a lexicon tapped on a record page stays in Explore.
    func open(_ route: Route, in tab: Tab? = nil) {
        let target = tab ?? selectedTab
        if target != selectedTab {
            selectedTab = target
        }
        switch target {
        case .explore: explorePath.append(route)
        case .tools: toolsPath.append(route)
        case .settings: settingsPath.append(route)
        case .account: accountPath.append(route)
        }
    }

    /// How many pages sit on a tab's stack.
    func depth(of tab: Tab) -> Int {
        switch tab {
        case .explore: return explorePath.count
        case .tools: return toolsPath.count
        case .settings: return settingsPath.count
        case .account: return accountPath.count
        }
    }

    /// `open` for an `at://` URI or bare DID found in record JSON. False
    /// when the string is not an AT URI this app has a page for.
    @discardableResult
    func open(atUri: String, in tab: Tab? = nil) -> Bool {
        let route: Route?
        if isValidDid(atUri) {
            route = .repo(atUri)
        } else {
            route = Route(atUri: atUri)
        }
        guard let route else { return false }
        open(route, in: tab)
        return true
    }

    func popToRoot(_ tab: Tab? = nil) {
        switch tab ?? selectedTab {
        case .explore: explorePath = NavigationPath()
        case .tools: toolsPath = NavigationPath()
        case .settings: settingsPath = NavigationPath()
        case .account: accountPath = NavigationPath()
        }
    }

    func select(_ tab: Tab) {
        selectedTab = tab
    }

    /// Go to a section at its top, as a link or a shortcut names it. Links
    /// is the Explore landing, where links are pasted; Lexicons is the
    /// lexicon browser pushed once on a fresh Explore stack.
    func show(_ section: AppSection) {
        switch section {
        case .explore, .links:
            popToRoot(.explore)
            selectedTab = .explore
        case .lexicons:
            popToRoot(.explore)
            explorePath.append(Route.lexicons)
            selectedTab = .explore
        case .tools:
            popToRoot(.tools)
            selectedTab = .tools
        case .settings:
            popToRoot(.settings)
            selectedTab = .settings
        case .account:
            popToRoot(.account)
            selectedTab = .account
        }
    }

    /// Route an incoming URL. False for links the app has no page for, so
    /// the caller can hand them to Safari.
    @discardableResult
    func handle(url: URL) -> Bool {
        handle(string: url.absoluteString)
    }

    /// `handle(url:)` for pasted text and strings Foundation's `URL`
    /// refuses (an `at://` URI with a DID authority).
    @discardableResult
    func handle(string: String) -> Bool {
        guard let target = DeepLinks.target(for: string) else { return false }
        if case .section(.settings) = target, let page = DeepLinks.settingsPage(for: string) {
            openSettings(page)
            return true
        }
        if case .route(.preview(let components), _) = target {
            /* Every preview the router places for a URL came from outside
               the app; an in-app push leaves its own note first, which
               the preview page checks before this one. */
            LinkNavigation.noteIncomingPreview(components)
            if DeepLinks.asksToStay(string) {
                LinkNavigation.noteStay(components)
            }
        }
        apply(target)
        return true
    }

    /// Show one settings screen over the Settings root, as a link to
    /// `/account#redirects` does on the web. The account page is its own
    /// tab, so a link to `/account#account` lands there.
    func openSettings(_ page: SettingsPage) {
        if page == .account {
            show(.account)
            return
        }
        settingsPath = NavigationPath()
        settingsPath.append(page)
        selectedTab = .settings
    }

    /// Open a link that came from outside the app (a Shortcuts action, the
    /// clipboard): anything `extractAtUriComponents` reads becomes its
    /// preview on Explore, and anything else the deep-link grammar places
    /// goes where that sends it. The preview is noted as incoming, so an
    /// auto-redirect preference applies. False when the input names nothing
    /// the app has a page for.
    @discardableResult
    func openLink(_ input: String) -> Bool {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else { return false }
        if var components = extractAtUriComponents(value) {
            if components.identifier.hasPrefix("@") {
                components.identifier.removeFirst()
            }
            LinkNavigation.noteIncomingPreview(components)
            open(.preview(components), in: .explore)
            return true
        }
        return handle(string: value)
    }

    /// Show the Explore landing and have it open whatever link is on the
    /// clipboard (see `clipboardLinkRequested`).
    func requestClipboardLink() {
        popToRoot(.explore)
        selectedTab = .explore
        clipboardLinkRequested = true
    }

    /// True once per request: the Explore landing calls this when it is on
    /// screen and the app is active, then reads the clipboard.
    func consumeClipboardLinkRequest() -> Bool {
        guard clipboardLinkRequested else { return false }
        clipboardLinkRequested = false
        return true
    }

    /// Show the lexicon browser with the New section selected (see
    /// `newLexiconsRequested`), on a fresh Explore stack.
    func showNewLexicons() {
        show(.lexicons)
        newLexiconsRequested = true
    }

    /// True once per request: the lexicon browser calls this when it
    /// appears and when the request changes, then shows its New section.
    func consumeNewLexiconsRequest() -> Bool {
        guard newLexiconsRequested else { return false }
        newLexiconsRequested = false
        return true
    }

    private func apply(_ target: DeepLinkTarget) {
        switch target {
        case .section(let section):
            show(section)
        case .route(let route, let tab):
            open(route, in: tab)
        case .newLexicons:
            showNewLexicons()
        }
    }
}
