import SwiftUI
import Observation
import AturiCore

/// The slice of the session layer the rest of the app depends on. The real
/// store (Features/Session) owns the Keychain item and the
/// `ASWebAuthenticationSession`; screens only ever see this surface, so
/// the app builds and previews with `NoSession` before that feature lands.
///
/// Everything is main-actor isolated: the state drives views, and the write
/// primitives are called from button actions.
@MainActor
protocol SessionStoring: AnyObject, Observable {
    var state: SessionState { get }
    /// Whether the granted scope carries any of the repo write scopes. The
    /// server may narrow a grant, so this is read off the token, not off
    /// what was requested.
    var writeAccess: Bool { get }
    /// Whether the granted scope allows deleting records, which the
    /// collection page's bulk delete and the editor's Delete need.
    var deleteAccess: Bool { get }
    /// Start the OAuth flow for a handle (or DID) with the picked granular
    /// scopes; the base scope is always added by the store.
    func signIn(handle: String, scope: Set<ScopeId>) async throws
    func signOut() async
    /// Called for every incoming URL before the router sees it. True when
    /// the URL was the `to.aturi:/oauth/callback` redirect and has been
    /// consumed, so the caller must not hand it on.
    func handleCallback(url: URL) -> Bool
    func putRecord(collection: String, rkey: String, value: JSONValue) async throws
    /// Returns the new record's `at://` URI. Without an rkey the PDS mints a TID.
    func createRecord(collection: String, rkey: String?, value: JSONValue) async throws -> String
    func deleteRecord(collection: String, rkey: String) async throws
    /// One atomic `com.atproto.repo.applyWrites` deleting every rkey given,
    /// at most `AuthenticatedPDS.applyWritesMax` per call.
    func applyWrites(deletes rkeys: [String], collection: String) async throws
    /// `app.bsky.actor.getProfile` as the signed-in account, proxied through
    /// its PDS so the `viewer` and `knownFollowers` blocks are filled in.
    func profileWithViewer(actor: String) async throws -> BskyProfile?
}

/// Thrown by `NoSession` for any write or sign-in: nothing is configured.
enum NoSessionError: Error {
    case unavailable
}

/// Placeholder session store: permanently signed out. Stands in until the
/// session feature is wired into `AppEnvironment`, and serves previews and
/// the environment default. The initializer is nonisolated so an
/// `EnvironmentKey` default can build one outside the main actor.
@MainActor
@Observable
final class NoSession: SessionStoring {
    private(set) var state: SessionState = .signedOut

    nonisolated init() {}

    var writeAccess: Bool { false }

    var deleteAccess: Bool { false }

    func signIn(handle: String, scope: Set<ScopeId>) async throws {
        throw NoSessionError.unavailable
    }

    func signOut() async {}

    func handleCallback(url: URL) -> Bool { false }

    func putRecord(collection: String, rkey: String, value: JSONValue) async throws {
        throw NoSessionError.unavailable
    }

    func createRecord(collection: String, rkey: String?, value: JSONValue) async throws -> String {
        throw NoSessionError.unavailable
    }

    func deleteRecord(collection: String, rkey: String) async throws {
        throw NoSessionError.unavailable
    }

    func applyWrites(deletes rkeys: [String], collection: String) async throws {
        throw NoSessionError.unavailable
    }

    func profileWithViewer(actor: String) async throws -> BskyProfile? {
        throw NoSessionError.unavailable
    }
}

/// The app's long-lived objects, built once by `AturiApp` and pushed into
/// the SwiftUI environment. The observable stores are injected as
/// themselves (`@Environment(PreferencesStore.self)`); the session store,
/// which is only known by protocol, and the identity resolver, which is not
/// observable, go in under keyed environment values.
@MainActor
@Observable
final class AppEnvironment {
    let preferences: PreferencesStore
    let searchHistory: SearchHistoryStore
    let session: any SessionStoring
    let identity: IdentityResolver
    let router: AppRouter

    /// - Parameter session: the session feature passes its `SessionStore`
    ///   here; until then the placeholder keeps the app signed out.
    init(
        session: any SessionStoring = NoSession(),
        preferences: PreferencesStore = PreferencesStore(),
        searchHistory: SearchHistoryStore? = nil,
        identity: IdentityResolver = .shared,
        router: AppRouter = AppRouter()
    ) {
        self.session = session
        self.preferences = preferences
        self.searchHistory = searchHistory ?? SearchHistoryStore(defaults: PreferencesStore.appGroupDefaults())
        self.identity = identity
        self.router = router
        /* A session store that mirrors preferences to the PDS conforms to
           PreferencesSync as well; attaching it here keeps the package
           unaware of OAuth while the debounce in PreferencesStore does the
           rest. The store holds it weakly, and this object holds it
           strongly, so the hook lives as long as the app. */
        if let sync = session as? PreferencesSync {
            preferences.sync = sync
        }
    }
}

private struct SessionStoreKey: EnvironmentKey {
    static let defaultValue: any SessionStoring = NoSession()
}

private struct IdentityResolverKey: EnvironmentKey {
    static let defaultValue: IdentityResolver = .shared
}

extension EnvironmentValues {
    /// The session store, read as `@Environment(\.sessionStore)`.
    var sessionStore: any SessionStoring {
        get { self[SessionStoreKey.self] }
        set { self[SessionStoreKey.self] = newValue }
    }

    /// The shared identity resolver (and its caches).
    var identityResolver: IdentityResolver {
        get { self[IdentityResolverKey.self] }
        set { self[IdentityResolverKey.self] = newValue }
    }
}

@main
struct AturiApp: App {
    /* The session store and the preferences store must be the same pair
       the rest of the app sees: signing in merges the PDS record into the
       preferences store it was handed, so it is built first and passed to
       both. */
    @State private var appEnvironment: AppEnvironment = {
        let preferences = PreferencesStore()
        return AppEnvironment(session: SessionStore(preferences: preferences), preferences: preferences)
    }()
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL

    var body: some Scene {
        WindowGroup {
            RootView()
                .themedRoot()
                .environment(appEnvironment)
                .environment(appEnvironment.preferences)
                .environment(appEnvironment.searchHistory)
                .environment(appEnvironment.router)
                .environment(\.sessionStore, appEnvironment.session)
                .environment(\.identityResolver, appEnvironment.identity)
                .onOpenURL { url in
                    handle(url)
                }
                .onContinueUserActivity(NSUserActivityTypeBrowsingWeb) { activity in
                    guard let url = activity.webpageURL else { return }
                    handle(url)
                }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .active:
                /* The share extension writes the same app group suite; a
                   change it made while the app was in the background is
                   only visible after a re-read. */
                appEnvironment.preferences.reload()
                appEnvironment.searchHistory.reload()
            case .background:
                appEnvironment.preferences.flushPendingSync()
            default:
                break
            }
        }
    }

    /// Every incoming URL, whichever door it came through: the OAuth
    /// redirect is consumed by the session store, everything the router
    /// understands becomes a route, and the rest goes to the system. A
    /// universal link the app cannot place is opened in Safari, which is
    /// where iOS sends an app's own universal links when the app itself
    /// opens them, so this cannot loop back.
    private func handle(_ url: URL) {
        if appEnvironment.session.handleCallback(url: url) { return }
        if appEnvironment.router.handle(url: url) { return }
        guard let scheme = url.scheme?.lowercased(), scheme == "http" || scheme == "https" else { return }
        openURL(url)
    }
}
