import Foundation
import Observation

/// What is known of an account's name: `nameOf` in
/// `src/components/explore/pds/usePdsData.ts`. The handle, display name and
/// avatar come from the AppView's profile; for an account the AppView
/// doesn't know, or knows without a usable handle, the handle comes from
/// the host's own describeRepo.
public struct PDSAccountName: Hashable, Sendable {
    public var handle: String?
    public var displayName: String?
    public var avatar: String?

    public init(handle: String? = nil, displayName: String? = nil, avatar: String? = nil) {
        self.handle = handle
        self.displayName = displayName
        self.avatar = avatar
    }

    /// The parts of an AppView profile a row shows, blanks dropped.
    public init(profile: BskyProfile) {
        self.init(
            handle: PDSAccountName.usable(profile.handle),
            displayName: profile.displayName.flatMap { (name: String) -> String? in
                let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
                return trimmed.isEmpty ? nil : trimmed
            },
            avatar: profile.avatar.flatMap { $0.isEmpty ? nil : $0 }
        )
    }

    /// A handle worth showing: not empty, and not the AppView's
    /// `handle.invalid` placeholder.
    public static func usable(_ handle: String?) -> String? {
        guard let handle, !handle.isEmpty, handle != "handle.invalid" else { return nil }
        return handle
    }
}

/// One account row on the PDS page: the DID, standing and last commit are
/// shown immediately, the name fills in as the AppView (or the host)
/// answers. Port of `AccountRow` in `explore/pds/usePdsData.ts` with the
/// name `nameOf` gives it, minus the layout.
public struct PDSRepoRow: Hashable, Sendable, Identifiable {
    public var id: String { entry.did }
    public let entry: PDSServer.RepoEntry
    /// Its place in the host's listing.
    public let index: Int
    /// `active`, or why it isn't (`PDSExplorer.standing`).
    public let standing: String
    /// The repo's head `rev` is itself a TID (the commit timestamp), so the
    /// last-commit time needs no second round-trip. Custom and non-TID revs
    /// fall back to nil.
    public let revDate: Date?
    public var handle: String?
    public var displayName: String?
    public var avatar: String?
    /// The AppView has answered for this account, found or not, so a
    /// missing name is missing rather than on its way.
    public var nameSettled: Bool

    public init(
        entry: PDSServer.RepoEntry,
        index: Int = 0,
        handle: String? = nil,
        displayName: String? = nil,
        avatar: String? = nil,
        nameSettled: Bool = false
    ) {
        self.entry = entry
        self.index = index
        standing = PDSExplorer.standing(of: entry)
        revDate = entry.rev.flatMap { TID.date(from: $0) }
        self.handle = handle
        self.displayName = displayName
        self.avatar = avatar
        self.nameSettled = nameSettled
    }

    public var did: String { entry.did }
    public var rev: String? { entry.rev }
    public var head: String? { entry.head }

    /// `@handle` once known, else the shortened DID.
    public var label: String {
        handle.map { "@\($0)" } ?? shortDid(entry.did)
    }

    /// The full DID beside a known handle; empty until then, since the
    /// label already shows it.
    public var secondaryLabel: String {
        handle != nil ? entry.did : ""
    }

    /// The avatar's stand-in: the handle's first letter, nothing for a DID,
    /// whose first letter is always "d" and says nothing.
    public var initial: String {
        guard let handle, let first = handle.first else { return "" }
        return String(first).uppercased()
    }

    public func updatedLabel(now: Date = Date()) -> String? {
        revDate.map { "updated \(TID.formatRelative($0, now: now))" }
    }

    /// The last commit as the list shows it (`CommitTime` in
    /// `explore/pds/parts.tsx`): relative while recent, a date after that.
    /// Nil when the rev is not a timestamp.
    public func commitLabel(now: Date = Date()) -> String? {
        revDate.map { TID.formatRelative($0, now: now) }
    }

    /// What the web's last-commit cell says on hover.
    public var commitTitle: String {
        guard let date = revDate else {
            if let rev = entry.rev { return "rev \(rev) isn’t a timestamp" }
            return "No commit listed"
        }
        let moment = "Last commit \(Formatting.isoTimestamp(date))"
        if let rev = entry.rev { return moment + " · rev " + rev }
        return moment
    }

    public var revTitle: String? {
        revDate.map { "rev \(entry.rev ?? "") · \(Formatting.isoTimestamp($0))" }
    }

    /// A year without a commit reads quieter than this week's.
    public func isDormant(now: Date = Date()) -> Bool {
        PDSExplorer.matchesCommit(revDate, .dormant, now: now)
    }

    /// `active === false` entries carry a `status` like 'takendown' /
    /// 'suspended' / 'deactivated' / 'deleted'. Shown prominently: those
    /// repos still appear in listRepos but their records will not fetch.
    public var showStatus: Bool {
        standing != "active"
    }

    public var statusLabel: String? {
        if let status = entry.status, !status.isEmpty { return status }
        return entry.active == false ? "inactive" : nil
    }

    /// The badge text, or nil when the row carries no status to flag.
    public var statusBadge: String? {
        showStatus ? statusLabel : nil
    }

    /// The standing in words ("Taken down"), its tone and what it means.
    public var standingLabel: String { PDSExplorer.statusLabel(standing) }
    public var standingTone: PDSExplorer.StatusTone { PDSExplorer.statusTone(standing) }
    public var standingMeaning: String { PDSExplorer.statusMeaning(standing) }

    public var explorePath: String {
        "/explore/\(encodeRepo(handle ?? entry.did))"
    }

    /// What sorting needs of it.
    public var sortable: PDSExplorer.SortableAccount {
        PDSExplorer.SortableAccount(index: index, standing: standing, date: revDate, handle: handle)
    }

    /// Whether the text filter (trimmed and lower-cased) finds it, by DID,
    /// handle or display name.
    public func matches(_ query: String) -> Bool {
        if query.isEmpty { return true }
        if entry.did.lowercased().contains(query) { return true }
        if let handle, handle.lowercased().contains(query) { return true }
        if let displayName, displayName.lowercased().contains(query) { return true }
        return false
    }
}

/// The accounts as the list shows them, worked out in one pass:
/// `useAccountsView` in `explore/pds/AccountsList.tsx` with the drawing
/// limit beside it.
public struct PDSAccountListing: Hashable, Sendable {
    /// Every account listed so far.
    public var total: Int
    /// Those within the status and commit filters, in the order asked for.
    public var ordered: [PDSRepoRow]
    /// Those of them the text filter finds.
    public var visible: [PDSRepoRow]
    /// The first of those, as many as the list draws.
    public var drawn: [PDSRepoRow]

    public init(total: Int = 0, ordered: [PDSRepoRow] = [], visible: [PDSRepoRow] = [], drawn: [PDSRepoRow] = []) {
        self.total = total
        self.ordered = ordered
        self.visible = visible
        self.drawn = drawn
    }

    /// More matches than are drawn: the list offers to show them.
    public var hasMoreToDraw: Bool {
        drawn.count < visible.count
    }

    /// How many the next "Show more" adds.
    public func nextDraw(step: Int) -> Int {
        min(step, visible.count - drawn.count)
    }
}

/// One way to narrow the accounts by status, with how many it holds.
public struct PDSStatusChoice: Hashable, Sendable, Identifiable {
    /// `all`, `active`, `inactive`, or an inactive status's name.
    public var value: String
    public var label: String
    public var count: Int
    /// One inactive status, which the rail sets under "Inactive".
    public var isStatus: Bool

    public var id: String { value }

    public init(value: String, label: String, count: Int, isStatus: Bool = false) {
        self.value = value
        self.label = label
        self.count = count
        self.isStatus = isStatus
    }
}

/// One last-commit window, with how many accounts it holds.
public struct PDSCommitChoice: Hashable, Sendable, Identifiable {
    /// Nil for "Any time".
    public var window: PDSExplorer.CommitWindow?
    public var label: String
    public var count: Int

    public var id: String { window?.rawValue ?? "any" }

    public init(window: PDSExplorer.CommitWindow?, label: String, count: Int) {
        self.window = window
        self.label = label
        self.count = count
    }
}

/// The PDS page (`/explore/pds/{host}`), port of `PdsExplorer.tsx`'s
/// classic page and what it reads (`explore/pds/usePdsData.ts`): the
/// server's facts, what the relays know of it, and the accounts it hosts,
/// found by handle, display name or DID, narrowed by status and last
/// commit, and sorted (`PDSExplorer`).
///
///   server     describeServer, `_health` and the OAuth protected-resource
///              metadata, each optional but the first
///   relays     every relay's `getHostStatus` for the host, once it has
///              answered as a PDS (a name that is not one would only
///              collect four "not known"s)
///   accounts   listRepos, a thousand at a time (the lexicon's maximum)
///   names      handles, display names and avatars from the AppView's
///              `getProfiles`, 25 a request, in the order the list shows
///              them; and for an account the AppView doesn't know, the
///              host's own describeRepo, a few at a time, for the rows the
///              list draws
///
/// Rows are drawn a few hundred at a time, with a way to draw more: a
/// host's first page is a thousand accounts, and a busy one lists far more.
@MainActor
@Observable
public final class PDSModel {
    /// listRepos' maximum. A busy host lists hundreds of thousands, so
    /// pages, not everything. `REPO_PAGE`.
    public static let pageSize = 1000
    /// Rows drawn at first, and how many more each "Show more" draws.
    /// `FIRST_DRAW` and `DRAW_STEP`.
    public static let drawStep = 200
    /// Accounts handed to the AppView per round, in the list's order; each
    /// round goes out as `getProfiles` requests of 25. `PROFILE_CHUNK`.
    public static let profileChunk = 100
    /// The list draws a row per account, and each the AppView doesn't know
    /// asks the host for its handle via describeRepo. Firing all of them
    /// hits the PDS with hundreds of simultaneous requests, so lookups are
    /// capped; rows still fill in as slots free up. Tighter than the web's
    /// six because a phone shares its connections with everything else on
    /// screen.
    public static let handleLookupConcurrency = 4

    /// The host exactly as the route named it.
    public let host: String
    /// `normalizePdsBase(host)`: scheme added, trailing slash dropped.
    public let pdsBase: String

    public private(set) var server: Loadable<PDSServer.ServerDescription> = .idle
    /// `_health` is a separate, optional endpoint; older and custom PDSs
    /// may 404, which leaves this nil without marking the server broken.
    public private(set) var health: PDSServer.ServerHealth?
    /// The authorization servers its accounts sign in through, from the
    /// OAuth protected-resource metadata. Nil until known, and when it
    /// doesn't say.
    public private(set) var authServers: [String]?
    public private(set) var repos: [PDSServer.RepoEntry] = []
    public private(set) var cursor: String?
    public private(set) var done = false
    public private(set) var isLoadingRepos = false
    public private(set) var reposError: String?
    /// What each relay knows of the host.
    public let relays: RelayStatusModel

    /// The text filter over the accounts listed so far. listRepos has no
    /// query parameter, so this narrows what is loaded.
    public var filter = "" {
        didSet { if filter != oldValue { viewDidChange(reorder: false) } }
    }
    /// `all`, `active`, `inactive`, or one inactive status by its name.
    public var status = "all" {
        didSet { if status != oldValue { viewDidChange(reorder: true) } }
    }
    /// Accounts by when their repo last changed; nil for any time.
    public var commit: PDSExplorer.CommitWindow? = nil {
        didSet { if commit != oldValue { viewDidChange(reorder: true) } }
    }
    public private(set) var sort: PDSExplorer.AccountSort = .listed
    public private(set) var desc = false
    /// How many of the matching rows the list draws.
    public private(set) var drawLimit = PDSModel.drawStep

    /// Each listed account in the host's order, before its name is known.
    private var baseRows: [PDSRepoRow] = []
    /// Names from the AppView, by DID, for the accounts it knows.
    private var profiles: [String: PDSAccountName] = [:]
    /// Accounts the AppView answered for and does not know.
    private var unknownToAppView: Set<String> = []
    /// Handles the host gave through describeRepo, by DID.
    private var hostHandles: [String: String] = [:]

    @ObservationIgnored private let pdsServer: PDSServer
    @ObservationIgnored private let pdsClient: PDSClient
    @ObservationIgnored private let appView: AppViewClient
    @ObservationIgnored private let clock: () -> Date
    @ObservationIgnored private var serverTask: Task<Void, Never>?
    @ObservationIgnored private var pageTask: Task<Void, Never>?
    @ObservationIgnored private var seenDids: Set<String> = []
    @ObservationIgnored private var profileTask: Task<Void, Never>?
    @ObservationIgnored private var profileToken = UUID()
    @ObservationIgnored private var profileQueue: [String] = []
    @ObservationIgnored private var profilePending: Set<String> = []
    @ObservationIgnored private var hydrationTask: Task<Void, Never>?
    /// Identifies the running drain so a cancelled one, finishing late,
    /// never clears a newer task's slot.
    @ObservationIgnored private var hydrationToken = UUID()
    @ObservationIgnored private var pendingHandleLookups: [String] = []
    /// Accounts the host has been asked about, or is queued to be.
    @ObservationIgnored private var hostAsked: Set<String> = []
    @ObservationIgnored private var generation = 0

    public init(host: String, http: HTTPClient = .shared, clock: @escaping () -> Date = { Date() }) {
        self.host = host
        pdsBase = PDSServer.normalizePdsBase(host)
        pdsServer = PDSServer(http: http)
        pdsClient = PDSClient(http: http)
        appView = AppViewClient(client: http)
        relays = RelayStatusModel(http: http)
        self.clock = clock
    }

    /// The bare host, as the relays are asked about it.
    public var hostname: String {
        PDSServer.pdsHostname(pdsBase)
    }

    // MARK: Loading

    /// Fetch the server description, its health, where it signs accounts
    /// in and the first page of accounts. The returned task finishes when
    /// the server's reads and the page have settled; names and the relays
    /// continue behind it (see `finishHandleLookups` and `relays`).
    @discardableResult
    public func load() -> Task<Void, Never> {
        cancel()
        generation += 1
        let gen = generation
        server = .loading
        health = nil
        authServers = nil
        repos = []
        baseRows = []
        seenDids = []
        cursor = nil
        done = false
        reposError = nil
        filter = ""
        profiles = [:]
        unknownToAppView = []
        hostHandles = [:]
        hostAsked = []
        drawLimit = Self.drawStep
        relays.reset()
        isLoadingRepos = true
        let serverTask = Task { [weak self] in
            guard let self else { return }
            await withTaskGroup(of: Void.self) { group in
                group.addTask { await self.loadServerDescription(gen) }
                group.addTask { await self.loadServerHealth(gen) }
                group.addTask { await self.loadProtectedResource(gen) }
            }
        }
        self.serverTask = serverTask
        let pageTask = Task { [weak self] in
            _ = await self?.loadPage(after: nil, generation: gen)
        }
        self.pageTask = pageTask
        return Task {
            await serverTask.value
            await pageTask.value
        }
    }

    /// Fetch the next page. Nil when exhausted or a page is in flight.
    @discardableResult
    public func loadMore() -> Task<Void, Never>? {
        guard !done, !isLoadingRepos else { return nil }
        let after = cursor
        let gen = generation
        isLoadingRepos = true
        let task = Task { [weak self] in
            _ = await self?.loadPage(after: after, generation: gen)
        }
        pageTask = task
        return task
    }

    /// Stop every in-flight read, names and relays included.
    public func cancel() {
        serverTask?.cancel()
        serverTask = nil
        pageTask?.cancel()
        pageTask = nil
        profileTask?.cancel()
        profileTask = nil
        profileQueue = []
        profilePending = []
        hydrationTask?.cancel()
        hydrationTask = nil
        for did in pendingHandleLookups {
            hostAsked.remove(did)
        }
        pendingHandleLookups = []
        isLoadingRepos = false
        relays.cancel()
    }

    /// Wait for the queued name lookups, the AppView's and then the host's,
    /// to drain.
    public func finishHandleLookups() async {
        while true {
            if let task = profileTask {
                await task.value
                if task == profileTask { return }
                continue
            }
            if let task = hydrationTask {
                await task.value
                if task == hydrationTask { return }
                continue
            }
            return
        }
    }

    private func loadServerDescription(_ gen: Int) async {
        do {
            let description = try await pdsServer.describeServer(pds: pdsBase)
            guard gen == generation, !Task.isCancelled else { return }
            server = .loaded(description)
            relays.ask(hostname)
        } catch {
            guard gen == generation, !Task.isCancelled else { return }
            server = .failed(ExploreErrorText.describe(error))
        }
    }

    private func loadServerHealth(_ gen: Int) async {
        let result = try? await pdsServer.serverHealth(pds: pdsBase)
        guard gen == generation, !Task.isCancelled else { return }
        health = result
    }

    /// Best-effort, like `_health`: only PDSs that support OAuth answer,
    /// and a silence says nothing is wrong with the host.
    private func loadProtectedResource(_ gen: Int) async {
        let metadata = try? await pdsServer.protectedResourceMetadata(pds: pdsBase)
        guard gen == generation, !Task.isCancelled else { return }
        authServers = PDSExplorer.authorizationServers(metadata?.authorizationServers)
    }

    /// `followShort` asks for the page after a short one straight away,
    /// once. The reference PDS hands back a cursor with every page that
    /// isn't empty, so a host with six accounts would otherwise read as
    /// "6+ listed, more on the host" until someone tapped Load more and
    /// got nothing. A short page can't be taken as the end either, since a
    /// host may filter a page down and still have more behind the cursor.
    private func loadPage(after: String?, generation gen: Int, followShort: Bool = true) async {
        isLoadingRepos = true
        reposError = nil
        do {
            let page = try await pdsServer.listRepos(pds: pdsBase, limit: Self.pageSize, cursor: after)
            guard gen == generation, !Task.isCancelled else { return }
            // A host's pages can overlap at their edges; an account is
            // listed once.
            var fresh: [PDSServer.RepoEntry] = []
            for entry in page.repos where !seenDids.contains(entry.did) {
                seenDids.insert(entry.did)
                fresh.append(entry)
            }
            let start = baseRows.count
            var added: [PDSRepoRow] = []
            added.reserveCapacity(fresh.count)
            for (offset, entry) in fresh.enumerated() {
                added.append(PDSRepoRow(entry: entry, index: start + offset))
            }
            repos += fresh
            baseRows += added
            let next = page.cursor.flatMap { $0.isEmpty ? nil : $0 }
            cursor = next
            // A cursor that doesn't move would page forever.
            if next == nil || page.repos.isEmpty || next == after {
                done = true
            }
            if !done, followShort, page.repos.count < Self.pageSize, let next {
                // The rows already listed get their names while the next
                // page is asked for; isLoadingRepos stays set so the
                // footer doesn't flicker between the two requests.
                scheduleProfileLoads()
                scheduleHostLookups()
                await loadPage(after: next, generation: gen, followShort: false)
                return
            }
            isLoadingRepos = false
            scheduleProfileLoads()
            scheduleHostLookups()
        } catch {
            guard gen == generation, !Task.isCancelled else { return }
            reposError = ExploreErrorText.describe(error)
            isLoadingRepos = false
        }
    }

    // MARK: The view

    /// Pick an order (one of `PDSExplorer.sortChoices`).
    public func setOrder(_ sort: PDSExplorer.AccountSort, desc: Bool) {
        guard sort != self.sort || desc != self.desc else { return }
        self.sort = sort
        self.desc = desc
        viewDidChange(reorder: true)
    }

    public func setOrder(_ choice: PDSExplorer.SortChoice) {
        setOrder(choice.sort, desc: choice.desc)
    }

    /// Draw the next few hundred matching rows.
    public func showMore() {
        drawLimit += Self.drawStep
        scheduleHostLookups()
    }

    /// A filter, an order or the text changed: back to the first few
    /// hundred rows, names asked for in the new order, and the host asked
    /// about the rows now drawn.
    private func viewDidChange(reorder: Bool) {
        drawLimit = Self.drawStep
        if reorder {
            scheduleProfileLoads()
        }
        scheduleHostLookups()
    }

    // MARK: Names

    /// What is known of an account's name; nil while the AppView has not
    /// answered for it.
    public func name(for did: String) -> PDSAccountName? {
        if let profile = profiles[did] {
            return PDSAccountName(
                handle: profile.handle ?? hostHandles[did],
                displayName: profile.displayName,
                avatar: profile.avatar
            )
        }
        if unknownToAppView.contains(did) {
            return PDSAccountName(handle: hostHandles[did])
        }
        return nil
    }

    /// Known handles by DID, from either source, so a row that scrolls out
    /// of the filter and back keeps its name.
    public var handles: [String: String] {
        var out = hostHandles
        for (did, profile) in profiles {
            if let handle = profile.handle {
                out[did] = handle
            }
        }
        return out
    }

    /// Ask the AppView for the names of the accounts the list holds, in the
    /// order it shows them, a round at a time; a new order skips whatever
    /// has already been asked. A round that failed is left unknown, so a
    /// later order tries it again.
    private func scheduleProfileLoads() {
        guard !baseRows.isEmpty else { return }
        let order = listing.ordered
        profileQueue = order.map(\.did).filter { did in
            profiles[did] == nil && !unknownToAppView.contains(did) && !profilePending.contains(did)
        }
        guard profileTask == nil, !profileQueue.isEmpty else { return }
        let token = UUID()
        profileToken = token
        profileTask = Task { [weak self] in
            while let self, !self.profileQueue.isEmpty, !Task.isCancelled {
                let chunk = Array(self.profileQueue.prefix(PDSModel.profileChunk))
                self.profileQueue.removeFirst(chunk.count)
                await self.loadProfiles(chunk)
            }
            if let self, self.profileToken == token {
                self.profileTask = nil
            }
        }
    }

    private func loadProfiles(_ dids: [String]) async {
        let gen = generation
        for did in dids {
            profilePending.insert(did)
        }
        let lookup = appView
        let result = await lookup.getProfilesResult(dids)
        // A reload or a cancel has already cleared the pending set.
        guard gen == generation, !Task.isCancelled else { return }
        for did in dids {
            profilePending.remove(did)
        }
        var found = profiles
        var unknown = unknownToAppView
        for did in dids {
            if let profile = result.profiles[did] {
                found[did] = PDSAccountName(profile: profile)
            } else if !result.failed {
                unknown.insert(did)
            }
        }
        profiles = found
        unknownToAppView = unknown
        scheduleHostLookups()
    }

    /// Queue describeRepo for the drawn rows whose account the AppView has
    /// answered for without a usable handle, and start the drain if it is
    /// not already running. One queue per model, so two rounds landing back
    /// to back share the same cap rather than doubling it.
    private func scheduleHostLookups() {
        guard !baseRows.isEmpty else { return }
        var wanted: [String] = []
        for row in listing.drawn where row.nameSettled && row.handle == nil && !hostAsked.contains(row.did) {
            hostAsked.insert(row.did)
            wanted.append(row.did)
        }
        guard !wanted.isEmpty else { return }
        pendingHandleLookups.append(contentsOf: wanted)
        guard hydrationTask == nil else { return }
        let token = UUID()
        hydrationToken = token
        hydrationTask = Task { [weak self] in
            while let self, !self.pendingHandleLookups.isEmpty, !Task.isCancelled {
                await self.drainHandleLookups()
            }
            if let self, self.hydrationToken == token {
                self.hydrationTask = nil
            }
        }
    }

    /// Run the queued lookups with at most `handleLookupConcurrency` in
    /// flight, handing each freed slot to the next DID in the list's order.
    /// Lookups are best-effort: a failure, or an inactive account the host
    /// won't describe, leaves the row showing its DID.
    private func drainHandleLookups() async {
        let client = pdsClient
        let base = pdsBase
        await withTaskGroup(of: (String, String?).self) { group in
            var inFlight = 0
            while true {
                while inFlight < Self.handleLookupConcurrency, !pendingHandleLookups.isEmpty, !Task.isCancelled {
                    let did = pendingHandleLookups.removeFirst()
                    inFlight += 1
                    group.addTask {
                        let description = try? await client.describeRepo(pds: base, repo: did)
                        return (did, PDSAccountName.usable(description?.handle))
                    }
                }
                guard let (did, handle) = await group.next() else { break }
                inFlight -= 1
                if let handle, !Task.isCancelled {
                    hostHandles[did] = handle
                }
            }
        }
    }

    // MARK: Derived

    /// The text filter, trimmed and lower-cased.
    private var query: String {
        filter.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    /// Whether the status or commit filter is narrowing the list.
    public var isNarrowed: Bool {
        status != "all" || commit != nil
    }

    /// Every listed account in the host's order, with what is known of its name.
    public var rows: [PDSRepoRow] {
        baseRows.map { named($0) }
    }

    private func named(_ row: PDSRepoRow) -> PDSRepoRow {
        guard let known = name(for: row.did) else { return row }
        var filled = row
        filled.handle = known.handle
        filled.displayName = known.displayName
        filled.avatar = known.avatar
        filled.nameSettled = true
        return filled
    }

    /// The accounts under the status and commit filters, in the order asked
    /// for, those of them the text filter finds, and the ones drawn.
    public var listing: PDSAccountListing {
        let now = clock()
        let all = rows
        let kept = all.filter { row in
            PDSExplorer.matchesStatus(row.standing, status) && PDSExplorer.matchesCommit(row.revDate, commit, now: now)
        }
        let order = sort
        let descending = desc
        let ordered = kept.sorted { a, b in
            PDSExplorer.compareAccounts(a.sortable, b.sortable, sort: order, desc: descending) < 0
        }
        let needle = query
        let visible = needle.isEmpty ? ordered : ordered.filter { $0.matches(needle) }
        let drawn = visible.count > drawLimit ? Array(visible.prefix(drawLimit)) : visible
        return PDSAccountListing(total: all.count, ordered: ordered, visible: visible, drawn: drawn)
    }

    public var visibleRows: [PDSRepoRow] {
        listing.visible
    }

    /// How many accounts each filter would show (`PDSExplorer.countFacets`).
    public var facets: PDSExplorer.Facets {
        PDSExplorer.countFacets(
            baseRows.map { (standing: $0.standing, date: $0.revDate) },
            status: status,
            commit: commit,
            now: clock()
        )
    }

    /// The status menu: all, active, inactive (when any are), then each
    /// inactive status the listing holds, each with how many it would show.
    public func statusChoices(_ facets: PDSExplorer.Facets) -> [PDSStatusChoice] {
        let active = facets.count(standing: "active")
        let inactive = facets.byStatus
            .filter { $0.key != "active" }
            .sorted { PDSExplorer.compareStatus($0.key, $1.key) < 0 }
        var out = [
            PDSStatusChoice(value: "all", label: "All accounts", count: facets.statusAll),
            PDSStatusChoice(value: "active", label: "Active", count: active),
        ]
        if !inactive.isEmpty || status == "inactive" {
            out.append(PDSStatusChoice(value: "inactive", label: "Inactive", count: facets.statusAll - active))
        }
        for entry in inactive {
            out.append(PDSStatusChoice(value: entry.key, label: PDSExplorer.statusLabel(entry.key), count: entry.value, isStatus: true))
        }
        let listed = out.contains { $0.value == status }
        if !listed {
            out.append(PDSStatusChoice(value: status, label: PDSExplorer.statusLabel(status), count: 0, isStatus: true))
        }
        return out
    }

    /// The last-commit menu: any time, then each window, with how many each holds.
    public func commitChoices(_ facets: PDSExplorer.Facets) -> [PDSCommitChoice] {
        var out = [PDSCommitChoice(window: nil, label: "Any time", count: facets.commitAll)]
        for window in PDSExplorer.CommitWindow.allCases {
            out.append(PDSCommitChoice(window: window, label: window.label, count: facets.count(window)))
        }
        return out
    }

    /// The status filter in a word, for its menu's label.
    public var statusTitle: String {
        switch status {
        case "all": return "All"
        case "active": return "Active"
        case "inactive": return "Inactive"
        default: return PDSExplorer.statusLabel(status)
        }
    }

    /// The commit filter in words, for its menu's label.
    public var commitTitle: String {
        commit?.label ?? "Any time"
    }

    /// The order in words, for its menu's label.
    public var sortTitle: String {
        PDSExplorer.sortLabel(sort, desc: desc)
    }

    /// The list header's count: "12 of 1,000 shown" while narrowing, else
    /// "1,000+ listed" until the last page. Empty before anything is
    /// listed, and when the first page failed: "0+ listed" beside the
    /// notice read as a server with no accounts.
    public func countLabel(_ listing: PDSAccountListing) -> String {
        guard !baseRows.isEmpty else { return "" }
        if !query.isEmpty || isNarrowed {
            return "\(RelayCheck.formatCount(listing.visible.count)) of \(RelayCheck.formatCount(listing.total)) shown"
        }
        return RelayCheck.formatCount(listing.total) + (done ? " listed" : "+ listed")
    }

    public var loadedLabel: String {
        countLabel(listing)
    }

    /// The chrome bar's status: nil before anything is listed.
    public var searchStatusLabel: String? {
        guard !baseRows.isEmpty else { return nil }
        let current = listing
        if !query.isEmpty {
            return "\(current.visible.count)/\(current.ordered.count)"
        }
        return "\(current.ordered.count)"
    }

    /// The list's foot: how much of the host is listed, and whether the
    /// last page failed.
    public var footerLabel: String {
        let count = RelayCheck.formatCount(baseRows.count)
        var text = done ? "All \(count) listed" : "\(count) listed, more on the host"
        if reposError != nil {
            text += ". The last page didn’t load."
        }
        return text
    }

    public var showsSkeleton: Bool {
        baseRows.isEmpty && isLoadingRepos
    }

    public var canLoadMore: Bool {
        !done && !baseRows.isEmpty
    }

    /// The very first page failed: a host that refuses to list at all
    /// (bsky.social does) fails it.
    public var firstPageFailed: Bool {
        reposError != nil && baseRows.isEmpty
    }

    /// In words, with the raw error kept in `reposError`: a bare "network
    /// error" said nothing about what had been tried.
    public var firstPageFailedMessage: String? {
        guard firstPageFailed else { return nil }
        return "Couldn’t list the accounts on this PDS. It may be offline, or it may not allow listing."
    }

    public var emptyMessage: String? {
        guard baseRows.isEmpty, done, reposError == nil else { return nil }
        return "No accounts reported by this PDS."
    }

    /// A search only sees the pages fetched so far, so say that rather than
    /// implying the PDS does not host a match.
    public func noMatchText(_ listing: PDSAccountListing) -> String? {
        guard !baseRows.isEmpty, listing.visible.isEmpty else { return nil }
        let trimmed = filter.trimmingCharacters(in: .whitespacesAndNewlines)
        var text: String
        if trimmed.isEmpty {
            text = "No listed account matches these filters."
        } else {
            text = "No listed account matches \(trimmed)" + (isNarrowed ? " with these filters." : ".")
        }
        if !done {
            text += " Load more to look further."
        }
        return text
    }

    public var noMatchMessage: String? {
        noMatchText(listing)
    }

    /// The header's explanation when describeServer failed. The raw error
    /// stays in `server.errorMessage`.
    public var serverErrorMessage: String? {
        guard server.errorMessage != nil else { return nil }
        return "Couldn’t reach \(pdsBase)/xrpc/com.atproto.server.describeServer. The PDS may not implement that endpoint, or it’s temporarily unavailable."
    }

    public var version: String? {
        health?.version.flatMap { $0.isEmpty ? nil : $0 }
    }

    /// Where the host's accounts sign in, as the server card names it.
    public var signIn: [PDSExplorer.SignIn] {
        guard let authServers else { return [] }
        return PDSExplorer.signIn(authServers: authServers, base: pdsBase)
    }

    /// The page as an address: the accounts' filters and order, as the
    /// web's classic page writes them (`pdsAddress`, accounts as the
    /// default view).
    public var location: PDSExplorer.Location {
        PDSExplorer.Location(host: host, tab: .accounts, status: status, commit: commit, sort: sort, desc: desc)
    }

    public var sharePath: String {
        PDSExplorer.address(location, defaultTab: .accounts)
    }
}
