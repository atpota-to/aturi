import Foundation
import Observation

// The state behind src/components/tools/StreamMonitor.tsx: live Jetstream
// and PLC directory events in one list, filtered by source, event type,
// account, collection and text.
//
// Account and collection filters go to Jetstream as `wantedDids` and
// `wantedCollections`, so a narrow view downloads only what it shows. The PLC
// stream has no server-side filters and is matched on the device. The same
// predicate runs over rows already listed, so narrowing a filter takes effect
// at once; widening one shows what arrives next.
//
// The list holds still (new events wait above it) while it is paused,
// scrolled away from the top, or has an event open, so a row can be read
// without it sliding away. Stop goes further and closes both sockets, and so
// does the app going to the background: websockets are not throttled there,
// so an unattended monitor would otherwise pull the whole firehose.

/// Live: connected, and the list moves. Paused: still connected, counting,
/// and holding new rows above the list. Stopped: both sockets closed, so
/// nothing is downloaded. Not kept in the link: a shared view always opens
/// live.
public enum StreamTransport: String, Hashable, Sendable {
    case live
    case paused
    case stopped
}

/// What a source's status line says (`Connection`).
public enum StreamConnection: Hashable, Sendable {
    case connecting
    case open
    case reconnecting
    /// The view does not show this source, or wants none of its events.
    case off
    case background
    /// Accounts are being resolved and none has a DID yet.
    case waiting
    case stopped

    init(_ status: StreamSocketStatus) {
        switch status {
        case .connecting: self = .connecting
        case .open: self = .open
        case .reconnecting: self = .reconnecting
        }
    }
}

/// The tally beside the title: Live, Paused, Stopped or Connecting.
public enum StreamTally: String, Hashable, Sendable {
    case live = "Live"
    case paused = "Paused"
    case stopped = "Stopped"
    case connecting = "Connecting"
}

/// A listed event, and whether it arrived while the list was calm (it then
/// gets the arrival accent).
public struct StreamEventRow: Hashable, Sendable {
    public let item: StreamItem
    public let accent: Bool

    public init(item: StreamItem, accent: Bool) {
        self.item = item
        self.accent = accent
    }
}

/// Where the stream was stopped and played again: nothing in between was
/// received, and the list says so rather than closing over the hole.
public struct StreamGapRow: Hashable, Sendable {
    public let id: Int
    public let from: Date
    public let to: Date

    public init(id: Int, from: Date, to: Date) {
        self.id = id
        self.from = from
        self.to = to
    }

    public var text: String {
        let span = StreamMonitor.formatSpan(to.timeIntervalSince(from))
        return "Stopped \(StreamMonitor.clockTime(from)) to \(StreamMonitor.clockTime(to)) (\(span)). Nothing from then was received."
    }
}

public enum StreamRow: Hashable, Sendable, Identifiable {
    case event(StreamEventRow)
    case gap(StreamGapRow)

    public var id: Int {
        switch self {
        case .event(let row): return row.item.id
        case .gap(let gap): return gap.id
        }
    }

    public var event: StreamItem? {
        if case .event(let row) = self { return row.item }
        return nil
    }
}

/// The counters, sampled into state on each flush.
public struct StreamMonitorStats: Hashable, Sendable {
    /// Per event type, of events passing every filter but the type.
    public var counts: [StreamKind: Int]
    public var matched: Int
    /// Events received a second, per source.
    public var rates: [StreamSource: Double]
    /// Matching events a second.
    public var matchedRate: Double
    /// Events were left out of the list to keep up.
    public var sampled: Bool
    /// Nothing has matched yet, and the filters are still new.
    public var warming: Bool
    /// Matching events that arrived while the list was held.
    public var held: Int

    public init(
        counts: [StreamKind: Int] = [:],
        matched: Int = 0,
        rates: [StreamSource: Double] = [:],
        matchedRate: Double = 0,
        sampled: Bool = false,
        warming: Bool = true,
        held: Int = 0
    ) {
        self.counts = counts
        self.matched = matched
        self.rates = rates
        self.matchedRate = matchedRate
        self.sampled = sampled
        self.warming = warming
        self.held = held
    }

    public static let empty = StreamMonitorStats()

    public func count(_ kind: StreamKind) -> Int { counts[kind] ?? 0 }
    public func rate(_ source: StreamSource) -> Double { rates[source] ?? 0 }
}

/// How a handle in the account filter resolved.
public enum StreamHandleResult: Hashable, Sendable {
    case resolved(String)
    case notFound
}

/// One account in the filter, as its token shows it.
public struct StreamAccountChip: Hashable, Sendable, Identifiable {
    public enum State: Hashable, Sendable {
        case ready
        case pending
        case failed
    }

    public var id: String { value }
    public let value: String
    public let state: State
    /// "resolving…", "not found", or nil.
    public let note: String?
    /// The DID a handle resolved to.
    public let did: String?
}

/// A suggestion under the account or collection field.
public struct StreamSuggestion: Hashable, Sendable, Identifiable {
    public var id: String { value }
    public let value: String
    public let title: String
    public let detail: String
    public var avatar: String?
    /// The typeahead already knows the DID, so it need not be resolved again.
    public var did: String?

    public init(value: String, title: String, detail: String, avatar: String? = nil, did: String? = nil) {
        self.value = value
        self.title = title
        self.detail = detail
        self.avatar = avatar
        self.did = did
    }
}

/// What an opened PLC operation changed.
public enum StreamPlcChangesState: Hashable, Sendable {
    case tombstone
    case changes([StreamPlcChange], genesis: Bool)
    case failed(String)

    public var message: String? {
        switch self {
        case .tombstone:
            return "Tombstoned: this DID is deactivated and can\u{2019}t be updated again."
        case .changes(let changes, _):
            return changes.isEmpty ? "No change to the handle, PDS or keys. Another field was rewritten." : nil
        case .failed(let message):
            return message
        }
    }
}

/// Where the events and lookups come from, so tests can drive the model
/// without a socket. `live` opens the real feeds.
public struct StreamMonitorSources: Sendable {
    public var openJetstream: @Sendable (_ wantedDids: [String], _ wantedCollections: [String]) -> StreamSubscription<StreamJetstreamEvent>
    public var openPlc: @Sendable () -> StreamSubscription<PlcStreamEntry>
    public var resolveHandle: @Sendable (String) async -> String?
    public var resolveDidHandle: @Sendable (String) async -> String?
    public var auditLog: @Sendable (String) async throws -> [PlcStreamAuditEntry]
    public var suggestAccounts: @Sendable (String) async -> [StreamSuggestion]
    public var searchCollections: @Sendable (String) async -> [StreamSuggestion]

    public init(
        openJetstream: @escaping @Sendable (_ wantedDids: [String], _ wantedCollections: [String]) -> StreamSubscription<StreamJetstreamEvent>,
        openPlc: @escaping @Sendable () -> StreamSubscription<PlcStreamEntry>,
        resolveHandle: @escaping @Sendable (String) async -> String?,
        resolveDidHandle: @escaping @Sendable (String) async -> String?,
        auditLog: @escaping @Sendable (String) async throws -> [PlcStreamAuditEntry],
        suggestAccounts: @escaping @Sendable (String) async -> [StreamSuggestion] = { _ in [] },
        searchCollections: @escaping @Sendable (String) async -> [StreamSuggestion] = { _ in [] }
    ) {
        self.openJetstream = openJetstream
        self.openPlc = openPlc
        self.resolveHandle = resolveHandle
        self.resolveDidHandle = resolveDidHandle
        self.auditLog = auditLog
        self.suggestAccounts = suggestAccounts
        self.searchCollections = searchCollections
    }

    public static let live = StreamMonitorSources(
        openJetstream: { dids, collections in
            StreamMonitorFeeds.jetstream(wantedDids: dids, wantedCollections: collections)
        },
        openPlc: {
            StreamMonitorFeeds.plc()
        },
        resolveHandle: { handle in
            await IdentityResolver.shared.resolveHandle(handle)
        },
        resolveDidHandle: { did in
            await IdentityResolver.shared.resolveDIDHandle(did)
        },
        auditLog: { did in
            let url = makeURL(Endpoints.plcDirectory, path: did + "/log/audit")
            let json = try await HTTPClient.shared.getJSONValue(from: url)
            return (json.arrayValue ?? []).map { PlcStreamAuditEntry(json: $0) }
        },
        suggestAccounts: { query in
            // The sign-in field's typeahead, from the AppView.
            guard AppViewClient.shouldQueryHandleTypeahead(query) else { return [] }
            var text = query.trimmingCharacters(in: .whitespacesAndNewlines)
            if text.hasPrefix("@") { text.removeFirst() }
            let actors = await AppViewClient().searchActorsTypeahead(text, limit: 6)
            return actors.map { actor in
                let name = actor.displayName?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                return StreamSuggestion(
                    value: actor.handle,
                    title: name.isEmpty ? actor.handle : name,
                    detail: actor.handle,
                    avatar: actor.avatar,
                    did: actor.did
                )
            }
        },
        searchCollections: { query in
            // The UFOs lexicon search ranks alphabetically and is full of
            // one-account test NSIDs, so only lexicons more than one account
            // writes are offered, busiest first.
            let result = await UFOsClient().searchLexicons(query)
            return result.matches
                .sorted { $0.counts.didsEstimate > $1.counts.didsEstimate }
                .filter { $0.counts.didsEstimate >= 2 }
                .map { match in
                    StreamSuggestion(
                        value: match.nsid,
                        title: match.nsid,
                        detail: "\(StreamMonitor.formatCount(match.counts.didsEstimate)) accounts"
                    )
                }
        }
    )
}

@MainActor
@Observable
public final class StreamMonitorModel {
    /// `FLUSH_MS`: how often buffered events reach the list.
    public nonisolated static let flushInterval: TimeInterval = 0.5
    /// Most rows any one event type adds per flush, newest kept. An
    /// unfiltered Jetstream runs at thousands of creates a second; capping
    /// each type rather than the whole batch keeps a rare account event or
    /// PLC operation from being crowded out by likes. The counters stay
    /// exact either way.
    public nonisolated static let perKindPerFlush = 10
    /// Rows kept, on screen and while held.
    public nonisolated static let maxRows = 300
    public nonisolated static let rateWindow: TimeInterval = 5
    /// How long the "sampled" note lingers after the last dropped event.
    public nonisolated static let sampledNote: TimeInterval = 3
    /// Matching events a second below which the list counts as calm: new
    /// rows get the arrival accent and accounts are looked up as they come
    /// into view. Above it the accent would sit on every row, and lookups
    /// would mean hundreds of requests a minute for rows nobody can read at
    /// that speed.
    public nonisolated static let calmRate: Double = 3
    /// How long an empty list shows skeleton rows after connecting or a
    /// filter change, before it says it is waiting.
    public nonisolated static let warmup: TimeInterval = 4
    /// Most collections tallied from the live stream, for suggestions.
    public nonisolated static let maxSeenCollections = 5_000

    public private(set) var filters: StreamMonitorFilters
    public private(set) var transport: StreamTransport = .live
    public private(set) var stoppedSince: Date?
    /// Newest first: events and gaps.
    public private(set) var rows: [StreamRow] = []
    public private(set) var stats: StreamMonitorStats = .empty
    public private(set) var socketStatus: [StreamSource: StreamSocketStatus] = [.jetstream: .connecting, .plc: .connecting]
    /// Handle in the account filter -> how it resolved; absent while pending.
    public private(set) var handleResults: [String: StreamHandleResult] = [:]
    /// DID -> handle, for rows and the open event.
    public private(set) var handles: [String: String] = [:]
    /// The event open in the inspector.
    public private(set) var openId: Int?
    /// Scrolled down the list, so it holds still while read.
    public private(set) var scrolledAway = false
    /// On screen (between `activate()` and `deactivate()`).
    public private(set) var isActive = false
    public private(set) var isBackground = false

    @ObservationIgnored private let sources: StreamMonitorSources
    @ObservationIgnored private let clock: @Sendable () -> Date
    @ObservationIgnored private let interval: TimeInterval

    // Everything the socket callbacks write to: kept out of observation so
    // a busy stream costs no view work per event; `flush()` samples it.
    @ObservationIgnored private var compiled: StreamCompiledFilter
    @ObservationIgnored private var nextId = 1
    @ObservationIgnored private var pending: [StreamKind: [PendingEvent]] = [:]
    @ObservationIgnored private var lastDropAt = Date.distantPast
    @ObservationIgnored private var held: [StreamRow] = []
    @ObservationIgnored private var heldMatched = 0
    @ObservationIgnored private var counts: [StreamKind: Int] = [:]
    @ObservationIgnored private var matched = 0
    @ObservationIgnored private var received: [StreamSource: Int] = [:]
    @ObservationIgnored private var samples: [Sample] = []
    /// When the matched count last went back to zero.
    @ObservationIgnored private var zeroSince: Date
    /// Collections seen in commits, and how often, for the collection field.
    @ObservationIgnored private var seenCollections: [String: Int] = [:]
    @ObservationIgnored private var requestedAccounts = Set<String>()
    @ObservationIgnored private var requestedHandles = Set<String>()

    @ObservationIgnored private var jetstream: (config: JetstreamConfig, subscription: StreamSubscription<StreamJetstreamEvent>, task: Task<Void, Never>)?
    @ObservationIgnored private var plc: (subscription: StreamSubscription<PlcStreamEntry>, task: Task<Void, Never>)?
    @ObservationIgnored private var tickTask: Task<Void, Never>?

    private struct JetstreamConfig: Hashable {
        let dids: [String]
        let collections: [String]
    }

    private enum PendingEvent {
        case jetstream(StreamJetstreamEvent, id: Int)
        case plc(PlcStreamEntry, id: Int)
    }

    private struct Sample {
        let time: Date
        let jetstream: Int
        let plc: Int
        let matched: Int
    }

    /// `filters` is the view a link handed the tool. `flushInterval` paces
    /// the automatic flush (tests pass a long one and call `flush()`).
    public init(
        filters: StreamMonitorFilters = .default,
        sources: StreamMonitorSources = .live,
        flushInterval: TimeInterval = StreamMonitorModel.flushInterval,
        clock: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.filters = filters
        self.sources = sources
        interval = flushInterval
        self.clock = clock
        zeroSince = clock()
        compiled = StreamMonitor.compileFilter(filters, dids: nil)
        refilter()
    }

    /// The monitor for a `/tools/stream?…` link.
    public convenience init(query: [String: String], sources: StreamMonitorSources = .live) {
        self.init(filters: StreamMonitor.filters(from: NetworkToolQuery.items(from: query)), sources: sources)
    }

    // MARK: Lifecycle

    /// On screen: start the flush timer, resolve the filter's handles and
    /// connect what the view wants.
    public func activate() {
        guard !isActive else { return }
        isActive = true
        let interval = interval
        tickTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
                guard !Task.isCancelled, let self else { return }
                self.flush()
            }
        }
        resolveAccounts()
        reconcile()
    }

    /// Off screen: close the sockets and stop the timer. The rows stay.
    public func deactivate() {
        guard isActive else { return }
        isActive = false
        tickTask?.cancel()
        tickTask = nil
        reconcile()
    }

    /// The app went to the background, or came back. Both sockets close in
    /// the background and reconnect at the live edge on return.
    public func setBackground(_ background: Bool) {
        guard background != isBackground else { return }
        isBackground = background
        reconcile()
    }

    // MARK: Accounts

    /// The DIDs the account filter stands for: nil without one, empty while
    /// none has resolved.
    public var accountDids: Set<String>? {
        guard !filters.accounts.isEmpty else { return nil }
        var dids = Set<String>()
        for account in filters.accounts {
            if account.hasPrefix("did:") {
                dids.insert(account)
            } else if case .resolved(let did)? = handleResults[account] {
                dids.insert(did)
            }
        }
        return dids
    }

    public var accountsPending: Bool {
        filters.accounts.contains { !$0.hasPrefix("did:") && handleResults[$0] == nil }
    }

    public var noAccountResolved: Bool {
        accountDids?.isEmpty ?? false
    }

    /// The account filter's tokens, with how each handle resolved.
    public var accountChips: [StreamAccountChip] {
        filters.accounts.map { account in
            if account.hasPrefix("did:") {
                return StreamAccountChip(value: account, state: .ready, note: nil, did: account)
            }
            switch handleResults[account] {
            case nil:
                return StreamAccountChip(value: account, state: .pending, note: "resolving\u{2026}", did: nil)
            case .resolved(let did)?:
                return StreamAccountChip(value: account, state: .ready, note: nil, did: did)
            case .notFound?:
                return StreamAccountChip(value: account, state: .failed, note: "not found", did: nil)
            }
        }
    }

    private func resolveAccounts() {
        for account in filters.accounts where !account.hasPrefix("did:") && !requestedAccounts.contains(account) {
            requestedAccounts.insert(account)
            let resolve = sources.resolveHandle
            Task { [weak self] in
                let did = await resolve(account)
                guard let self else { return }
                self.accountResolved(account, did: did)
            }
        }
    }

    private func accountResolved(_ account: String, did: String?) {
        if let did, did.hasPrefix("did:") {
            handleResults[account] = .resolved(did)
        } else {
            handleResults[account] = .notFound
        }
        refilter()
        reconcile()
    }

    // MARK: Filters

    /// The view as the link keeps it.
    public var queryItems: NetworkToolQueryItems {
        StreamMonitor.queryItems(for: filters)
    }

    /// `viewToSearch`.
    public var search: String {
        StreamMonitor.search(for: filters)
    }

    /// Counts describe the current filters, so they restart when those change.
    private func resetCounts() {
        counts = [:]
        matched = 0
        heldMatched = 0
        samples = []
        zeroSince = clock()
    }

    /// `changeView`.
    public func setFilters(_ next: StreamMonitorFilters, recount: Bool = true) {
        if recount { resetCounts() }
        filters = next
        resolveAccounts()
        refilter()
        reconcile()
    }

    public func setSource(_ source: StreamSourceChoice) {
        var next = filters
        next.source = source
        setFilters(next)
    }

    /// A chip switched on or off. The counts carry on: they already count
    /// every type.
    public func toggleKind(_ kind: StreamKind) {
        var next = filters
        if next.kinds.contains(kind) {
            next.kinds.removeAll { $0 == kind }
        } else {
            next.kinds.append(kind)
        }
        setFilters(next, recount: false)
    }

    public func setText(_ text: String) {
        guard text != filters.text else { return }
        var next = filters
        next.text = text
        setFilters(next)
    }

    /// Add an account as typed. Returns the reason it was refused, nil when
    /// it was added (or was already there). `knownDid` comes with a
    /// typeahead pick, which needs no second lookup.
    @discardableResult
    public func addAccount(_ raw: String, knownDid: String? = nil) -> String? {
        guard let token = StreamMonitor.parseAccountToken(raw) else {
            return "\u{201C}\(raw.trimmingCharacters(in: .whitespacesAndNewlines))\u{201D} isn\u{2019}t a handle or DID."
        }
        let value = token.value
        guard !filters.accounts.contains(value) else { return nil }
        guard filters.accounts.count < StreamMonitor.maxAccounts else {
            return "Up to \(StreamMonitor.maxAccounts) accounts."
        }
        if let knownDid, knownDid.hasPrefix("did:"), case .handle = token {
            requestedAccounts.insert(value)
            handleResults[value] = .resolved(knownDid)
        }
        var next = filters
        next.accounts.append(value)
        setFilters(next)
        return nil
    }

    public func removeAccount(_ value: String) {
        var next = filters
        next.accounts.removeAll { $0 == value }
        setFilters(next)
    }

    /// Add a collection as typed: an NSID or a `.*` namespace. Returns the
    /// reason it was refused, nil when it was added.
    @discardableResult
    public func addCollection(_ raw: String) -> String? {
        guard let nsid = StreamMonitor.parseCollectionToken(raw) else {
            return "\u{201C}\(raw.trimmingCharacters(in: .whitespacesAndNewlines))\u{201D} isn\u{2019}t an NSID or a namespace like app.bsky.*"
        }
        guard !filters.collections.contains(nsid) else { return nil }
        guard filters.collections.count < StreamMonitor.maxCollections else {
            return "Up to \(StreamMonitor.maxCollections) collections."
        }
        var next = filters
        next.collections.append(nsid)
        setFilters(next)
        return nil
    }

    public func removeCollection(_ value: String) {
        var next = filters
        next.collections.removeAll { $0 == value }
        setFilters(next)
    }

    public func applyPreset(_ preset: StreamPreset) {
        setFilters(preset.filters)
        showLatest()
    }

    public func isPresetActive(_ preset: StreamPreset) -> Bool {
        search == StreamMonitor.search(for: preset.filters)
    }

    public func resetFilters() {
        setFilters(.default)
    }

    /// The open event's "Watch account".
    public func watchAccount(_ did: String) {
        resetCounts()
        if !filters.accounts.contains(did), filters.accounts.count < StreamMonitor.maxAccounts {
            var next = filters
            next.accounts.append(did)
            filters = next
            resolveAccounts()
            refilter()
            reconcile()
        }
        showLatest()
    }

    /// The open event's "Watch collection".
    public func watchCollection(_ collection: String) {
        resetCounts()
        if !filters.collections.contains(collection), filters.collections.count < StreamMonitor.maxCollections {
            var next = filters
            next.collections.append(collection)
            filters = next
            refilter()
            reconcile()
        }
        showLatest()
    }

    private func refilter() {
        compiled = StreamMonitor.compileFilter(filters, dids: accountDids)
    }

    /// What the filters have set, for the filters button. The text filter
    /// sits beside the button in plain sight, so it is not counted.
    public var filterCount: Int {
        let shownKinds = StreamMonitor.allKinds.filter { filters.source.shows($0.source) }
        var count = filters.source != .both ? 1 : 0
        if shownKinds.contains(where: { !filters.kinds.contains($0) }) { count += 1 }
        count += filters.accounts.count
        if filters.source != .plc { count += filters.collections.count }
        return count
    }

    /// Sources the view shows, in order.
    public var shownSources: [StreamSource] {
        StreamSource.allCases.filter { filters.source.shows($0) }
    }

    // MARK: Sockets

    /// Whether the view wants a source's events at all.
    public func wants(_ source: StreamSource) -> Bool {
        filters.source.shows(source)
            && StreamMonitor.kinds(of: source).contains { filters.kinds.contains($0) }
            && !noAccountResolved
    }

    /// Open, close or reopen each socket to match the view and the
    /// transport. A socket reopens only when what it sends would change: a
    /// new set of DIDs or collections for Jetstream.
    private func reconcile() {
        let connectable = isActive && !isBackground && transport != .stopped

        var wantedJetstream: JetstreamConfig?
        if connectable && wants(.jetstream) {
            wantedJetstream = JetstreamConfig(
                dids: (accountDids ?? []).sorted(),
                collections: filters.collections
            )
        }
        if wantedJetstream != jetstream?.config {
            closeJetstream()
            if let wantedJetstream { openJetstream(wantedJetstream) }
        }

        let wantsPlc = connectable && wants(.plc)
        if wantsPlc, plc == nil {
            openPlc()
        } else if !wantsPlc, plc != nil {
            closePlc()
        }
    }

    private func openJetstream(_ config: JetstreamConfig) {
        let subscription = sources.openJetstream(config.dids, config.collections)
        let task = Task { [weak self] in
            for await update in subscription.updates {
                guard let self, !Task.isCancelled else { break }
                switch update {
                case .status(let status):
                    self.setSocketStatus(.jetstream, status)
                case .event(let event):
                    self.ingestJetstream(event)
                }
            }
        }
        jetstream = (config, subscription, task)
    }

    private func closeJetstream() {
        guard let current = jetstream else { return }
        current.task.cancel()
        current.subscription.close()
        jetstream = nil
    }

    private func openPlc() {
        let subscription = sources.openPlc()
        let task = Task { [weak self] in
            for await update in subscription.updates {
                guard let self, !Task.isCancelled else { break }
                switch update {
                case .status(let status):
                    self.setSocketStatus(.plc, status)
                case .event(let entry):
                    self.ingestPlc(entry)
                }
            }
        }
        plc = (subscription, task)
    }

    private func closePlc() {
        guard let current = plc else { return }
        current.task.cancel()
        current.subscription.close()
        plc = nil
    }

    private func setSocketStatus(_ source: StreamSource, _ status: StreamSocketStatus) {
        if socketStatus[source] != status {
            socketStatus[source] = status
        }
    }

    /// Whether a source's socket is open right now (for tests and status).
    public func isConnected(_ source: StreamSource) -> Bool {
        switch source {
        case .jetstream: return jetstream != nil
        case .plc: return plc != nil
        }
    }

    /// What a source's status line says.
    public func connection(_ source: StreamSource) -> StreamConnection {
        if !filters.source.shows(source) { return .off }
        if accountsPending && noAccountResolved { return .waiting }
        if !wants(source) { return .off }
        if transport == .stopped { return .stopped }
        if isBackground { return .background }
        return StreamConnection(socketStatus[source] ?? .connecting)
    }

    /// `connectionText`.
    public func connectionText(_ source: StreamSource) -> String {
        switch connection(source) {
        case .open: return StreamMonitor.formatRate(stats.rate(source))
        case .connecting: return "connecting\u{2026}"
        case .reconnecting: return "reconnecting\u{2026}"
        case .off: return "off"
        case .stopped: return "stopped"
        case .background: return "paused in background"
        case .waiting: return "waiting for handles"
        }
    }

    public var isConnecting: Bool {
        shownSources.contains { source in
            let state = connection(source)
            return state == .connecting || state == .reconnecting
        }
    }

    // MARK: Ingest

    /// Record one Jetstream event: count it, and keep it for the next flush
    /// when it matches.
    public func ingestJetstream(_ event: StreamJetstreamEvent) {
        if socketStatus[.jetstream] != .open { setSocketStatus(.jetstream, .open) }
        if let collection = event.collection {
            if let n = seenCollections[collection] {
                seenCollections[collection] = n + 1
            } else if seenCollections.count < StreamMonitorModel.maxSeenCollections {
                seenCollections[collection] = 1
            }
        }
        ingest(event.probe) { .jetstream(event, id: $0) }
    }

    public func ingestPlc(_ entry: PlcStreamEntry) {
        if socketStatus[.plc] != .open { setSocketStatus(.plc, .open) }
        ingest(entry.probe) { .plc(entry, id: $0) }
    }

    private func ingest(_ probe: StreamProbe, _ make: (Int) -> PendingEvent) {
        received[probe.source, default: 0] += 1
        guard StreamMonitor.matchesExceptKind(compiled, probe) else { return }
        counts[probe.kind, default: 0] += 1
        guard compiled.kinds.contains(probe.kind) else { return }
        matched += 1
        if isHeld { heldMatched += 1 }
        let id = nextId
        nextId += 1
        // Rows are built when they are kept, not for every event.
        var list = pending[probe.kind] ?? []
        list.append(make(id))
        if list.count > StreamMonitorModel.perKindPerFlush {
            list.removeFirst()
            lastDropAt = clock()
        }
        pending[probe.kind] = list
    }

    private func build(_ event: PendingEvent, now: Date) -> StreamItem {
        switch event {
        case .jetstream(let jetstreamEvent, let id):
            return StreamMonitor.item(fromJetstream: jetstreamEvent, id: id)
        case .plc(let entry, let id):
            return StreamMonitor.item(fromPlc: entry, id: id, now: now)
        }
    }

    /// One tick: sample the rates and counters, and move what arrived into
    /// the list, or above it while the list is held.
    public func flush() {
        let now = clock()
        samples.append(Sample(time: now, jetstream: received[.jetstream] ?? 0, plc: received[.plc] ?? 0, matched: matched))
        while samples.count > 2 && now.timeIntervalSince(samples[1].time) >= StreamMonitorModel.rateWindow {
            samples.removeFirst()
        }
        let first = samples[0]
        let span = now.timeIntervalSince(first.time)
        func per(_ n: Int) -> Double {
            span > 0 ? Double(max(0, n)) / span : 0
        }
        let rates: [StreamSource: Double] = [
            .jetstream: per((received[.jetstream] ?? 0) - first.jetstream),
            .plc: per((received[.plc] ?? 0) - first.plc),
        ]
        let matchedRate = per(matched - first.matched)
        let accent = matchedRate < StreamMonitorModel.calmRate

        var fresh: [StreamRow] = []
        for list in pending.values {
            for event in list {
                fresh.append(.event(StreamEventRow(item: build(event, now: now), accent: accent)))
            }
        }
        pending.removeAll()
        fresh.sort { $0.id > $1.id }

        if isHeld {
            if !fresh.isEmpty {
                held = Array((fresh + held).prefix(StreamMonitorModel.maxRows))
            }
        } else if !fresh.isEmpty || !held.isEmpty {
            let incoming = fresh + held
            held = []
            heldMatched = 0
            rows = Array((incoming + rows).prefix(StreamMonitorModel.maxRows))
        }

        let next = StreamMonitorStats(
            counts: counts,
            matched: matched,
            rates: rates,
            matchedRate: matchedRate,
            sampled: now.timeIntervalSince(lastDropAt) < StreamMonitorModel.sampledNote,
            warming: matched == 0 && now.timeIntervalSince(zeroSince) < StreamMonitorModel.warmup,
            held: heldMatched
        )
        if next != stats {
            stats = next
        }
    }

    /// Rows waiting above a held list.
    public var heldCount: Int { held.count }

    // MARK: Transport

    /// The list holds still while paused, scrolled away or with an event open.
    public var isHeld: Bool {
        transport == .paused || scrolledAway || openId != nil
    }

    public func pause() {
        if transport == .live { transport = .paused }
    }

    /// Stop: close both sockets, so nothing is downloaded.
    public func stop() {
        guard transport != .stopped else { return }
        stoppedSince = clock()
        transport = .stopped
        reconcile()
    }

    /// Back to live. From a stop the sockets reconnect at the live edge, the
    /// rates start over, and the list marks the gap, ahead of anything that
    /// arrives after it.
    public func play() {
        guard transport != .live else { return }
        if transport == .stopped {
            let now = clock()
            samples = []
            zeroSince = now
            if let since = stoppedSince {
                let gap = StreamRow.gap(StreamGapRow(id: nextId, from: since, to: now))
                nextId += 1
                if isHeld {
                    held = Array(([gap] + held).prefix(StreamMonitorModel.maxRows))
                } else {
                    rows = Array(([gap] + rows).prefix(StreamMonitorModel.maxRows))
                }
            }
            stoppedSince = nil
            socketStatus = [.jetstream: .connecting, .plc: .connecting]
        }
        transport = .live
        reconcile()
    }

    /// Space: pause or resume.
    public func togglePlay() {
        if transport == .live {
            pause()
        } else {
            play()
        }
    }

    /// The held banner's action: back to live, at the top of the list.
    public func showLatest() {
        if transport == .paused { transport = .live }
        openId = nil
        scrolledAway = false
    }

    /// Clear the list and counts.
    public func clear() {
        pending.removeAll()
        held = []
        resetCounts()
        rows = []
        openId = nil
    }

    public func setScrolledAway(_ away: Bool) {
        if away != scrolledAway { scrolledAway = away }
    }

    // MARK: Rows

    /// The rows the filters pass, gaps included. Narrowing a filter hides
    /// listed rows at once.
    public var visibleRows: [StreamRow] {
        let filter = StreamMonitor.compileFilter(filters, dids: accountDids)
        return rows.filter { row in
            switch row {
            case .gap: return true
            case .event(let event): return StreamMonitor.matchesFilter(filter, event.item.probe)
            }
        }
    }

    public var hasVisibleEvents: Bool {
        visibleRows.contains { $0.event != nil }
    }

    /// The event open in the inspector.
    public var openItem: StreamItem? {
        guard let openId else { return nil }
        return rows.lazy.compactMap(\.event).first { $0.id == openId }
    }

    public func open(_ id: Int?) {
        openId = id
    }

    /// Step to the next event (`1`, older) or the previous one (`-1`,
    /// newer), opening the newest when none is open.
    public func step(_ direction: Int) {
        let ids = visibleRows.compactMap { $0.event?.id }
        guard !ids.isEmpty else { return }
        let at = openId.flatMap { ids.firstIndex(of: $0) }
        guard let at else {
            openId = ids[0]
            return
        }
        openId = ids[min(ids.count - 1, max(0, at + direction))]
    }

    /// Whether the open event has a newer or an older neighbour.
    public func canStep(_ direction: Int) -> Bool {
        let ids = visibleRows.compactMap { $0.event?.id }
        guard let openId, let at = ids.firstIndex(of: openId) else { return false }
        let next = at + direction
        return next >= 0 && next < ids.count
    }

    public var isCalm: Bool {
        stats.matchedRate < StreamMonitorModel.calmRate
    }

    /// Accounts are looked up while the list is calm or held.
    public var lookupAllowed: Bool {
        isHeld || isCalm
    }

    /// Look up a row's handle once, while lookups are allowed (or always,
    /// for the open event). Cached and shared by the resolver.
    public func lookUpHandle(for did: String, force: Bool = false) {
        guard handles[did] == nil, !requestedHandles.contains(did) else { return }
        guard force || lookupAllowed else { return }
        requestedHandles.insert(did)
        let resolve = sources.resolveDidHandle
        Task { [weak self] in
            let handle = await resolve(did)
            guard let self, let handle else { return }
            self.handles[did] = handle
        }
    }

    /// What an opened PLC operation changed, read against the operation
    /// before it in the DID's audit log. Fetched when the event is opened,
    /// not before: one request for an event someone asked about, none for
    /// the rest.
    public func plcChanges(for entry: PlcStreamEntry) async -> StreamPlcChangesState {
        let kind = StreamMonitor.plcKind(entry.operation)
        if kind == .plcTombstone { return .tombstone }
        if kind == .plcNew {
            return .changes(StreamMonitor.describePlcChange(prev: nil, next: entry.operation), genesis: true)
        }
        do {
            let log = try await sources.auditLog(entry.did)
            guard let at = log.firstIndex(where: { $0.cid == entry.cid }) else {
                return .failed("This operation isn\u{2019}t in the DID\u{2019}s log yet. Try again in a moment.")
            }
            let before = log[..<at].reversed().first { !$0.nullified }
            return .changes(StreamMonitor.describePlcChange(prev: before?.operation, next: entry.operation), genesis: false)
        } catch {
            return .failed("Couldn\u{2019}t read the DID\u{2019}s log from plc.directory.")
        }
    }

    // MARK: Suggestions

    /// Account suggestions for what is typed, from the AppView typeahead.
    public func suggestAccounts(_ query: String) async -> [StreamSuggestion] {
        let found = await sources.suggestAccounts(query)
        return found.filter { !filters.accounts.contains($0.value) }
    }

    /// Collection suggestions, best first: the namespace itself as a
    /// wildcard when the text is one, then collections this screen has seen
    /// go by, most frequent first, then the UFOs lexicon search.
    public func suggestCollections(_ query: String) async -> [StreamSuggestion] {
        var q = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if q.hasSuffix(".*") {
            q.removeLast(2)
        } else if q.hasSuffix(".") {
            q.removeLast()
        }
        guard !q.isEmpty else { return [] }
        var items: [StreamSuggestion] = []
        if q.contains("."), let wildcard = StreamMonitor.parseCollectionToken(q + ".*") {
            items.append(StreamSuggestion(value: wildcard, title: wildcard, detail: "Every collection in this namespace"))
        }
        let local = seenCollections
            .filter { $0.key.lowercased().contains(q) }
            .sorted { $0.value != $1.value ? $0.value > $1.value : $0.key < $1.key }
            .prefix(6)
        for (nsid, n) in local {
            items.append(StreamSuggestion(value: nsid, title: nsid, detail: "\(StreamMonitor.formatCount(n)) seen on this page"))
        }
        if items.count < 7 {
            let searched = await sources.searchCollections(query)
            for match in searched {
                if items.count >= 7 { break }
                if items.contains(where: { $0.value == match.value }) { continue }
                items.append(match)
            }
        }
        return items.filter { !filters.collections.contains($0.value) }
    }

    // MARK: Copy

    /// The empty list's sentence.
    public var emptyMessage: String {
        var message = "Waiting for matching events. With narrow filters this can take a while."
        if !wants(.jetstream) && !wants(.plc) && !noAccountResolved { message = "Every event type is switched off." }
        if accountsPending && noAccountResolved {
            message = "Resolving handles\u{2026}"
        } else if noAccountResolved {
            message = "None of those accounts resolved to a DID."
        }
        if transport == .stopped {
            message = "Stopped. Play to connect again."
        } else if isBackground {
            message = "Paused while the app is in the background."
        }
        return message
    }

    /// Skeleton rows while the sockets connect and the first events arrive.
    public var showsSkeleton: Bool {
        !hasVisibleEvents && !isBackground && transport != .stopped
            && (isConnecting || ((wants(.jetstream) || wants(.plc)) && stats.warming))
    }

    /// The banner above a held or stopped list, nil while it is live.
    public var heldLabel: String? {
        if transport == .stopped {
            if let stoppedSince {
                return "Stopped at \(StreamMonitor.clockTime(stoppedSince)) \u{00B7} Play"
            }
            return "Stopped \u{00B7} Play"
        }
        guard isHeld else { return nil }
        if stats.held > 0 {
            let noun = stats.held == 1 ? "event" : "events"
            let n = "\(JetstreamModel.grouped(stats.held)) new \(noun)"
            return transport == .paused ? "Paused \u{00B7} \(n) \u{00B7} Resume" : "\(n) \u{00B7} Show latest"
        }
        if transport == .paused { return "Paused \u{00B7} Resume" }
        if openId != nil { return "Holding while an event is open \u{00B7} Back to live" }
        return "Holding while you read \u{00B7} Back to live"
    }

    public var tally: StreamTally {
        if transport == .stopped { return .stopped }
        if transport == .paused { return .paused }
        if isConnecting { return .connecting }
        return .live
    }

    /// The line under the list.
    public var footNote: String {
        let perSecond = Int(Double(StreamMonitorModel.perKindPerFlush) / StreamMonitorModel.flushInterval)
        var note = stats.sampled
            ? "Busy stream: the list keeps up to \(perSecond) events a second of each type. The counts include every event."
            : "Newest first. The last \(StreamMonitorModel.maxRows) are kept."
        if !isCalm && !isHeld { note += " Pause to see handles." }
        return note
    }
}
