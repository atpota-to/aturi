import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// What the explorer pages depend on for an account. Port of
/// `IdentityBundle` in `src/utils/atproto/identity.ts`.
public struct IdentityBundle: Hashable, Sendable {
    public var did: String
    public var handle: String?
    public var pds: String
    /// Set only when the account's PDS reports the repo as inactive (taken
    /// down, suspended, deactivated, deleted). Nil in the ordinary case, and
    /// also when a repo read simply failed: a PDS that is down says nothing
    /// about the account, so callers keep showing the raw error rather than
    /// a status they never got.
    public var repoStatus: InactiveRepo?

    public init(did: String, handle: String? = nil, pds: String, repoStatus: InactiveRepo? = nil) {
        self.did = did
        self.handle = handle
        self.pds = pds
        self.repoStatus = repoStatus
    }
}

/// Why an account's repo won't serve reads, straight from the host that
/// refused. Deliberately just the two facts the PDS hands over in one extra
/// request: this sits on the path to first paint, so anything that needs a
/// third-party lookup (the head rev, whether the handle still resolves) is
/// left to the screens that display it.
public struct InactiveRepo: Hashable, Sendable {
    /// `status` from com.atproto.sync.getRepoStatus, verbatim.
    public var status: String?
    /// The repo read error that prompted the status lookup.
    public var error: String

    public init(status: String? = nil, error: String) {
        self.status = status
        self.error = error
    }
}

/// Handle resolution that distinguishes a definitive "no such handle" from
/// a transient "resolver unavailable". Port of `HandleResolution` in
/// `src/utils/uriParser.ts`.
///
/// - `notFound`: a resolver answered 4xx (invalid or unknown handle), or 200
///   without a DID. Safe to surface as "not found".
/// - `unavailable`: network failure or 5xx. Must not be shown as not found;
///   it may be a real account we could not look up right now.
public enum HandleResolution: Hashable, Sendable {
    case did(String)
    case notFound
    case unavailable

    public var did: String? {
        if case .did(let did) = self { return did }
        return nil
    }
}

/// A DID with the PDS its document names. Port of the anonymous result of
/// `resolvePdsEndpoint` in `src/utils/didResolver.ts`.
public struct PDSResolution: Hashable, Sendable {
    public var did: String
    /// Verbatim from the document (may carry a trailing slash).
    public var pdsEndpoint: String
    public var didDoc: DIDDocument

    public init(did: String, pdsEndpoint: String, didDoc: DIDDocument) {
        self.did = did
        self.pdsEndpoint = pdsEndpoint
        self.didDoc = didDoc
    }
}

public enum IdentityResolverError: Error, Equatable, Sendable {
    /// `resolveIdentifier` was handed whitespace.
    case emptyInput
    /// No DID document, or a document without a PDS, for the input named.
    case unresolvable(String)
    /// A DID whose method is neither plc nor web.
    case unsupportedDIDMethod(String)
    /// A did:web whose method-specific id does not spell a host.
    case invalidDIDWeb(String)
}

/// Identity resolution: handle <-> DID, DID document, PDS. Port of
/// `src/utils/didResolver.ts` and `src/utils/atproto/identity.ts`.
///
/// The caches mirror the web's module-level `TTLMap`s: handle -> DID for
/// five minutes, DID -> handle (including "no handle") for thirty, the
/// relay's head rev for an inactive repo for five. In-flight lookups are
/// de-duplicated so a record full of the same DID costs one request. Use
/// `shared` from screens so those caches are actually shared; `init(http:)`
/// exists for tests and for a session-scoped client.
public final class IdentityResolver: Sendable {
    public static let shared = IdentityResolver()

    /// Matches `HANDLE_TTL`.
    public static let handleCacheTTL: TimeInterval = 5 * 60
    /// Matches `DID_HANDLE_TTL`.
    public static let didHandleCacheTTL: TimeInterval = 30 * 60
    /// Matches `REPO_REV_TTL`.
    public static let repoRevCacheTTL: TimeInterval = 5 * 60

    private let http: HTTPClient
    private let pds: PDSClient
    private let handleToDid: TTLCache<String, String>
    private let didToHandle: TTLCache<String, String?>
    private let repoRev: TTLCache<String, String?>
    private let inflight = InflightLookups()

    public init(http: HTTPClient = .shared, clock: @escaping @Sendable () -> Date = { Date() }) {
        self.http = http
        pds = PDSClient(http: http)
        handleToDid = TTLCache(ttl: IdentityResolver.handleCacheTTL, clock: clock)
        didToHandle = TTLCache(ttl: IdentityResolver.didHandleCacheTTL, clock: clock)
        repoRev = TTLCache(ttl: IdentityResolver.repoRevCacheTTL, clock: clock)
    }

    // MARK: Handle -> DID

    /// Resolve a handle to a DID. Tries the AppView first, then falls back
    /// to the bsky.social PDS, which can resolve handles served via DNS even
    /// when the appview hasn't seen them yet. Nil when neither could.
    public func resolveHandle(_ handle: String) async -> String? {
        await resolveHandleStatus(handle).did
    }

    /// `resolveHandle` with the reason a lookup produced no DID. A DID is
    /// returned as itself. Not found only when every resolver that answered
    /// said so; a resolver that was down leaves the question open, because a
    /// wrong "not found" is the worse mistake.
    public func resolveHandleStatus(_ handle: String) async -> HandleResolution {
        guard !handle.isEmpty else { return .notFound }
        if handle.hasPrefix("did:") { return .did(handle) }
        if let cached = await handleToDid.get(handle) { return .did(cached) }

        let primary = await queryResolver(Endpoints.appView, handle: handle)
        if case .did(let did) = primary {
            await handleToDid.set(handle, did)
            return primary
        }
        let secondary = await queryResolver(Endpoints.handleResolverFallback, handle: handle)
        if case .did(let did) = secondary {
            await handleToDid.set(handle, did)
            return secondary
        }
        if primary == .notFound, secondary == .notFound {
            return .notFound
        }
        return .unavailable
    }

    /// One com.atproto.identity.resolveHandle call, classified the way
    /// `resolveHandleStatus` in uriParser.ts classifies the appview's answer.
    private func queryResolver(_ base: URL, handle: String) async -> HandleResolution {
        let url = makeURL(base, path: "/xrpc/com.atproto.identity.resolveHandle", query: [("handle", handle)])
        do {
            let body = try await http.getJSONValue(from: url)
            if let did = body["did"]?.stringValue, !did.isEmpty {
                return .did(did)
            }
            return .notFound
        } catch let error as HTTPError {
            return error.status >= 500 ? .unavailable : .notFound
        } catch {
            return .unavailable
        }
    }

    // MARK: DID documents

    /// Fetch a DID document. did:plc via plc.directory, did:web via the
    /// host's `/.well-known/did.json` (or `/<path>/did.json` when the DID
    /// carries path segments). Redirects are refused on both: the did:web
    /// host is named by the DID and therefore caller-controlled, and
    /// plc.directory never needs one. Throws `HTTPError` on a non-2xx and
    /// `IdentityResolverError` for a DID this cannot fetch at all.
    public func loadDIDDocument(_ did: String) async throws -> DIDDocument {
        if did.hasPrefix("did:plc:") {
            let url = makeURL(Endpoints.plcDirectory, path: did)
            return try await http.getJSON(DIDDocument.self, from: url, refuseRedirects: true)
        }
        if did.hasPrefix("did:web:") {
            guard let url = IdentityResolver.didWebDocumentURL(for: did) else {
                throw IdentityResolverError.invalidDIDWeb(did)
            }
            return try await http.getJSON(DIDDocument.self, from: url, refuseRedirects: true)
        }
        let method = did.split(separator: ":", maxSplits: 2, omittingEmptySubsequences: false)
        let name = method.count > 1 ? String(method[1]) : "unknown"
        throw IdentityResolverError.unsupportedDIDMethod(name)
    }

    /// `loadDIDDocument` with every failure folded to nil, the shape of the
    /// web's `fetchDidDocument`.
    public func fetchDIDDocument(_ did: String) async -> DIDDocument? {
        try? await loadDIDDocument(did)
    }

    /// Where a did:web document lives, per the did:web method spec: the
    /// method-specific id's colons become path separators, a percent-encoded
    /// colon in the first segment is a port, and a bare host reads from
    /// `/.well-known/did.json`. Nil when the id does not name a host.
    public static func didWebDocumentURL(for did: String) -> URL? {
        guard did.hasPrefix("did:web:") else { return nil }
        let specific = String(did.dropFirst("did:web:".count))
        let segments = specific.split(separator: ":", omittingEmptySubsequences: false).map(String.init)
        guard let rawHost = segments.first, !rawHost.isEmpty,
            let host = rawHost.removingPercentEncoding, !host.isEmpty
        else { return nil }
        let pathSegments = segments.dropFirst()
        guard !host.contains("/"), !host.contains("?"), !host.contains("#"),
            host.rangeOfCharacter(from: .whitespacesAndNewlines) == nil,
            pathSegments.allSatisfy({ !$0.isEmpty && !$0.contains("/") })
        else { return nil }

        var path = "/.well-known/did.json"
        if !pathSegments.isEmpty {
            let encoded = pathSegments.map {
                $0.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? $0
            }
            path = "/" + encoded.joined(separator: "/") + "/did.json"
        }
        guard let url = URL(string: "https://\(host)\(path)"), let parsedHost = url.host, !parsedHost.isEmpty else {
            return nil
        }
        return url
    }

    // MARK: PDS

    /// Resolve a handle or DID to its PDS endpoint. Nil when the handle does
    /// not resolve, the document cannot be fetched, or it names no PDS.
    public func resolvePDS(_ actor: String) async -> PDSResolution? {
        var did = actor
        if !actor.hasPrefix("did:") {
            guard let resolved = await resolveHandle(actor) else { return nil }
            did = resolved
        }
        guard let doc = await fetchDIDDocument(did), let endpoint = doc.pdsEndpoint else { return nil }
        return PDSResolution(did: did, pdsEndpoint: endpoint, didDoc: doc)
    }

    // MARK: Identifier -> bundle

    /// Normalize a user-supplied identifier (handle, DID, or at:// URI) into
    /// `{ did, handle, pds, repoStatus }`. Throws on failure.
    public func resolveIdentifier(_ input: String) async throws -> IdentityBundle {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { throw IdentityResolverError.emptyInput }

        // at:// shortcut: the repo segment is the identifier.
        var target = trimmed
        if target.hasPrefix("at://") {
            let rest = target.dropFirst("at://".count)
            let repo = rest.prefix { $0 != "/" }
            if !repo.isEmpty {
                target = String(repo)
            }
        }
        // People commonly write handles with the presentation-only @ prefix;
        // the resolvers expect the bare handle.
        if target.hasPrefix("@") {
            target.removeFirst()
        }

        guard let resolved = await resolvePDS(target) else {
            throw IdentityResolverError.unresolvable(trimmed)
        }
        let pdsBase = IdentityResolver.stripTrailingSlash(resolved.pdsEndpoint)

        var handle: String? = nil
        var repoStatus: InactiveRepo? = nil
        do {
            let description = try await pds.describeRepo(pds: pdsBase, repo: resolved.did)
            if let claimed = description.handle, !claimed.isEmpty {
                handle = claimed
            }
        } catch {
            // describeRepo is the explorer's first read into a repo, so it is
            // also where an inactive account first shows up: an opaque 400
            // that names neither the handle nor the reason. Both are still
            // recoverable. The DID document is already in hand and carries
            // the handle, and getRepoStatus answers for repos that refuse
            // every other read.
            handle = resolved.didDoc.handle
            repoStatus = await inspectInactiveRepo(pds: pdsBase, did: resolved.did, cause: error)
        }
        return IdentityBundle(did: resolved.did, handle: handle, pds: pdsBase, repoStatus: repoStatus)
    }

    /// Ask the PDS why a repo read failed. Nil unless the host affirmatively
    /// reports the repo inactive, so an unreachable or broken PDS keeps the
    /// raw error instead of being labelled with a status nobody supplied.
    private func inspectInactiveRepo(pds base: String, did: String, cause: Error) async -> InactiveRepo? {
        guard let status = try? await pds.getRepoStatus(host: base, did: did), status.active == false else {
            return nil
        }
        let reason = status.status.flatMap { $0.isEmpty ? nil : $0 }
        return InactiveRepo(status: reason, error: IdentityResolver.describeFailure(cause))
    }

    /// The message the web's `fetchJson` threw: status, URL and the first
    /// 200 characters of the body, so a `RepoTakendown` body stays visible.
    private static func describeFailure(_ error: Error) -> String {
        if let http = error as? HTTPError {
            return "HTTP \(http.status) for \(http.url.absoluteString) :: \(http.body.prefix(200))"
        }
        return String(describing: error)
    }

    // MARK: DID -> handle

    /// Reverse-resolve a DID to its primary handle (the at:// entry in the
    /// DID document's alsoKnownAs). Cached and de-duped so a record full of
    /// the same DID, or repeated visits, does not re-hit plc.directory or the
    /// did:web host. Nil when the DID has no handle or resolution fails.
    public func resolveDIDHandle(_ did: String) async -> String? {
        guard did.hasPrefix("did:") else { return nil }
        if let cached = await didToHandle.get(did) { return cached }
        let task = await inflight.handleLookup(for: did) { [self] in
            let handle = await fetchDIDDocument(did)?.handle
            await didToHandle.set(did, handle)
            await inflight.finishedHandleLookup(for: did)
            return handle
        }
        return await task.value
    }

    // MARK: Inactive repo rev

    /// The head rev of a repo its own PDS has stopped describing.
    ///
    /// getRepoStatus is implemented by relays as well as by PDSs, and a relay
    /// answers it with the newest rev it holds for the repo: the one piece of
    /// "when did this account last do anything" that survives the account
    /// going inactive. Read it with that caveat attached: it is the relay's
    /// newest rev, not the PDS confirming a commit. Cached and de-duped
    /// because the status banner and the stats grid both want it on the same
    /// screen; nil rather than throwing so either can render without a catch.
    public func inactiveRepoRev(_ did: String) async -> String? {
        if let cached = await repoRev.get(did) { return cached }
        let task = await inflight.revLookup(for: did) { [self] in
            let status = try? await pds.getRepoStatus(host: Endpoints.relay.absoluteString, did: did)
            let rev = status?.rev.flatMap { $0.isEmpty ? nil : $0 }
            await repoRev.set(did, rev)
            await inflight.finishedRevLookup(for: did)
            return rev
        }
        return await task.value
    }

    // MARK: Collections

    /// The collection NSIDs held in a repo. Resolves the DID's PDS and calls
    /// describeRepo. Nil on any failure (unresolvable identity, no PDS,
    /// network error) so callers keep the "unknown" state rather than
    /// treating a failed scan as "this repo has no records". An empty array
    /// is a real answer: the repo exists but holds no collections.
    public func fetchRepoCollections(_ did: String) async -> [String]? {
        guard did.hasPrefix("did:") else { return nil }
        guard let resolved = await resolvePDS(did) else { return nil }
        let base = IdentityResolver.stripTrailingSlash(resolved.pdsEndpoint)
        guard let description = try? await pds.describeRepo(pds: base, repo: resolved.did) else { return nil }
        return description.collections
    }

    private static func stripTrailingSlash(_ s: String) -> String {
        s.hasSuffix("/") ? String(s.dropLast()) : s
    }
}

/// Holds the in-flight tasks the two de-duplicated lookups share, so
/// concurrent callers await one request instead of each making their own.
private actor InflightLookups {
    private var handles: [String: Task<String?, Never>] = [:]
    private var revs: [String: Task<String?, Never>] = [:]

    func handleLookup(for did: String, start: @escaping @Sendable () async -> String?) -> Task<String?, Never> {
        if let existing = handles[did] { return existing }
        let task = Task { await start() }
        handles[did] = task
        return task
    }

    func finishedHandleLookup(for did: String) {
        handles[did] = nil
    }

    func revLookup(for did: String, start: @escaping @Sendable () async -> String?) -> Task<String?, Never> {
        if let existing = revs[did] { return existing }
        let task = Task { await start() }
        revs[did] = task
        return task
    }

    func finishedRevLookup(for did: String) {
        revs[did] = nil
    }
}
