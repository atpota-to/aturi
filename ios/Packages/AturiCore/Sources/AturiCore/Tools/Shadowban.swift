import Foundation

/// The shadowban checker's logic: what to compare, and what a difference
/// means. Port of `src/lib/tools/shadowban.ts`; the app calls the result
/// "Visibility", as the web's account card does.
///
/// An account's posts live in its repository on its PDS, and anyone can read
/// them there. An AppView is a separate service that indexes repositories and
/// answers apps, and it can leave things out of its answers without telling
/// anyone: a post it will not return, a reply it drops from the thread it
/// belongs to, an account its search skips. Bluesky's AppView used to mark the
/// account for the last of these with a public `needs-review` label; it no
/// longer does, so the only way to see it is to put the PDS and the AppView
/// side by side, which is what this does.
///
/// Every rule below was checked against the live services before it was
/// written down (on the web), and several exist to stop an innocent
/// difference being reported as a hidden one:
///
///   - A thread answer lists at most `threadReplyCap` direct replies, on both
///     Bluesky and Blacksky, so a reply missing from a longer thread is "too
///     long to tell", not hidden.
///   - An AppView drops a reply across a block between the replier and the
///     thread, and a reply that breaks the thread's reply rules. Both are
///     looked up before a missing reply is called unexplained.
///   - Search leaves out every account carrying the `!no-unauthenticated`
///     self-label when the request is logged out, as this one is. Of sixty
///     ordinary accounts sampled, every one search left out carried it.
///   - Typeahead finds an account by handle even where full search leaves it
///     out, so it is the control: found by typeahead and not by search means
///     the account was indexed and then excluded.
///   - Indexing takes moments and search takes longer, so posts younger than
///     a grace period are not counted against either.
///
/// Everything here is pure. The requests are in `ShadowbanClient`.
///
/// Swift spellings of the web's names, as in `Labels`: lowerCamelCase
/// constants, `Date` and `TimeInterval` for the web's milliseconds, and the
/// types nested here. The web's discriminated unions are enums; an
/// `undefined` field ("not asked yet") is a nil optional, and the two fields
/// that also use `null` ("asked, no answer") are `Lookup`s.
public enum Shadowban {
    public static let postCollection = "app.bsky.feed.post"

    /// Recent posts compared. One getPosts request carries at most 25 URIs.
    public static let recentPosts = 25

    /// Replies whose threads are opened, at most: one request each.
    public static let repliesChecked = 10

    /// The most direct replies an AppView returns for one post. Measured on
    /// Bluesky and Blacksky, against a post with 581 replies: both stopped at 200.
    public static let threadReplyCap = 200

    /// A post younger than this may not have been indexed yet.
    public static let indexGrace: TimeInterval = 2 * 60

    /// Search is fed after the AppView's own index, and lags it.
    public static let searchGrace: TimeInterval = 15 * 60

    /// The self-label that asks apps not to show an account to logged-out visitors.
    public static let noUnauthenticated = "!no-unauthenticated"

    // MARK: - Which AppView

    public struct AppView: Hashable, Sendable {
        /// The `appview` query parameter: an id for a listed AppView, a host for any other.
        public var param: String
        public var name: String
        /// Scheme, host and port, without a trailing slash.
        public var origin: String
        /// False for a host typed by hand.
        public var listed: Bool

        public init(param: String, name: String, origin: String, listed: Bool) {
            self.param = param
            self.name = name
            self.origin = origin
            self.listed = listed
        }
    }

    /// AppViews that answer without signing in.
    ///
    /// Bluesky's is asked at api.bsky.app rather than public.api.bsky.app. The
    /// public host is a cache in front of the same service, so a reply written
    /// a minute ago can be missing from its answer for no reason but age, and
    /// it refuses post search outright.
    public static let appViews: [AppView] = [
        AppView(param: "bluesky", name: "Bluesky", origin: "https://api.bsky.app", listed: true),
        AppView(param: "blacksky", name: "Blacksky", origin: "https://api.blacksky.community", listed: true),
    ]

    public static let defaultAppView = appViews[0]

    public enum AppViewChoice: Hashable, Sendable {
        case ok(AppView)
        case invalid(reason: String)
    }

    private enum HostURL {
        case ok(origin: String, host: String)
        case invalid(reason: String)
    }

    /// Tidy a typed host into an origin. A bare name gets https. Plain http
    /// is kept only for this machine, which is where an AppView under
    /// development runs. The reasons say "the app" where the web says "the
    /// browser"; the rule is the same, since App Transport Security refuses
    /// plain http too.
    private static func normalizeHostUrl(_ raw: String) -> HostURL {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty {
            return .invalid(reason: "Enter the AppView’s host, such as appview.example.com.")
        }
        let hasScheme = value.firstMatch(of: #/^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\//#) != nil
        let candidate = hasScheme ? value : "https://\(value)"
        guard let components = URLComponents(string: candidate),
            let scheme = components.scheme?.lowercased(),
            let rawHost = components.host, !rawHost.isEmpty
        else {
            return .invalid(reason: "That isn’t a host name or URL.")
        }
        var host = rawHost.lowercased()
        if host.contains(":") && !host.hasPrefix("[") {
            host = "[\(host)]"
        }
        let local = host == "localhost" || host == "127.0.0.1" || host == "[::1]"
        if scheme == "http" && !local {
            return .invalid(reason: "Use https. The app won’t send this request over plain http.")
        }
        if scheme != "https" && scheme != "http" {
            return .invalid(reason: "Use an https address.")
        }
        if components.user != nil || components.password != nil {
            return .invalid(reason: "Remove the username and password from the address.")
        }
        var authority = host
        if let port = components.port, !(scheme == "https" && port == 443), !(scheme == "http" && port == 80) {
            authority += ":\(port)"
        }
        return .ok(origin: "\(scheme)://\(authority)", host: authority)
    }

    /// Read the `appview` parameter: empty for Bluesky's, a listed id, or any host.
    public static func readAppViewParam(_ raw: String) -> AppViewChoice {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { return .ok(defaultAppView) }
        if let listed = appViews.first(where: { $0.param == value.lowercased() }) {
            return .ok(listed)
        }
        switch normalizeHostUrl(value) {
        case .invalid(let reason):
            return .invalid(reason: reason)
        case .ok(let origin, let host):
            if let same = appViews.first(where: { $0.origin == origin }) {
                return .ok(same)
            }
            // A bare host reads back as https, so only plain http keeps its scheme.
            let param = origin.hasPrefix("https://") ? host : origin
            return .ok(AppView(param: param, name: host, origin: origin, listed: false))
        }
    }

    // MARK: - What was asked about

    /// An account or a post, with the account still as typed (a handle or a DID).
    public enum ShadowbanTarget: Hashable, Sendable {
        case account(actor: String)
        case post(actor: String, rkey: String)

        public var actor: String {
            switch self {
            case .account(let actor): return actor
            case .post(let actor, _): return actor
            }
        }

        public var isPost: Bool {
            if case .post = self { return true }
            return false
        }
    }

    public enum ShadowbanInput: Hashable, Sendable {
        case ok(ShadowbanTarget)
        case invalid(reason: String)
    }

    /// The reason given for a record that is neither an account nor a post.
    public static let notChecked = "This checks accounts and posts. Enter a handle, a DID, or a link to a post."

    static let profileCollection = "app.bsky.actor.profile"

    /// An account the way people paste one: a DID, or a handle with or without the @.
    private static func readAccount(_ input: String) -> String? {
        var value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.hasPrefix("@") {
            value.removeFirst()
        }
        if value.hasPrefix("did:") {
            return isValidDid(value) ? value : nil
        }
        let handle = value.lowercased()
        return isValidHandle(handle) ? handle : nil
    }

    private static func targetFrom(_ actor: String, collection: String? = nil, rkey: String? = nil) -> ShadowbanInput {
        guard let account = readAccount(actor) else {
            return .invalid(reason: "\u{201C}\(actor)\u{201D} isn’t a handle or a DID.")
        }
        if collection == nil || collection == "" || collection == profileCollection {
            return .ok(.account(actor: account))
        }
        if collection == postCollection, let rkey, !rkey.isEmpty {
            return .ok(.post(actor: account, rkey: rkey))
        }
        return .invalid(reason: notChecked)
    }

    /// A handle, a DID, an at:// URI, or a profile or post link from any
    /// client the link resolver knows (bsky.app and the rest of that family).
    public static func parseShadowbanInput(_ raw: String) -> ShadowbanInput {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty {
            return .invalid(reason: "Enter a handle, a DID, or a link to a post.")
        }
        let lower = value.lowercased()

        if lower.hasPrefix("at://") {
            guard let parsed = AtUri(parsing: value) else {
                return .invalid(reason: "That at:// URI isn’t valid.")
            }
            return targetFrom(parsed.repo, collection: parsed.collection, rkey: parsed.rkey)
        }

        if lower.hasPrefix("http://") || lower.hasPrefix("https://") {
            guard let url = URL(string: value), let host = url.host, !host.isEmpty else {
                return .invalid(reason: "That link isn’t valid.")
            }
            guard let match = matchSupportedUrl(url) else {
                return .invalid(reason: "This tool doesn’t recognize that link. Paste the handle instead.")
            }
            return targetFrom(match.parsed.handle, collection: match.parsed.collection, rkey: match.parsed.rkey)
        }

        return targetFrom(value)
    }

    /// A stable string for a target, to key a run on.
    public static func targetKey(_ target: ShadowbanTarget) -> String {
        switch target {
        case .post(let actor, let rkey): return "post:\(actor)/\(rkey)"
        case .account(let actor): return "account:\(actor)"
        }
    }

    // MARK: - What was observed

    /// A question asked of a service: its answer, or why there was none.
    public enum Probe<Value> {
        case ok(Value)
        case failed(String)

        public var value: Value? {
            if case .ok(let value) = self { return value }
            return nil
        }

        public var isOk: Bool {
            if case .ok = self { return true }
            return false
        }

        public var message: String? {
            if case .failed(let message) = self { return message }
            return nil
        }
    }

    /// The web's `field?: T | null` for the two reply lookups that tell
    /// "not looked up" (undefined) from "looked up, no answer" (null).
    public enum Lookup<Value: Hashable & Sendable>: Hashable, Sendable {
        /// Not looked up: the reply was not absent from its thread.
        case notChecked
        /// Looked up, and the service did not answer.
        case unanswered
        case answered(Value)

        public var value: Value? {
            if case .answered(let value) = self { return value }
            return nil
        }

        public var isUnanswered: Bool {
            if case .unanswered = self { return true }
            return false
        }
    }

    public struct Identity: Hashable, Sendable {
        public var did: String
        /// The handle the DID document claims, or the one typed. Nil when there is neither.
        public var handle: String?
        /// The PDS origin, without a trailing slash.
        public var pds: String

        public init(did: String, handle: String?, pds: String) {
            self.did = did
            self.handle = handle
            self.pds = pds
        }
    }

    /// What the PDS says about the repository, from com.atproto.sync.getRepoStatus.
    public enum RepoState: Hashable, Sendable {
        case active
        case inactive(status: String?)
        case unknown(message: String)
    }

    public struct ProfileLabel: Hashable, Sendable {
        public var val: String
        public var src: String

        public init(val: String, src: String) {
            self.val = val
            self.src = src
        }
    }

    public struct FoundProfile: Hashable, Sendable {
        public var handle: String?
        public var displayName: String?
        public var avatar: String?
        public var labels: [ProfileLabel]

        public init(handle: String?, displayName: String?, avatar: String?, labels: [ProfileLabel]) {
            self.handle = handle
            self.displayName = displayName
            self.avatar = avatar
            self.labels = labels
        }
    }

    public enum ProfileState: Hashable, Sendable {
        case found(FoundProfile)
        /// The AppView says it has taken the account down.
        case suspended(message: String)
        case deactivated(message: String)
        /// The AppView has no profile, and does not say why.
        case missing(message: String)
        case error(message: String)

        public var found: FoundProfile? {
            if case .found(let profile) = self { return profile }
            return nil
        }
    }

    public struct ReplyRef: Hashable, Sendable {
        public var parent: String
        public var root: String

        public init(parent: String, root: String) {
            self.parent = parent
            self.root = root
        }
    }

    /// A post as its repository holds it.
    public struct RepoPost: Hashable, Sendable {
        public var uri: String
        public var rkey: String
        public var text: String
        /// When it was written: from a TID record key, else from createdAt.
        public var writtenAt: Date?
        public var reply: ReplyRef?

        public init(uri: String, rkey: String, text: String, writtenAt: Date?, reply: ReplyRef?) {
            self.uri = uri
            self.rkey = rkey
            self.text = text
            self.writtenAt = writtenAt
            self.reply = reply
        }
    }

    /// What the AppView answered when asked for the thread a reply belongs in.
    public enum ThreadAnswer: String, Hashable, Sendable {
        /// The reply is among the parent's replies.
        case shown
        /// It is not, and the thread was short enough to list them all.
        case absent
        /// It is not, but the thread has more replies than one answer lists.
        case crowded
        /// The post it answers is not on the AppView.
        case noParent = "no-parent"
        case error
    }

    /// The thread's reply rules, read for a reply that is absent. `restricted`
    /// is any rule limiting who may reply; `hidden` is this reply being one
    /// the thread's author hid.
    public struct ThreadGate: Hashable, Sendable {
        public var restricted: Bool
        public var hidden: Bool

        public init(restricted: Bool, hidden: Bool) {
            self.restricted = restricted
            self.hidden = hidden
        }
    }

    /// A block between the replier and the author of the parent or the root.
    public struct BlockLookup: Hashable, Sendable {
        public var found: Bool

        public init(found: Bool) {
            self.found = found
        }
    }

    /// One reply, and where it turned up.
    public struct ReplyProbe: Hashable, Sendable {
        public var uri: String
        public var parent: String
        public var root: String
        public var thread: ThreadAnswer
        /// The AppView's words, when the thread could not be read.
        public var message: String?
        public var gate: Lookup<ThreadGate>
        public var block: Lookup<BlockLookup>

        public init(
            uri: String,
            parent: String,
            root: String,
            thread: ThreadAnswer,
            message: String? = nil,
            gate: Lookup<ThreadGate> = .notChecked,
            block: Lookup<BlockLookup> = .notChecked
        ) {
            self.uri = uri
            self.parent = parent
            self.root = root
            self.thread = thread
            self.message = message
            self.gate = gate
            self.block = block
        }
    }

    public struct ActorSearch: Hashable, Sendable {
        /// Full search, for the account's handle.
        public var inSearch: Bool
        /// Typeahead, for the same. Nil when it did not answer.
        public var inTypeahead: Bool?

        public init(inSearch: Bool, inTypeahead: Bool?) {
            self.inSearch = inSearch
            self.inTypeahead = inTypeahead
        }
    }

    /// Everything observed so far. A field left nil is still on its way;
    /// once `done` is set, one left nil was not asked.
    public struct Evidence: Hashable, Sendable {
        public var target: ShadowbanTarget
        public var appview: AppView
        /// When the run started, which the grace periods are measured from.
        public var checkedAt: Date?
        public var identity: Identity?
        public var repo: RepoState?
        public var profile: ProfileState?
        /// From the PDS: the account's most recent posts, whatever was asked about.
        public var posts: Probe<[RepoPost]>?
        /// Of `posts`, the URIs the AppView returned.
        public var shown: Probe<[String]>?
        public var replies: Probe<[ReplyProbe]>?
        public var actorSearch: Probe<ActorSearch>?
        /// URIs of the account's posts that post search returned.
        public var postSearch: Probe<[String]>?
        /// When a post was asked about, the account is checked as above and
        /// the post on its own as well. This is its record from the PDS, or
        /// `.ok(nil)` when the repository has no such record.
        public var post: Probe<RepoPost?>?
        /// The post's URI when the AppView returns it, as `shown` is for `posts`.
        public var postShown: Probe<[String]>?
        /// For a post that is a reply: where it turned up in its thread.
        public var postThread: Probe<ReplyProbe>?
        public var done: Bool

        public init(
            target: ShadowbanTarget,
            appview: AppView,
            checkedAt: Date? = nil,
            identity: Identity? = nil,
            repo: RepoState? = nil,
            profile: ProfileState? = nil,
            posts: Probe<[RepoPost]>? = nil,
            shown: Probe<[String]>? = nil,
            replies: Probe<[ReplyProbe]>? = nil,
            actorSearch: Probe<ActorSearch>? = nil,
            postSearch: Probe<[String]>? = nil,
            post: Probe<RepoPost?>? = nil,
            postShown: Probe<[String]>? = nil,
            postThread: Probe<ReplyProbe>? = nil,
            done: Bool = false
        ) {
            self.target = target
            self.appview = appview
            self.checkedAt = checkedAt
            self.identity = identity
            self.repo = repo
            self.profile = profile
            self.posts = posts
            self.shown = shown
            self.replies = replies
            self.actorSearch = actorSearch
            self.postSearch = postSearch
            self.post = post
            self.postShown = postShown
            self.postThread = postThread
            self.done = done
        }

        var isRepoInactive: Bool {
            if case .inactive? = repo { return true }
            return false
        }

        /// The AppView answered the comparison of recent posts.
        var shownAnswered: Bool {
            if case .ok? = shown { return true }
            return false
        }

        /// A post was asked about and its repository has no such record.
        var postDeleted: Bool {
            guard target.isPost, case .ok(let record)? = post else { return false }
            return record == nil
        }
    }

    // MARK: - Reading records and answers

    private static func strongRefUri(_ value: JSONValue?) -> String? {
        value?["uri"]?.stringValue
    }

    /// A post from a listRecords or getRecord answer.
    public static func readRepoPost(uri: String, value: JSONValue?) -> RepoPost {
        let record: JSONValue? = value?.objectValue != nil ? value : nil
        let rkey = uri.split(separator: "/", omittingEmptySubsequences: false).last.map(String.init) ?? ""
        let fromKey = TID.date(from: rkey)
        var fromField: Date? = nil
        if let createdAt = record?["createdAt"]?.stringValue {
            fromField = Formatting.isoDate(createdAt)
        }
        let reply: JSONValue? = record?["reply"]?.objectValue != nil ? record?["reply"] : nil
        let parent = strongRefUri(reply?["parent"])
        let root = strongRefUri(reply?["root"])
        return RepoPost(
            uri: uri,
            rkey: rkey,
            text: record?["text"]?.stringValue ?? "",
            writtenAt: fromKey ?? fromField,
            reply: parent.map { ReplyRef(parent: $0, root: root ?? $0) }
        )
    }

    public static func readRepoPost(_ record: AtRecord) -> RepoPost {
        readRepoPost(uri: record.uri, value: record.value)
    }

    /// The DID in an at:// URI, or the empty string.
    public static func authorOf(_ uri: String) -> String {
        guard uri.hasPrefix("at://") else { return "" }
        return String(uri.dropFirst("at://".count).prefix { $0 != "/" })
    }

    private static func nonEmpty(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        return value
    }

    /// The AppView's reason for not returning a profile, sorted by what it
    /// means. Bluesky's AppView answers 400 with `AccountTakedown` and
    /// "Account has been suspended" for a takedown, `AccountDeactivated` for
    /// a deactivation, and "Profile not found" for an account it has never
    /// indexed.
    public static func readProfileFailure(status: Int, error: String?, message: String?) -> ProfileState {
        let words = nonEmpty(message) ?? nonEmpty(error) ?? "HTTP \(status)"
        let said = "\(error ?? "") \(message ?? "")".lowercased()
        if status == 400 || status == 404 {
            if said.contains("takedown") || said.contains("suspended") || said.contains("taken down") {
                return .suspended(message: words)
            }
            if said.contains("deactivated") {
                return .deactivated(message: words)
            }
            return .missing(message: words)
        }
        return .error(message: words)
    }

    /// Where a reply is in an answer to getPostThread for its parent.
    /// `replies` is the thread's `replies` array: thread views carry the post
    /// under `post`, and blocked or missing entries carry a bare `uri`.
    public static func placeReply(_ uri: String, replies: JSONValue?) -> ThreadAnswer {
        let list = replies?.arrayValue ?? []
        let found = list.contains { entry in
            guard entry.objectValue != nil else { return false }
            let fromPost: JSONValue? = entry["post"]?.objectValue != nil ? entry["post"]?["uri"] : nil
            let candidate: JSONValue?
            if let fromPost, !fromPost.isNull {
                candidate = fromPost
            } else {
                candidate = entry["uri"]
            }
            return candidate?.stringValue == uri
        }
        if found { return .shown }
        return list.count >= threadReplyCap ? .crowded : .absent
    }

    /// The replies to look up, newest first: those the AppView returned, up to the limit.
    public static func repliesToCheck(_ posts: [RepoPost], shown: [String], limit: Int = Shadowban.repliesChecked) -> [RepoPost] {
        let visible = Set(shown)
        return Array(posts.filter { $0.reply != nil && visible.contains($0.uri) }.prefix(max(0, limit)))
    }

    // MARK: - What it means

    public struct ReplyReading: Hashable, Sendable {
        /// `hidden` counts towards a shadowban. `explained` is left out for a
        /// reason anyone can see. `unknown` could not be told either way.
        public enum Outcome: String, Hashable, Sendable {
            case shown
            case hidden
            case explained
            case unknown
        }

        public var outcome: Outcome
        /// A few words, for a pill.
        public var label: String
        /// A sentence.
        public var reason: String

        public init(outcome: Outcome, label: String, reason: String) {
            self.outcome = outcome
            self.label = label
            self.reason = reason
        }
    }

    public static func readReply(_ reply: ReplyProbe, author: String) -> ReplyReading {
        switch reply.thread {
        case .shown:
            return ReplyReading(outcome: .shown, label: "In its thread", reason: "Appears under the post it replies to.")
        case .crowded:
            return ReplyReading(
                outcome: .unknown,
                label: "Thread too long to tell",
                reason: "The post it replies to has more than \(threadReplyCap) replies, and the AppView only returns \(threadReplyCap) at a time."
            )
        case .noParent:
            return ReplyReading(
                outcome: .unknown,
                label: "Parent not shown",
                reason: "The post it replies to isn’t on the AppView, so there’s no thread to check."
            )
        case .error:
            let reason: String
            if let message = reply.message, !message.isEmpty {
                reason = "The thread didn’t load: \(message)"
            } else {
                reason = "The thread didn’t load."
            }
            return ReplyReading(outcome: .unknown, label: "Thread didn’t load", reason: reason)
        case .absent:
            break
        }

        let rootAuthor = authorOf(reply.root)
        let ownThread = rootAuthor == author && authorOf(reply.parent) == author
        if reply.gate.value?.hidden == true && rootAuthor != author {
            return ReplyReading(
                outcome: .explained,
                label: "Hidden by the thread’s author",
                reason: "The person who started the thread hid this reply."
            )
        }
        if reply.block.value?.found == true {
            return ReplyReading(
                outcome: .explained,
                label: "Block in the thread",
                reason: "There’s a block between this account and someone earlier in the thread. AppViews hide replies when there’s a block."
            )
        }
        if reply.gate.value?.restricted == true && rootAuthor != author {
            return ReplyReading(
                outcome: .explained,
                label: "Thread limits replies",
                reason: "The person who started the thread limits who can reply. AppViews hide replies from people outside that limit."
            )
        }
        var unchecked: [String] = []
        if reply.block.isUnanswered && !ownThread {
            unchecked.append("blocks")
        }
        if reply.gate.isUnanswered && !ownThread {
            unchecked.append("the thread’s reply limits")
        }
        let reason: String
        if ownThread {
            reason = "This reply is in the account’s own thread, where blocks and reply limits don’t apply, and it’s still missing."
        } else {
            let note = unchecked.isEmpty ? "" : " (Couldn’t check \(unchecked.joined(separator: " or ")).)"
            reason = "Missing from the thread, and no block or reply limit explains it.\(note)"
        }
        return ReplyReading(outcome: .hidden, label: "Missing from its thread", reason: reason)
    }

    public enum PostPresence: String, Hashable, Sendable {
        case shown
        case missing
        case new
        case pending
    }

    /// Whether the AppView returned a post, allowing for one too new to be indexed.
    public static func postPresence(_ post: RepoPost, shown: Probe<[String]>?, now: Date) -> PostPresence {
        guard case .ok(let uris)? = shown else { return .pending }
        if uris.contains(post.uri) { return .shown }
        if let writtenAt = post.writtenAt, now.timeIntervalSince(writtenAt) < indexGrace {
            return .new
        }
        return .missing
    }

    public enum CheckStatus: String, Hashable, Sendable {
        case pass
        case warn
        case fail
        case info
        case skip
        case pending
    }

    public enum CheckID: String, Hashable, Sendable {
        case pds
        case profile
        case posts
        case threads
        case actorSearch
        case postSearch
        case postRecord
        case post
        case thread
    }

    public struct ShadowbanCheck: Hashable, Sendable, Identifiable {
        public var id: CheckID
        public var status: CheckStatus
        public var title: String
        public var summary: String
        /// Evidence, one line each.
        public var detail: [String]?

        public init(id: CheckID, status: CheckStatus, title: String, summary: String, detail: [String]? = nil) {
            self.id = id
            self.status = status
            self.title = title
            self.summary = summary
            self.detail = detail
        }
    }

    static func hostOf(_ origin: String) -> String {
        if origin.hasPrefix("https://") { return String(origin.dropFirst("https://".count)) }
        if origin.hasPrefix("http://") { return String(origin.dropFirst("http://".count)) }
        return origin
    }

    /// Labels on the profile that someone other than the account applied.
    public static func moderationLabels(_ labels: [ProfileLabel], did: String) -> [String] {
        var out: [String] = []
        for label in labels where label.src != did && !out.contains(label.val) {
            out.append(label.val)
        }
        return out
    }

    private static func pdsCheck(_ evidence: Evidence) -> ShadowbanCheck {
        let title = "Account on its PDS"
        guard let identity = evidence.identity, let repo = evidence.repo else {
            return ShadowbanCheck(id: .pds, status: .pending, title: title, summary: "Reading the PDS…")
        }
        let host = hostOf(identity.pds)
        switch repo {
        case .inactive(let status):
            return ShadowbanCheck(
                id: .pds,
                status: .warn,
                title: title,
                summary: "\(host) reports the account as \(status ?? "inactive"). AppViews stop showing accounts that their PDS has turned off."
            )
        case .unknown(let message):
            return ShadowbanCheck(id: .pds, status: .info, title: title, summary: "\(host) didn’t say whether the account is active: \(message)")
        case .active:
            return ShadowbanCheck(id: .pds, status: .pass, title: title, summary: "Active on \(host).")
        }
    }

    private static func profileCheck(_ evidence: Evidence) -> ShadowbanCheck {
        let name = evidence.appview.name
        let title = "Profile on \(name)"
        guard let profile = evidence.profile else {
            return ShadowbanCheck(id: .profile, status: .pending, title: title, summary: "Asking the AppView…")
        }
        let found: FoundProfile
        switch profile {
        case .suspended(let message):
            return ShadowbanCheck(
                id: .profile,
                status: .fail,
                title: title,
                summary: "\(name) says “\(message)”. The account is suspended, and the AppView says so openly."
            )
        case .deactivated(let message):
            return ShadowbanCheck(id: .profile, status: .info, title: title, summary: "\(name) says “\(message)”.")
        case .missing(let message):
            return ShadowbanCheck(
                id: .profile,
                status: .fail,
                title: title,
                summary: "\(name) has no profile for this account (“\(message)”). Either it never indexed the account, or it removed it without saying why."
            )
        case .error(let message):
            return ShadowbanCheck(id: .profile, status: .warn, title: title, summary: "\(name) didn’t answer: \(message)")
        case .found(let value):
            found = value
        }
        let did = evidence.identity?.did
        let applied = moderationLabels(found.labels, did: did ?? "")
        let selfHidden = found.labels.contains(where: { $0.val == noUnauthenticated && $0.src == did })
        let detail: [String]? = selfHidden
            ? ["The account has the !no-unauthenticated label, which asks apps to hide it from people who aren’t signed in."]
            : nil
        if !applied.isEmpty {
            let kind = applied.count == 1 ? "a moderation label" : "moderation labels"
            return ShadowbanCheck(
                id: .profile,
                status: .warn,
                title: title,
                summary: "\(name) shows the profile, with \(kind): \(applied.joined(separator: ", ")).",
                detail: detail
            )
        }
        return ShadowbanCheck(
            id: .profile,
            status: .pass,
            title: title,
            summary: "\(name) shows the profile, with no moderation labels.",
            detail: detail
        )
    }

    private static func postsCheck(_ evidence: Evidence, now: Date) -> ShadowbanCheck {
        let name = evidence.appview.name
        let title = "Recent posts on \(name)"
        guard let posts = evidence.posts else {
            return ShadowbanCheck(id: .posts, status: .pending, title: title, summary: "Comparing…")
        }
        let list: [RepoPost]
        switch posts {
        case .failed(let message):
            return ShadowbanCheck(id: .posts, status: .skip, title: title, summary: "The PDS didn’t list the posts: \(message)")
        case .ok(let value):
            list = value
        }
        if !list.isEmpty && evidence.shown == nil {
            return ShadowbanCheck(id: .posts, status: .pending, title: title, summary: "Comparing…")
        }
        if list.isEmpty {
            return ShadowbanCheck(id: .posts, status: .info, title: title, summary: "The account hasn’t posted anything.")
        }
        if case .failed(let message)? = evidence.shown {
            return ShadowbanCheck(id: .posts, status: .warn, title: title, summary: "\(name) didn’t answer: \(message)")
        }

        let presence = list.map { postPresence($0, shown: evidence.shown, now: now) }
        let missing = presence.filter { $0 == .missing }.count
        let fresh = presence.filter { $0 == .new }.count
        let counted = list.count - fresh
        let freshNote: String
        if fresh == 0 {
            freshNote = ""
        } else {
            let howMany = fresh == 1 ? "One post" : "\(fresh) posts"
            let verb = fresh == 1 ? "was" : "were"
            freshNote = " \(howMany) from the last two minutes \(verb) skipped."
        }
        if missing > 0 {
            let verb = missing == 1 ? "is" : "are"
            return ShadowbanCheck(
                id: .posts,
                status: .fail,
                title: title,
                summary: "\(missing) of the \(counted) latest posts \(verb) on the PDS but missing from \(name).\(freshNote)",
                detail: ["An AppView also skips posts it can’t read, such as malformed records, so open one to check."]
            )
        }
        return ShadowbanCheck(
            id: .posts,
            status: .pass,
            title: title,
            summary: "\(name) returns all \(counted) of the latest posts.\(freshNote)"
        )
    }

    private static func threadsCheck(_ evidence: Evidence) -> ShadowbanCheck {
        let title = "Replies in their threads"
        guard let replies = evidence.replies else {
            if evidence.done {
                return ShadowbanCheck(
                    id: .threads,
                    status: .skip,
                    title: title,
                    summary: "Not checked, because the latest posts couldn’t be compared."
                )
            }
            return ShadowbanCheck(id: .threads, status: .pending, title: title, summary: "Opening the threads…")
        }
        let list: [ReplyProbe]
        switch replies {
        case .failed(let message):
            return ShadowbanCheck(id: .threads, status: .warn, title: title, summary: message)
        case .ok(let value):
            list = value
        }
        if list.isEmpty {
            return ShadowbanCheck(id: .threads, status: .skip, title: title, summary: "None of the latest posts on the AppView is a reply.")
        }
        let did = evidence.identity?.did
        let readings = list.map { readReply($0, author: did ?? "") }
        let total = readings.count
        let hidden = readings.filter { $0.outcome == .hidden }.count
        let explained = readings.filter { $0.outcome == .explained }.count
        let unknown = readings.filter { $0.outcome == .unknown }.count
        var notes: [String] = []
        if explained > 0 {
            let lead = explained == 1 ? "One more is" : "\(explained) more are"
            notes.append("\(lead) hidden because of a block or a reply limit.")
        }
        if unknown > 0 {
            let lead = unknown == 1 ? "One reply" : "\(unknown) replies"
            notes.append("\(lead) couldn’t be checked.")
        }
        if hidden > 0 {
            var own = 0
            for (reply, reading) in zip(list, readings) where reading.outcome == .hidden && authorOf(reply.root) == did {
                own += 1
            }
            let ownNote: String
            if own == 0 {
                ownNote = ""
            } else if own == hidden {
                ownNote = hidden == 1 ? " It’s a reply in the account’s own thread." : " All of them are in the account’s own threads."
            } else {
                ownNote = " \(own) of them are in the account’s own threads."
            }
            let verb = hidden == 1 ? "is" : "are"
            let place = hidden == 1 ? "its thread" : "their threads"
            return ShadowbanCheck(
                id: .threads,
                status: .fail,
                title: title,
                summary: "\(hidden) of \(total) recent replies \(verb) missing from \(place), and no block or reply limit explains it.\(ownNote)",
                detail: notes.isEmpty ? nil : notes
            )
        }
        let shownCount = readings.filter { $0.outcome == .shown }.count
        if shownCount == 0 {
            let joined = notes.joined(separator: " ")
            return ShadowbanCheck(id: .threads, status: .info, title: title, summary: joined.isEmpty ? "Couldn’t check." : joined)
        }
        let summary: String
        if shownCount == total {
            if total == 1 {
                summary = "The recent reply appears under the post it replies to."
            } else {
                let all = total == 2 ? "Both" : "All \(total)"
                summary = "\(all) recent replies appear under the posts they reply to."
            }
        } else {
            summary = "\(shownCount) of \(total) recent replies appear under the posts they reply to. \(notes.joined(separator: " "))"
        }
        return ShadowbanCheck(id: .threads, status: .pass, title: title, summary: summary)
    }

    private static func actorSearchCheck(_ evidence: Evidence) -> ShadowbanCheck {
        let name = evidence.appview.name
        let title = "Account in search"
        let handle = evidence.identity?.handle
        let hasHandle = !(handle ?? "").isEmpty
        guard let actorSearch = evidence.actorSearch else {
            if evidence.done {
                return ShadowbanCheck(
                    id: .actorSearch,
                    status: .skip,
                    title: title,
                    summary: hasHandle ? "Not checked." : "The account has no handle to search for."
                )
            }
            return ShadowbanCheck(id: .actorSearch, status: .pending, title: title, summary: "Searching…")
        }
        let result: ActorSearch
        switch actorSearch {
        case .failed(let message):
            return ShadowbanCheck(
                id: .actorSearch,
                status: .skip,
                title: title,
                summary: "\(name) didn’t answer an account search (\(message)), so this wasn’t checked."
            )
        case .ok(let value):
            result = value
        }
        let shownHandle = handle ?? ""
        if result.inSearch {
            return ShadowbanCheck(id: .actorSearch, status: .pass, title: title, summary: "Searching for \(shownHandle) finds it.")
        }
        let did = evidence.identity?.did
        let selfHidden = evidence.profile?.found?.labels.contains(where: { $0.val == noUnauthenticated && $0.src == did }) ?? false
        if selfHidden {
            return ShadowbanCheck(
                id: .actorSearch,
                status: .info,
                title: title,
                summary: "Searching for \(shownHandle) doesn’t find it. That’s expected, because the account asks to be hidden from people who aren’t signed in, and this search runs signed out."
            )
        }
        if result.inTypeahead == true {
            return ShadowbanCheck(
                id: .actorSearch,
                status: .fail,
                title: title,
                summary: "Searching for \(shownHandle) doesn’t find it, but typeahead does. \(name) has the account and is leaving it out of search."
            )
        }
        return ShadowbanCheck(
            id: .actorSearch,
            status: .warn,
            title: title,
            summary: "Neither search nor typeahead finds \(shownHandle). \(name) may not have indexed the handle yet."
        )
    }

    private static func postSearchCheck(_ evidence: Evidence, now: Date) -> ShadowbanCheck {
        let name = evidence.appview.name
        let title = "Posts in search"
        guard let postSearch = evidence.postSearch else {
            if evidence.done {
                return ShadowbanCheck(id: .postSearch, status: .skip, title: title, summary: "Not checked.")
            }
            return ShadowbanCheck(id: .postSearch, status: .pending, title: title, summary: "Searching…")
        }
        let found: [String]
        switch postSearch {
        case .failed(let message):
            return ShadowbanCheck(
                id: .postSearch,
                status: .skip,
                title: title,
                summary: "\(name) didn’t answer a post search (\(message)), so this wasn’t checked."
            )
        case .ok(let value):
            found = value
        }
        guard case .ok(let posts)? = evidence.posts, case .ok(let shown)? = evidence.shown else {
            return ShadowbanCheck(
                id: .postSearch,
                status: .skip,
                title: title,
                summary: "Not checked, because the latest posts couldn’t be compared."
            )
        }
        let visible = Set(shown)
        let eligible = posts.filter { post in
            guard let writtenAt = post.writtenAt else { return false }
            return visible.contains(post.uri) && now.timeIntervalSince(writtenAt) >= searchGrace
        }
        if eligible.isEmpty {
            return ShadowbanCheck(
                id: .postSearch,
                status: .skip,
                title: title,
                summary: "None of the latest posts is old enough to be in search yet. Search runs a few minutes behind."
            )
        }
        let foundSet = Set(found)
        let hits = eligible.filter { foundSet.contains($0.uri) }.count
        if hits == eligible.count {
            return ShadowbanCheck(id: .postSearch, status: .pass, title: title, summary: "Search finds all \(eligible.count) recent posts.")
        }
        if hits == 0 {
            return ShadowbanCheck(
                id: .postSearch,
                status: .fail,
                title: title,
                summary: "Search finds none of the \(eligible.count) recent posts that \(name) returns."
            )
        }
        return ShadowbanCheck(
            id: .postSearch,
            status: .warn,
            title: title,
            summary: "Search finds \(hits) of the \(eligible.count) recent posts that \(name) returns."
        )
    }

    private static func postRecordCheck(_ evidence: Evidence) -> ShadowbanCheck {
        let title = "Post on its PDS"
        guard let identity = evidence.identity, let post = evidence.post else {
            return ShadowbanCheck(id: .postRecord, status: .pending, title: title, summary: "Reading the PDS…")
        }
        let host = hostOf(identity.pds)
        if evidence.isRepoInactive {
            return ShadowbanCheck(
                id: .postRecord,
                status: .skip,
                title: title,
                summary: "Not checked, because the account isn’t active on its PDS."
            )
        }
        switch post {
        case .failed(let message):
            return ShadowbanCheck(id: .postRecord, status: .warn, title: title, summary: "\(host) didn’t answer: \(message)")
        case .ok(let record):
            if record == nil {
                return ShadowbanCheck(
                    id: .postRecord,
                    status: .warn,
                    title: title,
                    summary: "\(host) has no post at this address, so it was deleted. There’s nothing for an AppView to hide."
                )
            }
            return ShadowbanCheck(id: .postRecord, status: .pass, title: title, summary: "The post is in the account’s repository on \(host).")
        }
    }

    private static func postCheck(_ evidence: Evidence, now: Date) -> ShadowbanCheck {
        let name = evidence.appview.name
        let title = "Post on \(name)"
        guard let post = evidence.post else {
            return ShadowbanCheck(id: .post, status: .pending, title: title, summary: "Comparing…")
        }
        guard case .ok(let maybeRecord) = post, let record = maybeRecord else {
            return ShadowbanCheck(id: .post, status: .skip, title: title, summary: "Not checked, because there’s no post to compare.")
        }
        guard let postShown = evidence.postShown else {
            return ShadowbanCheck(id: .post, status: .pending, title: title, summary: "Asking the AppView…")
        }
        if case .failed(let message) = postShown {
            return ShadowbanCheck(id: .post, status: .warn, title: title, summary: "\(name) didn’t answer: \(message)")
        }
        switch postPresence(record, shown: postShown, now: now) {
        case .shown:
            return ShadowbanCheck(id: .post, status: .pass, title: title, summary: "\(name) returns the post.")
        case .new:
            return ShadowbanCheck(
                id: .post,
                status: .info,
                title: title,
                summary: "Posted less than two minutes ago. The AppView may not have it yet."
            )
        case .missing, .pending:
            return ShadowbanCheck(
                id: .post,
                status: .fail,
                title: title,
                summary: "The post is on the PDS, but \(name) won’t return it.",
                detail: ["An AppView also skips posts it can’t read, such as malformed records."]
            )
        }
    }

    private static func threadCheck(_ evidence: Evidence) -> ShadowbanCheck {
        let title = "In its thread"
        var record: RepoPost? = nil
        if case .ok(let value)? = evidence.post {
            guard let value else {
                return ShadowbanCheck(id: .thread, status: .skip, title: title, summary: "Not checked, because there’s no post.")
            }
            record = value
        }
        if let record, record.reply == nil {
            return ShadowbanCheck(id: .thread, status: .skip, title: title, summary: "It isn’t a reply, so there’s no thread to check.")
        }
        if let record, case .ok(let uris)? = evidence.postShown, !uris.contains(record.uri) {
            return ShadowbanCheck(
                id: .thread,
                status: .skip,
                title: title,
                summary: "Not checked, because the AppView doesn’t return the post at all."
            )
        }
        guard let postThread = evidence.postThread else {
            if evidence.done {
                return ShadowbanCheck(id: .thread, status: .skip, title: title, summary: "Not checked.")
            }
            return ShadowbanCheck(id: .thread, status: .pending, title: title, summary: "Opening the thread…")
        }
        switch postThread {
        case .failed(let message):
            return ShadowbanCheck(id: .thread, status: .warn, title: title, summary: message)
        case .ok(let probe):
            // Asked about this one post, a reply left out for a reason anyone
            // can see is still worth a warning: it is the thing that was asked
            // about.
            let reading = readReply(probe, author: evidence.identity?.did ?? "")
            let status: CheckStatus
            switch reading.outcome {
            case .shown: status = .pass
            case .hidden: status = .fail
            case .explained: status = .warn
            case .unknown: status = .info
            }
            return ShadowbanCheck(id: .thread, status: status, title: title, summary: reading.reason)
        }
    }

    /// The checks about the post that was asked about. None when an account was.
    public static func buildPostChecks(_ evidence: Evidence, now: Date) -> [ShadowbanCheck] {
        guard evidence.target.isPost else { return [] }
        return [postRecordCheck(evidence), postCheck(evidence, now: now), threadCheck(evidence)]
    }

    /// The checks about the account, which run whether an account or a post was asked about.
    public static func buildAccountChecks(_ evidence: Evidence, now: Date) -> [ShadowbanCheck] {
        [
            pdsCheck(evidence),
            profileCheck(evidence),
            postsCheck(evidence, now: now),
            threadsCheck(evidence),
            actorSearchCheck(evidence),
            postSearchCheck(evidence, now: now),
        ]
    }

    /// Every check for what has been observed so far: the post's first, when
    /// a post was asked about, then the account's. `now` is when the
    /// comparison is made, so the grace periods can be tested.
    public static func buildChecks(_ evidence: Evidence, now: Date) -> [ShadowbanCheck] {
        buildPostChecks(evidence, now: now) + buildAccountChecks(evidence, now: now)
    }

    static let postCheckIds: Set<CheckID> = [.postRecord, .post, .thread]

    public struct ShadowbanVerdict: Hashable, Sendable {
        public enum Tone: String, Hashable, Sendable {
            case pass
            case warn
            case fail
            case pending
        }

        public var tone: Tone
        public var title: String
        public var text: String

        public init(tone: Tone, title: String, text: String) {
            self.tone = tone
            self.title = title
            self.text = text
        }
    }

    /// The answer in one line, from the checks.
    ///
    /// One sentence differs from the web's: an AppView that answered nothing
    /// is described as not answering rather than as refusing "a browser".
    public static func shadowbanVerdict(_ evidence: Evidence, checks: [ShadowbanCheck]) -> ShadowbanVerdict {
        let name = evidence.appview.name
        let isPost = evidence.target.isPost
        func summary(of id: CheckID) -> String {
            checks.first(where: { $0.id == id })?.summary ?? ""
        }

        if checks.contains(where: { $0.status == .pending }) {
            return ShadowbanVerdict(
                tone: .pending,
                title: "Checking on \(name)",
                text: "Reading the posts from the PDS and asking the AppView for the same ones."
            )
        }
        if evidence.isRepoInactive {
            return ShadowbanVerdict(tone: .warn, title: "The account isn’t active on its PDS", text: summary(of: .pds))
        }
        switch evidence.profile {
        case .suspended?:
            return ShadowbanVerdict(tone: .fail, title: "Suspended on \(name)", text: summary(of: .profile))
        case .missing?:
            return ShadowbanVerdict(tone: .fail, title: "\(name) doesn’t show this account", text: summary(of: .profile))
        case .error?:
            // No answer about the profile or the posts leaves nothing
            // compared, which must not read as "nothing hidden".
            if !evidence.shownAnswered {
                return ShadowbanVerdict(
                    tone: .warn,
                    title: "\(name) didn’t answer",
                    text: "Nothing could be compared. Check that \(hostOf(evidence.appview.origin)) is an AppView that answers requests like these."
                )
            }
        case .found?, .deactivated?, nil:
            break
        }

        let failed = checks.filter { $0.status == .fail }
        let postFailed = failed.filter { postCheckIds.contains($0.id) }
        let accountFailed = failed.filter { !postCheckIds.contains($0.id) }
        func summaries(_ list: [ShadowbanCheck]) -> String {
            list.map { $0.summary }.joined(separator: " ")
        }
        let deleted = evidence.postDeleted

        // A post that was asked about leads the answer, but the account's own
        // findings are never dropped from it.
        if !accountFailed.isEmpty {
            let lead: String
            if !isPost {
                lead = ""
            } else if deleted {
                lead = "This post was deleted. "
            } else if !postFailed.isEmpty {
                lead = "\(summaries(postFailed)) "
            } else {
                lead = "The post itself shows on \(name). "
            }
            return ShadowbanVerdict(tone: .fail, title: "Possible shadowban on \(name)", text: "\(lead)\(summaries(accountFailed))")
        }
        if deleted {
            return ShadowbanVerdict(tone: .warn, title: "This post was deleted", text: summary(of: .postRecord))
        }
        if !postFailed.isEmpty {
            return ShadowbanVerdict(tone: .fail, title: "This post is hidden on \(name)", text: summaries(postFailed))
        }
        let warned = checks.filter { $0.status == .warn }
        if !warned.isEmpty {
            let count = warned.count == 1 ? "one warning" : "\(warned.count) warnings"
            return ShadowbanVerdict(
                tone: .warn,
                title: "No shadowban found on \(name), with \(count)",
                text: summaries(warned)
            )
        }
        return ShadowbanVerdict(
            tone: .pass,
            title: "No shadowban found on \(name)",
            text: isPost ? "\(name) shows the post and everything else that was checked." : "\(name) shows everything that was checked."
        )
    }
}

extension Shadowban.Probe: Equatable where Value: Equatable {}
extension Shadowban.Probe: Hashable where Value: Hashable {}
extension Shadowban.Probe: Sendable where Value: Sendable {}
