import Foundation
import Observation

// Port of the state behind src/components/explore/JetstreamFeed.tsx: the
// live record feed from the Jetstream firehose. The socket delivers
// thousands of commits a second; showing each one would make the list
// unreadable, so arrivals are buffered and a handful surface on a fixed
// interval. The rate and the rolling counters are computed from every
// arrival, so the sense of scale survives the sampling.

/// One feed row. Port of `Row`.
public struct JetstreamRow: Hashable, Sendable, Identifiable {
    /// `uri|op|ts`: a single commit cannot show twice, while a create
    /// followed by an update of the same URI still surfaces as two rows.
    public var id: String { "\(uri)|\(op.rawValue)|\(timeUs)" }
    public let uri: String
    public let did: String
    public let collection: String
    public let rkey: String
    /// The record value; empty for a delete, which carries none.
    public let value: JSONValue
    public let op: JetstreamOperation
    /// Firehose timestamp in microseconds (`ts` on the web).
    public let timeUs: Int
    /// When this process saw the commit, which drives the rate counters.
    public let receivedAt: Date

    public init(commit: JetstreamCommit, receivedAt: Date = Date()) {
        uri = commit.atUri
        did = commit.did
        collection = commit.commit.collection
        rkey = commit.commit.rkey
        value = commit.commit.record ?? .object([:])
        op = commit.commit.operation
        timeUs = commit.timeUs
        self.receivedAt = receivedAt
    }

    /// The firehose time.
    public var time: Date {
        Date(timeIntervalSince1970: Double(timeUs) / 1_000_000)
    }

    /// The DID column: `did:plc:abc1...wxyz`.
    public var didLabel: String { shortDid(did) }

    /// The collection column: the last two NSID segments (`feed.post`).
    public var collectionTail: String {
        collection.components(separatedBy: ".").suffix(2).joined(separator: ".")
    }

    /// The record page, nil when the commit does not form a valid AT URI
    /// (the row then renders without a link).
    public var explorerPath: String? { explorePath(fromAtUri: uri) }

    /// A one-line preview of the record for the third column.
    public var preview: String { RecordPreview.previewFor(value) }

    /// The op pill: `+` create, `~` update, `×` delete.
    public var opSymbol: String {
        switch op {
        case .create: return "+"
        case .update: return "~"
        case .delete: return "\u{00D7}"
        }
    }

    public var opTitle: String { op.rawValue }
}

/// Rolling counters since the feed started: events seen, the per-op
/// breakdown, and how many distinct DIDs and lexicons went by.
public struct JetstreamStats: Hashable, Sendable {
    public var total: Int
    public var creates: Int
    public var updates: Int
    public var deletes: Int
    public var uniqueDids: Int
    public var uniqueCollections: Int

    public static let empty = JetstreamStats()

    public init(total: Int = 0, creates: Int = 0, updates: Int = 0, deletes: Int = 0, uniqueDids: Int = 0, uniqueCollections: Int = 0) {
        self.total = total
        self.creates = creates
        self.updates = updates
        self.deletes = deletes
        self.uniqueDids = uniqueDids
        self.uniqueCollections = uniqueCollections
    }
}

/// One entry of the stats footer: a value, its label and a hover hint.
public struct JetstreamStatItem: Hashable, Sendable, Identifiable {
    public var id: String { label }
    public let label: String
    public let value: String
    public let hint: String

    public init(label: String, value: String, hint: String) {
        self.label = label
        self.value = value
        self.hint = hint
    }
}

/// Where the commits come from, so tests can feed the model without a
/// socket. The default opens a `JetstreamClient`.
public struct JetstreamFeedSource: Sendable {
    public typealias Subscription = (commits: AsyncStream<JetstreamCommit>, close: @Sendable () -> Void)

    public var open: @Sendable (JetstreamOptions) -> Subscription

    public init(open: @escaping @Sendable (JetstreamOptions) -> Subscription) {
        self.open = open
    }

    public static let live = JetstreamFeedSource { options in
        let client = JetstreamClient(options: options)
        return (client.commits, { client.cancel() })
    }
}

/// The live feed. Two-layer throttle, as on the web:
///
///   1. Arrivals go into a buffer; the buffer is flushed to `rows` on a
///      fixed interval (`flushInterval`).
///   2. Each flush surfaces at most `maxInsertsPerFlush` rows (the newest)
///      and drops the rest, so the list reads as a sample of activity
///      rather than a strobe of every commit.
///
/// Pausing stops rows from surfacing while the socket, the rate and the
/// counters keep running: tearing the socket down on every tap dropped
/// the buffer and hammered the Jetstream server. `stop()` is what the app
/// calls when the scene goes to the background, the way the web closes the
/// socket for a hidden tab: websockets are not throttled there, so an
/// unattended feed would otherwise pull the whole firehose indefinitely.
@MainActor
@Observable
public final class JetstreamModel {
    /// Rows kept in the list before old rows drop off.
    public nonisolated static let defaultMaxRows = 200
    /// `FLUSH_INTERVAL_MS`: slower than the firehose tempo on purpose. A
    /// faster flush feels more live, but at thousands of events a second
    /// the list churns so fast that nothing is readable.
    public nonisolated static let flushInterval: TimeInterval = 0.75
    /// `MAX_INSERTS_PER_FLUSH`.
    public nonisolated static let maxInsertsPerFlush = 6
    /// Arrivals held between flushes; past this the oldest are dropped so
    /// memory stays flat under steady load.
    public nonisolated static let bufferCap = 400
    /// The throughput indicator averages over this many seconds.
    public nonisolated static let rateWindow: TimeInterval = 5
    public nonisolated static let title = "Live across the Atmosphere"

    public let maxRows: Int
    /// NSIDs the subscription is limited to; empty means every collection.
    /// A trailing `*` matches a namespace, as Jetstream's own filter does.
    public private(set) var collections: [String]
    /// Commit operations to surface; empty means creates only, so the
    /// landing strip stays calm. Pass all three for the full mutation stream.
    public private(set) var ops: [JetstreamOperation]

    /// The visible rows, newest first.
    public private(set) var rows: [JetstreamRow] = []
    public private(set) var isPaused = false
    /// True between `start()` and `stop()`.
    public private(set) var isRunning = false
    /// Arrivals per second over the last `rateWindow`, sampled each flush.
    public private(set) var eventsPerSecond = 0
    /// Arrivals over the last sixty seconds, sampled each flush.
    public private(set) var eventsPerMinute = 0
    /// The counters, sampled each flush so they do not churn per event.
    public private(set) var stats: JetstreamStats = .empty

    @ObservationIgnored private let source: JetstreamFeedSource
    @ObservationIgnored private let clock: @Sendable () -> Date
    @ObservationIgnored private let interval: TimeInterval
    @ObservationIgnored private var buffer: [JetstreamRow] = []
    /// Arrivals per whole second, keyed by that second; pruned each flush.
    @ObservationIgnored private var arrivals: [Int: Int] = [:]
    @ObservationIgnored private var total = 0
    @ObservationIgnored private var opCounts: [JetstreamOperation: Int] = [:]
    @ObservationIgnored private var seenDids = Set<String>()
    @ObservationIgnored private var seenCollections = Set<String>()
    @ObservationIgnored private var consumeTask: Task<Void, Never>?
    @ObservationIgnored private var tickTask: Task<Void, Never>?
    @ObservationIgnored private var closeSubscription: (@Sendable () -> Void)?

    /// `clock` stamps arrivals and drives the rate maths; `flushInterval`
    /// paces the automatic flush (tests pass a long one and call `flush()`
    /// themselves).
    public init(
        collections: [String] = [],
        ops: [JetstreamOperation] = [],
        maxRows: Int = JetstreamModel.defaultMaxRows,
        source: JetstreamFeedSource = .live,
        flushInterval: TimeInterval = JetstreamModel.flushInterval,
        clock: @escaping @Sendable () -> Date = { Date() }
    ) {
        self.collections = collections
        self.ops = ops
        self.maxRows = max(1, maxRows)
        self.source = source
        interval = flushInterval
        self.clock = clock
    }

    // MARK: Lifecycle

    /// Open the subscription and start the flush timer. Rows and counters
    /// from an earlier run are kept, as the web keeps them across a
    /// reconnect.
    public func start() {
        guard !isRunning else { return }
        isRunning = true
        let subscription = source.open(JetstreamOptions(wantedCollections: collections, wantedOps: ops))
        closeSubscription = subscription.close
        consumeTask = Task { [weak self] in
            for await commit in subscription.commits {
                guard let self, !Task.isCancelled else { break }
                self.ingest(commit)
            }
        }
        let interval = interval
        tickTask = Task { [weak self] in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
                guard !Task.isCancelled, let self else { return }
                self.flush()
            }
        }
    }

    /// Close the subscription and stop the timer. The buffer and the rate
    /// window are dropped; the rows and the counters stay.
    public func stop() {
        guard isRunning else { return }
        isRunning = false
        consumeTask?.cancel()
        consumeTask = nil
        tickTask?.cancel()
        tickTask = nil
        closeSubscription?()
        closeSubscription = nil
        buffer.removeAll()
        arrivals.removeAll()
        eventsPerSecond = 0
        eventsPerMinute = 0
    }

    public func pause() { isPaused = true }
    public func resume() { isPaused = false }
    public func togglePaused() { isPaused.toggle() }

    /// Change the subscription's collections; reconnects when running.
    public func setCollections(_ next: [String]) {
        guard next != collections else { return }
        restart { collections = next }
    }

    /// Change the subscription's operations; reconnects when running.
    public func setOps(_ next: [JetstreamOperation]) {
        guard next != ops else { return }
        restart { ops = next }
    }

    private func restart(_ change: () -> Void) {
        let wasRunning = isRunning
        stop()
        change()
        if wasRunning { start() }
    }

    // MARK: Ingest and flush

    /// The operations that pass the filter (`allowedOps` of the options).
    public var allowedOps: Set<JetstreamOperation> {
        JetstreamOptions(wantedOps: ops).allowedOps
    }

    /// Whether a commit's collection passes `filters`: empty passes
    /// everything, `a.b.*` passes the namespace, anything else is exact.
    public nonisolated static func matchesCollectionFilter(_ collection: String, filters: [String]) -> Bool {
        if filters.isEmpty { return true }
        return filters.contains { filter in
            filter.hasSuffix("*") ? collection.hasPrefix(filter.dropLast()) : collection == filter
        }
    }

    /// Record one arrival: buffer it for the next flush, count it toward
    /// the rate and the totals. The op and collection filters are applied
    /// here too, so a source that ignores its options still yields a feed
    /// that matches the toggles.
    public func ingest(_ commit: JetstreamCommit) {
        guard allowedOps.contains(commit.commit.operation),
            JetstreamModel.matchesCollectionFilter(commit.commit.collection, filters: collections)
        else { return }
        let now = clock()
        buffer.append(JetstreamRow(commit: commit, receivedAt: now))
        arrivals[JetstreamModel.second(of: now), default: 0] += 1
        total += 1
        opCounts[commit.commit.operation, default: 0] += 1
        seenDids.insert(commit.did)
        seenCollections.insert(commit.commit.collection)
        if buffer.count > JetstreamModel.bufferCap {
            buffer.removeFirst(buffer.count - JetstreamModel.bufferCap)
        }
    }

    /// Arrivals waiting for the next flush.
    public var pendingCount: Int { buffer.count }

    /// One tick: sample the rate and the counters, and unless paused move
    /// the newest `maxInsertsPerFlush` arrivals to the top of the list,
    /// dropping the rest of the buffer. Paused, the buffer keeps filling
    /// (bounded), so resuming shows the latest activity, not a backlog.
    public func flush() {
        let now = clock()
        let nowSecond = JetstreamModel.second(of: now)
        arrivals = arrivals.filter { $0.key > nowSecond - 60 }
        let recent = arrivals.filter { $0.key > nowSecond - Int(JetstreamModel.rateWindow) }.values.reduce(0, +)
        eventsPerSecond = Int((Double(recent) / JetstreamModel.rateWindow).rounded(.toNearestOrAwayFromZero))
        eventsPerMinute = arrivals.values.reduce(0, +)
        stats = JetstreamStats(
            total: total,
            creates: opCounts[.create] ?? 0,
            updates: opCounts[.update] ?? 0,
            deletes: opCounts[.delete] ?? 0,
            uniqueDids: seenDids.count,
            uniqueCollections: seenCollections.count
        )
        guard !isPaused, !buffer.isEmpty else { return }
        let take = Array(buffer.suffix(JetstreamModel.maxInsertsPerFlush).reversed())
        buffer.removeAll(keepingCapacity: true)
        // Dedupe by (uri, op, ts) against the list and within the batch, so
        // a single commit cannot show twice (and no two rows share an id)
        // while a create followed by an update of the same URI still
        // surfaces as two rows.
        var seen = Set(rows.map(\.id))
        let fresh = take.filter { seen.insert($0.id).inserted }
        guard !fresh.isEmpty else { return }
        rows = Array((fresh + rows).prefix(maxRows))
    }

    private nonisolated static func second(of date: Date) -> Int {
        Int(date.timeIntervalSince1970.rounded(.down))
    }

    // MARK: Derived

    /// `~1,234/s` in the header; nil while nothing is arriving.
    public var rateLabel: String? {
        eventsPerSecond > 0 ? "~\(JetstreamModel.grouped(eventsPerSecond))/s" : nil
    }

    /// Skeleton rows fill the viewport until the first flush lands.
    public var showsSkeleton: Bool { rows.isEmpty }

    public var pauseButtonLabel: String { isPaused ? "Resume" : "Pause" }

    /// The stats footer: totals, then the distinct DIDs and lexicons seen.
    public var statItems: [JetstreamStatItem] {
        [
            JetstreamStatItem(label: "total", value: JetstreamModel.grouped(stats.total), hint: "Events received since the feed loaded"),
            JetstreamStatItem(label: "users", value: JetstreamModel.grouped(stats.uniqueDids), hint: "Distinct DIDs spotted"),
            JetstreamStatItem(label: "lexicons", value: JetstreamModel.grouped(stats.uniqueCollections), hint: "Distinct NSIDs spotted"),
        ]
    }

    /// `toLocaleString()` for a count: digits grouped by thousands.
    public nonisolated static func grouped(_ n: Int) -> String {
        let digits = Array(String(abs(n)))
        var out = ""
        for (index, digit) in digits.enumerated() {
            if index > 0, (digits.count - index) % 3 == 0 { out.append(",") }
            out.append(digit)
        }
        return n < 0 ? "-" + out : out
    }
}
