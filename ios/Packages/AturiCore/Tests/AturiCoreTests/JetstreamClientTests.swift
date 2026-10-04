import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

final class JetstreamClientTests: XCTestCase {
    private let commitEvent = """
    {"did":"did:plc:x","time_us":1700000000123456,"kind":"commit","commit":{"rev":"3lbrev","operation":"create","collection":"app.bsky.feed.post","rkey":"3k7abc","record":{"$type":"app.bsky.feed.post","text":"hello","createdAt":"2025-01-01T00:00:00.000Z","langs":["en"]},"cid":"bafyrec"}}
    """

    // MARK: URL building

    func testBuildURLWithoutOptionsIsTheBareEndpoint() {
        XCTAssertEqual(JetstreamClient.buildURL(JetstreamOptions()).absoluteString, "wss://jetstream2.us-east.bsky.network/subscribe")
        XCTAssertEqual(JetstreamClient.buildURL(JetstreamOptions(cursor: 0)).absoluteString, "wss://jetstream2.us-east.bsky.network/subscribe", "a zero cursor is falsy")
    }

    func testBuildURLRepeatsCollectionsAndDidsThenCursor() {
        let options = JetstreamOptions(
            wantedCollections: ["app.bsky.feed.post", "app.bsky.feed.like"],
            wantedDids: ["did:plc:a", "did:web:example.com"],
            wantedOps: [.create, .delete],
            cursor: 1_700_000_000_000_000
        )
        XCTAssertEqual(
            JetstreamClient.buildURL(options).absoluteString,
            "wss://jetstream2.us-east.bsky.network/subscribe?wantedCollections=app.bsky.feed.post&wantedCollections=app.bsky.feed.like&wantedDids=did%3Aplc%3Aa&wantedDids=did%3Aweb%3Aexample.com&cursor=1700000000000000"
        )
    }

    func testBuildURLAgainstACustomEndpoint() {
        let endpoint = URL(string: "ws://127.0.0.1:6008/subscribe")!
        let url = JetstreamClient.buildURL(JetstreamOptions(wantedCollections: ["sh.tangled.repo"]), endpoint: endpoint)
        XCTAssertEqual(url.absoluteString, "ws://127.0.0.1:6008/subscribe?wantedCollections=sh.tangled.repo")
    }

    func testWantedOpsDefaultToCreateOnly() {
        XCTAssertEqual(JetstreamOptions().allowedOps, [.create])
        XCTAssertEqual(JetstreamOptions(wantedOps: [.update, .delete]).allowedOps, [.update, .delete])
        XCTAssertEqual(JetstreamOptions(wantedOps: [.create, .create]).allowedOps, [.create])
    }

    // MARK: decoding

    func testDecodeCommitKeepsTheRecordAsJSON() throws {
        let commit = try XCTUnwrap(JetstreamClient.decodeCommit(commitEvent))
        XCTAssertEqual(commit.did, "did:plc:x")
        XCTAssertEqual(commit.timeUs, 1_700_000_000_123_456)
        XCTAssertEqual(commit.kind, "commit")
        XCTAssertEqual(commit.commit.rev, "3lbrev")
        XCTAssertEqual(commit.commit.operation, .create)
        XCTAssertEqual(commit.commit.collection, "app.bsky.feed.post")
        XCTAssertEqual(commit.commit.rkey, "3k7abc")
        XCTAssertEqual(commit.commit.cid, "bafyrec")
        XCTAssertEqual(commit.commit.record?["text"]?.stringValue, "hello")
        XCTAssertEqual(commit.commit.record?["langs"], ["en"])
        XCTAssertEqual(commit.atUri, "at://did:plc:x/app.bsky.feed.post/3k7abc")
        XCTAssertEqual(commit.time.timeIntervalSince1970, 1_700_000_000.123456, accuracy: 0.001)
    }

    func testDecodeCommitFiltersByOperation() {
        let deletion = #"{"did":"did:plc:x","time_us":1,"kind":"commit","commit":{"rev":"r","operation":"delete","collection":"app.bsky.feed.post","rkey":"3k"}}"#
        XCTAssertNil(JetstreamClient.decodeCommit(deletion), "deletes are filtered by default")
        let kept = JetstreamClient.decodeCommit(deletion, allowedOps: [.create, .delete])
        XCTAssertEqual(kept?.commit.operation, .delete)
        XCTAssertNil(kept?.commit.record)
        XCTAssertNil(kept?.commit.cid)

        let update = deletion.replacingOccurrences(of: "\"delete\"", with: "\"update\"")
        XCTAssertNil(JetstreamClient.decodeCommit(update, allowedOps: [.create, .delete]))
        XCTAssertNotNil(JetstreamClient.decodeCommit(update, allowedOps: [.update]))
    }

    func testDecodeCommitRejectsOtherKindsUnknownOpsAndMalformedFrames() {
        let identity = #"{"did":"did:plc:x","time_us":1,"kind":"identity","identity":{"did":"did:plc:x","handle":"x.example","seq":1,"time":"2025-01-01T00:00:00Z"}}"#
        XCTAssertNil(JetstreamClient.decodeCommit(identity))

        let account = #"{"did":"did:plc:x","time_us":1,"kind":"account","account":{"active":true,"did":"did:plc:x","seq":1,"time":"2025-01-01T00:00:00Z"}}"#
        XCTAssertNil(JetstreamClient.decodeCommit(account))

        let unknownOp = #"{"did":"did:plc:x","time_us":1,"kind":"commit","commit":{"operation":"merge","collection":"a.b.c","rkey":"r"}}"#
        XCTAssertNil(JetstreamClient.decodeCommit(unknownOp, allowedOps: Set(JetstreamOperation.allCases)))

        let emptyCollection = #"{"did":"did:plc:x","time_us":1,"kind":"commit","commit":{"operation":"create","collection":"","rkey":"r"}}"#
        XCTAssertNil(JetstreamClient.decodeCommit(emptyCollection))

        let wrongKindWithCommit = #"{"did":"did:plc:x","time_us":1,"kind":"identity","commit":{"operation":"create","collection":"a.b.c","rkey":"r"}}"#
        XCTAssertNil(JetstreamClient.decodeCommit(wrongKindWithCommit))

        XCTAssertNil(JetstreamClient.decodeCommit("not json"))
        XCTAssertNil(JetstreamClient.decodeCommit(""))
        XCTAssertNil(JetstreamClient.decodeCommit(Data([0xFF, 0xFE])))
    }

    func testCommitRoundTripsThroughCodable() throws {
        let commit = JetstreamCommit(
            did: "did:plc:x",
            timeUs: 42,
            commit: .init(rev: "r", operation: .update, collection: "a.b.c", rkey: "k", record: ["n": 1], cid: "c")
        )
        let data = try JSONEncoder().encode(commit)
        XCTAssertEqual(try JSONValue.parse(data)["time_us"]?.intValue, 42)
        XCTAssertEqual(try JSONValue.parse(data)["commit"]?["operation"]?.stringValue, "update")
        XCTAssertEqual(try JSONDecoder().decode(JetstreamCommit.self, from: data), commit)
    }

    // MARK: backoff

    func testBackoffDoublesFromOneSecondAndCapsAtThirty() {
        XCTAssertEqual(JetstreamClient.backoffDelay(attempt: 0), 1)
        XCTAssertEqual(JetstreamClient.backoffDelay(attempt: 1), 2)
        XCTAssertEqual(JetstreamClient.backoffDelay(attempt: 2), 4)
        XCTAssertEqual(JetstreamClient.backoffDelay(attempt: 4), 16)
        XCTAssertEqual(JetstreamClient.backoffDelay(attempt: 5), 30)
        XCTAssertEqual(JetstreamClient.backoffDelay(attempt: 40), 30)
        XCTAssertEqual(JetstreamClient.backoffDelay(attempt: 4000), 30)
        XCTAssertEqual(JetstreamClient.backoffDelay(attempt: -1), 1)
    }

    // MARK: lifecycle

    func testCancelFinishesTheStreamWhileReconnecting() async throws {
        // Nothing listens on this port, so the loop cycles through failed
        // connects and backoff sleeps until cancelled.
        let client = JetstreamClient(
            options: JetstreamOptions(wantedCollections: ["app.bsky.feed.post"]),
            endpoint: URL(string: "ws://127.0.0.1:9/subscribe")!
        )
        XCTAssertEqual(client.url.absoluteString, "ws://127.0.0.1:9/subscribe?wantedCollections=app.bsky.feed.post")

        let finished = expectation(description: "stream finished")
        let consumer = Task {
            var count = 0
            for await _ in client.commits { count += 1 }
            finished.fulfill()
            return count
        }
        try await Task.sleep(nanoseconds: 300_000_000)
        client.cancel()
        await fulfillment(of: [finished], timeout: 5)
        let count = await consumer.value
        XCTAssertEqual(count, 0)
        // Cancelling twice is harmless.
        client.cancel()
    }

    func testBreakingOutOfTheLoopTearsTheConnectionDown() async throws {
        let client = JetstreamClient(
            options: JetstreamOptions(),
            endpoint: URL(string: "ws://127.0.0.1:9/subscribe")!
        )
        var iterator = client.commits.makeAsyncIterator()
        let probe = Task { await iterator.next() }
        try await Task.sleep(nanoseconds: 100_000_000)
        probe.cancel()
        let value = await probe.value
        XCTAssertNil(value)
        client.cancel()
    }

    // MARK: live

    func testLiveTapReceivesAPostCommitWithinFiveSeconds() async throws {
        let client = JetstreamClient(options: JetstreamOptions(wantedCollections: ["app.bsky.feed.post"]))
        defer { client.cancel() }

        let first: JetstreamCommit? = await withTaskGroup(of: JetstreamCommit?.self) { group in
            group.addTask {
                for await commit in client.commits { return commit }
                return nil
            }
            group.addTask {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                return nil
            }
            let winner = await group.next() ?? nil
            group.cancelAll()
            return winner
        }

        guard let first else {
            if let error = client.lastError {
                throw XCTSkip("jetstream transport failed: \(error)")
            }
            throw XCTSkip("no commit arrived within 5 s")
        }
        XCTAssertEqual(first.kind, "commit")
        XCTAssertEqual(first.commit.collection, "app.bsky.feed.post")
        XCTAssertEqual(first.commit.operation, .create)
        XCTAssertTrue(first.did.hasPrefix("did:"), first.did)
        XCTAssertEqual(first.commit.record?["$type"]?.stringValue, "app.bsky.feed.post")
        XCTAssertGreaterThan(first.timeUs, 1_600_000_000_000_000)
    }
}
