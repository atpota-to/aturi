import Foundation
import Observation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// Port of src/components/explore/RecordExplorer.tsx and the state half of
// the sections it renders: RichRecordCard.tsx (which records get a rendered
// card, and the AppView thread behind a post's), EngagementSidecar.tsx (the
// counts strip under a non-post record), LexiconUsageCard.tsx (seven-day
// UFOs figures for the record's lexicon) and the featured backlinks card,
// which is a `BacklinksModel` of its own.
//
// The pipeline is the page's: `resolveIdentifier` on the repo segment, then
// `getRecord` from the account's PDS, then the helper sections. As on the
// web the helpers wait for the record: a record that fails to load shows
// the error panel with the backlinks card and the copy row beneath it, and
// nothing else is fetched. The record page's sections come from the user's
// preferences (Settings > Sections) in their order; the three data views
// keep a toggle on the page even when hidden, helper sections simply
// disappear.

/// The rendered card above the field table, when the record has one:
/// the Bluesky post card or one of the at.margin.* cards.
public enum RecordRichCard: Hashable, Sendable {
    case post(BskyPost, parent: BskyPost?)
    case margin(MarginLexiconType, AtRecord)
}

/// The seven figures the engagement strip can show, in the order the web
/// lists them. The first four come from a post thread, the last three
/// from a profile.
public enum RecordEngagementKind: String, Hashable, Sendable, CaseIterable {
    case replies, reposts, likes, quotes, followers, following, posts
}

public struct RecordEngagementStat: Hashable, Sendable, Identifiable {
    public let kind: RecordEngagementKind
    public let value: Int

    public init(kind: RecordEngagementKind, value: Int) {
        self.kind = kind
        self.value = value
    }

    public var id: RecordEngagementKind { kind }
    /// The word printed after the number ("likes", "followers").
    public var label: String { kind.rawValue }
}

/// What `LexiconUsageCard` shows: seven-day creates and repos for the
/// record's lexicon, plus the twelve-hour creates series behind its
/// sparkline.
public struct LexiconUsageSummary: Hashable, Sendable {
    public static let heading = "Lexicon usage \u{00B7} across the atmosphere \u{00B7} 7d"
    public static let linkLabel = "Explore this lexicon"

    public let collection: String
    public let counts: JustCount
    /// Creates per bucket, oldest first; empty when the series failed.
    public let series: [Int]

    public init(collection: String, counts: JustCount, series: [Int]) {
        self.collection = collection
        self.counts = counts
        self.series = series
    }

    /// `series.some((v) => v > 0)`: the sparkline is drawn only when there
    /// is something to draw.
    public var hasSparkline: Bool {
        series.contains { $0 > 0 }
    }

    public var createsText: String { UFOsFormat.formatCount(counts.creates) }
    public var reposText: String { UFOsFormat.formatCount(counts.didsEstimate) }
    /// Where the card links: the lexicon's detail page.
    public var lexiconPath: String { NSID.lexiconPathFor(collection) }
    public var title: String { "Explore usage of \(collection) across the atmosphere" }
    public var sparklineLabel: String { "\(collection) activity over the last 7 days" }
}

/// The error panel for a record that would not load. Port of
/// `parseRecordError` + `RecordErrorPanel`: the raw PDS message is parsed
/// for the status and the XRPC error code, "not found" gets plain
/// language (and, for a lexicon schema, a pointer at the lexicon's usage
/// page), everything else a generic load failure. The raw text stays
/// available for the "Technical details" disclosure.
public struct RecordFailure: Hashable, Sendable {
    public static let detailsLabel = "Technical details"

    public let raw: String
    public let status: Int?
    public let code: String?
    public let isNotFound: Bool
    public let isSchema: Bool
    /// The small-caps label: "Not found" or "Error".
    public let eyebrow: String
    public let headline: String
    public let body: String
    /// For a schema that was never published: the lexicon's usage page.
    public let lexiconPath: String?
    public let lexiconLinkLabel: String?

    public init(raw: String, collection: String, rkey: String, handle: String) {
        let parsed = RecordFailure.parse(raw)
        let notFound = parsed.code == "RecordNotFound"
            || parsed.status == 404
            || raw.range(of: "RecordNotFound", options: .caseInsensitive) != nil
        let isSchema = collection == RecordModel.schemaCollection

        self.raw = raw
        self.status = parsed.status
        self.code = parsed.code
        self.isNotFound = notFound
        self.isSchema = isSchema
        self.eyebrow = notFound ? "Not found" : "Error"

        if notFound, isSchema {
            headline = "No schema published for this lexicon"
            body = "\(rkey) is used across the network, but @\(handle) hasn\u{2019}t published a com.atproto.lexicon.schema record defining it. That\u{2019}s common: a lexicon can be widely adopted without a formal schema record in its owner\u{2019}s repository."
            lexiconPath = NSID.lexiconPathFor(rkey)
            lexiconLinkLabel = "See how \(rkey) is used across the atmosphere"
        } else if notFound {
            headline = "This record doesn\u{2019}t exist"
            body = "We couldn\u{2019}t find a \(collection) record with key \(rkey) in @\(handle)\u{2019}s repository. It may have been deleted, or the link may be incorrect."
            lexiconPath = nil
            lexiconLinkLabel = nil
        } else {
            headline = "Couldn\u{2019}t load this record"
            let statusClause = parsed.status.map { " (HTTP \($0))" } ?? ""
            body = "The PDS returned an error\(statusClause) while fetching this record. It might be a temporary problem. Try again in a moment."
            lexiconPath = nil
            lexiconLinkLabel = nil
        }
    }

    /// Pull the HTTP status and the XRPC error code out of the raw error
    /// string (`HTTP <status> <text> for <url> :: <json-body>`). The body
    /// may be truncated, so JSON parsing is best-effort and detection also
    /// falls back to substring matching in the initialiser.
    private static func parse(_ raw: String) -> (status: Int?, code: String?) {
        var status: Int?
        if raw.hasPrefix("HTTP ") {
            let digits = raw.dropFirst("HTTP ".count).prefix { $0.isASCII && $0.isNumber }
            status = Int(digits)
        }
        var code: String?
        if let separator = raw.range(of: "::") {
            let tail = raw[separator.upperBound...].trimmingCharacters(in: .whitespacesAndNewlines)
            if let json = try? JSONValue.parse(Data(tail.utf8)), let error = json["error"]?.stringValue {
                code = error
            }
        }
        return (status, code)
    }
}

/// The values behind the record page's row of copy buttons and outbound
/// links. Port of `CopyRow`'s props.
public struct RecordCopyRow: Hashable, Sendable {
    public let atUri: String
    public let did: String
    public let pds: String
    /// The canonical `/profile/` universal link on aturi.to.
    public let universalLink: String
    /// The same link's path, for in-app navigation to the universal-link page.
    public let universalPath: String
    /// `JSON.stringify(record, null, 2)`; nil until the record lands.
    public let recordJSON: String?
    /// The PDS XRPC URL that serves the raw record ("View on PDS").
    public let pdsRecordURL: URL?

    public init(
        atUri: String,
        did: String,
        pds: String,
        universalLink: String,
        universalPath: String,
        recordJSON: String? = nil,
        pdsRecordURL: URL? = nil
    ) {
        self.atUri = atUri
        self.did = did
        self.pds = pds
        self.universalLink = universalLink
        self.universalPath = universalPath
        self.recordJSON = recordJSON
        self.pdsRecordURL = pdsRecordURL
    }
}

/// One section of the read-mode page, in the user's order. Data views are
/// listed even when hidden so their toggle stays on the page.
public struct RecordSection: Hashable, Sendable, Identifiable {
    public let id: String
    public let hidden: Bool
    public let isDataView: Bool

    public init(id: String, hidden: Bool, isDataView: Bool) {
        self.id = id
        self.hidden = hidden
        self.isDataView = isDataView
    }

    /// The quiet text switch under a data view; nil for helper sections.
    public var toggleLabel: String? {
        switch id {
        case "richPreview": return hidden ? "Show rich preview" : "Hide rich preview"
        case "structuredJson": return hidden ? "Show rich JSON preview" : "Hide rich JSON preview"
        case "rawJson": return hidden ? "Show raw JSON" : "Hide raw JSON"
        default: return nil
        }
    }
}

@MainActor
@Observable
public final class RecordModel {
    public nonisolated static let postCollection = "app.bsky.feed.post"
    public nonisolated static let feedNamespace = "app.bsky.feed."
    public nonisolated static let profileCollection = "app.bsky.actor.profile"
    public nonisolated static let schemaCollection = "com.atproto.lexicon.schema"
    /// `WINDOW_HOURS`: the usage card looks back a week.
    public nonisolated static let usageWindowHours: Double = 24 * 7
    /// `SERIES_STEP`: twelve-hour buckets over that week.
    public nonisolated static let usageSeriesStep = 60 * 60 * 12
    /// `DATA_VIEW_IDS`: sections that keep their switch when collapsed.
    public nonisolated static let dataViewSectionIds: Set<String> = ["richPreview", "structuredJson", "rawJson"]

    // Copy, verbatim from the component.
    public nonisolated static let signInPrompt = "Sign in with your handle to edit your own records."
    public nonisolated static let editLabel = "Edit record"
    public nonisolated static let identityFailureEyebrow = "Couldn\u{2019}t resolve"
    public nonisolated static let identityFailureHeadline = "That handle didn\u{2019}t resolve."
    public nonisolated static let universalLinkPageLabel = "Universal link page"
    public nonisolated static let viewOnPdsLabel = "View on PDS"
    public nonisolated static let lexiconUsageUnavailable = "Lexicon usage unavailable"

    /// The route segments: repo as typed, collection, rkey as it came off
    /// the URL (`decodedRkey` is what the PDS is asked for).
    public let repo: String
    public let collection: String
    public let rkey: String
    /// `decodeURIComponent(rkey)`, falling back to the raw segment.
    public let decodedRkey: String

    /// The resolved account. `failed` carries the resolver's message, which
    /// the not-found panel quotes.
    public private(set) var identity: Loadable<IdentityBundle> = .idle
    /// The record from the account's PDS. `failed` carries the raw PDS
    /// message; `failure` is its parsed, human-readable form.
    public private(set) var record: Loadable<AtRecord> = .idle
    /// The AppView thread behind a post's rich card: `loaded(nil)` when the
    /// AppView has no live post for the URI (no card, as on the web).
    /// `idle` for anything but a post.
    public private(set) var postThread: Loadable<PostThread?> = .idle
    /// The engagement strip's figures; `loaded([])` renders nothing. `idle`
    /// for a post, whose figures are on the card.
    public private(set) var engagement: Loadable<[RecordEngagementStat]> = .idle
    /// The lexicon usage card; `failed` means the card stays invisible
    /// rather than showing a broken one.
    public private(set) var lexiconUsage: Loadable<LexiconUsageSummary> = .idle
    /// The featured backlinks card, pointed at the record's AT URI once the
    /// identity resolves.
    public let backlinks: BacklinksModel
    /// The signed-in account, if any: decides `canEdit` and the sign-in prompt.
    public var session: SessionState
    /// The section arrangement and visibility (Settings > Sections).
    public let preferences: PreferencesStore

    @ObservationIgnored private let resolver: IdentityResolver
    @ObservationIgnored private let pds: PDSClient
    @ObservationIgnored private let appView: AppViewClient
    @ObservationIgnored private let ufos: UFOsClient
    @ObservationIgnored private var loadTask: Task<Void, Never>?

    /// - Parameters:
    ///   - preferences: the store the sections come from; defaults to the
    ///     app group suite.
    ///   - http: the transport every lookup goes through. The shared client
    ///     uses the shared identity resolver (and its caches); a test
    ///     transport gets a resolver of its own.
    ///   - identity: an explicit resolver, overriding the rule above.
    ///   - hydratesBacklinks: whether the backlinks card fills its rows in
    ///     through Slingshot.
    public init(
        repo: String,
        collection: String,
        rkey: String,
        preferences: PreferencesStore? = nil,
        http: HTTPClient = .shared,
        identity: IdentityResolver? = nil,
        session: SessionState = .signedOut,
        hydratesBacklinks: Bool = true
    ) {
        self.repo = repo
        self.collection = collection
        self.rkey = rkey
        self.decodedRkey = rkey.removingPercentEncoding ?? rkey
        self.preferences = preferences ?? PreferencesStore()
        self.session = session
        self.resolver = identity ?? (http === HTTPClient.shared ? IdentityResolver.shared : IdentityResolver(http: http))
        self.pds = PDSClient(http: http)
        self.appView = AppViewClient(client: http)
        self.ufos = UFOsClient(http: http)
        self.backlinks = BacklinksModel(http: http, hydrates: hydratesBacklinks)
    }

    // MARK: Loading

    /// Resolve the repo and fetch the record, cancelling whatever was in flight.
    public func load() {
        loadTask?.cancel()
        backlinks.cancel()
        identity = .loading
        record = .idle
        postThread = .idle
        engagement = .idle
        lexiconUsage = .idle
        loadTask = Task { [weak self] in
            await self?.perform()
        }
    }

    /// The retry affordance and pull to refresh.
    public func reload() {
        load()
    }

    /// `load` and wait for everything to settle, backlinks included.
    public func loadAndWait() async {
        load()
        await loadTask?.value
        await backlinks.awaitLoad()
    }

    public func awaitLoad() async {
        await loadTask?.value
    }

    public func cancel() {
        loadTask?.cancel()
        loadTask = nil
        backlinks.cancel()
    }

    private func perform() async {
        let bundle: IdentityBundle
        do {
            bundle = try await resolver.resolveIdentifier(repo)
        } catch {
            guard !Task.isCancelled else { return }
            identity = .failed(RecordModel.describeIdentityFailure(error, input: repo))
            return
        }
        guard !Task.isCancelled else { return }
        identity = .loaded(bundle)

        let atUri = "at://\(bundle.did)/\(collection)/\(decodedRkey)"
        backlinks.load(target: atUri)

        record = .loading
        do {
            let fetched = try await pds.getRecord(pds: bundle.pds, repo: bundle.did, collection: collection, rkey: decodedRkey)
            guard !Task.isCancelled else { return }
            record = .loaded(fetched)
        } catch {
            guard !Task.isCancelled else { return }
            record = .failed(RecordModel.describeRecordFailure(error))
            return
        }

        let isPost = self.isPost
        let wantsEngagement = isEngagementApplicable
        if isPost { postThread = .loading }
        if wantsEngagement { engagement = .loading }
        lexiconUsage = .loading
        let did = bundle.did
        await withTaskGroup(of: Void.self) { group in
            if isPost {
                group.addTask { [weak self] in await self?.loadPostThread(atUri) }
            }
            if wantsEngagement {
                group.addTask { [weak self] in await self?.loadEngagement(did: did, atUri: atUri) }
            }
            group.addTask { [weak self] in await self?.loadLexiconUsage() }
        }
    }

    /// `fetchPostThread(atUri)` for the post card: the anchor and its parent.
    private func loadPostThread(_ atUri: String) async {
        let thread = await appView.getPostThread(atUri)
        guard !Task.isCancelled else { return }
        postThread = .loaded(thread)
    }

    /// Port of EngagementSidecar's effect: feed records ask the AppView for
    /// the thread's counts, profile records for the account's; anything
    /// else has no figures and renders nothing.
    private func loadEngagement(did: String, atUri: String) async {
        let stats: [RecordEngagementStat]
        if collection.hasPrefix(RecordModel.feedNamespace) {
            let thread = await appView.getPostThread(atUri)
            stats = thread.map { RecordModel.engagementStats(of: $0.post) } ?? []
        } else if collection == RecordModel.profileCollection {
            let profile = await appView.getProfile(did)
            stats = profile.map { RecordModel.engagementStats(of: $0) } ?? []
        } else {
            stats = []
        }
        guard !Task.isCancelled else { return }
        engagement = .loaded(stats)
    }

    /// Port of LexiconUsageCard's effect: stats and the series are fetched
    /// together; the card hides on a stats failure, and a failed series
    /// only drops the sparkline.
    private func loadLexiconUsage() async {
        let target = lexiconUsageCollection
        let since = UFOsClient.isoAgo(hours: RecordModel.usageWindowHours)
        let ufos = self.ufos
        async let statsLookup = ufos.fetchCollectionStats(collections: [target], since: since)
        async let seriesLookup = ufos.fetchTimeseries(collection: target, since: since, step: RecordModel.usageSeriesStep)
        let (stats, series) = await (statsLookup, seriesLookup)
        guard !Task.isCancelled else { return }
        guard !stats.failed else {
            lexiconUsage = .failed(RecordModel.lexiconUsageUnavailable)
            return
        }
        let counts = stats.stats[target] ?? .zero
        let points = series.failed ? [] : (series.series[target]?.map(\.creates) ?? [])
        lexiconUsage = .loaded(LexiconUsageSummary(collection: target, counts: counts, series: points))
    }

    // MARK: Identity

    public var identityBundle: IdentityBundle? {
        identity.value
    }

    public var did: String? {
        identity.value?.did
    }

    /// `identity.handle || identity.did`: the repo segment the page prints
    /// and hands to links.
    public var handleOrDid: String? {
        guard let bundle = identity.value else { return nil }
        if let handle = bundle.handle, !handle.isEmpty { return handle }
        return bundle.did
    }

    /// `at://did/collection/rkey`, nil until the identity resolves.
    public var atUri: String? {
        did.map { "at://\($0)/\(collection)/\(decodedRkey)" }
    }

    /// The not-found panel's body when the repo would not resolve.
    public var identityFailureBody: String? {
        guard let message = identity.errorMessage else { return nil }
        return "We tried to resolve \"\(repo)\" and the AT Protocol resolver returned: \(message). Try another handle, DID, or AT URI below."
    }

    // MARK: Record

    public var recordValue: AtRecord? {
        record.value
    }

    /// The parsed error panel, nil unless the record failed to load.
    public var failure: RecordFailure? {
        guard let raw = record.errorMessage else { return nil }
        return RecordFailure(raw: raw, collection: collection, rkey: decodedRkey, handle: handleOrDid ?? repo)
    }

    public var isPost: Bool {
        collection == RecordModel.postCollection
    }

    public var marginType: MarginLexiconType? {
        MarginLexicons.type(of: collection)
    }

    /// `recordHasRichCard`: posts and the at.margin.* lexicons get a card;
    /// a generic record's rich view is the field table.
    public var hasRichCard: Bool {
        isPost || marginType != nil
    }

    /// The card to draw, nil while a post's thread loads, when the AppView
    /// has no post for the URI, and for records without a card.
    public var richCard: RecordRichCard? {
        if isPost {
            guard case .loaded(let thread?) = postThread else { return nil }
            return .post(thread.post, parent: thread.parent)
        }
        if let type = marginType, let value = record.value {
            return .margin(type, value)
        }
        return nil
    }

    /// The engagement strip belongs to non-post records; a post's counts
    /// are on its card.
    public var isEngagementApplicable: Bool {
        !isPost
    }

    /// The counts a post carries, in strip order, skipping any the AppView
    /// did not send.
    public nonisolated static func engagementStats(of post: BskyPost) -> [RecordEngagementStat] {
        var out: [RecordEngagementStat] = []
        if let replies = post.replyCount { out.append(RecordEngagementStat(kind: .replies, value: replies)) }
        if let reposts = post.repostCount { out.append(RecordEngagementStat(kind: .reposts, value: reposts)) }
        if let likes = post.likeCount { out.append(RecordEngagementStat(kind: .likes, value: likes)) }
        if let quotes = post.quoteCount { out.append(RecordEngagementStat(kind: .quotes, value: quotes)) }
        return out
    }

    /// The counts a profile carries, in strip order.
    public nonisolated static func engagementStats(of profile: BskyProfile) -> [RecordEngagementStat] {
        var out: [RecordEngagementStat] = []
        if let followers = profile.followersCount { out.append(RecordEngagementStat(kind: .followers, value: followers)) }
        if let follows = profile.followsCount { out.append(RecordEngagementStat(kind: .following, value: follows)) }
        if let posts = profile.postsCount { out.append(RecordEngagementStat(kind: .posts, value: posts)) }
        return out
    }

    /// A lexicon schema record is about the lexicon it defines, so the
    /// usage card reads its rkey (the NSID) rather than the schema
    /// collection itself.
    public var lexiconUsageCollection: String {
        collection == RecordModel.schemaCollection ? decodedRkey : collection
    }

    // MARK: Copy row

    /// The copy buttons and outbound links, nil until the identity resolves.
    public var copyRow: RecordCopyRow? {
        guard let bundle = identity.value, let handleOrDid, let atUri else { return nil }
        // The universal link uses the canonical `/profile/` path; the bare
        // `/<handle>/<collection>/<rkey>` form still resolves but shareable
        // copies point at the canonical one.
        let path = "/profile/\(handleOrDid)/\(collection)/\(URIEncoding.encodeComponent(decodedRkey))"
        return RecordCopyRow(
            atUri: atUri,
            did: bundle.did,
            pds: bundle.pds,
            universalLink: Endpoints.aturiBase.absoluteString + path,
            universalPath: path,
            recordJSON: record.value.map(RecordModel.recordJSON),
            pdsRecordURL: try? PDSClient.recordURL(pds: bundle.pds, repo: bundle.did, collection: collection, rkey: decodedRkey)
        )
    }

    /// `JSON.stringify(record, null, 2)`: the whole `{ uri, cid, value }`
    /// envelope, keys sorted (a Swift dictionary keeps no wire order).
    private nonisolated static func recordJSON(_ record: AtRecord) -> String {
        JSONValue.object([
            "uri": .string(record.uri),
            "cid": .string(record.cid),
            "value": record.value,
        ]).prettyPrinted()
    }

    // MARK: Sections

    /// The saved arrangement, defaults included for sections added later.
    public var recordSections: [SectionConfig] {
        preferences.prefs.recordSections
    }

    public var isRichPreviewHidden: Bool {
        ExploreSections.sectionHidden(recordSections, id: "richPreview")
    }

    public var isRawJSONHidden: Bool {
        ExploreSections.sectionHidden(recordSections, id: "rawJson")
    }

    /// The field table and raw JSON are the two data views; at least one
    /// must stay visible. The setters maintain this, but guard here too.
    public var isStructuredJSONHidden: Bool {
        let structured = ExploreSections.sectionHidden(recordSections, id: "structuredJson")
        return structured && isRawJSONHidden ? false : structured
    }

    /// `applicable(id)`: whether a section can appear for this record at all.
    public func isSectionApplicable(_ id: String) -> Bool {
        switch id {
        case "richPreview": return hasRichCard
        case "engagement": return isEngagementApplicable
        case "signIn": return showsSignInPrompt
        default: return true
        }
    }

    /// The read-mode body in the user's order: applicable sections, with
    /// hidden data views kept (for their switch) and hidden helpers dropped.
    /// Empty until the record lands; a failed record shows the error layout
    /// (`failure`, `backlinks`, `copyRow`, the edit chip and the sign-in
    /// prompt) instead.
    public var sections: [RecordSection] {
        guard record.value != nil else { return [] }
        return recordSections.compactMap { section in
            guard isSectionApplicable(section.id) else { return nil }
            let isDataView = RecordModel.dataViewSectionIds.contains(section.id)
            if !isDataView, section.hidden { return nil }
            let hidden = section.id == "structuredJson" ? isStructuredJSONHidden : section.hidden
            return RecordSection(id: section.id, hidden: hidden, isDataView: isDataView)
        }
    }

    /// The switch under the rich card.
    public func toggleRichPreview() {
        let hidden = isRichPreviewHidden
        preferences.update { $0.setSectionHidden(page: .record, id: "richPreview", hidden: !hidden) }
    }

    /// The switch under the field table; shows raw JSON if this was the
    /// last visible data view.
    public func toggleStructuredJSON() {
        preferences.update { $0.toggleRecordDataView("structuredJson") }
    }

    /// The switch under the raw JSON; shows the field table if this was
    /// the last visible data view.
    public func toggleRawJSON() {
        preferences.update { $0.toggleRecordDataView("rawJson") }
    }

    // MARK: Editing

    /// `canEdit`: the signed-in account owns this repo.
    public var canEdit: Bool {
        guard let sessionDid = session.did, let bundle = identity.value else { return false }
        return sessionDid == bundle.did
    }

    /// The sign-in section shows to visitors who are not signed in.
    public var showsSignInPrompt: Bool {
        !session.isSignedIn
    }

    /// The handle the sign-in box is pre-filled with.
    public var signInDefaultInput: String {
        identity.value?.handle ?? ""
    }

    // MARK: Outbound waypoints

    /// The record type the universal-link page would give these segments.
    public var waypointType: WaypointType {
        let handle = handleOrDid ?? repo
        let parsed = parseURI(handle: handle.isEmpty ? repo : handle, collection: collection, rkey: decodedRkey)
        return WaypointType(rawValue: parsed.type.rawValue) ?? .unknown
    }

    /// The waypoint's destination for this record; nil before the identity
    /// resolves and when the client has no page for it.
    public func url(for waypoint: Waypoint) -> String? {
        guard let bundle = identity.value, let handleOrDid else { return nil }
        return waypoint.url(handle: handleOrDid, collection: collection, rkey: decodedRkey, did: bundle.did)
    }

    /// The user's picker groups narrowed to waypoints that can open this
    /// record; groups left empty are dropped. Empty before the identity
    /// resolves.
    public var waypoints: [CategorizedWaypoints] {
        guard identity.value != nil else { return [] }
        return Personalize.personalizeCategorized(preferences.prefs, type: waypointType).compactMap { group in
            let renderable = group.waypoints.filter { url(for: $0) != nil }
            guard !renderable.isEmpty else { return nil }
            return CategorizedWaypoints(category: group.category, waypoints: renderable)
        }
    }

    /// The catalog's recommendation for the collection, narrowed to
    /// waypoints the user surfaces and that can open this record.
    public var recommended: RecommendedWaypoints? {
        guard identity.value != nil else { return nil }
        let raw = WaypointCatalog.recommended(for: waypointType, collection: collection)
        let personalised = Personalize.personalizeRecommended(raw.waypoints, prefs: preferences.prefs)
            .filter { url(for: $0) != nil }
        return RecommendedWaypoints(waypoints: personalised, label: raw.label)
    }

    /// The first recommendation: the "Open in <client>" action.
    public var featured: Waypoint? {
        recommended?.waypoints.first
    }

    // MARK: Failure text

    /// The message the web's `resolveIdentifier` throws: "Could not resolve
    /// <input>" for anything the resolvers could not turn into a PDS.
    private nonisolated static func describeIdentityFailure(_ error: Error, input: String) -> String {
        if let resolver = error as? IdentityResolverError {
            switch resolver {
            case .emptyInput:
                return "resolveIdentifier: empty input"
            case .unresolvable, .unsupportedDIDMethod, .invalidDIDWeb:
                return "Could not resolve \(input.trimmingCharacters(in: .whitespacesAndNewlines))"
            }
        }
        return error.localizedDescription
    }

    /// The message the web's PDS `fetchJson` throws (`HTTP <status> <text>
    /// for <url> :: <body>`), which `RecordFailure` parses back.
    private nonisolated static func describeRecordFailure(_ error: Error) -> String {
        if let http = error as? HTTPError {
            let statusText = HTTPURLResponse.localizedString(forStatusCode: http.status)
            return "HTTP \(http.status) \(statusText) for \(http.url.absoluteString) :: \(http.body.prefix(200))"
        }
        if let failure = error as? HTTPFailure {
            switch failure {
            case .redirectRefused(let url): return "Redirect refused for \(url.absoluteString)"
            case .tooLarge(let bytes): return "Response too large (\(bytes) bytes)"
            case .invalidResponse: return "Invalid response"
            }
        }
        if let client = error as? PDSClientError {
            switch client {
            case .invalidBase(let base): return "Invalid PDS base: \(base)"
            }
        }
        return error.localizedDescription
    }
}
