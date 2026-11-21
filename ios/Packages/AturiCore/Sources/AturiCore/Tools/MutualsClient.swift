import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A failure the mutuals' blocks tool reports in its own words.
public struct MutualsError: Error, Hashable, Sendable, CustomStringConvertible {
    public let message: String

    public init(_ message: String) {
        self.message = message
    }

    public var description: String { message }
}

/// A repository that could not be read, and why, in words for the page.
struct MutualsUnreadable: Error {
    let reason: String
}

/// Set `stop()` to end a scan after the pages already in flight. Read from
/// the tasks reading each mutual, so it is locked.
public final class MutualsStopper: @unchecked Sendable {
    private let lock = NSLock()
    private var flag = false

    public init() {}

    public var isStopped: Bool {
        lock.lock()
        defer { lock.unlock() }
        return flag
    }

    public func stop() {
        lock.lock()
        flag = true
        lock.unlock()
    }
}

/// What reading one mutual's repository found.
public struct MutualsReadResult: Hashable, Sendable {
    /// The accounts it blocks, each once, in the order they were read. The
    /// scanned account itself is left out.
    public var subjects: [String]
    /// The lists it blocks wholesale, each once.
    public var listSubjects: [String]
    /// Block records read, duplicates and malformed ones included.
    public var records: Int
    public var state: MutualsReadState
}

/// What a list is called, who made it and how big it is.
public struct MutualsListInfo: Hashable, Sendable {
    public var uri: String
    public var name: String
    public var description: String?
    public var avatar: String?
    public var memberCount: Int?
    public var creator: MutualsPerson
}

public enum MutualsListDescription: Hashable, Sendable {
    case available(MutualsListInfo)
    /// The AppView will not describe it: deleted, or taken down.
    case unavailable
}

/// The mutuals' blocks tool's requests, port of
/// `src/lib/tools/mutualsClient.ts`. What the answers mean is in `Mutuals`;
/// the run that puts them together is `MutualsModel`.
///
/// Everything goes straight from the device:
///
///   - The public AppView, for the account, its follows and followers,
///     which follows follow back, and what a profile or a list looks like.
///   - Slingshot, for where each mutual's repository lives.
///   - Each mutual's own PDS, for its block and listblock records.
///
/// The cost of a scan lands mostly on the PDSes, a page of a hundred records
/// at a time. They are read a few mutuals at once, and a PDS that says it is
/// busy is waited for rather than pressed.
public struct MutualsClient: Sendable {
    /// Pages of one repository's listblocks read at most. A thousand lists
    /// is far more than anyone blocks.
    public static let listBlockPageLimit = 10
    /// The longest a PDS's "try again later" is waited out, and how often.
    public static let rateLimitWait: TimeInterval = 60
    public static let rateLimitRetries = 2
    /// `getProfiles` and `getList` requests at once.
    public static let appViewConcurrency = 4
    /// `getProfiles` takes at most this many actors a request.
    public static let profilesChunk = 25

    static let repoErrors: [String: String] = [
        "RepoNotFound": "its repository is gone",
        "RepoDeactivated": "the account is deactivated",
        "RepoTakendown": "the account was taken down",
        "RepoSuspended": "the account is suspended",
    ]

    private let http: HTTPClient
    private let resolver: IdentityResolver
    private let appView: URL
    private let slingshot: SlingshotClient
    private let sleep: @Sendable (TimeInterval) async throws -> Void
    private let now: @Sendable () -> Date

    /// - Parameters:
    ///   - sleep: how a rate limit is waited out; tests pass one that returns at once.
    ///   - now: the clock a `ratelimit-reset` is read against.
    public init(
        http: HTTPClient = .shared,
        resolver: IdentityResolver? = nil,
        appView: URL = Endpoints.appView,
        sleep: @escaping @Sendable (TimeInterval) async throws -> Void = { seconds in
            try await Task.sleep(nanoseconds: UInt64(max(0, seconds) * 1_000_000_000))
        },
        now: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.http = http
        self.resolver = resolver ?? (http === HTTPClient.shared ? .shared : IdentityResolver(http: http))
        self.appView = appView
        slingshot = SlingshotClient(http: http)
        self.sleep = sleep
        self.now = now
    }

    // MARK: - Fetching

    /// One answer, whatever it was. `status` 0 means none arrived (or a
    /// redirect was refused, which a PDS never needs).
    struct Answer: Sendable {
        var ok: Bool
        var status: Int
        var body: JSONValue?
        var error: String?
        var message: String?
        var resetAt: Date?
    }

    func get(_ url: URL, refuseRedirects: Bool) async throws -> Answer {
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        if refuseRedirects {
            // A PDS address comes from a DID document anyone can write; a PDS
            // answering XRPC never needs to redirect, so a redirect is refused.
            request.setValue("1", forHTTPHeaderField: URLSessionTransport.noRedirectHeader)
        }
        let result: (Data, HTTPURLResponse)
        do {
            result = try await http.send(request)
        } catch {
            if error is CancellationError || Task.isCancelled { throw CancellationError() }
            return Answer(ok: false, status: 0)
        }
        let (data, response) = result
        let status = response.statusCode
        if (300..<400).contains(status) {
            return Answer(ok: false, status: 0)
        }
        if (200..<300).contains(status) {
            guard let body = try? JSONValue.parse(data) else {
                return Answer(ok: false, status: status, message: "The answer was not JSON.")
            }
            return Answer(ok: true, status: status, body: body)
        }
        let body = try? JSONValue.parse(data)
        let message = body?["message"]?.stringValue
        return Answer(
            ok: false,
            status: status,
            body: nil,
            error: body?["error"]?.stringValue,
            message: (message?.isEmpty ?? true) ? nil : message,
            resetAt: status == 429 ? resetFrom(response) : nil
        )
    }

    /// When a 429 says to come back.
    private func resetFrom(_ response: HTTPURLResponse) -> Date? {
        if let reset = HTTPClient.header("ratelimit-reset", in: response).flatMap({ Double($0.trimmingCharacters(in: .whitespaces)) }),
           reset > 0 {
            return Date(timeIntervalSince1970: reset)
        }
        if let after = HTTPClient.header("retry-after", in: response).flatMap({ Double($0.trimmingCharacters(in: .whitespaces)) }),
           after > 0 {
            return self.now().addingTimeInterval(after)
        }
        return nil
    }

    /// A query to the AppView that has to succeed. One retry for a dropped
    /// connection or a 5xx.
    func appview(_ nsid: String, _ query: [(String, String)], what: String) async throws -> JSONValue {
        let url = makeURL(appView, path: "/xrpc/\(nsid)", query: query)
        var answer = try await get(url, refuseRedirects: false)
        if !answer.ok, answer.status == 0 || answer.status >= 500 {
            answer = try await get(url, refuseRedirects: false)
        }
        if answer.ok, let body = answer.body { return body }
        if let message = answer.message {
            throw MutualsError("Bluesky\u{2019}s AppView did not answer while \(what): \(message)")
        }
        throw MutualsError("Bluesky\u{2019}s AppView did not answer while \(what).")
    }

    // MARK: - The account and its mutuals

    /// A handle or DID as typed, resolved to a DID. Nil when it does not resolve.
    public func resolveActor(_ actor: String) async -> String? {
        if actor.hasPrefix("did:") {
            return isValidDid(actor) ? actor : nil
        }
        guard let did = await resolver.resolveHandle(actor), isValidDid(did) else { return nil }
        return did
    }

    /// The account, with how many it follows and how many follow it.
    public func loadAccount(_ actor: String) async throws -> (account: MutualsPerson, followsCount: Int, followersCount: Int) {
        guard let did = await resolveActor(actor) else {
            if Task.isCancelled { throw CancellationError() }
            throw MutualsError("\(actor) does not resolve to an account. Check the spelling, or use its DID.")
        }
        let answer = try await get(makeURL(appView, path: "/xrpc/app.bsky.actor.getProfile", query: [("actor", did)]), refuseRedirects: false)
        guard answer.ok, let view = answer.body else {
            if answer.status == 400 {
                throw MutualsError("Bluesky\u{2019}s AppView has no profile for this account, so it cannot say who its mutuals are.")
            }
            throw MutualsError("Bluesky\u{2019}s AppView did not answer. Try again in a moment.")
        }
        let account = MutualsPerson(profile: view, did: did) ?? MutualsPerson(did: did)
        // The DID asked about, whatever the view says.
        let named = MutualsPerson(did: did, handle: account.handle, displayName: account.displayName, avatar: account.avatar)
        return (named, view["followsCount"]?.intValue ?? 0, view["followersCount"]?.intValue ?? 0)
    }

    /// One page of who the account follows, with their profiles.
    public func followsPage(_ did: String, cursor: String?) async throws -> (people: [MutualsPerson], cursor: String?) {
        var query = [("actor", did), ("limit", String(Mutuals.graphPageSize))]
        if let cursor { query.append(("cursor", cursor)) }
        let body = try await appview("app.bsky.graph.getFollows", query, what: "listing who this account follows")
        let people = (body["follows"]?.arrayValue ?? []).compactMap { MutualsPerson(profile: $0) }
        let next = body["cursor"]?.stringValue
        return (people, (people.isEmpty || (next?.isEmpty ?? true)) ? nil : next)
    }

    /// One page of who follows the account, by DID.
    public func followersPage(_ did: String, cursor: String?) async throws -> (dids: [String], cursor: String?) {
        var query = [("actor", did), ("limit", String(Mutuals.graphPageSize))]
        if let cursor { query.append(("cursor", cursor)) }
        let body = try await appview("app.bsky.graph.getFollowers", query, what: "listing this account\u{2019}s followers")
        let dids = (body["followers"]?.arrayValue ?? []).compactMap { $0["did"]?.stringValue }.filter { !$0.isEmpty }
        let next = body["cursor"]?.stringValue
        return (dids, (dids.isEmpty || (next?.isEmpty ?? true)) ? nil : next)
    }

    /// Which of `others` (at most thirty) follow the account.
    public func followBacks(_ did: String, others: [String]) async throws -> [String] {
        let query = [("actor", did)] + others.map { ("others", $0) }
        let body = try await appview("app.bsky.graph.getRelationships", query, what: "checking which follows follow back")
        var back: [String] = []
        for relationship in body["relationships"]?.arrayValue ?? [] {
            guard let other = relationship["did"]?.stringValue, !other.isEmpty,
                  let followedBy = relationship["followedBy"]?.stringValue, !followedBy.isEmpty
            else { continue }
            back.append(other)
        }
        return back
    }

    // MARK: - Reading a repository

    /// Where a repository lives. Only an https PDS is read.
    func pdsFor(_ did: String) async throws -> URL {
        let doc = await slingshot.resolveMiniDoc(did)
        if Task.isCancelled { throw CancellationError() }
        guard let pds = doc?.pds, !pds.isEmpty else {
            throw MutualsUnreadable(reason: "its identity did not resolve")
        }
        guard let components = URLComponents(string: pds), let host = components.host, !host.isEmpty else {
            throw MutualsUnreadable(reason: "its PDS address is not a URL")
        }
        guard components.scheme?.lowercased() == "https" else {
            throw MutualsUnreadable(reason: "its PDS is not served over https")
        }
        var origin = URLComponents()
        origin.scheme = "https"
        origin.host = host
        origin.port = components.port
        guard let url = origin.url else {
            throw MutualsUnreadable(reason: "its PDS address is not a URL")
        }
        return url
    }

    /// Read every record in one collection of a repository, a page at a
    /// time, handing each page's values to `onPage`. Waits out a PDS's rate
    /// limit a couple of times before giving up on it. Stops early when the
    /// stopper is set, with what was read so far kept.
    func readCollection(
        pds: URL,
        did: String,
        collection: String,
        stopper: MutualsStopper,
        pageLimit: Int = Int.max,
        onPage: ([JSONValue]) -> Void
    ) async throws {
        var cursor: String?
        var page = 0
        while page < pageLimit {
            if stopper.isStopped { return }
            var query = [("repo", did), ("collection", collection), ("limit", "100")]
            if let cursor { query.append(("cursor", cursor)) }
            let url = makeURL(pds, path: "/xrpc/com.atproto.repo.listRecords", query: query)

            var answer = try await get(url, refuseRedirects: true)
            var retry = 0
            while !answer.ok, retry < Self.rateLimitRetries {
                if answer.status == 429 {
                    let wait = answer.resetAt.map { $0.timeIntervalSince(self.now()) } ?? 10
                    if wait > Self.rateLimitWait { break }
                    try await self.sleep(max(1, wait))
                } else if answer.status == 0 || answer.status >= 500 {
                    try await self.sleep(Double(retry + 1))
                } else {
                    break
                }
                if stopper.isStopped { return }
                answer = try await get(url, refuseRedirects: true)
                retry += 1
            }
            if !answer.ok {
                if let error = answer.error, let reason = Self.repoErrors[error] {
                    throw MutualsUnreadable(reason: reason)
                }
                if answer.status == 429 { throw MutualsUnreadable(reason: "its PDS asked to slow down") }
                if answer.status == 0 { throw MutualsUnreadable(reason: "its PDS did not answer") }
                let detail = answer.message.map { " (\($0))" } ?? ""
                throw MutualsUnreadable(reason: "its PDS answered \(answer.status)\(detail)")
            }
            let records = answer.body?["records"]?.arrayValue ?? []
            onPage(records.map { $0["value"] ?? .null })
            guard let next = answer.body?["cursor"]?.stringValue, !next.isEmpty, !records.isEmpty else { return }
            cursor = next
            page += 1
        }
    }

    /// Read one mutual's blocks and the lists it blocks. Never fails for the
    /// repository's sake: an unreadable one comes back skipped, with why.
    /// Throws only when the task is cancelled.
    ///
    /// - Parameter onProgress: accounts counted and records read so far,
    ///   after each page.
    public func readMutual(
        _ did: String,
        scanned: String,
        stopper: MutualsStopper,
        onProgress: @escaping @Sendable (_ blocks: Int, _ records: Int) -> Void = { _, _ in }
    ) async throws -> MutualsReadResult {
        var seen = Set<String>()
        var subjects: [String] = []
        var records = 0
        var lists = Set<String>()
        var listSubjects: [String] = []
        let state: MutualsReadState
        do {
            let pds = try await pdsFor(did)
            try await readCollection(pds: pds, did: did, collection: Mutuals.blockCollection, stopper: stopper) { values in
                for value in values {
                    guard let subject = Mutuals.readBlockSubject(value), subject != scanned else { continue }
                    if seen.insert(subject).inserted {
                        subjects.append(subject)
                    }
                }
                records += values.count
                onProgress(subjects.count, records)
            }
            try await readCollection(
                pds: pds,
                did: did,
                collection: Mutuals.listBlockCollection,
                stopper: stopper,
                pageLimit: Self.listBlockPageLimit
            ) { values in
                for value in values {
                    guard let subject = Mutuals.readListBlockSubject(value) else { continue }
                    if lists.insert(subject).inserted {
                        listSubjects.append(subject)
                    }
                }
            }
            if stopper.isStopped {
                state = .skipped(blocks: subjects.count, reason: "stopped before it was read to the end", stopped: true)
            } else {
                state = .done(blocks: subjects.count, listBlocks: lists.count)
            }
        } catch let unreadable as MutualsUnreadable {
            state = .skipped(blocks: subjects.count, reason: unreadable.reason, stopped: false)
        } catch {
            if error is CancellationError || Task.isCancelled { throw CancellationError() }
            state = .skipped(blocks: subjects.count, reason: "its repository could not be read", stopped: false)
        }
        return MutualsReadResult(subjects: subjects, listSubjects: listSubjects, records: records, state: state)
    }

    /// Every account the scanned one blocks, or nil when its repository
    /// could not be read. These only mark which results it has already
    /// dealt with, so a failure costs nothing.
    public func readOwnBlocks(_ did: String) async -> Set<String>? {
        do {
            let pds = try await pdsFor(did)
            var blocks = Set<String>()
            try await readCollection(pds: pds, did: did, collection: Mutuals.blockCollection, stopper: MutualsStopper()) { values in
                for value in values {
                    if let subject = Mutuals.readBlockSubject(value) {
                        blocks.insert(subject)
                    }
                }
            }
            return blocks
        } catch {
            return nil
        }
    }

    // MARK: - Describing what the page shows

    /// Profiles for some accounts, keyed by DID. An account the AppView
    /// does not know is absent; one in a chunk that failed is absent too,
    /// but listed in `failed` so it is not called missing.
    public func loadProfiles(_ dids: [String]) async -> (profiles: [String: MutualsPerson], failed: Set<String>) {
        let chunks = Mutuals.chunk(dids, size: Self.profilesChunk)
        let appView = self.appView
        let answers = (try? await SlingshotClient.mapWithConcurrency(chunks, limit: Self.appViewConcurrency) { chunk, _ in
            try await self.get(makeURL(appView, path: "/xrpc/app.bsky.actor.getProfiles", query: chunk.map { ("actors", $0) }), refuseRedirects: false)
        }) ?? []
        var profiles: [String: MutualsPerson] = [:]
        var failed = Set<String>()
        for (index, chunk) in chunks.enumerated() {
            guard index < answers.count, answers[index].ok, let body = answers[index].body else {
                failed.formUnion(chunk)
                continue
            }
            for view in body["profiles"]?.arrayValue ?? [] {
                if let person = MutualsPerson(profile: view) {
                    profiles[person.did] = person
                }
            }
        }
        return (profiles, failed)
    }

    /// What each list is called, who made it and how big it is.
    public func describeLists(_ uris: [String]) async -> [String: MutualsListDescription] {
        let appView = self.appView
        let answers = (try? await SlingshotClient.mapWithConcurrency(uris, limit: Self.appViewConcurrency) { uri, _ in
            try await self.get(makeURL(appView, path: "/xrpc/app.bsky.graph.getList", query: [("list", uri), ("limit", "1")]), refuseRedirects: false)
        }) ?? []
        var out: [String: MutualsListDescription] = [:]
        for (index, uri) in uris.enumerated() {
            guard index < answers.count, answers[index].ok,
                  let list = answers[index].body?["list"],
                  let creator = MutualsPerson(profile: list["creator"])
            else {
                out[uri] = .unavailable
                continue
            }
            let name = list["name"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            let description = list["description"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            out[uri] = .available(MutualsListInfo(
                uri: uri,
                name: name.isEmpty ? "Untitled list" : name,
                description: description.isEmpty ? nil : description,
                avatar: Mutuals.avatarThumb(list["avatar"]?.stringValue),
                memberCount: list["listItemCount"]?.intValue,
                creator: creator
            ))
        }
        return out
    }
}
