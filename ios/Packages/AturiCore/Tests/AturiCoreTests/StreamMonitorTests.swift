import Foundation
import XCTest
@testable import AturiCore

/// Port of src/lib/__tests__/streamMonitor.test.ts, then the feeds' URLs
/// and message decoding, the formatters, and the screen model against fake
/// feeds.
final class StreamMonitorTests: XCTestCase {
    static let did = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa"

    private func jet(_ json: String) -> StreamJetstreamEvent {
        guard let event = StreamMonitor.decodeJetstream(json) else {
            XCTFail("not a Jetstream event: \(json)")
            return StreamJetstreamEvent(did: "", timeUs: 0, body: .identity(handle: nil), raw: json)
        }
        return event
    }

    private func plcEntry(_ operation: String) -> PlcStreamEntry {
        let json = #"{"seq":10,"type":"sequenced_op","did":"\#(Self.did)","operation":\#(operation),"cid":"bafy","createdAt":"2026-01-02T03:04:05.000Z"}"#
        guard let entry = StreamMonitor.decodePlc(json) else {
            XCTFail("not a PLC entry: \(json)")
            return PlcStreamEntry(seq: 0, did: "", operation: PlcStreamOperation(), cid: "", createdAt: "", raw: json, data: .null)
        }
        return entry
    }

    // MARK: Rows

    func testACreatedPostBecomesARowWithItsTextAndARecordLink() {
        let event = jet(#"{"did":"\#(Self.did)","time_us":1700000000000000,"kind":"commit","commit":{"operation":"create","collection":"app.bsky.feed.post","rkey":"3kabc","record":{"$type":"app.bsky.feed.post","text":"hello there"}}}"#)
        let item = StreamMonitor.item(fromJetstream: event, id: 1)
        XCTAssertEqual(item.kind, .create)
        XCTAssertEqual(item.source, .jetstream)
        XCTAssertEqual(item.time, Date(timeIntervalSince1970: 1_700_000_000))
        XCTAssertEqual(item.preview, "hello there")
        XCTAssertEqual(item.rkey, "3kabc")
        XCTAssertEqual(item.href, "/explore/\(Self.did)/app.bsky.feed.post/3kabc")
        XCTAssertEqual(item.collection, "app.bsky.feed.post")
        XCTAssertEqual(item.record?["text"]?.stringValue, "hello there")
        XCTAssertEqual(item.data["kind"]?.stringValue, "commit")
    }

    func testADeleteLinksToTheCollectionSinceTheRecordIsGone() {
        let event = jet(#"{"did":"\#(Self.did)","time_us":1,"kind":"commit","commit":{"operation":"delete","collection":"app.bsky.feed.like","rkey":"3kxyz"}}"#)
        let item = StreamMonitor.item(fromJetstream: event, id: 2)
        XCTAssertEqual(item.kind, .delete)
        XCTAssertEqual(item.rkey, "3kxyz")
        XCTAssertNil(item.preview)
        XCTAssertEqual(item.href, "/explore/\(Self.did)/app.bsky.feed.like")
    }

    func testIdentityAndAccountEventsSummariseWhatTheyCarry() {
        let withHandle = StreamMonitor.item(fromJetstream: jet(#"{"did":"\#(Self.did)","time_us":1,"kind":"identity","identity":{"did":"\#(Self.did)","handle":"alice.example.com","seq":1,"time":""}}"#), id: 3)
        XCTAssertEqual(withHandle.handle, "alice.example.com")
        XCTAssertFalse(withHandle.isResolvable, "an identity event that names its handle needs no lookup")
        let bare = StreamMonitor.item(fromJetstream: jet(#"{"did":"\#(Self.did)","time_us":1,"kind":"identity","identity":{"did":"\#(Self.did)","seq":1,"time":""}}"#), id: 4)
        XCTAssertNil(bare.handle)
        XCTAssertTrue(bare.isResolvable)
        let account = StreamMonitor.item(fromJetstream: jet(#"{"did":"\#(Self.did)","time_us":1,"kind":"account","account":{"did":"\#(Self.did)","active":false,"status":"takendown","seq":1,"time":""}}"#), id: 5)
        XCTAssertEqual(account.kind, .account)
        XCTAssertEqual(account.active, false)
        XCTAssertEqual(account.status, "takendown")
        XCTAssertEqual(account.href, "/explore/\(Self.did)")
    }

    func testPLCOperationsAreSortedIntoNewUpdateAndTombstone() {
        XCTAssertEqual(StreamMonitor.plcKind(PlcStreamOperation(type: "plc_operation", prev: nil)), .plcNew)
        XCTAssertEqual(StreamMonitor.plcKind(PlcStreamOperation(type: "create", prev: nil)), .plcNew)
        XCTAssertEqual(StreamMonitor.plcKind(PlcStreamOperation(type: "plc_operation", prev: "bafyprev")), .plcUpdate)
        XCTAssertEqual(StreamMonitor.plcKind(PlcStreamOperation(type: "plc_tombstone", prev: "bafyprev")), .plcTombstone)
        // JSON null reads as no previous operation.
        XCTAssertEqual(plcEntry(#"{"type":"plc_operation","prev":null}"#).probe.kind, .plcNew)
    }

    func testAPLCRowShowsTheClaimedHandleAndPDSHost() {
        let entry = plcEntry(#"{"type":"plc_operation","prev":null,"alsoKnownAs":["at://alice.example.com"],"services":{"atproto_pds":{"type":"AtprotoPersonalDataServer","endpoint":"https://pds.example.com/"}}}"#)
        let item = StreamMonitor.item(fromPlc: entry, id: 6)
        XCTAssertEqual(item.kind, .plcNew)
        XCTAssertEqual(item.handle, "alice.example.com")
        XCTAssertEqual(item.pds, "pds.example.com")
        XCTAssertEqual(item.time, Formatting.isoDate("2026-01-02T03:04:05.000Z"))
        XCTAssertEqual(item.href, "/explore/\(Self.did)")
        XCTAssertEqual(item.plcEntry?.cid, "bafy")
        XCTAssertFalse(item.isResolvable)
    }

    func testLegacyCreateOperationsStillYieldAHandleAndHost() {
        let item = StreamMonitor.item(fromPlc: plcEntry(#"{"type":"create","prev":null,"handle":"bob.example.com","service":"https://pds.example.com"}"#), id: 7)
        XCTAssertEqual(item.handle, "bob.example.com")
        XCTAssertEqual(item.pds, "pds.example.com")
    }

    func testATombstoneRowNamesNoHandleOrHost() {
        let item = StreamMonitor.item(fromPlc: plcEntry(#"{"type":"plc_tombstone","prev":"bafyprev","alsoKnownAs":["at://alice.example.com"]}"#), id: 8)
        XCTAssertEqual(item.kind, .plcTombstone)
        XCTAssertNil(item.handle)
        XCTAssertNil(item.pds)
    }

    func testTextMatchingIsCaseInsensitiveAndEmptyMatchesEverything() {
        XCTAssertTrue(StreamMonitor.matchesText(#"{"text":"Hello World"}"#, needle: "hello"))
        XCTAssertFalse(StreamMonitor.matchesText(#"{"text":"Hello World"}"#, needle: "goodbye"))
        XCTAssertTrue(StreamMonitor.matchesText("anything", needle: ""))
    }

    // MARK: Typed filters

    func testAccountsAreReadFromDIDsHandlesAtHandlesAndAtURIs() {
        XCTAssertEqual(StreamMonitor.parseAccountToken(Self.did), .did(Self.did))
        XCTAssertEqual(StreamMonitor.parseAccountToken("@Alice.Example.com"), .handle("alice.example.com"))
        XCTAssertEqual(StreamMonitor.parseAccountToken("at://\(Self.did)/app.bsky.feed.post/3k"), .did(Self.did))
        XCTAssertEqual(StreamMonitor.parseAccountToken("at://alice.example.com"), .handle("alice.example.com"))
        XCTAssertNil(StreamMonitor.parseAccountToken("not a handle"))
        XCTAssertNil(StreamMonitor.parseAccountToken("localhost"))
        XCTAssertNil(StreamMonitor.parseAccountToken("did:plc:"))
    }

    func testCollectionsAcceptNSIDsAndNamespaceWildcardsOnly() {
        XCTAssertEqual(StreamMonitor.parseCollectionToken("app.bsky.feed.post"), "app.bsky.feed.post")
        XCTAssertEqual(StreamMonitor.parseCollectionToken(" app.bsky.graph.* "), "app.bsky.graph.*")
        XCTAssertEqual(StreamMonitor.parseCollectionToken("app.bsky.*"), "app.bsky.*")
        XCTAssertNil(StreamMonitor.parseCollectionToken("app.*"))
        XCTAssertNil(StreamMonitor.parseCollectionToken("app.bsky.graph.fo*"))
        XCTAssertNil(StreamMonitor.parseCollectionToken("app.bsky"))
        XCTAssertNil(StreamMonitor.parseCollectionToken("*"))
    }

    // MARK: Query string

    private func roundTrip(_ filters: StreamMonitorFilters) -> StreamMonitorFilters {
        StreamMonitor.filters(from: NetworkToolQuery.decode(StreamMonitor.search(for: filters)))
    }

    func testTheDefaultViewWritesAnEmptyQueryString() {
        XCTAssertEqual(StreamMonitor.search(for: .default), "")
        XCTAssertEqual(StreamMonitor.filters(from: []), .default)
    }

    func testAFilteredViewSurvivesTheQueryString() {
        let filters = StreamMonitorFilters(
            source: .both,
            kinds: [.create, .plcNew],
            accounts: ["alice.example.com", Self.did],
            collections: ["app.bsky.feed.post", "app.bsky.graph.*"],
            text: "hello"
        )
        XCTAssertEqual(roundTrip(filters), filters)
    }

    func testAHiddenSourceKeepsAllItsKindsWhenReadBack() {
        let filters = StreamMonitorFilters(source: .jetstream, kinds: [.create, .plcNew])
        let search = StreamMonitor.search(for: filters)
        XCTAssertEqual(search, "source=jetstream&type=create")
        let back = StreamMonitor.filters(from: NetworkToolQuery.decode(search))
        XCTAssertEqual(back.kinds, [.create, .plcNew, .plcUpdate, .plcTombstone])
    }

    func testEveryVisibleKindSwitchedOffIsRecordedNotLost() {
        let filters = StreamMonitorFilters(kinds: [])
        XCTAssertEqual(StreamMonitor.search(for: filters), "type=none")
        XCTAssertEqual(roundTrip(filters).kinds, [])
    }

    func testAPLCOnlyViewLeavesCollectionsOutOfTheLink() {
        let filters = StreamMonitorFilters(source: .plc, collections: ["app.bsky.feed.post"])
        XCTAssertEqual(StreamMonitor.search(for: filters), "source=plc")
    }

    func testJunkInTheQueryStringIsDropped() {
        let filters = StreamMonitor.filters(from: NetworkToolQuery.decode(
            "source=nope&type=bogus&type=create&account=%20&account=not%20valid&collection=app"
        ))
        XCTAssertEqual(filters.source, .both)
        XCTAssertEqual(filters.kinds, [.create])
        XCTAssertEqual(filters.accounts, [])
        XCTAssertEqual(filters.collections, [])
        XCTAssertEqual(StreamMonitor.allKinds.count, 8)
    }

    func testAPostWithNothingToPreviewHasNoPreviewNotASecondTimestamp() {
        let event = jet(#"{"did":"\#(Self.did)","time_us":1,"kind":"commit","commit":{"operation":"create","collection":"app.bsky.feed.post","rkey":"3kimg","record":{"$type":"app.bsky.feed.post","text":"","createdAt":"2026-01-02T03:04:05.000Z"}}}"#)
        let item = StreamMonitor.item(fromJetstream: event, id: 8)
        XCTAssertNil(item.preview)
        XCTAssertEqual(item.rkey, "3kimg")
    }

    func testALinkWithOnlyFirstValuesStillReads() {
        // A link the app is handed keeps the first value of a repeated key.
        let filters = StreamMonitor.filters(from: NetworkToolQuery.items(from: ["source": "jetstream", "type": "create", "collection": "app.bsky.graph.follow"]))
        XCTAssertEqual(filters.source, .jetstream)
        XCTAssertEqual(filters.kinds, [.create, .plcNew, .plcUpdate, .plcTombstone])
        XCTAssertEqual(filters.collections, ["app.bsky.graph.follow"])
    }

    // MARK: Matching

    func testCollectionFiltersMatchExactNSIDsAndNamespaces() {
        XCTAssertTrue(StreamMonitor.collectionMatches("app.bsky.graph.follow", filters: ["app.bsky.graph.*"]))
        XCTAssertTrue(StreamMonitor.collectionMatches("app.bsky.feed.post", filters: ["app.bsky.feed.post"]))
        XCTAssertFalse(StreamMonitor.collectionMatches("app.bsky.feed.postgate", filters: ["app.bsky.feed.post"]))
        XCTAssertFalse(StreamMonitor.collectionMatches("app.bsky.graphs.thing", filters: ["app.bsky.graph.*"]))
    }

    func testFiltersNarrowBySourceAccountCollectionAndTextKindsAreSeparate() {
        let other = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb"
        let filter = StreamMonitor.compileFilter(
            StreamMonitorFilters(kinds: [.create], collections: ["app.bsky.feed.*"], text: "Hello"),
            dids: [Self.did]
        )
        let post = StreamProbe(source: .jetstream, kind: .create, did: Self.did, collection: "app.bsky.feed.post", raw: #"{"text":"hello"}"#)
        XCTAssertTrue(StreamMonitor.matchesFilter(filter, post))
        XCTAssertFalse(StreamMonitor.matchesFilter(filter, StreamProbe(source: .jetstream, kind: .create, did: other, collection: "app.bsky.feed.post", raw: post.raw)))
        XCTAssertFalse(StreamMonitor.matchesFilter(filter, StreamProbe(source: .jetstream, kind: .create, did: Self.did, collection: "app.bsky.graph.follow", raw: post.raw)))
        XCTAssertFalse(StreamMonitor.matchesFilter(filter, StreamProbe(source: .jetstream, kind: .create, did: Self.did, collection: "app.bsky.feed.post", raw: #"{"text":"bye"}"#)))
        // An update passes everything but its kind, so it is counted, not listed.
        let update = StreamProbe(source: .jetstream, kind: .update, did: Self.did, collection: "app.bsky.feed.post", raw: post.raw)
        XCTAssertTrue(StreamMonitor.matchesExceptKind(filter, update))
        XCTAssertFalse(StreamMonitor.matchesFilter(filter, update))
        // Identity events carry no collection and pass the collection filter.
        XCTAssertTrue(StreamMonitor.matchesExceptKind(filter, StreamProbe(source: .jetstream, kind: .identity, did: Self.did, raw: "hello")))
        // A PLC-only view drops Jetstream events.
        XCTAssertFalse(StreamMonitor.matchesExceptKind(StreamMonitor.compileFilter(StreamMonitorFilters(source: .plc), dids: nil), post))
        // Accounts asked for but none resolved: nothing passes.
        XCTAssertFalse(StreamMonitor.matchesExceptKind(StreamMonitor.compileFilter(.default, dids: []), post))
    }

    // MARK: PLC changes and presets

    func testAPLCUpdateNamesWhatMoved() {
        let prev = PlcStreamOperation(
            type: "plc_operation",
            prev: nil,
            alsoKnownAs: ["at://alice.example.com"],
            serviceEndpoints: ["atproto_pds": "https://old.example.com"],
            rotationKeys: ["did:key:a"],
            verificationMethods: ["atproto": "did:key:s1"]
        )
        var next = prev
        next.prev = "bafyprev"
        next.alsoKnownAs = ["at://alice.example.net"]
        next.serviceEndpoints = ["atproto_pds": "https://new.example.com"]
        XCTAssertEqual(StreamMonitor.describePlcChange(prev: prev, next: next), [
            StreamPlcChange(field: .handle, from: "alice.example.com", to: "alice.example.net"),
            StreamPlcChange(field: .pds, from: "old.example.com", to: "new.example.com"),
        ])
        var rotated = next
        rotated.rotationKeys = ["did:key:b"]
        rotated.verificationMethods = ["atproto": "did:key:s2"]
        XCTAssertEqual(StreamMonitor.describePlcChange(prev: next, next: rotated).map(\.label), ["Signing key", "Rotation keys"])
        // A genesis operation has nothing before it: everything it sets is new.
        XCTAssertEqual(StreamMonitor.describePlcChange(prev: nil, next: prev), [
            StreamPlcChange(field: .handle, from: nil, to: "alice.example.com"),
            StreamPlcChange(field: .pds, from: nil, to: "old.example.com"),
            StreamPlcChange(field: .signingKey, from: nil, to: "did:key:s1"),
        ])
    }

    func testALegacyGenesisComparesItsKeysToo() {
        let legacy = PlcStreamOperation(type: "create", prev: nil, handle: "bob.example.com", service: "https://pds.example.com", signingKey: "did:key:s", recoveryKey: "did:key:r")
        let modern = PlcStreamOperation(
            type: "plc_operation", prev: "bafy", alsoKnownAs: ["at://bob.example.com"],
            serviceEndpoints: ["atproto_pds": "https://pds.example.com"],
            rotationKeys: ["did:key:r", "did:key:s"], verificationMethods: ["atproto": "did:key:s"]
        )
        XCTAssertEqual(StreamMonitor.describePlcChange(prev: legacy, next: modern), [], "the same handle, host and keys in the new format")
    }

    func testEveryPresetSurvivesTheQueryStringAndIsDistinct() {
        var seen = Set<String>()
        for preset in StreamMonitor.presets {
            let search = StreamMonitor.search(for: preset.filters)
            XCTAssertFalse(search.isEmpty, "\(preset.id) is not the default view")
            XCTAssertEqual(StreamMonitor.search(for: StreamMonitor.filters(from: NetworkToolQuery.decode(search))), search, preset.id)
            XCTAssertTrue(seen.insert(search).inserted, "\(preset.id) duplicates another preset")
        }
        XCTAssertEqual(StreamMonitor.search(for: StreamMonitor.presets[3].filters), "source=jetstream&type=create&type=delete&collection=app.bsky.graph.follow")
    }

    // MARK: Messages and feeds

    func testMalformedAndUnknownMessagesAreSkipped() {
        XCTAssertNil(StreamMonitor.decodeJetstream("not json"))
        XCTAssertNil(StreamMonitor.decodeJetstream(#"{"did":"\#(Self.did)","kind":"commit","commit":{"operation":"create"}}"#), "a commit without a collection")
        XCTAssertNil(StreamMonitor.decodeJetstream(#"{"did":"\#(Self.did)","kind":"commit","commit":{"operation":"merge","collection":"a.b.c","rkey":"x"}}"#))
        XCTAssertNil(StreamMonitor.decodeJetstream(#"{"did":"\#(Self.did)","kind":"sync"}"#))
        XCTAssertNil(StreamMonitor.decodeJetstream(#"{"kind":"identity","identity":{}}"#), "no DID")
        XCTAssertNil(StreamMonitor.decodePlc(#"{"seq":1,"type":"something_else","did":"\#(Self.did)","operation":{}}"#))
        XCTAssertNil(StreamMonitor.decodePlc(#"{"seq":"1","type":"sequenced_op","did":"\#(Self.did)","operation":{}}"#))
        XCTAssertNil(StreamMonitor.decodePlc(#"{"seq":1,"type":"sequenced_op","did":"\#(Self.did)","operation":"x"}"#))
        XCTAssertEqual(StreamMonitor.decodePlc(#"{"seq":7,"type":"sequenced_op","did":"\#(Self.did)","operation":{}}"#)?.seq, 7)
    }

    func testTheFeedsAddresses() {
        XCTAssertEqual(StreamMonitorFeeds.plcURL(cursor: 0).absoluteString, "wss://plc.directory/export/stream")
        XCTAssertEqual(StreamMonitorFeeds.plcURL(cursor: 42).absoluteString, "wss://plc.directory/export/stream?cursor=42")
        XCTAssertEqual(
            StreamMonitorFeeds.jetstreamURL(wantedDids: [Self.did], wantedCollections: ["app.bsky.graph.*"]).absoluteString,
            "wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.graph.*&wantedDids=did%3Aplc%3Aaaaaaaaaaaaaaaaaaaaaaaaa"
        )
        XCTAssertEqual(StreamMonitorFeeds.jetstreamURL(wantedDids: [], wantedCollections: []).absoluteString, "wss://jetstream2.us-east.bsky.network/subscribe")
        XCTAssertEqual(StreamReconnectingSocket.backoffDelay(attempt: 0), 1)
        XCTAssertEqual(StreamReconnectingSocket.backoffDelay(attempt: 3), 8)
        XCTAssertEqual(StreamReconnectingSocket.backoffDelay(attempt: 9), 30)
    }

    func testTheSeqCursorOnlyMovesForward() {
        let cursor = StreamMonitorFeeds.SeqCursor(5)
        cursor.advance(to: 9)
        cursor.advance(to: 7)
        XCTAssertEqual(cursor.value, 9)
    }

    // MARK: Formatting

    func testCountsRatesAndSpansReadAsTheWebWritesThem() {
        XCTAssertEqual(StreamMonitor.formatCount(999), "999")
        XCTAssertEqual(StreamMonitor.formatCount(1000), "1K")
        XCTAssertEqual(StreamMonitor.formatCount(1234), "1.2K")
        XCTAssertEqual(StreamMonitor.formatCount(15_300), "15.3K")
        XCTAssertEqual(StreamMonitor.formatCount(999_950), "1M")
        XCTAssertEqual(StreamMonitor.formatCount(2_500_000), "2.5M")
        XCTAssertEqual(StreamMonitor.formatRate(0), "0/s")
        XCTAssertEqual(StreamMonitor.formatRate(2.34), "2.3/s")
        XCTAssertEqual(StreamMonitor.formatRate(1234), "1.2K/s")
        XCTAssertEqual(StreamMonitor.formatSpan(26), "26s")
        XCTAssertEqual(StreamMonitor.formatSpan(0.2), "1s")
        XCTAssertEqual(StreamMonitor.formatSpan(252), "4m 12s")
        XCTAssertEqual(StreamMonitor.formatSpan(3780), "1h 3m")
        XCTAssertEqual(StreamMonitor.clockTime(Date(timeIntervalSince1970: 1_700_000_000), timeZone: TimeZone(identifier: "UTC")!), "22:13:20")
        XCTAssertEqual(StreamMonitor.shortValue(nil), "\u{2014}")
        XCTAssertEqual(StreamMonitor.shortValue("did:key:zQ3shortkey"), "did:key:zQ3shortkey")
        XCTAssertEqual(StreamMonitor.shortValue(String(repeating: "a", count: 30) + String(repeating: "b", count: 20)), String(repeating: "a", count: 24) + "\u{2026}" + String(repeating: "b", count: 8))
    }

    func testPreviewsOfReferencesAreCutToWhatTellsThemApart() {
        let like = StreamMonitor.compactPreview("at://\(Self.did)/app.bsky.feed.post/3k")
        XCTAssertEqual(like.text, "feed.post by did:plc:aaaa\u{2026}aaaa")
        XCTAssertTrue(like.mono)
        XCTAssertEqual(StreamMonitor.compactPreview(Self.did).text, "did:plc:aaaa\u{2026}aaaa")
        XCTAssertEqual(StreamMonitor.compactPreview("hello").text, "hello")
        XCTAssertFalse(StreamMonitor.compactPreview("hello").mono)
    }

    func testQueryStringsEncodeAsURLSearchParamsDoes() {
        XCTAssertEqual(NetworkToolQuery.encode([("q", "two words"), ("collection", "app.bsky.*"), ("account", Self.did)]), "q=two+words&collection=app.bsky.*&account=did%3Aplc%3Aaaaaaaaaaaaaaaaaaaaaaaaa")
        let back = NetworkToolQuery.decode("?q=two+words&type=create&type=delete&empty=")
        XCTAssertEqual(back.map { $0.0 }, ["q", "type", "type", "empty"])
        XCTAssertEqual(back.map { $0.1 }, ["two words", "create", "delete", ""])
        let folded = NetworkToolQuery.dictionary(back)
        XCTAssertEqual(folded.query["type"], "create")
        XCTAssertFalse(folded.lossless)
        XCTAssertTrue(NetworkToolQuery.dictionary([("a", "1"), ("b", "2")]).lossless)
    }
}

// MARK: - The model

/// Feeds that never open a socket: they record what was asked for, and the
/// tests hand events to the model directly.
private final class StreamFakeFeeds: @unchecked Sendable {
    private let lock = NSLock()
    private var jetstreamOpens: [(dids: [String], collections: [String])] = []
    private var plcOpenCount = 0
    private var closeCount = 0
    private let handles: [String: String]
    private let log: [PlcStreamAuditEntry]

    init(handles: [String: String] = [:], log: [PlcStreamAuditEntry] = []) {
        self.handles = handles
        self.log = log
    }

    var jetstream: [(dids: [String], collections: [String])] {
        lock.lock(); defer { lock.unlock() }
        return jetstreamOpens
    }

    var plcOpens: Int {
        lock.lock(); defer { lock.unlock() }
        return plcOpenCount
    }

    var closes: Int {
        lock.lock(); defer { lock.unlock() }
        return closeCount
    }

    private func closed() {
        lock.lock(); closeCount += 1; lock.unlock()
    }

    var sources: StreamMonitorSources {
        StreamMonitorSources(
            openJetstream: { dids, collections in
                self.lock.lock()
                self.jetstreamOpens.append((dids: dids, collections: collections))
                self.lock.unlock()
                let (stream, continuation) = AsyncStream.makeStream(of: StreamSocketUpdate<StreamJetstreamEvent>.self)
                return StreamSubscription(updates: stream, close: {
                    self.closed()
                    continuation.finish()
                })
            },
            openPlc: {
                self.lock.lock()
                self.plcOpenCount += 1
                self.lock.unlock()
                let (stream, continuation) = AsyncStream.makeStream(of: StreamSocketUpdate<PlcStreamEntry>.self)
                return StreamSubscription(updates: stream, close: {
                    self.closed()
                    continuation.finish()
                })
            },
            resolveHandle: { handle in self.handles[handle] },
            resolveDidHandle: { _ in nil },
            auditLog: { _ in self.log }
        )
    }
}

/// A clock the tests move by hand.
private final class StreamTestClock: @unchecked Sendable {
    private let lock = NSLock()
    private var current = Date(timeIntervalSince1970: 1_800_000_000)

    var now: Date {
        lock.lock(); defer { lock.unlock() }
        return current
    }

    func advance(_ seconds: TimeInterval) {
        lock.lock(); current = current.addingTimeInterval(seconds); lock.unlock()
    }
}

@MainActor
final class StreamMonitorModelTests: XCTestCase {
    private let did = StreamMonitorTests.did

    private func commit(_ operation: String = "create", collection: String = "app.bsky.feed.post", did: String? = nil, text: String = "hi") -> StreamJetstreamEvent {
        let author = did ?? self.did
        let json = #"{"did":"\#(author)","time_us":1700000000000000,"kind":"commit","commit":{"operation":"\#(operation)","collection":"\#(collection)","rkey":"3k","record":{"text":"\#(text)"}}}"#
        return StreamMonitor.decodeJetstream(json)!
    }

    private func account() -> StreamJetstreamEvent {
        StreamMonitor.decodeJetstream(#"{"did":"\#(did)","time_us":1,"kind":"account","account":{"active":false,"status":"deactivated"}}"#)!
    }

    private func plc(_ seq: Int, prev: String? = nil, cid: String = "bafy") -> PlcStreamEntry {
        let prevJSON = prev.map { "\"\($0)\"" } ?? "null"
        return StreamMonitor.decodePlc(#"{"seq":\#(seq),"type":"sequenced_op","did":"\#(did)","operation":{"type":"plc_operation","prev":\#(prevJSON),"alsoKnownAs":["at://alice.example.com"]},"cid":"\#(cid)","createdAt":"2026-01-02T03:04:05.000Z"}"#)!
    }

    private func makeModel(_ filters: StreamMonitorFilters = .default, feeds: StreamFakeFeeds, clock: StreamTestClock = StreamTestClock()) -> StreamMonitorModel {
        StreamMonitorModel(filters: filters, sources: feeds.sources, flushInterval: 3600, clock: { clock.now })
    }

    /// Wait for the model's own tasks (a handle lookup) to land.
    private func waitUntil(_ condition: () -> Bool) async {
        var tries = 0
        while !condition() && tries < 200 {
            tries += 1
            try? await Task.sleep(nanoseconds: 10_000_000)
        }
    }

    func testActivatingConnectsWhatTheViewWants() {
        let feeds = StreamFakeFeeds()
        let model = makeModel(StreamMonitorFilters(collections: ["app.bsky.feed.post"]), feeds: feeds)
        XCTAssertFalse(model.isConnected(.jetstream), "nothing connects before the screen shows")
        model.activate()
        XCTAssertEqual(feeds.jetstream.count, 1)
        XCTAssertEqual(feeds.jetstream.first?.collections, ["app.bsky.feed.post"])
        XCTAssertEqual(feeds.jetstream.first?.dids, [])
        XCTAssertEqual(feeds.plcOpens, 1)

        model.setSource(.plc)
        XCTAssertFalse(model.isConnected(.jetstream), "a PLC-only view closes Jetstream")
        XCTAssertTrue(model.isConnected(.plc))
        XCTAssertEqual(feeds.plcOpens, 1, "the PLC socket stays as it was")
        XCTAssertEqual(model.connection(.jetstream), .off)
        model.deactivate()
        XCTAssertFalse(model.isConnected(.plc))
    }

    func testAChangedCollectionReconnectsJetstreamAndAKindDoesNot() {
        let feeds = StreamFakeFeeds()
        let model = makeModel(feeds: feeds)
        model.activate()
        model.toggleKind(.update)
        XCTAssertEqual(feeds.jetstream.count, 1, "event types are matched on the device")
        model.addCollection("app.bsky.graph.*")
        XCTAssertEqual(feeds.jetstream.count, 2)
        XCTAssertEqual(feeds.jetstream.last?.collections, ["app.bsky.graph.*"])
        XCTAssertNotNil(model.addCollection("app"), "a bad collection is refused with a reason")
        model.deactivate()
    }

    func testEventsReachTheListOnAFlushNewestFirst() {
        let feeds = StreamFakeFeeds()
        let model = makeModel(feeds: feeds)
        model.activate()
        model.ingestJetstream(commit())
        model.ingestJetstream(commit("update"))
        model.ingestPlc(plc(1))
        XCTAssertTrue(model.rows.isEmpty, "rows wait for the flush")
        model.flush()
        XCTAssertEqual(model.rows.map(\.event?.kind), [.plcNew, .update, .create])
        XCTAssertEqual(model.stats.matched, 3)
        XCTAssertEqual(model.stats.count(.create), 1)
        XCTAssertEqual(model.socketStatus[.jetstream], .open, "an event means the socket is open")
        model.deactivate()
    }

    func testEachTypeIsCappedPerFlushSoRareEventsShow() {
        let feeds = StreamFakeFeeds()
        let model = makeModel(feeds: feeds)
        model.activate()
        for _ in 0..<25 { model.ingestJetstream(commit()) }
        model.ingestJetstream(account())
        model.flush()
        let kinds = model.rows.compactMap(\.event?.kind)
        XCTAssertEqual(kinds.filter { $0 == .create }.count, StreamMonitorModel.perKindPerFlush)
        XCTAssertEqual(kinds.filter { $0 == .account }.count, 1)
        XCTAssertEqual(model.stats.count(.create), 25, "the counts include every event")
        XCTAssertTrue(model.stats.sampled)
        XCTAssertTrue(model.footNote.hasPrefix("Busy stream: the list keeps up to 20 events a second of each type."))
        model.deactivate()
    }

    func testPausedTheListHoldsAndCountsWhatWaits() {
        let feeds = StreamFakeFeeds()
        let model = makeModel(feeds: feeds)
        model.activate()
        model.ingestJetstream(commit())
        model.flush()
        model.pause()
        XCTAssertTrue(model.isConnected(.jetstream), "pause stays connected")
        model.ingestJetstream(commit(text: "one"))
        model.ingestJetstream(commit(text: "two"))
        model.flush()
        XCTAssertEqual(model.rows.count, 1)
        XCTAssertEqual(model.stats.held, 2)
        XCTAssertEqual(model.heldLabel, "Paused \u{00B7} 2 new events \u{00B7} Resume")
        model.play()
        model.flush()
        XCTAssertEqual(model.rows.count, 3)
        XCTAssertEqual(model.stats.held, 0)
        XCTAssertNil(model.heldLabel)
        model.deactivate()
    }

    func testAnOpenEventHoldsTheListToo() {
        let feeds = StreamFakeFeeds()
        let model = makeModel(feeds: feeds)
        model.activate()
        model.ingestJetstream(commit(text: "first"))
        model.ingestJetstream(commit(text: "second"))
        model.flush()
        model.open(model.rows.first?.id)
        XCTAssertEqual(model.openItem?.preview, "second")
        XCTAssertEqual(model.heldLabel, "Holding while an event is open \u{00B7} Back to live")
        model.ingestJetstream(commit(text: "third"))
        model.flush()
        XCTAssertEqual(model.rows.count, 2)
        model.step(1)
        XCTAssertEqual(model.openItem?.preview, "first")
        XCTAssertFalse(model.canStep(1))
        XCTAssertTrue(model.canStep(-1))
        model.showLatest()
        model.flush()
        XCTAssertNil(model.openId)
        XCTAssertEqual(model.rows.first?.event?.preview, "third")
        model.deactivate()
    }

    func testStopClosesBothSocketsAndPlayMarksTheGap() {
        let feeds = StreamFakeFeeds()
        let clock = StreamTestClock()
        let model = makeModel(feeds: feeds, clock: clock)
        model.activate()
        model.stop()
        XCTAssertFalse(model.isConnected(.jetstream))
        XCTAssertFalse(model.isConnected(.plc))
        XCTAssertEqual(model.connection(.jetstream), .stopped)
        XCTAssertEqual(model.emptyMessage, "Stopped. Play to connect again.")
        XCTAssertEqual(model.tally, .stopped)
        clock.advance(26)
        model.play()
        XCTAssertTrue(model.isConnected(.jetstream))
        XCTAssertEqual(feeds.jetstream.count, 2, "play reconnects at the live edge")
        guard case .gap(let gap)? = model.rows.first else {
            return XCTFail("the list marks the gap")
        }
        XCTAssertEqual(gap.to.timeIntervalSince(gap.from), 26)
        XCTAssertTrue(gap.text.hasSuffix("(26s). Nothing from then was received."))
        model.deactivate()
    }

    func testTheBackgroundClosesTheSocketsAndTheForegroundReopensThem() {
        let feeds = StreamFakeFeeds()
        let model = makeModel(feeds: feeds)
        model.activate()
        model.setBackground(true)
        XCTAssertFalse(model.isConnected(.jetstream))
        XCTAssertEqual(model.connection(.plc), .background)
        XCTAssertEqual(model.emptyMessage, "Paused while the app is in the background.")
        model.setBackground(false)
        XCTAssertTrue(model.isConnected(.jetstream))
        XCTAssertEqual(feeds.plcOpens, 2)
        model.deactivate()
    }

    func testASwitchedOffKindIsHiddenAndStillCounted() {
        let feeds = StreamFakeFeeds()
        let model = makeModel(feeds: feeds)
        model.activate()
        model.ingestJetstream(commit())
        model.ingestJetstream(commit("update"))
        model.flush()
        model.toggleKind(.update)
        XCTAssertEqual(model.visibleRows.compactMap(\.event?.kind), [.create], "narrowing hides listed rows at once")
        model.ingestJetstream(commit("update"))
        model.flush()
        XCTAssertEqual(model.stats.count(.update), 2)
        XCTAssertEqual(model.stats.matched, 2)
        XCTAssertEqual(model.filterCount, 1)
        model.deactivate()
    }

    func testAHandleIsResolvedAndJetstreamAsksForItsDID() async {
        let feeds = StreamFakeFeeds(handles: ["alice.example.com": "did:plc:alice"])
        let model = makeModel(StreamMonitorFilters(accounts: ["alice.example.com"]), feeds: feeds)
        model.activate()
        await waitUntil { model.isConnected(.jetstream) }
        XCTAssertEqual(feeds.jetstream.last?.dids, ["did:plc:alice"])
        XCTAssertEqual(model.accountChips.first?.did, "did:plc:alice")
        // The PLC stream has no server-side filter: it is matched here.
        model.ingestPlc(plc(1))
        model.flush()
        XCTAssertTrue(model.rows.isEmpty, "another DID's operation is not listed")
        model.deactivate()
    }

    func testAHandleThatDoesNotResolveSaysSo() async {
        let feeds = StreamFakeFeeds()
        let model = makeModel(StreamMonitorFilters(accounts: ["nobody.example.com"]), feeds: feeds)
        model.activate()
        XCTAssertEqual(model.connection(.jetstream), .waiting)
        await waitUntil { model.accountChips.first?.state == .failed }
        XCTAssertEqual(model.accountChips.first?.note, "not found")
        XCTAssertEqual(model.emptyMessage, "None of those accounts resolved to a DID.")
        XCTAssertFalse(model.isConnected(.jetstream))
        XCTAssertFalse(model.isConnected(.plc))
        model.deactivate()
    }

    func testWatchingAnAccountAddsItsDIDAndGoesBackToLive() {
        let feeds = StreamFakeFeeds()
        let model = makeModel(feeds: feeds)
        model.activate()
        model.pause()
        model.watchAccount(did)
        XCTAssertEqual(model.filters.accounts, [did])
        XCTAssertEqual(model.transport, .live)
        XCTAssertEqual(feeds.jetstream.last?.dids, [did])
        model.watchAccount(did)
        XCTAssertEqual(model.filters.accounts, [did], "an account is watched once")
        XCTAssertEqual(model.search, "account=did%3Aplc%3Aaaaaaaaaaaaaaaaaaaaaaaaa")
        model.deactivate()
    }

    func testEveryKindOffSaysSoAndConnectsNothing() {
        let feeds = StreamFakeFeeds()
        let model = makeModel(StreamMonitorFilters(kinds: []), feeds: feeds)
        model.activate()
        XCTAssertFalse(model.isConnected(.jetstream))
        XCTAssertFalse(model.isConnected(.plc))
        XCTAssertEqual(model.emptyMessage, "Every event type is switched off.")
        model.deactivate()
    }

    func testALinkOpensItsPreset() {
        let model = StreamMonitorModel(query: ["source": "plc", "type": "plc-new"], sources: StreamFakeFeeds().sources)
        XCTAssertTrue(model.isPresetActive(StreamMonitor.presets[0]))
        XCTAssertFalse(model.isPresetActive(StreamMonitor.presets[1]))
        XCTAssertEqual(model.filterCount, 2)
    }

    func testAnOpenedUpdateIsReadAgainstTheOperationBeforeIt() async {
        let genesis = PlcStreamAuditEntry(did: did, operation: PlcStreamOperation(type: "plc_operation", prev: nil, alsoKnownAs: ["at://alice.old"]), cid: "a")
        let nullified = PlcStreamAuditEntry(did: did, operation: PlcStreamOperation(type: "plc_operation", prev: "a", alsoKnownAs: ["at://mistake"]), cid: "b", nullified: true)
        let target = PlcStreamAuditEntry(did: did, operation: PlcStreamOperation(type: "plc_operation", prev: "a", alsoKnownAs: ["at://alice.example.com"]), cid: "c")
        let model = makeModel(feeds: StreamFakeFeeds(log: [genesis, nullified, target]))
        let changes = await model.plcChanges(for: plc(3, prev: "a", cid: "c"))
        XCTAssertEqual(changes, .changes([StreamPlcChange(field: .handle, from: "alice.old", to: "alice.example.com")], genesis: false))
        let missing = await model.plcChanges(for: plc(4, prev: "c", cid: "zzz"))
        XCTAssertEqual(missing, .failed("This operation isn\u{2019}t in the DID\u{2019}s log yet. Try again in a moment."))
        let first = await model.plcChanges(for: plc(5))
        XCTAssertEqual(first, .changes([StreamPlcChange(field: .handle, from: nil, to: "alice.example.com")], genesis: true))
    }

    func testCollectionSuggestionsOfferTheNamespaceThenWhatWentBy() async {
        let model = makeModel(feeds: StreamFakeFeeds())
        model.activate()
        model.ingestJetstream(commit(collection: "app.bsky.graph.follow"))
        model.ingestJetstream(commit(collection: "app.bsky.graph.follow"))
        model.ingestJetstream(commit(collection: "app.bsky.graph.block"))
        let suggestions = await model.suggestCollections("app.bsky.graph.")
        XCTAssertEqual(suggestions.map(\.value), ["app.bsky.graph.*", "app.bsky.graph.follow", "app.bsky.graph.block"])
        XCTAssertEqual(suggestions[1].detail, "2 seen on this page")
        model.deactivate()
    }
}
