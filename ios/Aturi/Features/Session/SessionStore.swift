import Foundation
import Observation
import AuthenticationServices
import UIKit
import AturiCore

/// Why a sign-in or an authenticated call could not go ahead, beyond what
/// AturiCore's own error types say.
enum SessionError: LocalizedError, Equatable {
    /// The person dismissed the browser sheet.
    case cancelled
    /// A sign-in is already running.
    case busy
    /// The browser sheet could not be presented.
    case browserUnavailable
    /// Nobody is signed in, or the stored key could not be reopened.
    case notSignedIn
    /// The account's DID document names a PDS that is not a URL.
    case invalidPDS(String)

    var errorDescription: String? {
        switch self {
        case .cancelled:
            return "Sign in was cancelled."
        case .busy:
            return "A sign in is already in progress."
        case .browserUnavailable:
            return "The sign-in page could not be opened."
        case .notSignedIn:
            return "Sign in to do that."
        case .invalidPDS(let pds):
            return "Your account names a PDS this app cannot reach: \(pds)"
        }
    }
}

/// Where a sign-in is, for the sheet's progress copy.
enum SignInPhase: Equatable {
    case idle
    case resolving
    case discovering
    case authorizing
    case exchanging
    case syncing

    var label: String? {
        switch self {
        case .idle: return nil
        case .resolving: return "Resolving your handle"
        case .discovering: return "Contacting your server"
        case .authorizing: return "Waiting for your server"
        case .exchanging: return "Finishing sign in"
        case .syncing: return "Syncing your settings"
        }
    }
}

/// The preferences mirror's state, the web provider's `pdsSync`.
enum PreferencesSyncStatus: Equatable {
    case idle
    case syncing
    case failed(String)
}

/// Everything `completeAuthorization` needs once the browser is gone,
/// kept in the Keychain while the sheet is up so a redirect that reaches
/// the app after a relaunch can still finish the flow.
private struct PendingAuthorization: Codable {
    var request: AuthorizationRequest
    var key: DPoPKeySerialization
}

/// The signed-in account, its DPoP key and the OAuth flow that produces
/// them. This is the `SessionStoring` the app runs with: it restores the
/// session from the Keychain at launch, refreshes tokens before they
/// expire, signs every repo write, and mirrors preferences to the PDS as
/// the web's session and preferences providers do together.
///
/// Wire it in with the store it should merge preferences into:
///
///     let preferences = PreferencesStore()
///     AppEnvironment(session: SessionStore(preferences: preferences), preferences: preferences)
///
/// Without one it merges into a store of its own on the same app group
/// suite, and the app's copy catches up on its next reload (a foreground
/// transition, or `attach(preferences:)` from the sign-in sheet).
@MainActor
@Observable
final class SessionStore: SessionStoring, PreferencesSync {
    private static let sessionAccount = "session"
    private static let pendingAccount = "pending-authorization"
    /// The redirect's custom scheme, read off the client metadata so the
    /// two cannot drift.
    private static let callbackScheme = URL(string: OAuthClientMetadata.nativeRedirectURI)?.scheme ?? "to.aturi"
    /// How long before expiry the timer refreshes. Longer than the
    /// one-minute leeway `isExpired` applies on use, so a token is normally
    /// renewed in the background before any call has to wait on it.
    private static let refreshLeeway: TimeInterval = 120

    private(set) var state: SessionState = .signedOut
    private(set) var phase: SignInPhase = .idle
    private(set) var syncStatus: PreferencesSyncStatus = .idle

    @ObservationIgnored private let keychain: KeychainStore
    @ObservationIgnored private let http: HTTPClient
    @ObservationIgnored private let identity: IdentityResolver
    @ObservationIgnored private let client: OAuthClient
    @ObservationIgnored private let nonces: DPoPNonceStore
    @ObservationIgnored private let anchorProvider = PresentationAnchorProvider()
    @ObservationIgnored private weak var preferences: PreferencesStore?
    @ObservationIgnored private var key: P256DPoPKey?
    @ObservationIgnored private var pending: PendingAuthorization?
    @ObservationIgnored private var callbackContinuation: CheckedContinuation<URL, Error>?
    @ObservationIgnored private var browser: ASWebAuthenticationSession?
    @ObservationIgnored private var refreshTask: Task<OAuthSession, Error>?
    @ObservationIgnored private var expiryTask: Task<Void, Never>?
    @ObservationIgnored private var syncTask: Task<Void, Never>?
    /// Whether a sign-in merge has run against a store other than the
    /// attached one, so a late `attach` knows to re-read storage.
    @ObservationIgnored private var mergedWithoutStore = false

    init(
        preferences: PreferencesStore? = nil,
        http: HTTPClient = .shared,
        identity: IdentityResolver = .shared,
        keychain: KeychainStore = KeychainStore()
    ) {
        let nonces = DPoPNonceStore()
        self.preferences = preferences
        self.http = http
        self.identity = identity
        self.keychain = keychain
        self.nonces = nonces
        self.client = OAuthClient(http: http, metadata: .native, nonces: nonces)
        preferences?.sync = self
        restore()
    }

    // MARK: SessionStoring

    var writeAccess: Bool {
        guard let session = state.session else { return false }
        let granted = session.grantedScopeIds
        return granted.contains(.create) || granted.contains(.update)
    }

    var deleteAccess: Bool {
        state.session?.grantedScopeIds.contains(.delete) ?? false
    }

    func signIn(handle: String, scope: Set<ScopeId>) async throws {
        guard phase == .idle else { throw SessionError.busy }
        defer { phase = .idle }

        phase = .resolving
        let bundle = try await identity.resolveIdentifier(handle)
        guard let pds = URL(string: PDSServer.normalizePdsBase(bundle.pds)), pds.host != nil else {
            throw SessionError.invalidPDS(bundle.pds)
        }

        phase = .discovering
        /* A fresh key per sign-in: the tokens are bound to it, and a key
           reused across accounts would let one session's proofs stand in
           for another's. */
        let key = P256DPoPKey()
        let request = try await client.beginAuthorization(
            did: bundle.did,
            pds: pds,
            scope: Scopes.buildScopeString(scope),
            key: key,
            handleHint: Self.loginHint(typed: handle, resolved: bundle.handle)
        )
        persistPending(PendingAuthorization(request: request, key: key.serialized))
        defer { clearPending() }

        phase = .authorizing
        let callback = try await presentBrowser(url: request.authorizeURL)

        phase = .exchanging
        let session = try await client.completeAuthorization(callback: callback, expected: request, key: key)
        adopt(session, key: key)

        phase = .syncing
        await syncPreferences()
    }

    func signOut() async {
        guard case .signedIn(let session) = state else { return }
        syncTask?.cancel()
        if let key {
            /* Best effort, as on the web: a revoke the network swallows
               still ends the session here. */
            try? await client.revoke(session, key: key)
        }
        forgetSession()
    }

    func handleCallback(url: URL) -> Bool {
        guard url.scheme?.lowercased() == Self.callbackScheme else { return false }
        if callbackContinuation != nil {
            finishCallback(.success(url))
        } else if let pending = pending ?? loadPersistedPending() {
            /* No browser sheet is waiting: the app was relaunched while it
               was up, or the redirect was opened from another browser.
               The request it answers is still on file, so finish it. */
            Task { await completeInterrupted(pending, callback: url) }
        }
        return true
    }

    func putRecord(collection: String, rkey: String, value: JSONValue) async throws {
        _ = try await withAuthenticatedPDS { pds in
            try await pds.putRecord(collection: collection, rkey: rkey, record: value)
        }
    }

    func createRecord(collection: String, rkey: String?, value: JSONValue) async throws -> String {
        let result = try await withAuthenticatedPDS { pds in
            try await pds.createRecord(collection: collection, record: value, rkey: rkey)
        }
        return result.uri
    }

    func deleteRecord(collection: String, rkey: String) async throws {
        try await withAuthenticatedPDS { pds in
            try await pds.deleteRecord(collection: collection, rkey: rkey)
        }
    }

    func applyWrites(deletes rkeys: [String], collection: String) async throws {
        try await withAuthenticatedPDS { pds in
            try await pds.applyWrites(deletes: rkeys, collection: collection)
        }
    }

    func profileWithViewer(actor: String) async throws -> BskyProfile? {
        try await withAuthenticatedPDS { pds in
            try await pds.getProfileWithViewer(actor)
        }
    }

    // MARK: Preferences mirror

    /// Point the store at the preferences it should reconcile on sign-in.
    /// Idempotent; the sign-in sheet and the badge call it with the
    /// environment's store in case the app was wired without one.
    func attach(preferences: PreferencesStore) {
        /* Ahead of the identity guard, so a store init already holds is
           (re)pointed at this hook too; the assignment is idempotent. */
        preferences.sync = self
        guard self.preferences !== preferences else { return }
        self.preferences = preferences
        if mergedWithoutStore {
            mergedWithoutStore = false
            preferences.reload()
        }
    }

    func preferencesDidChange(_ prefs: Preferences) {
        guard state.isSignedIn else { return }
        let value = prefs.toRecordValue()
        /* Writes are chained rather than raced: the store already debounced
           this change, and the newest value must be the one that lands
           last on the PDS. */
        let previous = syncTask
        syncTask = Task { [weak self] in
            _ = await previous?.value
            guard let self else { return }
            await self.push(value)
        }
    }

    private func push(_ value: JSONValue) async {
        guard state.isSignedIn else { return }
        syncStatus = .syncing
        do {
            _ = try await withAuthenticatedPDS { pds in
                try await pds.writePreferencesRecord(value)
            }
            syncStatus = .idle
        } catch {
            if state.isSignedIn {
                syncStatus = .failed(ExploreErrorText.describe(error))
            }
        }
    }

    /// The provider's sign-in reconciliation: read the PDS record, let the
    /// store decide between it and local (remote wins when it is at least
    /// as new; otherwise local stands), and push local up when the store
    /// says the PDS copy is behind or missing.
    private func syncPreferences() async {
        guard state.isSignedIn else { return }
        syncStatus = .syncing
        do {
            let remote = try await withAuthenticatedPDS { pds in
                try await pds.readPreferencesRecord()
            }
            let store: PreferencesStore
            if let preferences {
                store = preferences
            } else {
                store = PreferencesStore()
                mergedWithoutStore = true
            }
            let outcome = store.load(fromRemote: remote.map { Preferences(recordValue: $0) })
            if case .keptLocal(pushToRemote: true) = outcome {
                let value = store.prefs.toRecordValue()
                _ = try await withAuthenticatedPDS { pds in
                    try await pds.writePreferencesRecord(value)
                }
            }
            syncStatus = .idle
        } catch {
            if state.isSignedIn {
                syncStatus = .failed(ExploreErrorText.describe(error))
            }
        }
    }

    // MARK: Session lifecycle

    /// Reopen the Keychain session at launch. A blob that no longer
    /// decodes, or a key that will not reopen, reads as signed out; the
    /// next sign-in overwrites it.
    private func restore() {
        guard let data = try? keychain.load(account: Self.sessionAccount),
              let session = try? JSONDecoder().decode(OAuthSession.self, from: data),
              let key = try? P256DPoPKey(serialized: session.dpopKey)
        else { return }
        self.key = key
        state = .signedIn(session)
        scheduleRefresh(for: session)
        syncTask = Task { [weak self] in
            await self?.syncPreferences()
        }
    }

    private func adopt(_ session: OAuthSession, key: P256DPoPKey) {
        self.key = key
        state = .signedIn(session)
        if let data = try? JSONEncoder().encode(session) {
            /* A Keychain that refuses the write leaves the session usable
               for this launch; there is nothing better to do than try
               again on the next refresh. */
            try? keychain.save(data, account: Self.sessionAccount)
        }
        scheduleRefresh(for: session)
    }

    private func forgetSession() {
        expiryTask?.cancel()
        expiryTask = nil
        refreshTask = nil
        key = nil
        state = .signedOut
        syncStatus = .idle
        try? keychain.delete(account: Self.sessionAccount)
    }

    /// Renew the token pair in the background shortly before it expires,
    /// so a write never has to wait on a refresh round trip first. A token
    /// with no expiry, or no refresh token, is left to the 401 path.
    private func scheduleRefresh(for session: OAuthSession) {
        expiryTask?.cancel()
        expiryTask = nil
        guard session.canRefresh, let expiresAt = session.expiresAt else { return }
        let delay = max(expiresAt.timeIntervalSinceNow - Self.refreshLeeway, 1)
        expiryTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(delay))
            guard !Task.isCancelled, let self else { return }
            _ = try? await self.refreshSession()
        }
    }

    /// Trade the refresh token for a new pair, sharing one in-flight
    /// refresh between callers. A refusal of the grant itself (revoked
    /// elsewhere, refresh token expired) ends the session; a network
    /// failure leaves it alone, since the next call tries again.
    private func refreshSession() async throws -> OAuthSession {
        if let refreshTask {
            return try await refreshTask.value
        }
        guard case .signedIn(let current) = state, let key else {
            throw SessionError.notSignedIn
        }
        let client = self.client
        let task = Task { try await client.refresh(current, key: key) }
        refreshTask = task
        defer { refreshTask = nil }
        do {
            let refreshed = try await task.value
            adopt(refreshed, key: key)
            return refreshed
        } catch let error as OAuthError {
            if Self.endsSession(error) {
                forgetSession()
            }
            throw error
        }
    }

    /// `invalid_grant` is the authorization server saying the refresh token
    /// is dead; nothing short of a new sign-in fixes that.
    private static func endsSession(_ error: OAuthError) -> Bool {
        switch error {
        case .server(_, let name, _):
            return name == "invalid_grant"
        case .missingRefreshToken:
            return true
        default:
            return false
        }
    }

    /// The PDS client for the current session, refreshed first when the
    /// token is about to expire.
    private func authenticatedPDS() async throws -> AuthenticatedPDS {
        guard case .signedIn(var session) = state, let key else {
            throw SessionError.notSignedIn
        }
        if session.isExpired() {
            session = try await refreshSession()
        }
        return AuthenticatedPDS(session: session, key: key, http: http, nonces: nonces)
    }

    /// Run one authenticated call, and once more with a refreshed token
    /// when the PDS rejected the credential rather than the request.
    private func withAuthenticatedPDS<T>(_ operation: (AuthenticatedPDS) async throws -> T) async throws -> T {
        let pds = try await authenticatedPDS()
        do {
            return try await operation(pds)
        } catch let error as HTTPError where AuthenticatedPDS.isAuthenticationError(error) {
            let session = try await refreshSession()
            guard let key else { throw SessionError.notSignedIn }
            return try await operation(AuthenticatedPDS(session: session, key: key, http: http, nonces: nonces))
        }
    }

    // MARK: Authorization flow

    /// What the server's sign-in page is told about the account: the
    /// handle the person typed (minus a presentation @), or the one the
    /// PDS reports when they typed a DID or an at:// URI. Nil lets the
    /// client send the DID.
    private static func loginHint(typed: String, resolved: String?) -> String? {
        var typed = typed.trimmingCharacters(in: .whitespacesAndNewlines)
        if typed.hasPrefix("@") {
            typed.removeFirst()
        }
        if !typed.isEmpty, !typed.hasPrefix("did:"), !typed.hasPrefix("at://") {
            return typed
        }
        return resolved
    }

    /// Open the authorization page in the system browser sheet and wait
    /// for the redirect. The person's existing login at their server is
    /// reused (no ephemeral session), as it is on the web.
    private func presentBrowser(url: URL) async throws -> URL {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<URL, Error>) in
            let browser = ASWebAuthenticationSession(url: url, callbackURLScheme: Self.callbackScheme) { [weak self] callback, error in
                /* The completion arrives on the main queue, but the handler
                   is a plain ObjC block with no isolation of its own; the
                   hop states where the store lives instead of assuming it. */
                Task { @MainActor [weak self] in
                    guard let self else { return }
                    if let callback {
                        self.finishCallback(.success(callback))
                    } else if let error = error as? ASWebAuthenticationSessionError, error.code == .canceledLogin {
                        self.finishCallback(.failure(SessionError.cancelled))
                    } else {
                        self.finishCallback(.failure(error ?? SessionError.browserUnavailable))
                    }
                }
            }
            browser.presentationContextProvider = anchorProvider
            browser.prefersEphemeralWebBrowserSession = false
            callbackContinuation = continuation
            self.browser = browser
            if !browser.start() {
                finishCallback(.failure(SessionError.browserUnavailable))
            }
        }
    }

    /// Resume the waiting sign-in exactly once, whichever door the answer
    /// came through: the sheet's completion, the app's URL handler, or a
    /// failure to start.
    private func finishCallback(_ result: Result<URL, Error>) {
        guard let continuation = callbackContinuation else { return }
        callbackContinuation = nil
        let browser = self.browser
        self.browser = nil
        if case .success = result {
            /* The redirect can arrive through the app's URL handler while
               the sheet is still up; dismiss it. Cancelling a sheet that
               already completed is a no-op. */
            browser?.cancel()
        }
        continuation.resume(with: result)
    }

    /// Finish a flow whose sheet is gone, from the request on file.
    /// Failures have no sheet to land in, so they end the attempt quietly;
    /// the person can start over from the sign-in button.
    private func completeInterrupted(_ pending: PendingAuthorization, callback: URL) async {
        guard phase == .idle else { return }
        phase = .exchanging
        defer {
            phase = .idle
            clearPending()
        }
        guard let key = try? P256DPoPKey(serialized: pending.key),
              let session = try? await client.completeAuthorization(callback: callback, expected: pending.request, key: key)
        else { return }
        adopt(session, key: key)
        phase = .syncing
        await syncPreferences()
    }

    private func persistPending(_ pending: PendingAuthorization) {
        self.pending = pending
        if let data = try? JSONEncoder().encode(pending) {
            try? keychain.save(data, account: Self.pendingAccount)
        }
    }

    private func loadPersistedPending() -> PendingAuthorization? {
        guard let data = try? keychain.load(account: Self.pendingAccount) else { return nil }
        return try? JSONDecoder().decode(PendingAuthorization.self, from: data)
    }

    private func clearPending() {
        pending = nil
        try? keychain.delete(account: Self.pendingAccount)
    }
}

/// Hands the browser sheet the window to present over: the foreground
/// scene's key window, or failing that any window of any scene.
private final class PresentationAnchorProvider: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        /* The framework asks on the main thread, which is where the scene
           list lives; the protocol requirement itself carries no isolation,
           so this states the assumption rather than hopping. */
        MainActor.assumeIsolated {
            let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
            let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
            return scene?.keyWindow ?? scene?.windows.first ?? ASPresentationAnchor()
        }
    }
}
