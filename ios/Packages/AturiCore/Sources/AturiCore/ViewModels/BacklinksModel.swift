import Foundation
import Observation

// Port of src/components/explore/tabs/BacklinksTab.tsx and BacklinkRows.tsx:
// the inbound-link panel the repo screen mounts as a tab (target = DID)
// and the record screen mounts as a featured card with a count header
// (target = at:// URI). The three states the web keeps in one variable
// (`undefined` still loading, `null` constellation unavailable, `[]`
// nothing links here) are `Loadable.loading`, `.failed` and `.loaded([])`.
//
// Either target gets the relationships view: a tile (or, in the record
// card, a chip) per kind of link over one merged list of the records
// behind it. An account's kinds are who follows, mentions and lists it; a
// record's are what answers, quotes and likes it (BacklinkRelations). The
// open relationship can be narrowed to one app, or to one raw
// collection + path source, and each narrowing keeps its own merged list
// (BacklinkMerge), so moving between relationships, apps and sources and
// back shows what was already loaded instead of starting over.
//
// Constellation only hands back link coordinates, so once a batch lands
// its rows are filled in through BacklinkDetailsStore: who wrote each
// record (AppView profiles) and a line of what it says (post text, a list
// item's list, a record's title). Likes, follows, blocks and reposts carry
// no words and are never fetched for them.

/// What a panel's target is, which decides the rules its sources are
/// sorted by and what its own account is called in the rows.
public enum BacklinkTargetKind: Hashable, Sendable {
    case account
    case record(collection: String)
}

extension BacklinkRelation {
    /// What the relationship's tile is called.
    public var label: String {
        switch self {
        case .follow: return "Followers"
        case .mention: return "Mentions"
        case .list: return "Lists"
        case .block: return "Blocks"
        case .verify: return "Verifications"
        case .endorse: return "Vouches"
        case .embed: return "Embedded copies"
        case .other: return "Other links"
        }
    }

    /// The line under the list's heading.
    public var about: String {
        switch self {
        case .follow: return "Accounts that follow this one, in any app."
        case .mention: return "Posts, documents and lists that mention this account."
        case .list: return "Lists, starter packs and groups this account is in."
        case .block: return "Accounts that block this one."
        case .verify: return "Verification records that name this account, by others or by itself."
        case .endorse: return "Endorsements, vouches, top-friends slots and contact cards."
        case .embed: return "Records that keep a copy of this account\u{2019}s details, like a starter pack showing a feed it made."
        case .other: return BacklinksModel.otherAbout
        }
    }
}

extension RecordBacklinkRelation {
    /// What the relationship's chip is called.
    public var label: String {
        switch self {
        case .reply: return "Replies"
        case .thread: return "In thread"
        case .quote: return "Quotes"
        case .repost: return "Reposts"
        case .like: return "Likes"
        case .mention: return "Mentions"
        case .item: return "Items"
        case .subscribe: return "Subscribers"
        case .via: return "Came via"
        case .other: return "Other links"
        }
    }

    /// The line under the list's heading.
    public var about: String {
        switch self {
        case .reply: return "Replies and comments that answer this record directly."
        case .thread: return "Every reply in the thread this record started, at any depth."
        case .quote: return "Posts that quote or embed this record."
        case .repost: return "Accounts that reposted this record."
        case .like: return "Likes, stars, votes and recommendations."
        case .mention: return "Records that link to this one in their text."
        case .item: return "Records filed under this one, like a list\u{2019}s members or a publication\u{2019}s documents."
        case .subscribe: return "Subscriptions to this record."
        case .via: return "Follows and sign-ups made through this record."
        case .other: return BacklinksModel.otherAbout
        }
    }
}

/// One relationship as the panel shows it: a bucket of sources with its
/// name and description, the same shape for an account's relationships
/// and a record's. `key` is the relation's raw value.
public struct BacklinkGroup: Hashable, Sendable, Identifiable {
    public var key: String
    public var label: String
    public var about: String
    /// Links across every source in the group.
    public var count: Int
    /// Distinct accounts, summed per source (see `BacklinkBucket.accounts`).
    public var accounts: Int
    public var sources: [BacklinkSource]
    public var apps: [BacklinkAppCount]

    public init<Relation: Hashable & Sendable>(key: String, label: String, about: String, bucket: BacklinkBucket<Relation>) {
        self.key = key
        self.label = label
        self.about = about
        self.count = bucket.count
        self.accounts = bucket.accounts
        self.sources = bucket.sources
        self.apps = bucket.apps
    }

    public var id: String { key }

    /// The tile's big number, in full.
    public var countText: String {
        BacklinksModel.grouped(count)
    }

    /// The chip's number, abbreviated.
    public var compactCountText: String {
        UFOsFormat.formatCount(count)
    }

    /// The tile's line under the number: accounts when Constellation
    /// reported them, else sources, and how many apps when more than one.
    public var subtitle: String {
        let sourceCount = sources.count
        let base = accounts > 0
            ? "\(UFOsFormat.formatCount(accounts)) \(accounts == 1 ? "account" : "accounts")"
            : "\(sourceCount) \(sourceCount == 1 ? "source" : "sources")"
        return apps.count > 1 ? "\(base) \u{00B7} \(apps.count) apps" : base
    }

    /// The tile's hint. Accounts are distinct per source, summed: it says
    /// so wherever two sources could share an account.
    public var hint: String {
        let sourceCount = sources.count
        let head = "\(BacklinksModel.grouped(count)) \(count == 1 ? "link" : "links") through \(sourceCount) \(sourceCount == 1 ? "source" : "sources")"
        if sourceCount > 1 {
            return head + ". Accounts are counted per source, so one account linking through two counts twice."
        }
        return head + "."
    }

    /// The disclosure over the raw sources: "3 sources behind followers".
    public var sourcesTitle: String {
        "\(sources.count) \(sources.count == 1 ? "source" : "sources") behind \(label.lowercased())"
    }

    /// The button that undoes a narrowing to one source.
    public var showAllLabel: String {
        "Show all \(label.lowercased())"
    }
}

/// A narrowing within one relationship: to one app (by `BacklinkApp.key`)
/// or to one raw source (by `BacklinkSource.source`). It belongs to the
/// relationship it was made in; moving to another starts whole.
public struct BacklinkNarrowing: Hashable, Sendable {
    public var relation: String
    public var app: String?
    public var source: String?

    public init(relation: String, app: String? = nil, source: String? = nil) {
        self.relation = relation
        self.app = app
        self.source = source
    }
}

/// One merged list and where its loading stands.
public struct BacklinkList: Hashable, Sendable {
    public var items: [MergedBacklink]
    public var isLoading: Bool
    /// Every source is exhausted.
    public var isDone: Bool
    /// Sources whose last request failed.
    public var failed: [String]

    public init(items: [MergedBacklink] = [], isLoading: Bool = true, isDone: Bool = false, failed: [String] = []) {
        self.items = items
        self.isLoading = isLoading
        self.isDone = isDone
        self.failed = failed
    }

    /// Whether "Show more" shows.
    public var canLoadMore: Bool {
        !isDone
    }
}

/// One linking record as a row reads, port of `BacklinkRow` in
/// BacklinkRows.tsx: who wrote it, when (from its TID), and what it is.
public struct BacklinkRow: Hashable, Sendable, Identifiable {
    public var item: MergedBacklink
    /// The account the row is about: the record's author, or, for a list
    /// item seen from the list it belongs to, the account it adds. Every
    /// item of a list is written by the list's owner and names the same
    /// list, so author and context would repeat down the whole page; what
    /// differs is who each one adds.
    public var subjectDid: String
    /// The display name, else the handle, else the shortened DID.
    public var title: String
    /// "@handle" beside a display name.
    public var handle: String?
    /// The title is the shortened DID, set in the identifier face.
    public var titleIsIdentifier: Bool
    /// The profile has not been looked up yet.
    public var isPending: Bool
    /// The AppView answered and has no profile for the account.
    public var hasNoProfile: Bool
    /// The avatar's thumbnail URL.
    public var avatar: String?
    /// "this account" or "author" when the target's own account wrote it.
    public var selfLabel: String?
    /// The context line, hidden on a member row (it would repeat the list).
    public var context: RecordContext?
    /// The app's mark, when the list mixes apps.
    public var app: BacklinkApp?

    public var id: String { item.uri }
    public var uri: String { item.uri }

    /// The time in the record's TID rkey, nil for any other key.
    public var date: Date? {
        TID.date(from: item.rkey)
    }

    /// "×3 links" for a record that links here more than once.
    public var linksLabel: String? {
        item.links > 1 ? "\u{00D7}\(item.links) links" : nil
    }
}

/// One raw source in the disclosure under a relationship.
public struct BacklinkSourceRow: Hashable, Sendable, Identifiable {
    public var source: BacklinkSource
    public var app: BacklinkApp
    /// The path with its type qualifiers shortened (`backlinkPathLabels`).
    public var pathLabel: String
    /// The list is narrowed to this source.
    public var isNarrowed: Bool

    public var id: String { source.source }
}

@MainActor
@Observable
public final class BacklinksModel {
    /// `step = 20` in `useMergedBacklinks`: records per batch, and per
    /// request to each source.
    public nonisolated static let pageSize = 20
    /// Where the "constellation" and "Microcosm" links in the panel point.
    public nonisolated static let constellationURL = URL(string: "https://constellation.microcosm.blue")!
    public nonisolated static let microcosmURL = URL(string: "https://www.microcosm.blue")!

    // Copy, verbatim from the components.
    public nonisolated static let unavailableMessage = "Backlinks unavailable (constellation)."
    /// The tab's empty state.
    public nonisolated static let emptyMessage = "No backlinks found."
    public nonisolated static let recordsErrorMessage = "Couldn\u{2019}t load linking records from Constellation."
    public nonisolated static let noRecordsMessage = "No linking records to show."
    public nonisolated static let loadingMessage = "Loading\u{2026}"
    public nonisolated static let loadMoreLabel = "Show more"
    nonisolated static let otherAbout = "Links from fields the groups above don\u{2019}t cover."

    /// The DID or AT URI the panel is about.
    public private(set) var target: String
    /// The flattened, count-sorted source list. `failed` is the index being
    /// unreachable; `loaded([])` is a real "nothing links here".
    public private(set) var sources: Loadable<[BacklinkSource]> = .idle
    /// The sources as relationships, in display order; empty until loaded.
    public private(set) var groups: [BacklinkGroup] = []
    /// The open relationship's key; nil opens the first.
    public private(set) var selectedRelation: String?
    /// The last narrowing made, whichever relationship it was made in.
    public private(set) var narrowing: BacklinkNarrowing?
    /// Merged lists keyed by the sources behind them (`listKey`).
    public private(set) var lists: [String: BacklinkList] = [:]
    /// Profiles and context lines for the rows.
    public let details: BacklinkDetailsStore
    /// Whether rows are filled in with profiles and context at all. Off
    /// for surfaces that only want the coordinates (or tests of the paging).
    public let hydrates: Bool

    @ObservationIgnored private let constellation: ConstellationClient
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private var listTasks: [String: Task<Void, Never>] = [:]
    @ObservationIgnored private var merges: [String: BacklinkMerge] = [:]
    /// Bumped by every new target and every cancel, so an answer that
    /// lands after either is dropped.
    @ObservationIgnored private var generation = 0

    /// - Parameters:
    ///   - target: the DID or AT URI; `load()` fetches it. Empty until
    ///     `load(target:)` when the owner does not know it yet.
    ///   - http: the transport every Constellation, AppView and Slingshot
    ///     call goes through, injectable for tests.
    ///   - hydrates: see `hydrates`.
    public init(target: String = "", http: HTTPClient = .shared, hydrates: Bool = true) {
        self.target = target
        self.constellation = ConstellationClient(http: http)
        self.details = BacklinkDetailsStore(http: http)
        self.hydrates = hydrates
    }

    // MARK: Loading

    /// Fetch the source list for the current target, dropping every list
    /// and any load in flight.
    public func load() {
        load(target: target)
    }

    /// Point the panel at a new target and fetch its sources. Profiles and
    /// context lines stay cached: they belong to the linking records, not
    /// to the target.
    public func load(target: String) {
        loadTask?.cancel()
        loadTask = nil
        cancelLists()
        generation += 1
        self.target = target
        groups = []
        selectedRelation = nil
        narrowing = nil
        lists = [:]
        merges = [:]
        guard !target.isEmpty else {
            sources = .idle
            return
        }
        sources = .loading
        let generation = self.generation
        loadTask = Task { [weak self] in
            await self?.fetchSources(target, generation: generation)
        }
    }

    /// The retry affordance: same target again.
    public func reload() {
        load(target: target)
    }

    /// `load` and wait for the source list to settle.
    public func loadAndWait(target: String) async {
        load(target: target)
        await loadTask?.value
    }

    /// Wait for the source list in flight, if any.
    public func awaitLoad() async {
        await loadTask?.value
    }

    /// Wait for the open list's batch in flight (and its rows' details), if any.
    public func awaitActiveList() async {
        guard let key = activeListKey else { return }
        await listTasks[key]?.value
    }

    /// Cancel everything in flight (screen leaving). A list cut off mid-batch
    /// is dropped with its merge, whose sources may have read the
    /// cancellation as a failure, so `loadActiveList()` starts it afresh.
    public func cancel() {
        loadTask?.cancel()
        loadTask = nil
        cancelLists()
        generation += 1
        for (key, list) in lists where list.isLoading {
            lists[key] = nil
            merges[key] = nil
        }
    }

    private func cancelLists() {
        for task in listTasks.values { task.cancel() }
        listTasks = [:]
    }

    private func fetchSources(_ target: String, generation: Int) async {
        let result = await constellation.sources(for: target)
        guard !Task.isCancelled, generation == self.generation else { return }
        if let result {
            // A source with no links behind it is not a source: listed, it
            // read as "0 backlinks" and inflated "across N sources". The
            // web's Backlinks tab drops them the same way.
            let list = result.filter { $0.count > 0 }
            groups = BacklinksModel.relationGroups(for: target, sources: list)
            sources = .loaded(list)
            loadActiveList()
        } else {
            sources = .failed(BacklinksModel.unavailableMessage)
        }
    }

    // MARK: Summary

    /// The source list, empty until loaded.
    public var sourceList: [BacklinkSource] {
        sources.value ?? []
    }

    /// The card header's numbers, nil until the list is loaded.
    public var totals: BacklinkTotals? {
        sources.value.map(ConstellationClient.totals(of:))
    }

    public var isUnavailable: Bool {
        sources.isFailed
    }

    /// Loaded and empty: the "nothing references this" states.
    public var isEmpty: Bool {
        sources.value?.isEmpty ?? false
    }

    /// The big number in the card header: the total backlink count with
    /// thousands separators, or a dash while the list is not loaded.
    public var countText: String {
        guard let totals else { return "\u{2014}" }
        return BacklinksModel.grouped(totals.records)
    }

    /// The line beside the count, one of the four the header prints:
    /// "loading…", "unavailable", "no records reference this yet", or
    /// "across N sources · from M accounts" (the accounts clause only when
    /// some source reported distinct DIDs).
    public var summaryText: String {
        switch sources {
        case .idle, .loading:
            return "loading\u{2026}"
        case .failed:
            return "unavailable"
        case .loaded(let list):
            if list.isEmpty { return "no records reference this yet" }
            let totals = ConstellationClient.totals(of: list)
            var text = "across \(totals.sources) \(totals.sources == 1 ? "source" : "sources")"
            if let accounts = totals.accounts {
                text += " \u{00B7} from \(BacklinksModel.grouped(accounts)) \(accounts == 1 ? "account" : "accounts")"
            }
            return text
        }
    }

    /// The abbreviated figures on chips and source rows ("2.4k").
    public nonisolated static func compactCount(_ n: Int) -> String {
        UFOsFormat.formatCount(n)
    }

    // MARK: Relationships

    /// `relationshipsFor` in BacklinksTab.tsx: an AT URI with a collection
    /// is a record, anything else an account.
    public nonisolated static func targetKind(of target: String) -> BacklinkTargetKind {
        if target.hasPrefix("at://"), let uri = AtUri(parsing: target), let collection = uri.collection, !collection.isEmpty {
            return .record(collection: collection)
        }
        return .account
    }

    /// A target's sources as relationships: an account's set for a DID, a
    /// record's for an AT URI.
    public nonisolated static func relationGroups(for target: String, sources: [BacklinkSource]) -> [BacklinkGroup] {
        switch targetKind(of: target) {
        case .record(let collection):
            return BacklinkRelations.bucketRecordSources(sources, targetCollection: collection).map { bucket in
                BacklinkGroup(key: bucket.relation.rawValue, label: bucket.relation.label, about: bucket.relation.about, bucket: bucket)
            }
        case .account:
            return BacklinkRelations.bucketSources(sources).map { bucket in
                BacklinkGroup(key: bucket.relation.rawValue, label: bucket.relation.label, about: bucket.relation.about, bucket: bucket)
            }
        }
    }

    public var kind: BacklinkTargetKind {
        BacklinksModel.targetKind(of: target)
    }

    /// The account whose own records get the `selfLabel` pill: the account
    /// itself, or the record's author.
    public var selfDid: String {
        switch kind {
        case .record:
            return AtUri(parsing: target)?.repo ?? target
        case .account:
            return target
        }
    }

    /// What the target's own account is called in the rows.
    public var selfLabel: String {
        switch kind {
        case .record: return "author"
        case .account: return "this account"
        }
    }

    /// The open relationship: the one selected, else the first.
    public var selectedGroup: BacklinkGroup? {
        if let selectedRelation, let group = groups.first(where: { $0.key == selectedRelation }) {
            return group
        }
        return groups.first
    }

    public func isSelected(_ group: BacklinkGroup) -> Bool {
        selectedGroup?.key == group.key
    }

    /// Open a relationship's list (a tile or a chip).
    public func select(relation: String) {
        selectedRelation = relation
        loadActiveList()
    }

    /// The narrowing in force: the last one made, if it was made in the
    /// open relationship.
    public var activeNarrowing: BacklinkNarrowing? {
        guard let narrowing, let group = selectedGroup, narrowing.relation == group.key else { return nil }
        return narrowing
    }

    public var narrowedApp: String? {
        activeNarrowing?.app
    }

    public var narrowedSourceKey: String? {
        activeNarrowing?.source
    }

    /// Neither an app nor a source is picked: the "All" chip.
    public var isShowingAll: Bool {
        narrowedApp == nil && narrowedSourceKey == nil
    }

    /// The "All" chip, and "Show all …" under a narrowed source.
    public func showAll() {
        narrowing = nil
        loadActiveList()
    }

    /// An app chip.
    public func narrow(toApp key: String) {
        guard let group = selectedGroup else { return }
        narrowing = BacklinkNarrowing(relation: group.key, app: key)
        loadActiveList()
    }

    /// A row of the sources disclosure: narrow to it, or back to the whole
    /// relationship when it is already the one shown.
    public func toggleSource(_ source: String) {
        guard let group = selectedGroup else { return }
        if narrowedSourceKey == source {
            narrowing = nil
        } else {
            narrowing = BacklinkNarrowing(relation: group.key, source: source)
        }
        loadActiveList()
    }

    /// The sources behind the list on screen.
    public var activeSources: [BacklinkSource] {
        guard let group = selectedGroup else { return [] }
        if let source = narrowedSourceKey {
            return group.sources.filter { $0.source == source }
        }
        if let app = narrowedApp {
            return group.sources.filter { BacklinkRelations.appForCollection($0.collection).key == app }
        }
        return group.sources
    }

    /// Links behind the list on screen, from Constellation's counts.
    public var activeTotal: Int {
        activeSources.reduce(0) { $0 + $1.count }
    }

    /// The one source the list is narrowed to, if it is.
    public var narrowedSource: BacklinkSource? {
        narrowedSourceKey == nil ? nil : activeSources.first
    }

    /// How a narrowed source reads after "Only": the collection and its
    /// path, without the path of a root-level link.
    public nonisolated static func sourceText(_ source: BacklinkSource) -> String {
        source.collection + (source.path == "." ? "" : source.path)
    }

    /// The app filter shows when a relationship spans more than one app.
    public var showsAppFilter: Bool {
        (selectedGroup?.apps.count ?? 0) > 1
    }

    /// Rows wear their app's mark when the list mixes apps.
    public var showsAppOnRows: Bool {
        showsAppFilter && isShowingAll
    }

    /// The raw collection + path pairs behind the open relationship, each
    /// with a short path label. Labels are made per collection, so two
    /// paths that would read the same keep their namespaces.
    public var sourceRows: [BacklinkSourceRow] {
        guard let group = selectedGroup else { return [] }
        var pathsByCollection: [String: [String]] = [:]
        for source in group.sources {
            pathsByCollection[source.collection, default: []].append(source.path)
        }
        var labels: [String: [String: String]] = [:]
        for (collection, paths) in pathsByCollection {
            labels[collection] = BacklinkRelations.backlinkPathLabels(paths)
        }
        let narrowed = narrowedSourceKey
        return group.sources.map { source in
            BacklinkSourceRow(
                source: source,
                app: BacklinkRelations.appForCollection(source.collection),
                pathLabel: labels[source.collection]?[source.path] ?? source.path,
                isNarrowed: narrowed == source.source
            )
        }
    }

    // MARK: The merged list

    /// A list's key: the sources behind it, in order. Nil for none.
    nonisolated static func listKey(_ sources: [String]) -> String? {
        sources.isEmpty ? nil : sources.joined(separator: "\n")
    }

    private var activeListKey: String? {
        BacklinksModel.listKey(activeSources.map(\.source))
    }

    /// The list on screen, nil until its first batch is asked for.
    public var activeList: BacklinkList? {
        guard let key = activeListKey else { return nil }
        return lists[key]
    }

    /// Nothing to show yet and something on the way: the skeleton.
    public var isListLoading: Bool {
        if let list = activeList { return list.isLoading }
        return !activeSources.isEmpty
    }

    /// The list on screen as rows, details applied.
    public var rows: [BacklinkRow] {
        guard let list = activeList else { return [] }
        let showsApp = showsAppOnRows
        return list.items.map { row(for: $0, showsApp: showsApp) }
    }

    /// One record as a row reads, from whatever details have landed.
    public func row(for item: MergedBacklink, showsApp: Bool = false) -> BacklinkRow {
        let context = details.context(for: item.uri)
        var member: String?
        if let candidate = context?.member, candidate.list == target {
            member = candidate.did
        }
        let subject = member ?? item.did
        let profile = details.profile(for: subject)
        let displayName = profile?.displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let handle = profile?.handle ?? ""

        let title: String
        var handleText: String?
        var isIdentifier = false
        if !displayName.isEmpty {
            title = displayName
            handleText = handle.isEmpty ? nil : "@" + handle
        } else if !handle.isEmpty {
            title = handle
        } else {
            title = shortDid(subject)
            isIdentifier = true
        }

        return BacklinkRow(
            item: item,
            subjectDid: subject,
            title: title,
            handle: handleText,
            titleIsIdentifier: isIdentifier,
            isPending: hydrates && !details.isProfileKnown(subject),
            hasNoProfile: details.missingProfiles.contains(subject),
            avatar: profile?.avatar.map { $0.replacingOccurrences(of: "/img/avatar/", with: "/img/avatar_thumbnail/") },
            selfLabel: member == nil && item.did == selfDid ? selfLabel : nil,
            context: member == nil ? context : nil,
            app: showsApp ? BacklinkRelations.appForCollection(item.collection) : nil
        )
    }

    /// The list's foot: records shown against links in all. A record that
    /// links twice is one row, so the two numbers are not the same unit.
    /// No claim about order: Constellation lists links as it indexed them,
    /// which an edited record breaks (see BacklinkMerge).
    public var footerText: String? {
        guard let list = activeList, !list.items.isEmpty else { return nil }
        let total = activeTotal
        var text = "\(BacklinksModel.grouped(list.items.count)) shown \u{00B7} \(BacklinksModel.grouped(total)) \(total == 1 ? "link" : "links") in all"
        if !list.failed.isEmpty {
            let count = list.failed.count
            text += " \u{00B7} \(count) \(count == 1 ? "source" : "sources") didn\u{2019}t answer"
        }
        return text
    }

    /// What an empty, settled list says.
    public var listEmptyMessage: String {
        if let list = activeList, !list.failed.isEmpty {
            return BacklinksModel.recordsErrorMessage
        }
        return BacklinksModel.noRecordsMessage
    }

    /// Start the list on screen if nothing has asked for it yet. Selecting
    /// and narrowing call it; the view calls it on appear, for a list a
    /// `cancel()` dropped.
    public func loadActiveList() {
        let keys = activeSources.map(\.source)
        guard let key = BacklinksModel.listKey(keys), lists[key] == nil else { return }
        loadBatch(key: key, sources: keys)
    }

    /// "Show more": the next batch of the list on screen.
    public func loadMore() {
        let keys = activeSources.map(\.source)
        guard let key = BacklinksModel.listKey(keys), let list = lists[key], !list.isLoading, !list.isDone else { return }
        loadBatch(key: key, sources: keys)
    }

    private func loadBatch(key: String, sources keys: [String]) {
        let merge: BacklinkMerge
        if let existing = merges[key] {
            merge = existing
        } else {
            merge = BacklinkMerge(
                sources: keys,
                pageSize: BacklinksModel.pageSize,
                fetchPage: BacklinkMerge.constellationFetcher(target: target, client: constellation)
            )
            merges[key] = merge
        }
        var list = lists[key] ?? BacklinkList()
        list.isLoading = true
        lists[key] = list
        let generation = self.generation
        listTasks[key] = Task { [weak self] in
            let batch = await merge.next(BacklinksModel.pageSize)
            await self?.receive(batch, key: key, generation: generation)
        }
    }

    private func receive(_ batch: BacklinkMergeBatch, key: String, generation: Int) async {
        guard !Task.isCancelled, generation == self.generation, var list = lists[key] else { return }
        list.items.append(contentsOf: batch.items)
        if !batch.relinked.isEmpty {
            for index in list.items.indices {
                if let links = batch.relinked[list.items[index].uri] {
                    list.items[index].links = links
                }
            }
        }
        list.isLoading = false
        list.isDone = batch.isDone
        list.failed = batch.failed
        lists[key] = list
        if hydrates, !batch.items.isEmpty {
            await details.hydrate(batch.items.map(\.record))
        }
    }

    /// `toLocaleString()` as an English reader sees it: thousands grouped
    /// with commas. Deterministic so the header reads the same in tests and
    /// on device; a screen that wants locale grouping has `totals`.
    nonisolated static func grouped(_ n: Int) -> String {
        let digits = String(n.magnitude)
        var out = ""
        for (index, character) in digits.enumerated() {
            let remaining = digits.count - index
            if index > 0, remaining % 3 == 0 { out.append(",") }
            out.append(character)
        }
        return n < 0 ? "-" + out : out
    }
}
