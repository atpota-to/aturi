import Foundation
import Observation

/// One repo row on the PDS page: the DID is shown immediately, the handle
/// fills in when its describeRepo lookup lands. Port of `RepoRow` in
/// `PdsExplorer.tsx` minus the layout.
public struct PDSRepoRow: Hashable, Sendable, Identifiable {
    public var id: String { entry.did }
    public var entry: PDSServer.RepoEntry
    public var handle: String?

    public init(entry: PDSServer.RepoEntry, handle: String? = nil) {
        self.entry = entry
        self.handle = handle
    }

    public var did: String { entry.did }
    public var rev: String? { entry.rev }

    /// `@handle` once resolved, else the shortened DID.
    public var label: String {
        handle.map { "@\($0)" } ?? shortDid(entry.did)
    }

    /// The full DID beside a resolved handle; empty until then, since the
    /// label already shows it.
    public var secondaryLabel: String {
        handle != nil ? entry.did : ""
    }

    /// The repo's head `rev` is itself a TID (the commit timestamp), so the
    /// last-updated time needs no second round-trip. Custom / non-TID revs
    /// fall back to nil and the line is hidden.
    public var revDate: Date? {
        entry.rev.flatMap { TID.date(from: $0) }
    }

    public func updatedLabel(now: Date = Date()) -> String? {
        revDate.map { "updated \(TID.formatRelative($0, now: now))" }
    }

    public var revTitle: String? {
        revDate.map { "rev \(entry.rev ?? "") · \(Formatting.isoTimestamp($0))" }
    }

    /// `active === false` entries carry a `status` like 'takendown' /
    /// 'suspended' / 'deactivated' / 'deleted'. Shown prominently: those
    /// repos still appear in listRepos but their records will not fetch.
    public var showStatus: Bool {
        if entry.active == false { return true }
        if let status = entry.status, !status.isEmpty, status != "active" { return true }
        return false
    }

    public var statusLabel: String? {
        if let status = entry.status, !status.isEmpty { return status }
        return entry.active == false ? "inactive" : nil
    }

    /// The badge text, or nil when the row carries no status to flag.
    public var statusBadge: String? {
        showStatus ? statusLabel : nil
    }

    public var explorePath: String {
        "/explore/\(encodeRepo(handle ?? entry.did))"
    }
}

/// The PDS page: server metadata plus a paginated list of the repos hosted
/// there, each row resolving its handle lazily so the initial paint is not
/// blocked on N describeRepo calls. Port of `PdsExplorer.tsx`.
@MainActor
@Observable
public final class PDSModel {
    public static let pageSize = 50
    /// A page renders up to 50 repo rows at once, each of which looks up
    /// its handle via describeRepo. Firing all of them hits the PDS with
    /// 50 simultaneous requests, so lookups are capped; rows still fill in
    /// as slots free up. Tighter than the web's six because a phone shares
    /// its connections with everything else on screen.
    public static let handleLookupConcurrency = 4

    /// The host exactly as the route named it.
    public let host: String
    /// `normalizePdsBase(host)`: scheme added, trailing slash dropped.
    public let pdsBase: String

    public private(set) var server: Loadable<PDSServer.ServerDescription> = .idle
    /// `_health` is a separate, optional endpoint; older and custom PDSs
    /// may 404, which leaves this nil without marking the server broken.
    public private(set) var health: PDSServer.ServerHealth?
    public private(set) var repos: [PDSServer.RepoEntry] = []
    public private(set) var cursor: String?
    public private(set) var done = false
    public private(set) var isLoadingRepos = false
    public private(set) var reposError: String?
    /// Resolved handles by DID, kept here so the search can match a handle
    /// and a row that scrolls out of the filter and back does not refetch.
    public private(set) var handles: [String: String] = [:]

    /// Search over the repos fetched so far. listRepos has no query
    /// parameter, so this narrows what is loaded.
    public var filter = ""

    @ObservationIgnored private let pdsServer: PDSServer
    @ObservationIgnored private let pdsClient: PDSClient
    @ObservationIgnored private var serverTask: Task<Void, Never>?
    @ObservationIgnored private var pageTask: Task<Void, Never>?
    @ObservationIgnored private var hydrationTask: Task<Void, Never>?
    /// Identifies the running drain so a cancelled one, finishing late,
    /// never clears a newer task's slot.
    @ObservationIgnored private var hydrationToken = UUID()
    @ObservationIgnored private var pendingHandleLookups: [String] = []
    @ObservationIgnored private var generation = 0

    public init(host: String, http: HTTPClient = .shared) {
        self.host = host
        pdsBase = PDSServer.normalizePdsBase(host)
        pdsServer = PDSServer(http: http)
        pdsClient = PDSClient(http: http)
    }

    // MARK: Loading

    /// Fetch the server description, its health and the first page of
    /// repos. The returned task finishes when the description and the page
    /// have settled; handle lookups continue behind it (see
    /// `finishHandleLookups`).
    @discardableResult
    public func load() -> Task<Void, Never> {
        cancel()
        generation += 1
        let gen = generation
        server = .loading
        health = nil
        repos = []
        cursor = nil
        done = false
        reposError = nil
        filter = ""
        handles = [:]
        pendingHandleLookups = []
        isLoadingRepos = true
        let serverTask = Task { [weak self] in
            guard let self else { return }
            await withTaskGroup(of: Void.self) { group in
                group.addTask { await self.loadServerDescription(gen) }
                group.addTask { await self.loadServerHealth(gen) }
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

    /// Stop every in-flight read, handle lookups included.
    public func cancel() {
        serverTask?.cancel()
        serverTask = nil
        pageTask?.cancel()
        pageTask = nil
        hydrationTask?.cancel()
        hydrationTask = nil
        pendingHandleLookups = []
        isLoadingRepos = false
    }

    /// Wait for the queued handle lookups to drain.
    public func finishHandleLookups() async {
        while let task = hydrationTask {
            await task.value
            if task == hydrationTask { break }
        }
    }

    private func loadServerDescription(_ gen: Int) async {
        do {
            let description = try await pdsServer.describeServer(pds: pdsBase)
            guard gen == generation, !Task.isCancelled else { return }
            server = .loaded(description)
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

    private func loadPage(after: String?, generation gen: Int) async {
        isLoadingRepos = true
        reposError = nil
        do {
            let page = try await pdsServer.listRepos(pds: pdsBase, limit: Self.pageSize, cursor: after)
            guard gen == generation, !Task.isCancelled else { return }
            let batch = page.repos
            repos = after == nil ? batch : repos + batch
            let next = page.cursor.flatMap { $0.isEmpty ? nil : $0 }
            cursor = next
            if next == nil || batch.isEmpty {
                done = true
            }
            scheduleHandleLookups(batch.map(\.did))
        } catch {
            guard gen == generation, !Task.isCancelled else { return }
            reposError = ExploreErrorText.describe(error)
        }
        isLoadingRepos = false
    }

    // MARK: Handle hydration

    /// Queue lookups for DIDs whose handle is unknown and start the drain
    /// if it is not already running. One queue per model, so two pages
    /// landing back to back share the same cap rather than doubling it.
    private func scheduleHandleLookups(_ dids: [String]) {
        let queued = Set(pendingHandleLookups)
        pendingHandleLookups.append(contentsOf: dids.filter { handles[$0] == nil && !queued.contains($0) })
        guard hydrationTask == nil, !pendingHandleLookups.isEmpty else { return }
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
    /// flight, handing each freed slot to the next DID in page order.
    /// Lookups are best-effort: a failure leaves the row showing its DID.
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
                        let handle = description?.handle.flatMap { $0.isEmpty ? nil : $0 }
                        return (did, handle)
                    }
                }
                guard let (did, handle) = await group.next() else { break }
                inFlight -= 1
                if let handle, !Task.isCancelled {
                    handles[did] = handle
                }
            }
        }
    }

    // MARK: Derived

    private var query: String {
        filter.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    public var rows: [PDSRepoRow] {
        repos.map { PDSRepoRow(entry: $0, handle: handles[$0.did]) }
    }

    public var visibleRows: [PDSRepoRow] {
        let needle = query
        guard !needle.isEmpty else { return rows }
        return rows.filter { row in
            row.did.lowercased().contains(needle) || (row.handle?.lowercased().contains(needle) ?? false)
        }
    }

    /// The list header's count: "12 of 50 shown" while searching, else
    /// "50+ loaded" until the last page.
    public var loadedLabel: String {
        if !query.isEmpty {
            return "\(visibleRows.count) of \(repos.count) shown"
        }
        return "\(repos.count)\(done ? "" : "+") loaded"
    }

    /// The chrome bar's status: nil before anything loaded.
    public var searchStatusLabel: String? {
        guard !repos.isEmpty else { return nil }
        if !query.isEmpty {
            return "\(visibleRows.count)/\(repos.count)"
        }
        return "\(repos.count)\(done ? "" : "+")"
    }

    public var showsSkeleton: Bool {
        repos.isEmpty && isLoadingRepos
    }

    public var canLoadMore: Bool {
        !done && !repos.isEmpty
    }

    public var emptyMessage: String? {
        guard repos.isEmpty, !isLoadingRepos, reposError == nil else { return nil }
        return "No repos reported by this PDS."
    }

    /// A search only sees the pages fetched so far, and only the rows whose
    /// handle has resolved, so say that rather than implying the PDS does
    /// not host a match.
    public var noMatchMessage: String? {
        guard !repos.isEmpty, visibleRows.isEmpty else { return nil }
        let base = "No loaded repos match \(filter.trimmingCharacters(in: .whitespacesAndNewlines))."
        return done ? base : base + " Load more to search further."
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

    public var sharePath: String {
        "/explore/pds/\(URIEncoding.encodeComponent(host))"
    }
}
