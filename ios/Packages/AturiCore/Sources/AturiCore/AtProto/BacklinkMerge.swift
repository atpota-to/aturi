import Foundation

// Port of src/utils/atproto/backlinkMerge.ts: one list of linking records
// drawn from several Constellation sources at once. The backlinks panel's
// "Followers" is eight follow lexicons, its "Mentions" a dozen richtext
// paths.
//
// Constellation pages each source on its own cursor, most recently indexed
// link first. That is close to creation order but not the same: an edited
// starter pack links anew while its rkey keeps the date it was made. This
// is a k-way merge over those pages that keeps each source's own order and
// interleaves sources by the date in each head's TID rkey. Every source
// keeps a buffer, the latest head across buffers is taken next, and a
// source is only asked for another page once its buffer runs dry, so a
// 13.9M-link source and a 2-link one cost the same first request each.
//
// Constellation returns one entry per link, not per record: a starter pack
// whose three feeds were made by the target comes back three times.
// Entries for a record already taken fold into it as `links`. The web
// mutates the row object it already handed out; a Swift value cannot be
// reached once returned, so a fold into a record from an earlier batch is
// reported in that batch's `relinked` instead.

/// One linking record in a merged list.
public struct MergedBacklink: Hashable, Sendable, Identifiable {
    public var record: BacklinkRecord
    /// The `collection:path` source it came through first.
    public var source: String
    /// How many links this record holds to the target (1 for most).
    public var links: Int

    public init(record: BacklinkRecord, source: String, links: Int = 1) {
        self.record = record
        self.source = source
        self.links = links
    }

    /// The AT URI of the linking record.
    public var uri: String { record.atUri }
    public var id: String { uri }
    public var did: String { record.did }
    public var collection: String { record.collection }
    public var rkey: String { record.rkey }
}

/// One page of one source, as a fetcher hands it to the merge.
public struct BacklinkMergePage: Hashable, Sendable {
    public var records: [BacklinkRecord]
    /// Nil (or empty) when the source has nothing after this page.
    public var cursor: String?

    public init(records: [BacklinkRecord], cursor: String? = nil) {
        self.records = records
        self.cursor = cursor
    }
}

/// Fetches one page of a source; nil when the request failed.
public typealias BacklinkPageFetcher = @Sendable (_ source: String, _ cursor: String?, _ limit: Int) async -> BacklinkMergePage?

/// What one `next` call took.
public struct BacklinkMergeBatch: Hashable, Sendable {
    /// Records new to the list, latest first.
    public var items: [MergedBacklink]
    /// Records from earlier batches that turned up again in this one,
    /// keyed by AT URI, with their new link count.
    public var relinked: [String: Int]
    /// Every source is exhausted: there is nothing more to take.
    public var isDone: Bool
    /// Sources whose last request failed; they are treated as exhausted.
    public var failed: [String]

    public init(items: [MergedBacklink] = [], relinked: [String: Int] = [:], isDone: Bool = false, failed: [String] = []) {
        self.items = items
        self.relinked = relinked
        self.isDone = isDone
        self.failed = failed
    }
}

/// The merge itself, `createBacklinkMerge` on the web. An actor because it
/// keeps per-source buffers across calls; callers take one batch at a time
/// (the panel marks a list busy while a batch is in flight, as the web
/// does), since two overlapping `next` calls would interleave their
/// refills.
public actor BacklinkMerge {
    private let pageSize: Int
    private let concurrency: Int
    private let fetchPage: BacklinkPageFetcher
    private var states: [SourceState]
    /// Every record taken so far, in order, and where each sits.
    private var taken: [MergedBacklink] = []
    private var takenIndex: [String: Int] = [:]

    private struct SourceState {
        var source: String
        var buffer: [BacklinkRecord] = []
        var cursor: String?
        var exhausted = false
        var failed = false
        /// Sort key of the last record taken from this source.
        var lastKey: Double = -Double.infinity
    }

    private struct RefillRequest: Sendable {
        var index: Int
        var source: String
        var cursor: String?
    }

    /// - Parameters:
    ///   - sources: `collection:path` source keys, as `getBacklinks` takes them.
    ///   - pageSize: records asked of a source per request.
    ///   - concurrency: dry sources refilled at once.
    public init(sources: [String], pageSize: Int = 25, concurrency: Int = 6, fetchPage: @escaping BacklinkPageFetcher) {
        self.pageSize = pageSize
        self.concurrency = concurrency
        self.fetchPage = fetchPage
        self.states = sources.map { SourceState(source: $0) }
    }

    /// The key a source's head competes with: the time in its TID rkey. A
    /// head whose rkey is not a TID (a custom key, `self`) has no date of
    /// its own, so it rides with its neighbours in the same source: the
    /// record taken before it, else the next dated record in the buffer. A
    /// source with no dated record in sight sorts after every dated one,
    /// rather than heading a list the reader expects to start with the
    /// latest links.
    private static func headKey(_ state: SourceState) -> Double {
        if let own = TID.date(from: state.buffer[0].rkey) {
            return own.timeIntervalSince1970
        }
        if state.lastKey.isFinite { return state.lastKey }
        for record in state.buffer {
            if let date = TID.date(from: record.rkey) {
                return date.timeIntervalSince1970
            }
        }
        return -Double.infinity
    }

    /// Take up to `count` more records, latest first.
    public func next(_ count: Int) async -> BacklinkMergeBatch {
        let start = taken.count
        var relinked: [String: Int] = [:]
        while taken.count - start < count {
            let dry = states.indices.filter { states[$0].buffer.isEmpty && !states[$0].exhausted }
            if !dry.isEmpty {
                await refill(dry)
            }
            var best: Int?
            var bestKey = -Double.infinity
            for index in states.indices where !states[index].buffer.isEmpty {
                let key = BacklinkMerge.headKey(states[index])
                if best == nil || key > bestKey {
                    best = index
                    bestKey = key
                }
            }
            guard let index = best else { break }
            let record = states[index].buffer.removeFirst()
            states[index].lastKey = bestKey
            let uri = record.atUri
            if let seen = takenIndex[uri] {
                taken[seen].links += 1
                if seen < start {
                    relinked[uri] = taken[seen].links
                }
                continue
            }
            takenIndex[uri] = taken.count
            taken.append(MergedBacklink(record: record, source: states[index].source))
        }
        return BacklinkMergeBatch(
            items: Array(taken[start...]),
            relinked: relinked,
            isDone: states.allSatisfy { $0.exhausted && $0.buffer.isEmpty },
            failed: states.filter { $0.failed }.map { $0.source }
        )
    }

    /// Ask every dry source for its next page, a few at a time.
    private func refill(_ indices: [Int]) async {
        let requests = indices.map { RefillRequest(index: $0, source: states[$0].source, cursor: states[$0].cursor) }
        let fetch = fetchPage
        let limit = pageSize
        // The fetch never throws (a failure is a nil page), so the fallback
        // only exists because the helper is generic over throwing work.
        let pages: [BacklinkMergePage?] = (try? await SlingshotClient.mapWithConcurrency(requests, limit: concurrency) { request, _ in
            await fetch(request.source, request.cursor, limit)
        }) ?? [BacklinkMergePage?](repeating: nil, count: requests.count)
        for (offset, request) in requests.enumerated() {
            let index = request.index
            guard offset < pages.count, let page = pages[offset] else {
                states[index].exhausted = true
                states[index].failed = true
                continue
            }
            let cursor = page.cursor.flatMap { $0.isEmpty ? nil : $0 }
            states[index].buffer.append(contentsOf: page.records)
            states[index].cursor = cursor
            if cursor == nil || page.records.isEmpty {
                states[index].exhausted = true
            }
        }
    }

    /// The live fetcher: one `getBacklinks` page for `target` per call.
    public static func constellationFetcher(target: String, client: ConstellationClient) -> BacklinkPageFetcher {
        return { source, cursor, limit in
            guard let page = await client.getBacklinks(target: target, source: source, limit: limit, cursor: cursor) else {
                return nil
            }
            return BacklinkMergePage(records: page.backlinks, cursor: page.cursor)
        }
    }
}
