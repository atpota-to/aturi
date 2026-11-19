import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The feed inspector's reads, port of `src/lib/tools/server/feed.ts` and of
/// the two reads `FeedInspector.tsx` makes itself (the AppView's view of the
/// feed, and the skeleton's posts).
///
/// Given a feed generator record's address, this follows the chain the
/// AppView follows: the record names a service DID, the service's DID
/// document names an endpoint, and the endpoint is asked two things,
/// `app.bsky.feed.describeFeedGenerator` and `app.bsky.feed.getFeedSkeleton`.
/// The web makes those reads on its server, since most generators send no
/// CORS headers; the app asks them itself.
///
/// The endpoint is never taken from the input. It comes from the record and
/// the DID document, both of which anyone can author, so the did:web host
/// and the generator are read through `ServiceFetcher`, which checks each
/// hop, caps the body and holds a deadline. Only those two XRPC methods are
/// called, and what comes back is narrowed to the fields the lexicons define.
public struct FeedInspectorClient: Sendable {
    static let didDocumentMaxBytes = 256 * 1024
    /// A hosted feed builder lists every feed it serves here, and the largest
    /// seen while the web tool was written answered with 830KB. Past the cap
    /// the answer is reported as too long to read rather than parsed in part.
    static let describeMaxBytes = 2 * 1024 * 1024
    static let skeletonMaxBytes = 512 * 1024
    static let generatorTimeout: TimeInterval = 8
    /// Longest opaque string (a cursor, a feedContext) kept.
    static let maxOpaque = 2000

    private let http: HTTPClient
    private let fetcher: ServiceFetcher
    private let resolver: IdentityResolver
    private let slingshot: SlingshotClient
    private let pds: PDSClient
    private let appView: URL

    public init(http: HTTPClient = .shared, fetcher: ServiceFetcher = .shared, appView: URL = Endpoints.appView) {
        self.http = http
        self.fetcher = fetcher
        resolver = http === HTTPClient.shared ? .shared : IdentityResolver(http: http)
        slingshot = SlingshotClient(http: http)
        pds = PDSClient(http: http)
        self.appView = appView
    }

    // MARK: - The account

    /// The record lives in a repository, and a repository is named by a DID.
    public func resolveDid(_ authority: String) async -> String? {
        if authority.hasPrefix("did:") { return authority }
        return await resolver.resolveHandle(authority)
    }

    // MARK: - The generator's side

    /// Words for each way a host could not be read, `FETCH_FAILURE`.
    static func failureWords(_ error: Error) -> String {
        guard let failure = error as? ServiceFetchFailure else { return "the request failed" }
        switch failure {
        case .blocked: return "the address is not a public https host"
        case .unresolved: return "the host has no DNS record"
        case .timeout: return "the host did not answer in time"
        case .network: return "the connection failed (refused, reset, or a certificate problem)"
        case .redirects: return "the address redirects too many times"
        }
    }

    /// The record, the way the web's get_record reads one: the Slingshot
    /// cache first, then the repository's own PDS, which is what can say the
    /// record is not there.
    func readRecord(did: String, rkey: String) async -> FeedInspector.RecordProbe {
        if let cached = await slingshot.getRecordByUri(FeedInspector.feedUri(did: did, rkey: rkey)) {
            return .found(cid: cached.cid, value: cached.value)
        }
        let document: DIDDocument
        do {
            document = try await resolver.loadDIDDocument(did)
        } catch {
            return .error("the account’s DID document could not be read")
        }
        guard let endpoint = document.pdsEndpoint else {
            return .error("the account’s DID document names no PDS")
        }
        do {
            let record = try await pds.getRecord(pds: endpoint, repo: did, collection: FeedInspector.collection, rkey: rkey)
            return .found(cid: record.cid, value: record.value)
        } catch let error as HTTPError where error.status == 400 || error.status == 404 {
            return .missing
        } catch {
            return .error("the repository did not answer")
        }
    }

    static func readServices(_ document: JSONValue) -> [FeedInspector.ServiceEntry] {
        guard let list = document["service"]?.arrayValue else { return [] }
        var out: [FeedInspector.ServiceEntry] = []
        for entry in list {
            guard let id = entry["id"]?.stringValue else { continue }
            out.append(FeedInspector.ServiceEntry(
                id: ServiceFormat.clip(id, 200),
                type: entry["type"]?.stringValue.map { ServiceFormat.clip($0, 200) },
                serviceEndpoint: entry["serviceEndpoint"]?.stringValue.map { ServiceFormat.clip($0, 500) }
            ))
            if out.count == 20 { break }
        }
        return out
    }

    /// Resolve the service the record names. Only the two DID methods
    /// atproto uses, and a did:web only on a bare hostname: atproto allows
    /// no path and no port in one, and refusing them keeps the document URL
    /// to one shape.
    func readService(did: String) async -> FeedInspector.ServiceProbe {
        let document: JSONValue
        if did.wholeMatch(of: feedServicePlcPattern) != nil {
            let url = makeURL(Endpoints.plcDirectory, path: did)
            do {
                document = try await http.getJSONValue(from: url, refuseRedirects: true)
            } catch let error as HTTPError {
                return FeedInspector.ServiceProbe(did: did, status: .error, error: "its DID document answered HTTP \(error.status)")
            } catch is DecodingError {
                return FeedInspector.ServiceProbe(did: did, status: .error, error: "its DID document is not JSON")
            } catch {
                return FeedInspector.ServiceProbe(did: did, status: .error, error: "the request failed")
            }
        } else if did.wholeMatch(of: feedServiceWebPattern) != nil {
            let host = did.dropFirst("did:web:".count)
            let answer: ServiceFetchResponse
            do {
                answer = try await fetcher.fetch(
                    "https://\(host)/.well-known/did.json",
                    maxBytes: Self.didDocumentMaxBytes,
                    accept: "application/did+ld+json, application/json",
                    httpsOnly: true
                )
            } catch {
                return FeedInspector.ServiceProbe(did: did, status: .error, error: Self.failureWords(error))
            }
            if answer.status != 200 {
                return FeedInspector.ServiceProbe(did: did, status: .error, error: "its DID document answered HTTP \(answer.status)")
            }
            if answer.truncated {
                return FeedInspector.ServiceProbe(did: did, status: .error, error: "its DID document is too large to read")
            }
            if answer.cutOff {
                return FeedInspector.ServiceProbe(did: did, status: .error, error: Self.failureWords(ServiceFetchFailure.timeout))
            }
            guard let parsed = try? JSONValue.parse(answer.body) else {
                return FeedInspector.ServiceProbe(did: did, status: .error, error: "its DID document is not JSON")
            }
            document = parsed
        } else {
            return FeedInspector.ServiceProbe(did: did, status: .unsupported)
        }

        let services = Self.readServices(document)
        let entry = services.first { $0.id == "#bsky_fg" || $0.id.hasSuffix("#bsky_fg") }
        let endpoint = entry?.serviceEndpoint.map(Self.trimTrailingSlashes)
        return FeedInspector.ServiceProbe(did: did, status: .resolved, services: services, endpoint: endpoint)
    }

    static func trimTrailingSlashes(_ value: String) -> String {
        var out = value
        while out.hasSuffix("/") { out.removeLast() }
        return out
    }

    /// The error name and message of an XRPC error body, if that is what this is.
    static func xrpcError(_ data: Data) -> (error: String?, message: String?) {
        guard let body = try? JSONValue.parse(data) else { return (nil, nil) }
        return (
            body["error"]?.stringValue.map { ServiceFormat.clip($0, 100) },
            body["message"]?.stringValue.map { ServiceFormat.clip($0, 300) }
        )
    }

    private enum Asked {
        case answer(ServiceFetchResponse)
        case failure(String)
    }

    private func ask(_ url: String, maxBytes: Int) async -> Asked {
        do {
            let answer = try await fetcher.fetch(
                url,
                maxBytes: maxBytes,
                timeout: Self.generatorTimeout,
                accept: "application/json",
                httpsOnly: true
            )
            // A body that stopped part-way is no answer to read.
            if answer.cutOff {
                return .failure(Self.failureWords(ServiceFetchFailure.timeout))
            }
            return .answer(answer)
        } catch {
            return .failure(Self.failureWords(error))
        }
    }

    func describe(endpoint: String, feed: String) async -> FeedInspector.DescribeProbe {
        let url = "\(endpoint)/xrpc/app.bsky.feed.describeFeedGenerator"
        let answer: ServiceFetchResponse
        switch await ask(url, maxBytes: Self.describeMaxBytes) {
        case .failure(let words):
            return FeedInspector.DescribeProbe(url: url, status: .error, error: words)
        case .answer(let got):
            answer = got
        }
        var probe = FeedInspector.DescribeProbe(url: url, status: .answered, httpStatus: answer.status)
        if answer.status != 200 {
            let named = Self.xrpcError(answer.body)
            probe.xrpcError = named.error
            probe.message = named.message
            return probe
        }
        guard !answer.truncated, let body = try? JSONValue.parse(answer.body), let feeds = body["feeds"]?.arrayValue else {
            probe.unreadable = true
            return probe
        }
        probe.did = body["did"]?.stringValue.map { ServiceFormat.clip($0, 300) }
        probe.feedCount = feeds.count
        probe.listsFeed = feeds.contains { $0["uri"]?.stringValue == feed }
        return probe
    }

    static func readItems(_ feed: [JSONValue], limit: Int) -> [FeedInspector.SkeletonItem] {
        var items: [FeedInspector.SkeletonItem] = []
        for entry in feed.prefix(limit) {
            guard let post = entry["post"]?.stringValue else { continue }
            var reason: FeedInspector.SkeletonReason?
            if let type = entry["reason"]?["$type"]?.stringValue {
                reason = FeedInspector.SkeletonReason(
                    type: ServiceFormat.clip(type, 200),
                    repost: entry["reason"]?["repost"]?.stringValue.map { ServiceFormat.clip($0, 600) }
                )
            }
            items.append(FeedInspector.SkeletonItem(
                post: ServiceFormat.clip(post, 600),
                reason: reason,
                feedContext: entry["feedContext"]?.stringValue.map { ServiceFormat.clip($0, maxOpaque) }
            ))
        }
        return items
    }

    static func skeletonURL(endpoint: String, feed: String, limit: Int, cursor: String?) -> String {
        var query = "feed=\(URIEncoding.encodeComponent(feed))&limit=\(limit)"
        if let cursor, !cursor.isEmpty {
            query += "&cursor=\(URIEncoding.encodeComponent(cursor))"
        }
        return "\(endpoint)/xrpc/app.bsky.feed.getFeedSkeleton?\(query)"
    }

    func skeleton(endpoint: String, feed: String, limit: Int, cursor: String?) async -> FeedInspector.SkeletonProbe {
        let url = Self.skeletonURL(endpoint: endpoint, feed: feed, limit: limit, cursor: cursor)
        let answer: ServiceFetchResponse
        switch await ask(url, maxBytes: Self.skeletonMaxBytes) {
        case .failure(let words):
            return FeedInspector.SkeletonProbe(url: url, status: .error, error: words)
        case .answer(let got):
            answer = got
        }
        var probe = FeedInspector.SkeletonProbe(url: url, status: .answered, httpStatus: answer.status)
        if answer.status != 200 {
            let named = Self.xrpcError(answer.body)
            probe.xrpcError = named.error
            probe.message = named.message
            return probe
        }
        guard !answer.truncated, let body = try? JSONValue.parse(answer.body), let feed = body["feed"]?.arrayValue else {
            probe.unreadable = true
            return probe
        }
        probe.items = Self.readItems(feed, limit: limit)
        // An empty cursor is how some generators say there is no next page.
        if let cursor = body["cursor"]?.stringValue, !cursor.isEmpty {
            probe.cursor = ServiceFormat.clip(cursor, Self.maxOpaque)
        }
        probe.reqId = body["reqId"]?.stringValue.map { ServiceFormat.clip($0, 100) }
        return probe
    }

    /// `probeFeed`: the record, the service it names, and the generator's
    /// two answers, side by side.
    public func probe(did: String, rkey: String, limit: Int = FeedInspector.pageSize, cursor: String? = nil) async -> FeedInspector.Probe {
        let feed = FeedInspector.feedUri(did: did, rkey: rkey)
        let record = await readRecord(did: did, rkey: rkey)
        guard let serviceDid = record.value?["did"]?.stringValue else {
            return FeedInspector.Probe(feed: feed, record: record)
        }
        let service = await readService(did: serviceDid)
        guard let endpoint = service.endpoint else {
            return FeedInspector.Probe(feed: feed, record: record, service: service)
        }
        async let described = describe(endpoint: endpoint, feed: feed)
        async let skeletal = skeleton(endpoint: endpoint, feed: feed, limit: limit, cursor: cursor)
        let describeProbe = await described
        let skeletonProbe = await skeletal
        return FeedInspector.Probe(feed: feed, record: record, service: service, describe: describeProbe, skeleton: skeletonProbe)
    }

    // MARK: - The AppView's side

    /// `app.bsky.feed.getFeedGenerator`: the AppView's account of the feed,
    /// and its view for the card. A failure is an answer too.
    public func appViewFeed(_ feed: String) async -> (appview: FeedInspector.AppView, view: FeedGeneratorView?) {
        let url = makeURL(appView, path: "/xrpc/app.bsky.feed.getFeedGenerator", query: [("feed", feed)])
        do {
            let body = try await http.getJSONValue(from: url)
            let view = FeedGeneratorView(json: body["view"])
            let appview = FeedInspector.AppView(
                displayName: view?.displayName,
                likeCount: view?.likeCount,
                isOnline: body["isOnline"]?.boolValue,
                isValid: body["isValid"]?.boolValue
            )
            return (appview, view)
        } catch let error as HTTPError {
            let message = (try? JSONValue.parse(Data(error.body.utf8)))?["message"]?.stringValue
            let words = (message?.isEmpty ?? true) ? "HTTP \(error.status)" : (message ?? "")
            return (FeedInspector.AppView(error: words), nil)
        } catch {
            return (FeedInspector.AppView(error: "no answer"), nil)
        }
    }

    /// The skeleton's posts as the AppView hydrates them, by URI. Nil when
    /// the AppView did not answer.
    public func posts(_ uris: [String]) async -> [String: BskyPost]? {
        var seen = Set<String>()
        let unique = uris.filter { seen.insert($0).inserted }
        guard !unique.isEmpty else { return [:] }
        let client = AppViewClient(client: http, baseURL: appView)
        // One page of the skeleton is one getPosts call's worth.
        guard let posts = await client.getPosts(Array(unique.prefix(FeedInspector.pageSize))) else { return nil }
        var out: [String: BskyPost] = [:]
        for post in posts { out[post.uri] = post }
        return out
    }
}

/// `^did:plc:[a-z2-7]{24}$`.
private let feedServicePlcPattern = #/did:plc:[a-z2-7]{24}/#
/// `^did:web:([a-z0-9-]+\.)+[a-z0-9-]+$`, any case.
private let feedServiceWebPattern = #/did:web:([a-z0-9-]+\.)+[a-z0-9-]+/#.ignoresCase()
