import Foundation
import Observation

// The bulk identity resolver's screen state, port of `resolveAll` and the
// list handling in src/components/tools/BulkResolver.tsx: read the pasted
// list, resolve every identifier in it with a few requests in flight at
// once, and fill the table in as rows settle. The parsing, the row reading
// and the export are `BulkResolve`; one identifier's lookups are
// `BulkResolveClient`.

@MainActor
@Observable
public final class BulkResolveModel {
    /// Requests in flight at once. Enough that a few hundred identifiers
    /// finish in well under a minute, few enough that Slingshot is not asked
    /// for all of them in the same instant (`CONCURRENCY`).
    public nonisolated static let concurrency = 6

    /// Least time between two redraws of the table while rows are arriving
    /// (`PUBLISH_EVERY_MS`). A busy list settles several rows between
    /// frames; drawing each one would redraw the whole table hundreds of
    /// times.
    public nonisolated static let publishInterval: TimeInterval = 0.15

    /// The list as last submitted, read into entries.
    public private(set) var list = BulkResolve.IdentifierList()
    /// One row per entry, in the list's order.
    public private(set) var rows: [BulkResolve.Row] = []
    public private(set) var isRunning = false

    @ObservationIgnored private let client: BulkResolveClient
    @ObservationIgnored private let clock: () -> Date
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var generation = 0

    public init(http: HTTPClient = .shared, clock: @escaping () -> Date = { Date() }) {
        client = BulkResolveClient(http: http)
        self.clock = clock
    }

    public init(client: BulkResolveClient, clock: @escaping () -> Date = { Date() }) {
        self.client = client
        self.clock = clock
    }

    // MARK: Derived

    public var entries: [BulkResolve.Entry] {
        list.entries
    }

    public var counts: BulkResolve.Counts {
        BulkResolve.countRows(rows)
    }

    /// The list as the link keeps it (`?list=`): nil when there is nothing
    /// to share, or when the list is too long for a link.
    public var queryList: String? {
        guard !list.entries.isEmpty else { return nil }
        return BulkResolve.listForQuery(list.entries)
    }

    /// Whether the list is too long to keep in the link, so the table
    /// cannot be shared as one.
    public var isTooLongToShare: Bool {
        !list.entries.isEmpty && queryList == nil
    }

    /// What the editor shows once a list has been read: one entry per line,
    /// as typed, duplicates and the overflow left out.
    public var editorText: String {
        list.entries.map(\.input).joined(separator: "\n")
    }

    public var csv: String {
        BulkResolve.rowsToCsv(rows)
    }

    public var json: String {
        BulkResolve.rowsToJson(rows)
    }

    // MARK: Running

    /// Read `text` and resolve it, cancelling any run in flight. Returns the
    /// run, for callers (and tests) that wait for it; nil when the text
    /// holds nothing to resolve.
    @discardableResult
    public func submit(_ text: String) -> Task<Void, Never>? {
        cancel()
        list = BulkResolve.parseList(text)
        rows = list.entries.map(BulkResolve.pendingRow)
        guard rows.contains(where: { $0.state == .pending }) else { return nil }

        generation += 1
        let gen = generation
        let entries = list.entries
        isRunning = true
        let run = Task<Void, Never> { [weak self] in
            guard let self else { return }
            await self.resolveAll(entries, gen)
        }
        task = run
        return run
    }

    public func cancel() {
        task?.cancel()
        task = nil
        generation += 1
        isRunning = false
    }

    private func resolveAll(_ entries: [BulkResolve.Entry], _ gen: Int) async {
        let client = self.client
        let queue = entries.indices.filter { entries[$0].kind != .invalid }
        var working = rows
        var lastPublish = clock()

        await withTaskGroup(of: (Int, BulkResolve.Outcome?).self) { group in
            var cursor = 0
            while cursor < queue.count, cursor < BulkResolveModel.concurrency {
                let index = queue[cursor]
                let entry = entries[index]
                cursor += 1
                group.addTask { (index, await client.resolve(entry)) }
            }
            while let (index, outcome) = await group.next() {
                guard gen == generation else {
                    group.cancelAll()
                    break
                }
                working[index] = BulkResolve.classifyRow(entries[index], outcome: outcome)
                if clock().timeIntervalSince(lastPublish) >= BulkResolveModel.publishInterval {
                    lastPublish = clock()
                    rows = working
                }
                if cursor < queue.count {
                    let nextIndex = queue[cursor]
                    let nextEntry = entries[nextIndex]
                    cursor += 1
                    group.addTask { (nextIndex, await client.resolve(nextEntry)) }
                }
            }
        }

        guard gen == generation else { return }
        rows = working
        isRunning = false
        task = nil
    }
}
