import Foundation

/// The feed inspector's logic, port of `src/lib/tools/feed.ts`: what a
/// custom feed is made of, and how to read the evidence for each part.
///
/// A feed is two things that have to agree. A record
/// (`app.bsky.feed.generator`, in anybody's repository) gives it a name and
/// names the service that computes it, by DID. That service's DID document
/// then says where it lives, in a `#bsky_fg` service entry, and the service
/// answers `app.bsky.feed.getFeedSkeleton` with nothing but a list of post
/// URIs: the skeleton. The AppView fetches the skeleton and fills in the
/// posts, which is all an app ever shows.
///
/// Everything here is pure: it takes what was observed and says what it
/// means. The observing is `FeedInspectorClient`, which asks the record's
/// repository, the service's DID document, the generator and the AppView
/// directly (the web reads the first three on its server because most
/// generators send no CORS headers).
public enum FeedInspector {
    public static let collection = "app.bsky.feed.generator"

    /// Posts asked for in one skeleton page. One AppView getPosts call
    /// hydrates this many. `FEED_PAGE_SIZE`.
    public static let pageSize = 25

    // MARK: - The input

    public struct Target: Hashable, Sendable {
        /// A DID, or a handle in lower case.
        public var authority: String
        public var rkey: String

        public init(authority: String, rkey: String) {
            self.authority = authority
            self.rkey = rkey
        }
    }

    public enum Input: Hashable, Sendable {
        case feed(Target)
        case invalid(String)

        public var target: Target? {
            if case .feed(let target) = self { return target }
            return nil
        }

        public var reason: String? {
            if case .invalid(let reason) = self { return reason }
            return nil
        }

        public static func ok(authority: String, rkey: String) -> Input {
            .feed(Target(authority: authority, rkey: rkey))
        }
    }

    /// Record keys allow a wider alphabet than this tool needs to refuse, so
    /// this only rules out what could not be one: empty, too long, `.` and
    /// `..`, or a character outside the record key set.
    static func isRecordKey(_ value: String) -> Bool {
        value.wholeMatch(of: feedRecordKeyPattern) != nil && value != "." && value != ".."
    }

    static func isAuthority(_ value: String) -> Bool {
        value.wholeMatch(of: feedDidPattern) != nil || value.wholeMatch(of: feedHandlePattern) != nil
    }

    private static func target(_ authority: String, _ rkey: String) -> Input {
        let clean = authority.hasPrefix("@") ? String(authority.dropFirst()) : authority
        if !isAuthority(clean) { return .invalid("\"\(authority)\" is not a handle or a DID.") }
        if !isRecordKey(rkey) { return .invalid("\"\(rkey)\" is not a valid record key.") }
        return .ok(authority: clean.hasPrefix("did:") ? clean : clean.lowercased(), rkey: rkey)
    }

    /// Read what was pasted as a feed's address: an at:// URI of a feed
    /// generator record, or a link to the feed in any client that uses
    /// Bluesky's `/profile/<actor>/feed/<rkey>` path.
    public static func parseInput(_ raw: String) -> Input {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { return .invalid("Enter a feed link or at:// URI.") }

        if value.lowercased().hasPrefix("at://") {
            let rest = value.dropFirst("at://".count)
            let parts = rest.split(omittingEmptySubsequences: false, whereSeparator: { $0 == "/" || $0 == "?" || $0 == "#" })
                .map(String.init)
            let authority = parts.count > 0 ? parts[0] : ""
            let collection = parts.count > 1 ? parts[1] : ""
            let rkey = parts.count > 2 ? parts[2] : ""
            if authority.isEmpty || collection.isEmpty || rkey.isEmpty {
                return .invalid("A feed's URI has three parts: at://<account>/\(Self.collection)/<key>.")
            }
            if collection != Self.collection {
                return .invalid("That is a \(collection) record. A feed is an \(Self.collection) record.")
            }
            return target(authority, rkey)
        }

        let lower = value.lowercased()
        let absolute = lower.hasPrefix("http://") || lower.hasPrefix("https://") ? value : "https://" + value
        guard let url = URL(string: absolute), let host = url.host, !host.isEmpty else {
            return .invalid("That could not be read as a link or an at:// URI.")
        }

        // Bluesky's own path shape, on whichever client's host.
        let pathname = URLComponents(url: url, resolvingAgainstBaseURL: false)?.percentEncodedPath ?? url.path
        let parts = pathname.split(separator: "/").map { part -> String in
            let text = String(part)
            return text.removingPercentEncoding ?? text
        }
        func part(_ index: Int) -> String? {
            index < parts.count ? parts[index] : nil
        }
        if part(0) == "profile", part(2) == "feed", let actor = part(1), !actor.isEmpty, let rkey = part(3), !rkey.isEmpty {
            return target(actor, rkey)
        }

        // Links this site and the other explorers make, which spell the collection out.
        if let match = matchSupportedUrl(url)?.parsed, match.collection == Self.collection,
            let rkey = match.rkey, !rkey.isEmpty {
            return target(match.handle, rkey)
        }
        if part(0) == "profile", part(2) == "post" {
            return .invalid("That is a post, not a feed. The post inspector reads posts.")
        }
        if part(0) == "profile", part(2) == "lists" {
            return .invalid("That is a list, not a feed.")
        }
        return .invalid("That link does not point at a feed. A feed link looks like bsky.app/profile/<account>/feed/<key>.")
    }

    public static func feedUri(did: String, rkey: String) -> String {
        "at://\(did)/\(collection)/\(rkey)"
    }

    // MARK: - What the reads report

    public enum RecordProbe: Hashable, Sendable {
        case found(cid: String, value: JSONValue)
        /// The repository answered, and has no record at this address.
        case missing
        case error(String)

        public var value: JSONValue? {
            if case .found(_, let value) = self { return value }
            return nil
        }
    }

    public struct ServiceEntry: Hashable, Sendable {
        public var id: String
        public var type: String?
        public var serviceEndpoint: String?

        public init(id: String, type: String? = nil, serviceEndpoint: String? = nil) {
            self.id = id
            self.type = type
            self.serviceEndpoint = serviceEndpoint
        }
    }

    public struct ServiceProbe: Hashable, Sendable {
        public enum Status: String, Hashable, Sendable {
            case resolved
            case error
            /// Not a did:web on a plain host or a did:plc, so it was not fetched.
            case unsupported
        }

        /// The `did` field of the record: the service that computes the feed.
        public var did: String
        public var status: Status
        /// Every service the document lists, so a wrong id or type can be seen.
        public var services: [ServiceEntry]
        /// The `#bsky_fg` endpoint, when the document has one.
        public var endpoint: String?
        public var error: String?

        public init(did: String, status: Status, services: [ServiceEntry] = [], endpoint: String? = nil, error: String? = nil) {
            self.did = did
            self.status = status
            self.services = services
            self.endpoint = endpoint
            self.error = error
        }
    }

    public enum AnswerStatus: String, Hashable, Sendable {
        case answered
        case error
    }

    /// One request to the generator: whether it answered, and with what.
    public struct DescribeProbe: Hashable, Sendable {
        public var url: String
        public var status: AnswerStatus
        public var httpStatus: Int?
        /// The XRPC error name and message, when it answered with one.
        public var xrpcError: String?
        public var message: String?
        /// It answered 200 with something that is not the JSON the lexicon describes.
        public var unreadable: Bool
        /// Why there was no answer at all.
        public var error: String?
        /// The DID the generator says it is.
        public var did: String?
        /// How many feeds it says it serves.
        public var feedCount: Int?
        /// Whether this feed is among them.
        public var listsFeed: Bool?

        public init(
            url: String,
            status: AnswerStatus,
            httpStatus: Int? = nil,
            xrpcError: String? = nil,
            message: String? = nil,
            unreadable: Bool = false,
            error: String? = nil,
            did: String? = nil,
            feedCount: Int? = nil,
            listsFeed: Bool? = nil
        ) {
            self.url = url
            self.status = status
            self.httpStatus = httpStatus
            self.xrpcError = xrpcError
            self.message = message
            self.unreadable = unreadable
            self.error = error
            self.did = did
            self.feedCount = feedCount
            self.listsFeed = listsFeed
        }
    }

    public struct SkeletonReason: Hashable, Sendable {
        public var type: String
        public var repost: String?

        public init(type: String, repost: String? = nil) {
            self.type = type
            self.repost = repost
        }
    }

    public struct SkeletonItem: Hashable, Sendable {
        public var post: String
        /// Why the post is here when it is not the author's own: a repost, a pin.
        public var reason: SkeletonReason?
        /// Opaque context the generator wants back with interactions.
        public var feedContext: String?

        public init(post: String, reason: SkeletonReason? = nil, feedContext: String? = nil) {
            self.post = post
            self.reason = reason
            self.feedContext = feedContext
        }
    }

    public struct SkeletonProbe: Hashable, Sendable {
        public var url: String
        public var status: AnswerStatus
        public var httpStatus: Int?
        public var xrpcError: String?
        public var message: String?
        public var unreadable: Bool
        public var error: String?
        public var items: [SkeletonItem]?
        public var cursor: String?
        public var reqId: String?

        public init(
            url: String,
            status: AnswerStatus,
            httpStatus: Int? = nil,
            xrpcError: String? = nil,
            message: String? = nil,
            unreadable: Bool = false,
            error: String? = nil,
            items: [SkeletonItem]? = nil,
            cursor: String? = nil,
            reqId: String? = nil
        ) {
            self.url = url
            self.status = status
            self.httpStatus = httpStatus
            self.xrpcError = xrpcError
            self.message = message
            self.unreadable = unreadable
            self.error = error
            self.items = items
            self.cursor = cursor
            self.reqId = reqId
        }

        /// The skeleton as the generator returned it, back in the lexicon's
        /// shape, for the JSON view.
        public var json: JSONValue {
            var feed: [JSONValue] = []
            for item in items ?? [] {
                var row: [String: JSONValue] = ["post": .string(item.post)]
                if let reason = item.reason {
                    var reasonObject: [String: JSONValue] = ["$type": .string(reason.type)]
                    if let repost = reason.repost { reasonObject["repost"] = .string(repost) }
                    row["reason"] = .object(reasonObject)
                }
                if let context = item.feedContext { row["feedContext"] = .string(context) }
                feed.append(.object(row))
            }
            var out: [String: JSONValue] = ["feed": .array(feed)]
            if let cursor { out["cursor"] = .string(cursor) }
            if let reqId { out["reqId"] = .string(reqId) }
            return .object(out)
        }
    }

    public struct Probe: Hashable, Sendable {
        public var feed: String
        public var record: RecordProbe
        public var service: ServiceProbe?
        public var describe: DescribeProbe?
        public var skeleton: SkeletonProbe?

        public init(feed: String, record: RecordProbe, service: ServiceProbe? = nil, describe: DescribeProbe? = nil, skeleton: SkeletonProbe? = nil) {
            self.feed = feed
            self.record = record
            self.service = service
            self.describe = describe
            self.skeleton = skeleton
        }
    }

    /// The AppView's own account of the feed (app.bsky.feed.getFeedGenerator).
    public struct AppView: Hashable, Sendable {
        public var displayName: String?
        public var likeCount: Int?
        public var isOnline: Bool?
        public var isValid: Bool?
        public var error: String?

        public init(displayName: String? = nil, likeCount: Int? = nil, isOnline: Bool? = nil, isValid: Bool? = nil, error: String? = nil) {
            self.displayName = displayName
            self.likeCount = likeCount
            self.isOnline = isOnline
            self.isValid = isValid
            self.error = error
        }
    }

    /// What has been observed so far. A step still `pending` is on its way;
    /// `failed` means the lookup was made and failed.
    public struct Evidence: Hashable, Sendable {
        /// What was asked for, as typed.
        public var authority: String
        public var rkey: String
        /// The account the feed belongs to. `failed` when a handle would not resolve.
        public var did: ServiceStep<String>
        public var probe: ServiceStep<Probe>
        public var probeError: String?
        public var appview: ServiceStep<AppView>

        public init(
            authority: String,
            rkey: String,
            did: ServiceStep<String> = .pending,
            probe: ServiceStep<Probe> = .pending,
            probeError: String? = nil,
            appview: ServiceStep<AppView> = .pending
        ) {
            self.authority = authority
            self.rkey = rkey
            self.did = did
            self.probe = probe
            self.probeError = probeError
            self.appview = appview
        }
    }

    // MARK: - The check list

    private enum CheckID: String {
        case record
        case service
        case describe
        case skeleton
        case appview

        var title: String {
            switch self {
            case .record: return "Feed record"
            case .service: return "Service identity"
            case .describe: return "Generator description"
            case .skeleton: return "Feed skeleton"
            case .appview: return "Bluesky AppView"
            }
        }
    }

    private static func pending(_ id: CheckID) -> ServiceCheck {
        ServiceCheck(id: id.rawValue, status: .pending, title: id.title, summary: "Checking…")
    }

    private static func skipped(_ id: CheckID, _ why: String) -> ServiceCheck {
        ServiceCheck(id: id.rawValue, status: .skip, title: id.title, summary: why)
    }

    static func host(_ url: String) -> String {
        var out = url
        if out.hasPrefix("https://") {
            out = String(out.dropFirst("https://".count))
        } else if out.hasPrefix("http://") {
            out = String(out.dropFirst("http://".count))
        }
        if out.hasSuffix("/") { out.removeLast() }
        return out
    }

    /// True when a generator turned the request away for want of a signed-in viewer.
    public static func needsViewer(httpStatus: Int?, xrpcError: String?) -> Bool {
        if httpStatus == 401 || httpStatus == 403 { return true }
        return (xrpcError ?? "").range(of: "auth", options: .caseInsensitive) != nil
    }

    public static func needsViewer(_ skeleton: SkeletonProbe?) -> Bool {
        guard let skeleton else { return false }
        return needsViewer(httpStatus: skeleton.httpStatus, xrpcError: skeleton.xrpcError)
    }

    private static func answerLine(status: AnswerStatus, httpStatus: Int?, xrpcError: String?, message: String?, error: String?) -> String {
        if status == .error { return "→ \(error ?? "no answer")" }
        let named = xrpcError.map { ", \($0)" } ?? ""
        let said = message.map { ": \($0)" } ?? ""
        return "→ HTTP \(httpStatusText(httpStatus))\(named)\(said)"
    }

    private static func httpStatusText(_ status: Int?) -> String {
        status.map(String.init) ?? "undefined"
    }

    private static func recordCheck(feed: String, record: RecordProbe) -> ServiceCheck {
        let id = CheckID.record.rawValue
        let title = CheckID.record.title
        switch record {
        case .missing:
            return ServiceCheck(
                id: id,
                status: .fail,
                title: title,
                summary: "The repository answered, and it has no feed generator record at this address.",
                detail: [feed],
                fix: ["Check the link. A feed that was deleted leaves its old links behind."]
            )
        case .error(let error):
            return ServiceCheck(id: id, status: .fail, title: title, summary: "The record could not be read: \(error).", detail: [feed])
        case .found(let cid, let value):
            guard let service = value["did"]?.stringValue else {
                return ServiceCheck(
                    id: id,
                    status: .fail,
                    title: title,
                    summary: "The record has no did field, so it names no service to compute the feed.",
                    detail: [feed],
                    fix: ["Publish the record again with did set to the feed generator service’s DID."]
                )
            }
            let missing = ["displayName", "createdAt"].filter { value[$0]?.stringValue == nil }
            let type = value["$type"]
            let wrongType = type?.stringValue != Self.collection
            let summary: String
            if wrongType {
                summary = "The record exists, but its $type is \(ServiceFormat.jsString(type)) rather than \(Self.collection)."
            } else if !missing.isEmpty {
                summary = "The record exists and names \(service), but it is missing \(missing.joined(separator: " and ")), which the lexicon requires."
            } else {
                summary = "The record exists and names \(service) as the service that computes the feed."
            }
            return ServiceCheck(
                id: id,
                status: !missing.isEmpty || wrongType ? .warn : .pass,
                title: title,
                summary: summary,
                detail: [feed, "cid \(cid)"]
            )
        }
    }

    private static func serviceCheck(_ service: ServiceProbe) -> ServiceCheck {
        let id = CheckID.service.rawValue
        let title = CheckID.service.title
        let listed = service.services.map { entry -> String in
            let type = entry.type.map { " (\($0))" } ?? ""
            return "\(entry.id)\(type) → \(entry.serviceEndpoint ?? "no endpoint")"
        }
        switch service.status {
        case .unsupported:
            return ServiceCheck(
                id: id,
                status: .fail,
                title: title,
                summary: "\(service.did) is not a did:web on a plain hostname or a did:plc, so it cannot be resolved.",
                fix: ["A feed generator is usually a did:web, such as did:web:feeds.example.com."]
            )
        case .error:
            let fix = service.did.hasPrefix("did:web:")
                ? "A did:web document is served from https://\(service.did.dropFirst("did:web:".count))/.well-known/did.json. Check that it is reachable."
                : "Check the DID in the record is spelled exactly as the PLC directory has it."
            return ServiceCheck(
                id: id,
                status: .fail,
                title: title,
                summary: "\(service.did) could not be resolved: \(service.error ?? "no answer").",
                fix: [fix]
            )
        case .resolved:
            break
        }
        guard let endpoint = service.endpoint else {
            return ServiceCheck(
                id: id,
                status: .fail,
                title: title,
                summary: "\(service.did) resolves, but its DID document has no #bsky_fg service, so nothing says where the generator is.",
                detail: listed.isEmpty ? ["service: none"] : listed,
                fix: ["Add a service with the id #bsky_fg and the type BskyFeedGenerator, whose serviceEndpoint is the generator’s https address."]
            )
        }
        let entry = service.services.first { $0.id.hasSuffix("#bsky_fg") }
        let typed = entry?.type == "BskyFeedGenerator"
        return ServiceCheck(
            id: id,
            status: typed ? .pass : .warn,
            title: title,
            summary: typed
                ? "\(service.did) resolves, and its #bsky_fg service is \(host(endpoint))."
                : "\(service.did) resolves and has a #bsky_fg service, but its type is \(entry?.type ?? "missing") rather than BskyFeedGenerator.",
            detail: listed
        )
    }

    private static func describeCheck(feed: String, describe: DescribeProbe, service: ServiceProbe) -> ServiceCheck {
        let id = CheckID.describe.rawValue
        let title = CheckID.describe.title
        let detail = [
            "GET \(describe.url)",
            answerLine(status: describe.status, httpStatus: describe.httpStatus, xrpcError: describe.xrpcError, message: describe.message, error: describe.error),
        ]
        if describe.status == .error {
            return ServiceCheck(id: id, status: .warn, title: title, summary: "The generator did not answer: \(describe.error ?? "no answer").", detail: detail)
        }
        if describe.httpStatus != 200 {
            return ServiceCheck(
                id: id,
                status: .info,
                title: title,
                summary: "The generator does not answer describeFeedGenerator (HTTP \(httpStatusText(describe.httpStatus))). Many do not, and a feed works without it.",
                detail: detail
            )
        }
        if describe.unreadable {
            return ServiceCheck(
                id: id,
                status: .info,
                title: title,
                summary: "The generator answered, but with more than this tool reads or with something other than a feed list.",
                detail: detail
            )
        }
        let count = describe.feedCount ?? 0
        let feeds = "\(ServiceFormat.grouped(count)) \(count == 1 ? "feed" : "feeds")"
        if let did = describe.did, did != service.did {
            return ServiceCheck(
                id: id,
                status: .warn,
                title: title,
                summary: "The generator says it is \(did), but the record names \(service.did).",
                detail: detail
            )
        }
        let lists = describe.listsFeed == true
        return ServiceCheck(
            id: id,
            status: lists ? .pass : .warn,
            title: title,
            summary: lists
                ? "The generator lists this feed among the \(feeds) it serves."
                : "The generator answers and lists \(feeds), but this one is not among them.",
            detail: lists ? detail : detail + ["looked for \(feed)"]
        )
    }

    private static func skeletonCheck(_ skeleton: SkeletonProbe) -> ServiceCheck {
        let id = CheckID.skeleton.rawValue
        let title = CheckID.skeleton.title
        let detail = [
            "GET \(skeleton.url)",
            answerLine(status: skeleton.status, httpStatus: skeleton.httpStatus, xrpcError: skeleton.xrpcError, message: skeleton.message, error: skeleton.error),
        ]
        if skeleton.status == .error {
            return ServiceCheck(
                id: id,
                status: .fail,
                title: title,
                summary: "The generator did not answer: \(skeleton.error ?? "no answer").",
                detail: detail,
                fix: ["Check the service is running and reachable over https at the address in its DID document."]
            )
        }
        if needsViewer(skeleton) {
            return ServiceCheck(
                id: id,
                status: .info,
                title: title,
                summary: "The generator only answers a signed-in viewer, so the feed is personalised. This tool asks without one, and gets no skeleton.",
                detail: detail
            )
        }
        if skeleton.httpStatus != 200 {
            let unknown = skeleton.xrpcError == "UnknownFeed"
            return ServiceCheck(
                id: id,
                status: .fail,
                title: title,
                summary: unknown
                    ? "The generator answers, but says it does not know this feed."
                    : "The generator answered with HTTP \(httpStatusText(skeleton.httpStatus)) rather than a skeleton.",
                detail: detail,
                fix: unknown
                    ? ["The record points at a service that does not serve it. Check the did in the record, and the feed’s key on the service."]
                    : []
            )
        }
        guard !skeleton.unreadable, let items = skeleton.items else {
            return ServiceCheck(
                id: id,
                status: .fail,
                title: title,
                summary: "The generator answered 200, but not with a feed skeleton: there is no feed array in it.",
                detail: detail
            )
        }
        let count = items.count
        if count == 0 {
            return ServiceCheck(
                id: id,
                status: .warn,
                title: title,
                summary: "The generator answered with an empty feed. That can be right for a quiet feed, or one that needs a viewer to have anything to show.",
                detail: detail
            )
        }
        let more = skeleton.cursor == nil ? "" : " and a cursor for more"
        return ServiceCheck(
            id: id,
            status: .pass,
            title: title,
            summary: "The generator returned \(count) \(count == 1 ? "post" : "posts")\(more).",
            detail: detail
        )
    }

    private static func appviewCheck(_ appview: AppView?) -> ServiceCheck {
        let id = CheckID.appview.rawValue
        let title = CheckID.appview.title
        guard let appview, appview.error == nil else {
            let because = appview?.error.map { " (\($0))" } ?? ""
            return ServiceCheck(
                id: id,
                status: .warn,
                title: title,
                summary: "Bluesky's AppView has no view of this feed\(because), so Bluesky apps cannot open it."
            )
        }
        var likes = ""
        if let count = appview.likeCount {
            likes = " It has \(ServiceFormat.grouped(count)) \(count == 1 ? "like" : "likes")."
        }
        let detail = ["isOnline \(boolText(appview.isOnline))", "isValid \(boolText(appview.isValid))"]
        if appview.isOnline == false || appview.isValid == false {
            var reported: [String] = []
            if appview.isOnline == false { reported.append("offline") }
            if appview.isValid == false { reported.append("not valid") }
            return ServiceCheck(
                id: id,
                status: .warn,
                title: title,
                summary: "Bluesky's AppView has indexed the feed, but reports it as \(reported.joined(separator: " and ")).\(likes)",
                detail: detail
            )
        }
        return ServiceCheck(
            id: id,
            status: .pass,
            title: title,
            summary: "Bluesky's AppView has indexed the feed, and reports it online and valid.\(likes)",
            detail: detail
        )
    }

    private static func boolText(_ value: Bool?) -> String {
        guard let value else { return "undefined" }
        return value ? "true" : "false"
    }

    /// Build the check list from whatever has been observed so far.
    public static func buildChecks(_ evidence: Evidence) -> [ServiceCheck] {
        let appviewRow: ServiceCheck
        switch evidence.appview {
        case .pending: appviewRow = pending(.appview)
        case .failed: appviewRow = appviewCheck(nil)
        case .done(let appview): appviewRow = appviewCheck(appview)
        }

        if case .failed = evidence.did {
            let why = "Not checked, because \(evidence.authority) did not resolve to an account."
            return [
                ServiceCheck(
                    id: CheckID.record.rawValue,
                    status: .fail,
                    title: CheckID.record.title,
                    summary: "\(evidence.authority) did not resolve to an account, so there is no repository to read."
                ),
                skipped(.service, why),
                skipped(.describe, why),
                skipped(.skeleton, why),
                skipped(.appview, why),
            ]
        }

        let probe: Probe
        switch evidence.probe {
        case .pending:
            return [pending(.record), pending(.service), pending(.describe), pending(.skeleton), appviewRow]
        case .failed:
            let why = evidence.probeError ?? "The lookup could not be made."
            let skip = "Not checked, because the record could not be read."
            return [
                ServiceCheck(id: CheckID.record.rawValue, status: .fail, title: CheckID.record.title, summary: why),
                skipped(.service, skip),
                skipped(.describe, skip),
                skipped(.skeleton, skip),
                appviewRow,
            ]
        case .done(let done):
            probe = done
        }

        var checks = [recordCheck(feed: probe.feed, record: probe.record)]
        guard let service = probe.service else {
            let why: String
            if case .found = probe.record {
                why = "Not checked, because the record names no service."
            } else {
                why = "Not checked, because there is no record to read."
            }
            return checks + [skipped(.service, why), skipped(.describe, why), skipped(.skeleton, why), appviewRow]
        }
        checks.append(serviceCheck(service))
        guard service.endpoint != nil, let describe = probe.describe, let skeleton = probe.skeleton else {
            let why = "Not checked, because the service has no address to ask."
            return checks + [skipped(.describe, why), skipped(.skeleton, why), appviewRow]
        }
        checks.append(describeCheck(feed: probe.feed, describe: describe, service: service))
        checks.append(skeletonCheck(skeleton))
        checks.append(appviewRow)
        return checks
    }

    /// The one-line answer above the list.
    public static func verdict(_ evidence: Evidence, checks: [ServiceCheck], name: String) -> ServiceVerdict {
        if checks.contains(where: { $0.status == .pending }) {
            return ServiceVerdict(tone: .pending, title: "Checking \(name)", text: "Reading the record and asking its generator.")
        }
        if let failed = checks.first(where: { $0.status == .fail }) {
            let title: String
            switch failed.id {
            case CheckID.record.rawValue: title = "\(name) has no readable feed record"
            case CheckID.service.rawValue: title = "\(name) names a service that cannot be found"
            default: title = "\(name) is not answering"
            }
            return ServiceVerdict(tone: .fail, title: title, text: failed.summary)
        }
        let skeleton = checks.first { $0.id == CheckID.skeleton.rawValue }
        if needsViewer(evidence.probe.value?.skeleton) {
            return ServiceVerdict(
                tone: .info,
                title: "\(name) answers only for a signed-in viewer",
                text: "Its record and service check out. The generator personalises the feed, so it returns nothing to an anonymous request."
            )
        }
        let warnings = checks.filter { $0.status == .warn }
        if let first = warnings.first {
            let things = warnings.count == 1 ? "one thing" : "\(warnings.count) things"
            return ServiceVerdict(tone: .warn, title: "\(name) answers, with \(things) to look at", text: first.summary)
        }
        let served = evidence.probe.value?.service?.endpoint.map { " It is served from \(host($0))." } ?? ""
        return ServiceVerdict(
            tone: .pass,
            title: "\(name) is answering",
            text: "\(skeleton?.summary ?? "The generator returned a skeleton.")\(served)"
        )
    }

    /// `app.bsky.feed.defs#skeletonReasonRepost` → "Repost".
    public static func reasonLabel(_ type: String) -> String {
        let name = type.split(separator: "#", omittingEmptySubsequences: false).last.map(String.init) ?? type
        let word = name.hasPrefix("skeletonReason") ? String(name.dropFirst("skeletonReason".count)) : name
        guard let first = word.first else { return "Reason" }
        return first.uppercased() + word.dropFirst()
    }
}

/// `^[A-Za-z0-9._:~-]{1,512}$`.
private let feedRecordKeyPattern = #/[A-Za-z0-9._:~-]{1,512}/#
/// `^did:(plc:[a-z2-7]{24}|web:[A-Za-z0-9.%-]+)$`.
private let feedDidPattern = #/did:(plc:[a-z2-7]{24}|web:[A-Za-z0-9.%-]+)/#
/// `^([a-z0-9-]+\.)+[a-z0-9-]+$`, any case.
private let feedHandlePattern = #/([a-z0-9-]+\.)+[a-z0-9-]+/#.ignoresCase()
