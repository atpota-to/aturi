import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// How the list is written: the signed-in account's repo writes, handed in
/// by the app's session layer, which owns the token and its refresh.
///
/// `createListItems` writes up to `batchSize` list items in one call. With
/// `applyWrites` that is 200 in one commit, all or none; a session that can
/// only create one record at a time says 1, and the pacing below works the
/// same way a record at a time.
public struct MutualsListWriter: Sendable {
    /// The signed-in account, whose repository the list goes in.
    public var did: String
    public var batchSize: Int
    /// createRecord: a collection and a record, back the new record's at:// URI.
    public var createRecord: @Sendable (_ collection: String, _ record: JSONValue) async throws -> String
    /// Write these `app.bsky.graph.listitem` records. A batch that fails wrote nothing.
    public var createListItems: @Sendable (_ records: [JSONValue]) async throws -> Void

    public init(
        did: String,
        batchSize: Int,
        createRecord: @escaping @Sendable (_ collection: String, _ record: JSONValue) async throws -> String,
        createListItems: @escaping @Sendable (_ records: [JSONValue]) async throws -> Void
    ) {
        self.did = did
        self.batchSize = max(1, min(batchSize, Mutuals.applyWritesMax))
        self.createRecord = createRecord
        self.createListItems = createListItems
    }
}

public struct MutualsAddProgress: Hashable, Sendable {
    public var done: Int
    public var total: Int
    /// Seconds until the write budget allows the next batch, while waiting for it.
    public var waitingSeconds: Int?

    public init(done: Int, total: Int, waitingSeconds: Int? = nil) {
        self.done = done
        self.total = total
        self.waitingSeconds = waitingSeconds
    }
}

public struct MutualsAddOutcome: Hashable, Sendable {
    public enum Ending: String, Hashable, Sendable {
        case stop
        case rateLimit
        case error
    }

    /// Accounts written to the list.
    public var added: Int
    /// Accounts not written, in order, to add again.
    public var remaining: [String]
    /// Why it ended short. Nil when everything was added.
    public var endedBy: Ending?
    /// The first error's message, when `endedBy` is `.error`.
    public var error: String?

    public init(added: Int, remaining: [String], endedBy: Ending? = nil, error: String? = nil) {
        self.added = added
        self.remaining = remaining
        self.endedBy = endedBy
        self.error = error
    }
}

/// Saving the mutuals' blocks tool's result as a moderation list: the
/// writes, in the signed-in account's own repository. Port of
/// `src/lib/tools/mutualsSave.ts`; the records themselves are built in
/// `Mutuals`.
///
/// A list is one `app.bsky.graph.list` record, and each member a separate
/// `app.bsky.graph.listitem` beside it naming the list and the account.
/// Every create costs a PDS three write points, so the batches are paced
/// against the account's hourly budget the way the collection page paces a
/// bulk delete (`WriteThrottle`); a list of a few thousand pauses rather
/// than hitting the limit. A batch that fails wrote nothing, so what is left
/// is always a whole number of batches and adding it again picks up where
/// it stopped.
public enum MutualsSave {
    /// While paused for the throttle, the budget is looked at again this
    /// often, so the countdown ticks and a Stop is picked up within a second.
    public static let throttleTick: TimeInterval = 1

    /// Create the list itself. Returns its at:// URI.
    @MainActor
    public static func createModList(
        writer: MutualsListWriter,
        name: String,
        description: String,
        throttle: WriteThrottle,
        now: Date = Date()
    ) async throws -> String {
        throttle.recordSpend(writer.did, points: Mutuals.createPoints)
        let record = Mutuals.listRecord(name: name, description: description, createdAt: Formatting.isoTimestamp(now))
        return try await writer.createRecord(Mutuals.listCollection, record)
    }

    /// Block everyone on a list, by writing a listblock record for it.
    @MainActor
    public static func blockList(writer: MutualsListWriter, list: String, throttle: WriteThrottle, now: Date = Date()) async throws {
        throttle.recordSpend(writer.did, points: Mutuals.createPoints)
        _ = try await writer.createRecord(Mutuals.listBlockCollection, Mutuals.listBlockRecord(list: list, createdAt: Formatting.isoTimestamp(now)))
    }

    /// Add accounts to a list, a batch at a time, pacing against the write
    /// budget. Once `isStopped` says so it ends after the batch in flight.
    @MainActor
    public static func addMembers(
        writer: MutualsListWriter,
        list: String,
        subjects: [String],
        throttle: WriteThrottle,
        sleep: @Sendable (TimeInterval) async -> Void,
        isStopped: () -> Bool,
        onProgress: (MutualsAddProgress) -> Void
    ) async -> MutualsAddOutcome {
        let size = writer.batchSize
        let batches = Mutuals.chunk(subjects, size: size)
        var added = 0
        onProgress(MutualsAddProgress(done: 0, total: subjects.count))

        for (index, batch) in batches.enumerated() {
            let points = batch.count * Mutuals.createPoints
            let remaining = Array(subjects[(index * size)...])

            while !isStopped() {
                let wait = throttle.secondsUntilBudget(writer.did, needed: points)
                if wait <= 0 { break }
                onProgress(MutualsAddProgress(done: added, total: subjects.count, waitingSeconds: Int(wait.rounded(.up))))
                await sleep(min(wait, throttleTick))
            }
            if isStopped() {
                return MutualsAddOutcome(added: added, remaining: remaining, endedBy: .stop)
            }

            // Reserve the points before sending, and keep them on a failure:
            // under-counting is what would trip the limit.
            throttle.recordSpend(writer.did, points: points)
            let createdAt = Formatting.isoTimestamp(Date())
            let records = batch.map { Mutuals.listItemRecord(list: list, subject: $0, createdAt: createdAt) }
            do {
                try await writer.createListItems(records)
            } catch {
                if let http = error as? HTTPError, http.status == 429 {
                    return MutualsAddOutcome(added: added, remaining: remaining, endedBy: .rateLimit)
                }
                return MutualsAddOutcome(added: added, remaining: remaining, endedBy: .error, error: describe(error))
            }
            added += batch.count
            onProgress(MutualsAddProgress(done: added, total: subjects.count))
        }
        return MutualsAddOutcome(added: added, remaining: [])
    }

    /// A failed write in words: the XRPC error's own message where it gave one.
    public static func describe(_ error: Error) -> String {
        if let error = error as? MutualsError { return error.message }
        if let http = error as? HTTPError {
            if let body = try? JSONValue.parse(Data(http.body.utf8)) {
                if let message = body["message"]?.stringValue, !message.isEmpty { return message }
                if let name = body["error"]?.stringValue, !name.isEmpty { return name }
            }
            return "HTTP \(http.status)"
        }
        return ExploreErrorText.describe(error)
    }
}
