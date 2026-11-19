import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

extension Shadowban.Identity {
    /// The explorer has already resolved the account; its bundle names the
    /// same DID, handle and PDS the web's run reads from the DID document.
    public init(bundle: IdentityBundle) {
        self.init(did: bundle.did, handle: bundle.handle, pds: bundle.pds)
    }
}

/// The shadowban checker's requests, port of
/// `src/lib/tools/shadowbanClient.ts`. What the answers mean is in
/// `Shadowban`.
///
///   - The account's identity: the handle resolved and the DID document
///     read, for where its repository lives. Skipped when the caller
///     already holds the identity, as the explorer does.
///   - Its PDS, for the repository as it is.
///   - The AppView being checked, asked logged out for the same records.
///   - Slingshot, for a thread's reply rules, and Constellation, for blocks:
///     both only for a reply the AppView left out, to see whether something
///     anyone can see explains it.
public struct ShadowbanClient: Sendable {
    /// Threads opened at once.
    static let threadConcurrency = 4

    private let http: HTTPClient
    private let resolver: IdentityResolver
    private let pds: PDSClient
    private let slingshot: URL
    private let constellation: URL

    public init(
        http: HTTPClient = .shared,
        resolver: IdentityResolver? = nil,
        slingshot: URL = Endpoints.slingshot,
        constellation: URL = Endpoints.constellation
    ) {
        self.http = http
        self.resolver = resolver ?? (http === HTTPClient.shared ? .shared : IdentityResolver(http: http))
        pds = PDSClient(http: http)
        self.slingshot = slingshot
        self.constellation = constellation
    }

    // MARK: - Answers

    /// An AppView's answer: the body, or the status and the words it gave.
    /// A status of 0 is a request that never got an answer.
    enum XrpcAnswer: Sendable {
        case ok(JSONValue)
        case failed(status: Int, error: String?, message: String?)
    }

    /// A query to the AppView. A failure is an answer too.
    func xrpc(_ origin: String, _ nsid: String, _ params: [(String, String)]) async -> XrpcAnswer {
        guard let base = URL(string: origin) else {
            return .failed(status: 0, error: nil, message: nil)
        }
        let url = makeURL(base, path: "/xrpc/\(nsid)", query: params)
        let data: Data
        do {
            let response = try await http.get(url)
            data = response.0
        } catch let error as HTTPError {
            let body = try? JSONValue.parse(Data(error.body.utf8))
            let message = body?["message"]?.stringValue
            return .failed(
                status: error.status,
                error: body?["error"]?.stringValue,
                message: (message?.isEmpty ?? true) ? nil : message
            )
        } catch {
            return .failed(status: 0, error: nil, message: nil)
        }
        guard let json = try? JSONValue.parse(data) else {
            return .failed(status: 200, error: nil, message: "the answer was not JSON")
        }
        return .ok(json)
    }

    /// What went wrong, in a few words. The web's words for a request that
    /// got no answer blame the browser; here there is none to blame.
    static func failureWords(status: Int, error: String?, message: String?) -> String {
        if status == 0 { return "the host is down, or didn’t answer" }
        if let message { return message }
        if let error, !error.isEmpty { return error }
        return "HTTP \(status)"
    }

    static func failureWords(_ answer: XrpcAnswer) -> String {
        switch answer {
        case .ok: return ""
        case .failed(let status, let error, let message): return failureWords(status: status, error: error, message: message)
        }
    }

    static func pdsFailure(_ error: Error) -> String {
        if let http = error as? HTTPError { return "HTTP \(http.status)" }
        return "no answer"
    }

    // MARK: - The account and its repository

    /// The account typed, resolved to its DID and PDS. Throws when there is
    /// no account to check.
    public func resolveIdentity(_ actor: String) async throws -> Shadowban.Identity {
        let resolved: String?
        if actor.hasPrefix("did:") {
            resolved = actor
        } else {
            resolved = await resolver.resolveHandle(actor)
        }
        guard let did = resolved, isValidDid(did) else {
            throw AccountCheckError("\(actor) doesn’t match any account. Check the spelling, or use its DID.")
        }
        let document: DIDDocument
        do {
            document = try await resolver.loadDIDDocument(did)
        } catch {
            try Task.checkCancellation()
            throw AccountCheckError("Couldn’t read the DID document for \(did), so its PDS is unknown.")
        }
        guard let endpoint = document.pdsEndpoint else {
            throw AccountCheckError("The DID document for \(did) doesn’t list a PDS, so there are no posts to compare.")
        }
        let pdsOrigin = endpoint.hasSuffix("/") ? String(endpoint.dropLast()) : endpoint
        let handle = actor.hasPrefix("did:") ? document.handle?.lowercased() : actor
        return Shadowban.Identity(did: did, handle: handle, pds: pdsOrigin)
    }

    func readRepo(_ identity: Shadowban.Identity) async -> Shadowban.RepoState {
        do {
            let status = try await pds.getRepoStatus(host: identity.pds, did: identity.did)
            return status.active ? .active : .inactive(status: status.status)
        } catch {
            return .unknown(message: Self.pdsFailure(error))
        }
    }

    func readRecentPosts(_ identity: Shadowban.Identity) async -> Shadowban.Probe<[Shadowban.RepoPost]> {
        do {
            // listRecords lists newest first by record key, which for a post
            // is the time it was written.
            let page = try await pds.listRecordsPage(
                pds: identity.pds,
                repo: identity.did,
                collection: Shadowban.postCollection,
                limit: Shadowban.recentPosts
            )
            return .ok(page.records.map { Shadowban.readRepoPost($0) })
        } catch {
            return .failed(Self.pdsFailure(error))
        }
    }

    /// The one post asked about, or `.ok(nil)` when the repository has no such record.
    func readOnePost(_ identity: Shadowban.Identity, rkey: String) async -> Shadowban.Probe<Shadowban.RepoPost?> {
        do {
            let record = try await pds.getRecord(pds: identity.pds, repo: identity.did, collection: Shadowban.postCollection, rkey: rkey)
            return .ok(Shadowban.readRepoPost(record))
        } catch let error as HTTPError where error.status == 400 || error.status == 404 {
            return .ok(nil)
        } catch {
            return .failed(Self.pdsFailure(error))
        }
    }

    // MARK: - The AppView

    func readProfile(origin: String, did: String) async -> Shadowban.ProfileState {
        let answer = await xrpc(origin, "app.bsky.actor.getProfile", [("actor", did)])
        switch answer {
        case .failed(let status, let error, let message):
            if status == 0 {
                return .error(message: Self.failureWords(status: status, error: error, message: message))
            }
            return Shadowban.readProfileFailure(status: status, error: error, message: message)
        case .ok(let profile):
            let handle = profile["handle"]?.stringValue
            let displayName = profile["displayName"]?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines)
            var labels: [Shadowban.ProfileLabel] = []
            for label in profile["labels"]?.arrayValue ?? [] {
                if let val = label["val"]?.stringValue, let src = label["src"]?.stringValue {
                    labels.append(Shadowban.ProfileLabel(val: val, src: src))
                }
            }
            return .found(Shadowban.FoundProfile(
                handle: (handle?.isEmpty ?? true) || handle == "handle.invalid" ? nil : handle,
                displayName: (displayName?.isEmpty ?? true) ? nil : displayName,
                avatar: profile["avatar"]?.stringValue,
                labels: labels
            ))
        }
    }

    private static func postUris(_ body: JSONValue) -> [String] {
        (body["posts"]?.arrayValue ?? []).compactMap { $0["uri"]?.stringValue }
    }

    /// Which of the posts the AppView returns. One request: getPosts takes up to 25.
    func readShown(origin: String, posts: [Shadowban.RepoPost]) async -> Shadowban.Probe<[String]> {
        let answer = await xrpc(origin, "app.bsky.feed.getPosts", posts.map { ("uris", $0.uri) })
        switch answer {
        case .failed:
            return .failed(Self.failureWords(answer))
        case .ok(let body):
            return .ok(Self.postUris(body))
        }
    }

    // MARK: - Replies

    /// Ask for the parent's thread, one level down, and look for the reply in it.
    func findInThread(origin: String, post: Shadowban.RepoPost) async -> Shadowban.ReplyProbe {
        let parent = post.reply?.parent ?? ""
        let root = post.reply?.root ?? parent
        let answer = await xrpc(origin, "app.bsky.feed.getPostThread", [("uri", parent), ("depth", "1"), ("parentHeight", "0")])
        switch answer {
        case .failed(_, let error, _):
            if error == "NotFound" {
                return Shadowban.ReplyProbe(uri: post.uri, parent: parent, root: root, thread: .noParent)
            }
            return Shadowban.ReplyProbe(uri: post.uri, parent: parent, root: root, thread: .error, message: Self.failureWords(answer))
        case .ok(let body):
            let thread = body["thread"]
            guard thread?["$type"]?.stringValue == "app.bsky.feed.defs#threadViewPost" else {
                return Shadowban.ReplyProbe(uri: post.uri, parent: parent, root: root, thread: .noParent)
            }
            return Shadowban.ReplyProbe(
                uri: post.uri,
                parent: parent,
                root: root,
                thread: Shadowban.placeReply(post.uri, replies: thread?["replies"])
            )
        }
    }

    /// The thread's reply rules, from the threadgate record beside its root,
    /// read through Slingshot as the post inspector reads it. No record is
    /// the ordinary case and means anyone may reply.
    func readGate(_ reply: Shadowban.ReplyProbe) async -> Shadowban.Lookup<Shadowban.ThreadGate> {
        guard reply.root.hasPrefix("at://") else { return .unanswered }
        let parts = reply.root.dropFirst("at://".count).split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 3, parts.allSatisfy({ !$0.isEmpty }) else { return .unanswered }
        let gate = "at://\(parts[0])/app.bsky.feed.threadgate/\(parts[2])"
        let url = makeURL(slingshot, path: "/xrpc/blue.microcosm.repo.getRecordByUri", query: [("at_uri", gate)])
        do {
            let body = try await http.getJSONValue(from: url)
            let value = body["value"]
            // `allow` absent means anyone may reply; any list, even an empty one, limits it.
            let restricted = value?["allow"]?.arrayValue != nil
            let hidden = value?["hiddenReplies"]?.arrayValue?.contains(where: { $0.stringValue == reply.uri }) ?? false
            return .answered(Shadowban.ThreadGate(restricted: restricted, hidden: hidden))
        } catch let error as HTTPError where error.status == 400 || error.status == 404 {
            return .answered(Shadowban.ThreadGate(restricted: false, hidden: false))
        } catch {
            return .unanswered
        }
    }

    /// Whether `blocker` has a block record naming `blocked`, from
    /// Constellation. Nil when it did not answer.
    func hasBlocked(blocker: String, blocked: String) async -> Bool? {
        let url = makeURL(constellation, path: "/xrpc/blue.microcosm.links.getBacklinks", query: [
            ("subject", blocked),
            ("source", "app.bsky.graph.block:subject"),
            ("did", blocker),
            ("limit", "1"),
        ])
        guard let body = try? await http.getJSONValue(from: url) else { return nil }
        let total = body["total"]?.doubleValue ?? 0
        let records = body["records"]?.arrayValue?.count ?? 0
        return total > 0 || records > 0
    }

    /// A block either way between the replier and the authors of the parent
    /// and the root. Blocks made by subscribing to a moderation list are not
    /// records naming the account, so they are not found here.
    func readBlock(_ reply: Shadowban.ReplyProbe, author: String) async -> Shadowban.Lookup<Shadowban.BlockLookup> {
        var others: [String] = []
        for did in [Shadowban.authorOf(reply.parent), Shadowban.authorOf(reply.root)] where !did.isEmpty && did != author && !others.contains(did) {
            others.append(did)
        }
        if others.isEmpty { return .answered(Shadowban.BlockLookup(found: false)) }
        let client = self
        var answers: [Bool?] = []
        await withTaskGroup(of: Bool?.self) { group in
            for other in others {
                group.addTask { await client.hasBlocked(blocker: author, blocked: other) }
                group.addTask { await client.hasBlocked(blocker: other, blocked: author) }
            }
            while let answer = await group.next() {
                answers.append(answer)
            }
        }
        if answers.contains(where: { $0 == true }) { return .answered(Shadowban.BlockLookup(found: true)) }
        if answers.contains(where: { $0 == nil }) { return .unanswered }
        return .answered(Shadowban.BlockLookup(found: false))
    }

    private enum ReplyPiece: Sendable {
        case gate(Shadowban.Lookup<Shadowban.ThreadGate>)
        case block(Shadowban.Lookup<Shadowban.BlockLookup>)
    }

    /// One reply: where it is in its thread and, when it is absent, the
    /// reply rules and blocks that might explain it, looked up side by side.
    func probeReply(origin: String, author: String, reply: Shadowban.RepoPost) async -> Shadowban.ReplyProbe {
        var probe = await findInThread(origin: origin, post: reply)
        guard probe.thread == .absent else { return probe }
        let client = self
        let absent = probe
        await withTaskGroup(of: ReplyPiece.self) { group in
            group.addTask { .gate(await client.readGate(absent)) }
            group.addTask { .block(await client.readBlock(absent, author: author)) }
            while let piece = await group.next() {
                switch piece {
                case .gate(let gate): probe.gate = gate
                case .block(let block): probe.block = block
                }
            }
        }
        return probe
    }

    /// The replies, a few threads at a time, in the order given.
    func checkReplies(origin: String, author: String, replies: [Shadowban.RepoPost]) async -> Shadowban.Probe<[Shadowban.ReplyProbe]> {
        let client = self
        var results = [Shadowban.ReplyProbe?](repeating: nil, count: replies.count)
        await withTaskGroup(of: (Int, Shadowban.ReplyProbe).self) { group in
            var next = 0
            while next < min(Self.threadConcurrency, replies.count) {
                let index = next
                let reply = replies[index]
                next += 1
                group.addTask {
                    let probe = await client.probeReply(origin: origin, author: author, reply: reply)
                    return (index, probe)
                }
            }
            while let finished = await group.next() {
                results[finished.0] = finished.1
                if next < replies.count {
                    let index = next
                    let reply = replies[index]
                    next += 1
                    group.addTask {
                        let probe = await client.probeReply(origin: origin, author: author, reply: reply)
                        return (index, probe)
                    }
                }
            }
        }
        return .ok(results.compactMap { $0 })
    }

    // MARK: - Search

    func searchActor(origin: String, identity: Shadowban.Identity) async -> Shadowban.Probe<Shadowban.ActorSearch> {
        let handle = identity.handle ?? ""
        let client = self
        var search: XrpcAnswer = .failed(status: 0, error: nil, message: nil)
        var typeahead: XrpcAnswer = .failed(status: 0, error: nil, message: nil)
        await withTaskGroup(of: (Bool, XrpcAnswer).self) { group in
            group.addTask {
                let answer = await client.xrpc(origin, "app.bsky.actor.searchActors", [("q", handle), ("limit", "25")])
                return (true, answer)
            }
            group.addTask {
                let answer = await client.xrpc(origin, "app.bsky.actor.searchActorsTypeahead", [("q", handle), ("limit", "10")])
                return (false, answer)
            }
            while let finished = await group.next() {
                if finished.0 {
                    search = finished.1
                } else {
                    typeahead = finished.1
                }
            }
        }
        func has(_ body: JSONValue) -> Bool {
            (body["actors"]?.arrayValue ?? []).contains(where: { $0["did"]?.stringValue == identity.did })
        }
        guard case .ok(let searchBody) = search else {
            return .failed(Self.failureWords(search))
        }
        var inTypeahead: Bool? = nil
        if case .ok(let typeaheadBody) = typeahead {
            inTypeahead = has(typeaheadBody)
        }
        return .ok(Shadowban.ActorSearch(inSearch: has(searchBody), inTypeahead: inTypeahead))
    }

    /// The account's latest posts in post search. `q` is required, and `*`
    /// with an `author` lists everything that author has in the index.
    func searchPosts(origin: String, did: String) async -> Shadowban.Probe<[String]> {
        let answer = await xrpc(origin, "app.bsky.feed.searchPosts", [
            ("q", "*"),
            ("author", did),
            ("sort", "latest"),
            ("limit", String(Shadowban.recentPosts)),
        ])
        switch answer {
        case .failed:
            return .failed(Self.failureWords(answer))
        case .ok(let body):
            return .ok(Self.postUris(body))
        }
    }

    // MARK: - The run

    /// One part of the evidence, as it arrives.
    enum Step: Sendable {
        case repo(Shadowban.RepoState)
        case profile(Shadowban.ProfileState)
        case posts(Shadowban.Probe<[Shadowban.RepoPost]>)
        case shown(Shadowban.Probe<[String]>)
        case replies(Shadowban.Probe<[Shadowban.ReplyProbe]>)
        case postSearch(Shadowban.Probe<[String]>)
        case actorSearch(Shadowban.Probe<Shadowban.ActorSearch>)
        case post(Shadowban.Probe<Shadowban.RepoPost?>)
        case postShown(Shadowban.Probe<[String]>)
        case postThread(Shadowban.Probe<Shadowban.ReplyProbe>)
    }

    /// The requests of a run, side by side as `investigate` does them on the
    /// web: the repo status, the profile, the recent posts (then which of
    /// them the AppView returns, then the threads of the replies among
    /// those), post search, account search when there is a handle, and the
    /// one post when a post was asked about. Every answer goes to
    /// `continuation`, which is finished when all are in.
    private func gather(
        target: Shadowban.ShadowbanTarget,
        origin: String,
        identity: Shadowban.Identity,
        into continuation: AsyncStream<Step>.Continuation
    ) async {
        let client = self
        await withTaskGroup(of: Void.self) { group in
            group.addTask {
                let repo = await client.readRepo(identity)
                continuation.yield(.repo(repo))
            }
            group.addTask {
                let profile = await client.readProfile(origin: origin, did: identity.did)
                continuation.yield(.profile(profile))
            }
            group.addTask {
                let posts = await client.readRecentPosts(identity)
                continuation.yield(.posts(posts))
                guard case .ok(let list) = posts, !list.isEmpty else { return }
                let shown = await client.readShown(origin: origin, posts: list)
                continuation.yield(.shown(shown))
                guard case .ok(let uris) = shown else { return }
                let replies = await client.checkReplies(
                    origin: origin,
                    author: identity.did,
                    replies: Shadowban.repliesToCheck(list, shown: uris)
                )
                continuation.yield(.replies(replies))
            }
            group.addTask {
                let postSearch = await client.searchPosts(origin: origin, did: identity.did)
                continuation.yield(.postSearch(postSearch))
            }
            if let handle = identity.handle, !handle.isEmpty {
                group.addTask {
                    let actorSearch = await client.searchActor(origin: origin, identity: identity)
                    continuation.yield(.actorSearch(actorSearch))
                }
            }
            if case .post(_, let rkey) = target {
                group.addTask {
                    let post = await client.readOnePost(identity, rkey: rkey)
                    continuation.yield(.post(post))
                    guard case .ok(let found) = post, let record = found else { return }
                    let postShown = await client.readShown(origin: origin, posts: [record])
                    continuation.yield(.postShown(postShown))
                    guard case .ok(let uris) = postShown, uris.contains(record.uri), record.reply != nil else { return }
                    let probes = await client.checkReplies(origin: origin, author: identity.did, replies: [record])
                    switch probes {
                    case .ok(let list):
                        if let first = list.first {
                            continuation.yield(.postThread(.ok(first)))
                        }
                    case .failed(let message):
                        continuation.yield(.postThread(.failed(message)))
                    }
                }
            }
        }
        continuation.finish()
    }

    private static func apply(_ step: Step, to evidence: inout Shadowban.Evidence) {
        switch step {
        case .repo(let value): evidence.repo = value
        case .profile(let value): evidence.profile = value
        case .posts(let value): evidence.posts = value
        case .shown(let value): evidence.shown = value
        case .replies(let value): evidence.replies = value
        case .postSearch(let value): evidence.postSearch = value
        case .actorSearch(let value): evidence.actorSearch = value
        case .post(let value): evidence.post = value
        case .postShown(let value): evidence.postShown = value
        case .postThread(let value): evidence.postThread = value
        }
    }

    /// Gather the evidence for an account, publishing as each part arrives so
    /// the six checks fill in step by step. When a post was asked about, its
    /// author is checked in full and the post on its own alongside. Only an
    /// account that cannot be found is thrown; every other failure is
    /// recorded as evidence. Cancelling the task stops every request.
    ///
    /// `identity` skips the resolution when the caller already holds it.
    /// Runs on the main actor so `publish` can hand each snapshot straight
    /// to a view model; the requests themselves run off it.
    @MainActor
    public func investigate(
        target: Shadowban.ShadowbanTarget,
        appview: Shadowban.AppView = Shadowban.defaultAppView,
        identity known: Shadowban.Identity? = nil,
        now: Date = Date(),
        publish: (Shadowban.Evidence) -> Void
    ) async throws -> Shadowban.Evidence {
        var evidence = Shadowban.Evidence(target: target, appview: appview, checkedAt: now)
        publish(evidence)

        let identity: Shadowban.Identity
        if let known {
            identity = known
        } else {
            identity = try await resolveIdentity(target.actor)
        }
        try Task.checkCancellation()
        evidence.identity = identity
        publish(evidence)

        let (stream, continuation) = AsyncStream.makeStream(of: Step.self)
        let client = self
        let origin = appview.origin
        let producer = Task.detached {
            await client.gather(target: target, origin: origin, identity: identity, into: continuation)
        }
        continuation.onTermination = { _ in producer.cancel() }
        for await step in stream {
            Self.apply(step, to: &evidence)
            publish(evidence)
        }
        producer.cancel()
        try Task.checkCancellation()

        evidence.done = true
        publish(evidence)
        return evidence
    }
}
