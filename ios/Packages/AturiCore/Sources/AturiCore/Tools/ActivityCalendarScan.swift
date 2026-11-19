import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// The activity calendar's reading: every collection in a repository,
/// newest record first, back to the start of the window. Port of
/// `src/lib/tools/activityScan.ts`; the arithmetic is in `ActivityCalendar`.
///
/// `com.atproto.repo.listRecords` returns a collection in descending key
/// order by default (`reverse=true` is oldest first), 100 records a page at
/// most. TIDs sort by time, so a collection is read from its newest record
/// and reading stops at the first key older than the window; a quiet
/// collection costs one request. A collection whose keys carry no time
/// cannot stop early and is read to its end.
///
/// The cost lands on the account's own PDS, which is often one person's
/// server, so it is bounded twice: a few collections at a time, and a page
/// budget per run, for each collection and overall. A collection that runs
/// out of budget keeps its cursor and is marked `partial`; running again
/// resumes there rather than starting over. That is what "Read further
/// back" does, and also why Stop loses nothing.
///
/// What has been read is kept by DID in `ActivityCalendarStore` for as long
/// as the app runs (the web keeps it for the life of the page), so
/// returning to an account or reading further never repeats a request. Only
/// day counts are kept: each page's records are dropped as soon as their
/// keys are counted.
public enum ActivityCalendarScan {
    /// listRecords refuses more than this.
    static let pageSize = 100
    /// A page of long records can pass the client's response cap; this size never has.
    static let smallPageSize = 25
    /// Collections read at once.
    public static let concurrency = 3
    /// Pages one collection may take in one run: 5,000 records.
    public static let pagesPerCollection = 50
    /// Pages one run may take in all.
    public static let pagesPerRun = 250

    /// `reading` while requests are going out. `done` when every
    /// collection has been read back to the window's start. `partial` when
    /// the run ended with some left short: the budget ran out, or Stop was
    /// pressed.
    public enum Phase: String, Hashable, Sendable {
        case reading
        case done
        case partial
    }

    /// Why a `partial` run ended.
    public enum EndedBy: String, Hashable, Sendable {
        case budget
        case stop
    }

    /// The web's `ActivityScan`: one account's year as read so far.
    public struct Snapshot: Hashable, Sendable {
        public var did: String
        public var handle: String?
        public var pds: String
        public var window: ActivityCalendar.Window
        /// One entry per collection, in the order the PDS lists them.
        public var collections: [ActivityCalendar.CollectionScan]
        public var phase: Phase
        public var endedBy: EndedBy?
        /// Requests made by this run.
        public var pagesThisRun: Int

        public init(
            did: String,
            handle: String?,
            pds: String,
            window: ActivityCalendar.Window,
            collections: [ActivityCalendar.CollectionScan],
            phase: Phase,
            endedBy: EndedBy?,
            pagesThisRun: Int
        ) {
            self.did = did
            self.handle = handle
            self.pds = pds
            self.window = window
            self.collections = collections
            self.phase = phase
            self.endedBy = endedBy
            self.pagesThisRun = pagesThisRun
        }
    }

    static func isTooLarge(_ error: Error) -> Bool {
        if let failure = error as? HTTPFailure, case .tooLarge = failure { return true }
        return false
    }

    /// What went wrong with a PDS request, in words for a row.
    static func failureText(_ error: Error) -> String {
        if let http = error as? HTTPError { return "the PDS answered HTTP \(http.status)" }
        if let urlError = error as? URLError, urlError.code == .timedOut {
            return "the PDS did not answer in time"
        }
        return "the PDS could not be reached"
    }

    /// The record key is the last segment of the record's at:// URI.
    static func rkeyOf(_ uri: String) -> String {
        guard let slash = uri.lastIndex(of: "/") else { return uri }
        return String(uri[uri.index(after: slash)...])
    }

    /// Read an account's year. Publishes after every page, so the calendar
    /// fills in as it loads. Throws only when the account or its
    /// collections cannot be found at all; a collection that fails is
    /// recorded on its own row and the rest carry on. Cancelling the task
    /// abandons the run without writing over what a later one has read;
    /// `stopper` ends it early and keeps everything. `store` is the shared
    /// one unless a test hands it its own.
    @MainActor
    public static func scan(
        actor: String,
        http: HTTPClient = .shared,
        resolver: IdentityResolver = .shared,
        store: ActivityCalendarStore? = nil,
        stopper: ActivityCalendarStopper,
        now: Date = Date(),
        calendar: Calendar = .current,
        publish: @escaping (Snapshot) -> Void
    ) async throws -> Snapshot {
        let identity: IdentityBundle
        do {
            identity = try await resolver.resolveIdentifier(actor)
        } catch {
            try Task.checkCancellation()
            throw AccountCheckError("\(actor) could not be resolved. Check the spelling, or try its DID.")
        }
        if let inactive = identity.repoStatus {
            throw AccountCheckError(
                "This account is \(inactive.status ?? "inactive"), so its PDS will not serve its records."
            )
        }

        let pds = PDSClient(http: http)
        let names: [String]
        do {
            names = try await pds.describeRepo(pds: identity.pds, repo: identity.did).collections
        } catch {
            try Task.checkCancellation()
            throw AccountCheckError("The account\u{2019}s collections could not be listed: \(failureText(error)).")
        }
        try Task.checkCancellation()

        let window = ActivityCalendar.buildWindow(now: now, calendar: calendar)
        let entry = (store ?? ActivityCalendarStore.shared).entry(did: identity.did, windowStart: window.start)
        for name in names {
            if let known = entry.scans[name] {
                // A collection that failed or stopped short last time gets another go.
                if known.state != .done {
                    var retry = known
                    retry.state = .waiting
                    retry.error = nil
                    entry.scans[name] = retry
                }
            } else {
                entry.scans[name] = ActivityCalendar.emptyScan(name)
            }
        }

        let run = ActivityCalendarRun(
            identity: identity,
            names: names,
            window: window,
            entry: entry,
            pds: pds,
            stopper: stopper,
            calendar: calendar,
            publish: publish
        )
        return await run.read()
    }
}

/// What has been read so far, by DID. A new day starts a new window, and a
/// new count. The web's module-level `cache`.
@MainActor
public final class ActivityCalendarStore {
    public static let shared = ActivityCalendarStore()

    /// One account's counts for one window.
    final class Entry {
        let windowStart: Date
        var scans: [String: ActivityCalendar.CollectionScan] = [:]

        init(windowStart: Date) {
            self.windowStart = windowStart
        }
    }

    private var entries: [String: Entry] = [:]

    public init() {}

    func entry(did: String, windowStart: Date) -> Entry {
        if let existing = entries[did], existing.windowStart == windowStart {
            return existing
        }
        let fresh = Entry(windowStart: windowStart)
        entries[did] = fresh
        return fresh
    }
}

/// Stop ends a read early without throwing its results away, so it cannot
/// be the task's cancellation: each read gets a switch of its own to watch,
/// as the web keeps a `ScanStopper` apart from the run's abort signal.
@MainActor
public final class ActivityCalendarStopper {
    public private(set) var isStopped = false

    public init() {}

    /// End the run after the requests already in flight.
    public func stop() {
        isStopped = true
    }
}

/// One run's shared state: the budget, the queue of collections and the
/// counts, all on the main actor so the few readers working through the
/// queue at once take turns with them, as the web's do on its one thread.
@MainActor
final class ActivityCalendarRun {
    private let identity: IdentityBundle
    private let names: [String]
    private let window: ActivityCalendar.Window
    private let entry: ActivityCalendarStore.Entry
    private let pds: PDSClient
    private let stopper: ActivityCalendarStopper
    private let calendar: Calendar
    private let publish: (ActivityCalendarScan.Snapshot) -> Void
    private var queue: [String]
    private var pagesThisRun = 0

    init(
        identity: IdentityBundle,
        names: [String],
        window: ActivityCalendar.Window,
        entry: ActivityCalendarStore.Entry,
        pds: PDSClient,
        stopper: ActivityCalendarStopper,
        calendar: Calendar,
        publish: @escaping (ActivityCalendarScan.Snapshot) -> Void
    ) {
        self.identity = identity
        self.names = names
        self.window = window
        self.entry = entry
        self.pds = pds
        self.stopper = stopper
        self.calendar = calendar
        self.publish = publish
        queue = names
    }

    private func snapshot(_ phase: ActivityCalendarScan.Phase, endedBy: ActivityCalendarScan.EndedBy? = nil) -> ActivityCalendarScan.Snapshot {
        ActivityCalendarScan.Snapshot(
            did: identity.did,
            handle: identity.handle,
            pds: identity.pds,
            window: window,
            collections: names.map { entry.scans[$0] ?? ActivityCalendar.emptyScan($0) },
            phase: phase,
            endedBy: endedBy,
            pagesThisRun: pagesThisRun
        )
    }

    private func put(_ scan: ActivityCalendar.CollectionScan) {
        entry.scans[scan.collection] = scan
        if !Task.isCancelled {
            publish(snapshot(.reading))
        }
    }

    func read() async -> ActivityCalendarScan.Snapshot {
        publish(snapshot(.reading))
        let run = self
        let width = min(ActivityCalendarScan.concurrency, names.count)
        await withTaskGroup(of: Void.self) { group in
            for _ in 0..<width {
                group.addTask {
                    await run.work()
                }
            }
        }
        let short = names.contains { entry.scans[$0]?.state == .partial }
        if short {
            return snapshot(.partial, endedBy: stopper.isStopped ? .stop : .budget)
        }
        return snapshot(.done)
    }

    /// One reader: the next collection in the queue, until there is none.
    private func work() async {
        while !queue.isEmpty {
            let name = queue.removeFirst()
            await readCollection(name)
        }
    }

    private func fetchPage(_ name: String, cursor: String?) async throws -> ListRecordsPage {
        do {
            return try await pds.listRecordsPage(
                pds: identity.pds,
                repo: identity.did,
                collection: name,
                limit: ActivityCalendarScan.pageSize,
                cursor: cursor
            )
        } catch {
            guard ActivityCalendarScan.isTooLarge(error) else { throw error }
            pagesThisRun += 1
            return try await pds.listRecordsPage(
                pds: identity.pds,
                repo: identity.did,
                collection: name,
                limit: ActivityCalendarScan.smallPageSize,
                cursor: cursor
            )
        }
    }

    private func readCollection(_ name: String) async {
        guard var scan = entry.scans[name], scan.state != .done else { return }
        var pagesHere = 0

        while true {
            if Task.isCancelled { return }
            if stopper.isStopped
                || pagesHere >= ActivityCalendarScan.pagesPerCollection
                || pagesThisRun >= ActivityCalendarScan.pagesPerRun {
                scan.state = .partial
                put(scan)
                return
            }
            if scan.state != .reading {
                scan.state = .reading
                put(scan)
            }

            pagesThisRun += 1
            pagesHere += 1
            let page: ListRecordsPage
            do {
                page = try await fetchPage(name, cursor: scan.cursor)
            } catch {
                // A run that was replaced while this page was in flight must
                // not write over what its successor has read since.
                if Task.isCancelled { return }
                scan.state = .failed
                scan.error = ActivityCalendarScan.failureText(error)
                put(scan)
                return
            }
            if Task.isCancelled { return }

            let records = page.records.map { record in
                ActivityCalendar.KeyedRecord(
                    rkey: ActivityCalendarScan.rkeyOf(record.uri),
                    createdAt: record.value["createdAt"]
                )
            }
            let tallied = ActivityCalendar.tallyPage(scan, records: records, window: window, calendar: calendar)
            scan = tallied.scan
            let next = page.cursor.flatMap { $0.isEmpty ? nil : $0 }
            scan.cursor = next
            if tallied.passedWindow || next == nil || records.isEmpty {
                scan.state = .done
                scan.cursor = nil
                put(scan)
                return
            }
            put(scan)
        }
    }
}
