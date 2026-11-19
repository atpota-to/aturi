import Foundation

// Port of src/utils/atproto/lexiconSchemaLookup.ts: the published schema for
// an NSID, the `com.atproto.lexicon.schema` record that defines it in its
// authority's repository. The record validator asks it for every lexicon a
// record turns out to need, and the explorer's record page can ask it for
// the one a record names; both share one instance, so a schema read for one
// is in hand for the other.
//
// Two steps, as on the web:
//
//   1. The authority. The `_lexicon` TXT record on the NSID's domain names
//      its DID (the lexicon resolution spec), read over DNS-over-HTTPS with
//      `DNSTXTClient`. Failing that, the reversed NSID as a handle
//      (`app.bsky.feed.post` -> `bsky.app`), the convention the rest of the
//      lexicons explorer already leans on, resolved through Slingshot.
//   2. The record, at `com.atproto.lexicon.schema/{nsid}` in that repo.
//      Slingshot first, since it is a cache and quick; the authority's own
//      PDS before declaring the schema unpublished, since Slingshot misses
//      records it has never been asked for.
//
// Each answer says how far it got, because "nobody claims this namespace"
// and "its owner never published a schema" are different things to tell a
// reader, and neither is an error: plenty of busy lexicons have no schema
// record.

/// Finds, and keeps, the published schema for an NSID. Use `shared` from
/// screens so the caches are actually shared; `init(http:clock:)` exists for
/// tests.
public actor LexiconSchemaLookup {
    public static let shared = LexiconSchemaLookup()

    /// Where a schema record lives in its publisher's repo.
    public static let collection = "com.atproto.lexicon.schema"

    /// Schemas change rarely, so a found one is kept an hour, which keeps
    /// stepping back and forth through a namespace quick. Every other answer
    /// is kept five minutes: the lookups underneath answer a network failure
    /// the way they answer "not there", and an hour is a long time to repeat
    /// one.
    public static let foundTTL: TimeInterval = 60 * 60
    public static let missingTTL: TimeInterval = 5 * 60

    /// Who answers for a namespace, and how that was learned.
    public struct Authority: Hashable, Sendable {
        public enum Via: String, Hashable, Sendable {
            /// The spec's `_lexicon` DNS record.
            case dns
            /// An account at the handle the NSID reverses to.
            case handle
        }

        public let did: String
        public let via: Via

        public init(did: String, via: Via) {
            self.did = did
            self.via = via
        }
    }

    /// How far a lookup got.
    public enum Answer: Hashable, Sendable {
        /// The schema record, as the repository holds it.
        case found(nsid: String, authority: Authority, uri: String, cid: String, doc: JSONValue)
        /// Nobody answers for the namespace: no TXT record, and no such handle.
        case noAuthority(nsid: String, domain: String, publisher: String)
        /// Somebody does, and has published no schema record for this NSID.
        case unpublished(nsid: String, authority: Authority)
        /// The text is not an NSID at all.
        case invalid(nsid: String)

        /// The answer's kind without its details, the web's `status`.
        public enum Status: String, Hashable, Sendable {
            case found
            case noAuthority = "no-authority"
            case unpublished
            case invalid
        }

        public var status: Status {
            switch self {
            case .found: return .found
            case .noAuthority: return .noAuthority
            case .unpublished: return .unpublished
            case .invalid: return .invalid
            }
        }

        public var nsid: String {
            switch self {
            case .found(let nsid, _, _, _, _): return nsid
            case .noAuthority(let nsid, _, _): return nsid
            case .unpublished(let nsid, _): return nsid
            case .invalid(let nsid): return nsid
            }
        }

        public var isFound: Bool {
            status == .found
        }

        /// The lexicon document, when one was found.
        public var doc: JSONValue? {
            if case .found(_, _, _, _, let doc) = self { return doc }
            return nil
        }

        /// The authority, when one answers for the namespace.
        public var authority: Authority? {
            switch self {
            case .found(_, let authority, _, _, _): return authority
            case .unpublished(_, let authority): return authority
            case .noAuthority, .invalid: return nil
            }
        }
    }

    private let dns: DNSTXTClient
    private let slingshot: SlingshotClient
    private let pds: PDSClient
    private let found: TTLCache<String, Answer>
    private let missing: TTLCache<String, Answer>
    private var inflight: [String: Task<Answer, Never>] = [:]

    public init(http: HTTPClient = .shared, clock: @escaping @Sendable () -> Date = { Date() }) {
        dns = DNSTXTClient(http: http)
        slingshot = SlingshotClient(http: http)
        pds = PDSClient(http: http)
        found = TTLCache(ttl: LexiconSchemaLookup.foundTTL, clock: clock)
        missing = TTLCache(ttl: LexiconSchemaLookup.missingTTL, clock: clock)
    }

    // MARK: Asking

    /// The schema for an NSID, shared between concurrent callers and kept
    /// an hour once found (five minutes when not).
    public func lookup(_ nsid: String) async -> Answer {
        if let hit = await cached(nsid) { return hit }
        if let pending = inflight[nsid] { return await pending.value }
        let task = Task { await self.resolve(nsid) }
        inflight[nsid] = task
        let answer = await task.value
        // Into the cache before the in-flight entry goes, so a caller that
        // arrives in between joins the finished task rather than asking again.
        if answer.isFound {
            await found.set(nsid, answer)
        } else {
            await missing.set(nsid, answer)
        }
        inflight[nsid] = nil
        return answer
    }

    /// An answer already in hand, so a screen opened again draws it at once.
    public func cached(_ nsid: String) async -> Answer? {
        if let hit = await found.get(nsid) { return hit }
        return await missing.get(nsid)
    }

    /// Forget every answer, found or not.
    public func clear() async {
        await found.clear()
        await missing.clear()
    }

    private nonisolated func resolve(_ nsid: String) async -> Answer {
        guard isValidNsid(nsid), let domain = LexiconSchemaLookup.authorityDomain(nsid) else {
            return .invalid(nsid: nsid)
        }
        let publisher = UFOsClient.publisherForNsid(nsid)

        var authority: Authority?
        let probe = await dns.lookup("_lexicon.\(domain)")
        if let did = LexiconSchemaLookup.didFromLexiconRecords(probe.records) {
            authority = Authority(did: did, via: .dns)
        } else if let doc = await slingshot.resolveMiniDoc(publisher) {
            authority = Authority(did: doc.did, via: .handle)
        }
        guard let authority else {
            return .noAuthority(nsid: nsid, domain: domain, publisher: publisher)
        }

        let uri = LexiconSchemaLookup.schemaRecordUri(did: authority.did, nsid: nsid)
        if let cachedRecord = await slingshot.getRecordByUri(uri) {
            return .found(
                nsid: nsid,
                authority: authority,
                uri: cachedRecord.uri.isEmpty ? uri : cachedRecord.uri,
                cid: cachedRecord.cid,
                doc: cachedRecord.value
            )
        }

        if let host = await slingshot.resolveMiniDoc(authority.did), !host.pds.isEmpty {
            // A 400 RecordNotFound is the usual answer here: nothing published.
            let record = try? await pds.getRecord(
                pds: host.pds,
                repo: authority.did,
                collection: LexiconSchemaLookup.collection,
                rkey: nsid
            )
            if let record, !record.value.isNull {
                return .found(
                    nsid: nsid,
                    authority: authority,
                    uri: record.uri.isEmpty ? uri : record.uri,
                    cid: record.cid,
                    doc: record.value
                )
            }
        }
        return .unpublished(nsid: nsid, authority: authority)
    }

    // MARK: Pure helpers

    /// The domain that publishes an NSID's lexicon: every segment but the
    /// last, reversed (`com.atmoboards.forum` -> `atmoboards.com`). Nil for
    /// anything that is not an NSID. `lexiconAuthorityDomain` in
    /// spaceLexicon.ts.
    public static func authorityDomain(_ nsid: String) -> String? {
        guard isValidNsid(nsid) else { return nil }
        let segments = nsid.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        return segments.dropLast().reversed().joined(separator: ".")
    }

    /// The DID the TXT values at `_lexicon.<authority>` name, the first
    /// that reads exactly `did=<did>` (`resolveLexiconDid`). The values
    /// arrive unquoted and joined from `DNSTXTClient`.
    public static func didFromLexiconRecords(_ records: [String]) -> String? {
        for record in records {
            if let match = record.wholeMatch(of: lexiconDidPattern) {
                return String(match.output.1)
            }
        }
        return nil
    }

    /// `at://{did}/com.atproto.lexicon.schema/{nsid}`.
    public static func schemaRecordUri(did: String, nsid: String) -> String {
        "at://\(did)/\(collection)/\(nsid)"
    }
}

/// `^did=(did:[a-z]+:[^\s;]+)$` from spaceLexicon.ts.
private let lexiconDidPattern = #/did=(did:[a-z]+:[^\s;]+)/#
