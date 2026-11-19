import Foundation
import XCTest
@testable import AturiCore

/// Port of `src/lib/tools/__tests__/carRepo.test.ts`: the tree walk, the
/// checks, the JSON export and the formatters.
final class CarRepoTests: XCTestCase {
    private typealias F = CarFixture

    private func repo(_ bytes: [UInt8]) throws -> CarRepoArchive {
        try CarRepo.read(try CarReader.read(bytes))
    }

    private func summary(_ bytes: [UInt8]) throws -> [String: [String]] {
        var out: [String: [String]] = [:]
        for collection in try repo(bytes).collections {
            out[collection.nsid] = collection.rkeys
        }
        return out
    }

    private func assertRepoError(_ bytes: [UInt8], _ fragment: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertThrowsError(try repo(bytes), file: file, line: line) { error in
            let message = (error as? CarRepoError)?.message ?? "\(error)"
            XCTAssertTrue(message.contains(fragment), "\(message) should say \(fragment)", file: file, line: line)
        }
    }

    // MARK: The walk

    func testTheCommitIsReadFromTheFirstRoot() throws {
        let sample = F.sampleRepo()
        XCTAssertEqual(try repo(sample.bytes).commit, CarRepoCommit(
            cid: sample.head.cid.string,
            did: F.did,
            version: 3,
            rev: "3n22yg6lg2k2f",
            data: sample.top.cid.string,
            prev: nil,
            signatureBytes: 64
        ))
    }

    func testTheTreeIsWalkedLeftToRightWithKeysRebuiltFromTheirPrefixes() throws {
        let sample = F.sampleRepo()
        let archive = try repo(sample.bytes)
        XCTAssertEqual(archive.collections.map(\.nsid), ["app.bsky.feed.like", "app.bsky.feed.post"])
        XCTAssertEqual(archive.collections.map(\.rkeys), [["3aaa", "3bbb"], ["3aaa", "3bbb", "3ccc"]])
        XCTAssertEqual(archive.collections[1].cids, [sample.post1.cid.string, sample.post2.cid.string, sample.post3.cid.string])
        XCTAssertEqual(archive.recordCount, 5)
        XCTAssertEqual(archive.nodeCount, 3)
        XCTAssertEqual(
            [archive.missingNodes.count, archive.missingRecords, archive.unreachedBlocks, archive.outOfOrder, archive.malformedKeys],
            [0, 0, 0, 0, 0]
        )
    }

    func testARecordIsDecodedOnDemandAsJSON() throws {
        let sample = F.sampleRepo()
        let archive = try repo(sample.bytes)
        let two: JSONValue = ["$type": "app.bsky.feed.post", "text": "two", "createdAt": "2026-01-04T00:00:00.000Z"]
        XCTAssertEqual(try CarRepo.readRecord(archive, cid: sample.post2.cid.string), two)
        XCTAssertNil(try CarRepo.readRecord(archive, cid: F.cidFor(F.encode(.text("absent"))).string))
        XCTAssertEqual(
            CarRepo.exportRecord(archive, collection: archive.collections[1], index: 1),
            CarExportedRecord(uri: "at://\(F.did)/app.bsky.feed.post/3bbb", cid: sample.post2.cid.string, value: two)
        )
    }

    func testAnEmptyRepositoryIsOneNodeWithNoEntries() throws {
        let top = F.node(nil, [])
        let head = F.commit(F.did, top.cid)
        let archive = try repo(F.carFile([head.cid], [head, top]))
        XCTAssertEqual(archive.recordCount, 0)
        XCTAssertEqual(archive.collections, [])
        XCTAssertEqual(archive.nodeCount, 1)
    }

    func testASubtreeThatIsNotInTheFileIsReportedAndTheRestStillListed() throws {
        let s = F.sampleRepo()
        // Everything but the right-hand node.
        let archive = try repo(F.carFile([s.head.cid], [s.head, s.top, s.left] + s.records))
        XCTAssertEqual(archive.missingNodes, [s.right.cid.string])
        XCTAssertEqual(archive.recordCount, 3)
        // The two records only that node listed are in the file, but nothing reaches them.
        XCTAssertEqual(archive.unreachedBlocks, 2)
    }

    func testAListedRecordWhoseBlockIsAbsentIsCountedAndStillListed() throws {
        let s = F.sampleRepo()
        let archive = try repo(F.carFile([s.head.cid], [s.head, s.top, s.left, s.right, s.like1, s.like2, s.post1, s.post2]))
        XCTAssertEqual(archive.recordCount, 5)
        XCTAssertEqual(archive.missingRecords, 1)
        XCTAssertNil(try CarRepo.readRecord(archive, cid: s.post3.cid.string))
        XCTAssertNil(CarRepo.exportRecord(archive, collection: archive.collections[1], index: 2))
    }

    func testBlocksNothingLinksToAreCounted() throws {
        let s = F.sampleRepo()
        let stray = F.block(.map(["unrelated": .bool(true)]))
        XCTAssertEqual(try repo(F.carFile([s.head.cid], s.blocks + [stray])).unreachedBlocks, 1)
    }

    func testKeysOutOfOrderAndKeysThatAreNotCollectionAndRkeyAreCounted() throws {
        let a = F.block(.map(["n": .int(1)]))
        let b = F.block(.map(["n": .int(2)]))
        let c = F.block(.map(["n": .int(3)]))
        let d = F.block(.map(["n": .int(4)]))
        let top = F.node(nil, [
            F.Entry(p: 0, k: "com.example.b/2", v: a.cid),
            F.Entry(p: 0, k: "com.example.a/1", v: b.cid),
            F.Entry(p: 0, k: "no-slash-here", v: c.cid),
            F.Entry(p: 0, k: "too/many/parts", v: d.cid),
        ])
        let head = F.commit(F.did, top.cid)
        let bytes = F.carFile([head.cid], [head, top, a, b, c, d])
        let archive = try repo(bytes)
        XCTAssertEqual(archive.outOfOrder, 1)
        XCTAssertEqual(archive.malformedKeys, 2)
        XCTAssertEqual(archive.collections.map(\.nsid), ["com.example.b", "com.example.a"])
        XCTAssertEqual(try summary(bytes), ["com.example.b": ["2"], "com.example.a": ["1"]])
    }

    func testAPrefixLongerThanTheKeyBeforeItIsClampedRatherThanReadPast() throws {
        let a = F.block(.map(["n": .int(1)]))
        let top = F.node(nil, [F.Entry(p: 50, k: "com.example.a/1", v: a.cid)])
        let head = F.commit(F.did, top.cid)
        XCTAssertEqual(try summary(F.carFile([head.cid], [head, top, a])), ["com.example.a": ["1"]])
    }

    func testASubtreeLinkedFromTwoPlacesIsWalkedOnce() throws {
        let a = F.block(.map(["n": .int(1)]))
        // A node cannot hold its own hash, so a true loop cannot be built by
        // hand. The guard that stops one is the same that refuses a second visit.
        let inner = F.node(nil, [F.Entry(p: 0, k: "com.example.a/1", v: a.cid)])
        let top = F.node(inner.cid, [F.Entry(p: 0, k: "com.example.a/2", v: a.cid, t: inner.cid)])
        let head = F.commit(F.did, top.cid)
        let bytes = F.carFile([head.cid], [head, top, inner, a])
        XCTAssertEqual(try repo(bytes).nodeCount, 2)
        XCTAssertEqual(try summary(bytes), ["com.example.a": ["1", "2"]])
    }

    func testACARFileThatIsNotARepositoryIsRefusedInWords() {
        let stray = F.block(.map(["hello": .text("world")]))
        assertRepoError(F.carFile([stray.cid], [stray]), "not a repository commit")
        assertRepoError(F.carFile([], [stray]), "names no root")
        assertRepoError(F.carFile([F.cidFor(F.encode(.text("gone")))], [stray]), "is not in the file")
    }

    func testACommitWithoutASignatureOrWithAPreviousCommitIsReadAsSuch() throws {
        let top = F.node(nil, [])
        let previous = F.cidFor(F.encode(.text("previous")))
        let head = F.block(.map([
            "did": .text(F.did),
            "version": .int(2),
            "data": .link(top.cid),
            "rev": .text("3n22yg6lg2k2f"),
            "prev": .link(previous),
        ]))
        let commit = try repo(F.carFile([head.cid], [head, top])).commit
        XCTAssertNil(commit.signatureBytes)
        XCTAssertEqual(commit.prev, previous.string)
        XCTAssertEqual(commit.version, 2)
    }

    func testWalkingInStepsListsTheSameRecordsAsWalkingStraightThrough() throws {
        let bytes = F.sampleRepo().bytes
        let whole = try repo(bytes)
        let reader = try CarRepoReader(car: try CarReader.read(bytes))
        var seen: [Int] = []
        while !reader.step(1) {
            seen.append(reader.recordCount)
        }
        XCTAssertEqual(seen, [1, 2, 3, 4, 5])
        let stepped = reader.archive()
        XCTAssertEqual(stepped.collections, whole.collections)
        XCTAssertEqual(stepped.unreachedBlocks, whole.unreachedBlocks)
    }

    func testOpenArchiveReadsTheSameRepositoryAndReportsNothingForASmallFile() async throws {
        let bytes = F.sampleRepo().bytes
        let progress = CarProgressLog()
        let archive = try await CarRepo.openArchive(bytes) { progress.append($0) }
        XCTAssertEqual(archive.collections, try repo(bytes).collections)
        // A file this small is read in one slice of each phase.
        XCTAssertEqual(progress.entries, [])

        do {
            _ = try await CarRepo.openArchive(Array("not a car".utf8))
            XCTFail("a file that is not a CAR opened")
        } catch let error as CarError {
            XCTAssertTrue(error.message.contains("does not look like a CAR file"), error.message)
        }
    }

    // MARK: The JSON export

    private func exportFile(_ name: String) -> URL {
        FileManager.default.temporaryDirectory.appendingPathComponent("carrepotests-\(UUID().uuidString)-\(name)")
    }

    private func parse(_ url: URL) throws -> [String: Any] {
        let data = try Data(contentsOf: url)
        return try XCTUnwrap(JSONSerialization.jsonObject(with: data) as? [String: Any])
    }

    func testTheJSONExportHoldsEveryRecordInListRecordsShape() throws {
        let sample = F.sampleRepo()
        let archive = try repo(sample.bytes)
        let url = exportFile("all.json")
        defer { try? FileManager.default.removeItem(at: url) }
        let result = try CarExport.writeJSON(archive, collections: archive.collections, to: url)
        XCTAssertEqual([result.written, result.skipped], [5, 0])
        let parsed = try parse(url)
        XCTAssertEqual(parsed["repo"] as? String, F.did)
        XCTAssertEqual(parsed["rev"] as? String, "3n22yg6lg2k2f")
        XCTAssertEqual(parsed["collections"] as? [String], ["app.bsky.feed.like", "app.bsky.feed.post"])
        let records = try XCTUnwrap(parsed["records"] as? [[String: Any]])
        XCTAssertEqual(records.count, 5)
        XCTAssertEqual(records[2]["uri"] as? String, "at://\(F.did)/app.bsky.feed.post/3aaa")
        XCTAssertEqual(records[2]["cid"] as? String, sample.post1.cid.string)
        let value = try XCTUnwrap(records[2]["value"] as? [String: Any])
        XCTAssertEqual(value["text"] as? String, "one")
        XCTAssertEqual(value["$type"] as? String, "app.bsky.feed.post")

        // One collection, and a repository with nothing in it, are still valid JSON.
        let one = exportFile("one.json")
        let none = exportFile("none.json")
        defer {
            try? FileManager.default.removeItem(at: one)
            try? FileManager.default.removeItem(at: none)
        }
        _ = try CarExport.writeJSON(archive, collections: [archive.collections[0]], to: one)
        XCTAssertEqual((try parse(one)["records"] as? [Any])?.count, 2)
        _ = try CarExport.writeJSON(archive, collections: [], to: none)
        XCTAssertEqual((try parse(none)["records"] as? [Any])?.count, 0)
        XCTAssertEqual((try parse(none)["collections"] as? [Any])?.count, 0)
    }

    func testARecordMissingFromTheFileIsLeftOutOfTheExportAndCounted() throws {
        let s = F.sampleRepo()
        let archive = try repo(F.carFile([s.head.cid], [s.head, s.top, s.left, s.right, s.like1, s.like2, s.post1, s.post2]))
        let url = exportFile("partial.json")
        defer { try? FileManager.default.removeItem(at: url) }
        let result = try CarExport.writeJSON(archive, collections: archive.collections, to: url)
        XCTAssertEqual([result.written, result.skipped], [4, 1])
        XCTAssertEqual((try parse(url)["records"] as? [Any])?.count, 4)
    }

    // MARK: Formatting

    func testByteCountsAndAppNamesReadTheWayAPersonWouldSayThem() {
        XCTAssertEqual(CarFormat.bytes(512), "512 B")
        XCTAssertEqual(CarFormat.bytes(432_348), "422 KB")
        XCTAssertEqual(CarFormat.bytes(84_124_320), "80.2 MB")
        XCTAssertEqual(CarFormat.bytes(150 * 1024 * 1024), "150 MB")
        XCTAssertEqual(CarFormat.bytes(100 * 1024 * 1024), "100 MB")
        XCTAssertEqual(CarFormat.appOfCollection("app.bsky.feed.post"), "app.bsky")
        XCTAssertEqual(CarFormat.count(1_234_567), "1,234,567")
        XCTAssertEqual(CarFormat.count(12), "12")
    }

    func testAnAccountIsReadOutOfWhatWasTyped() {
        XCTAssertEqual(CarFormat.actorFromInput("  @alice.example.com "), "alice.example.com")
        XCTAssertEqual(CarFormat.actorFromInput("at://did:plc:abc/app.bsky.feed.post/3k"), "did:plc:abc")
        XCTAssertEqual(CarFormat.actorFromInput("https://bsky.app/profile/alice.example.com/post/3k"), "alice.example.com")
        XCTAssertEqual(CarFormat.actorFromInput("https://deer.social/profile/did%3Aplc%3Aabc"), "did:plc:abc")
        XCTAssertEqual(CarFormat.actorFromInput("did:plc:abc"), "did:plc:abc")
        XCTAssertEqual(CarFormat.exportFileName(handle: "alice.example.com", did: "did:plc:abc"), "alice.example.com.car")
        XCTAssertEqual(CarFormat.exportFileName(handle: nil, did: "did:plc:abc"), "did-plc-abc.car")
    }

    // MARK: The checks

    private func statuses(_ checks: [CarArchiveCheck]) -> [CarArchiveCheck.Kind: CarCheckStatus] {
        var out: [CarArchiveCheck.Kind: CarCheckStatus] = [:]
        for check in checks {
            out[check.id] = check.status
        }
        return out
    }

    func testAWholeWellFormedArchivePassesItsStructuralChecks() throws {
        let checks = CarChecks.archiveChecks(try repo(F.sampleRepo().bytes), hashes: .idle)
        XCTAssertEqual(statuses(checks), [
            .tree: .pass,
            .records: .pass,
            .keys: .pass,
            // Not run until asked for, and never able to be run.
            .hashes: .info,
            .signature: .info,
        ])
        XCTAssertTrue(checks.first { $0.id == .tree }?.summary.contains("All 3 nodes") ?? false)
        XCTAssertTrue(checks.first { $0.id == .records }?.summary.contains("All 5 listed records are") ?? false)
    }

    func testAMissingSubtreeFailsAMissingRecordWarnsAndStrayBlocksAreANote() throws {
        let s = F.sampleRepo()
        let noRight = try repo(F.carFile([s.head.cid], [s.head, s.top, s.left] + s.records))
        let first = CarChecks.archiveChecks(noRight, hashes: .idle)
        XCTAssertEqual(statuses(first)[.tree], .fail)
        XCTAssertEqual(first.first { $0.id == .tree }?.detail, [s.right.cid.string])
        XCTAssertEqual(statuses(first)[.extra], .info)

        let noRecord = try repo(F.carFile([s.head.cid], [s.head, s.top, s.left, s.right, s.like1, s.like2, s.post1, s.post2]))
        XCTAssertEqual(statuses(CarChecks.archiveChecks(noRecord, hashes: .idle))[.records], .warn)

        let repeated = try repo(F.carFile([s.head.cid], s.blocks + [s.blocks[2]]))
        let extra = CarChecks.archiveChecks(repeated, hashes: .idle).first { $0.id == .extra }
        XCTAssertTrue(extra?.summary.contains("1 block appears more than once") ?? false, extra?.summary ?? "")
    }

    func testTheHashCheckReportsWhereItHasGotToAndHowItCameOut() throws {
        let archive = try repo(F.sampleRepo().bytes)
        func hashes(_ progress: CarHashProgress) -> CarArchiveCheck? {
            CarChecks.archiveChecks(archive, hashes: progress).first { $0.id == .hashes }
        }
        XCTAssertEqual(hashes(.running(done: 4, total: 9))?.status, .pending)
        XCTAssertEqual(hashes(.done(CarHashCheck(checked: 9, skipped: 0, mismatched: [])))?.status, .pass)
        let failed = hashes(.done(CarHashCheck(checked: 9, skipped: 1, mismatched: ["bafy1", "bafy2"])))
        XCTAssertEqual(failed?.status, .fail)
        XCTAssertEqual(failed?.detail, ["bafy1", "bafy2"])
        XCTAssertTrue(failed?.summary.contains("2 blocks do not hash") ?? false)
        XCTAssertTrue(failed?.summary.contains("1 block uses another hash") ?? false)
    }

    func testEvidenceIsListedFiveAtATime() {
        XCTAssertEqual(CarChecks.listed(["a", "b", "c", "d", "e", "f", "g"]), ["a", "b", "c", "d", "e", "and 2 more"])
        XCTAssertEqual(CarChecks.listed(["a"]), ["a"])
    }

    func testAnUnsignedOrOldVersionCommitIsFlagged() throws {
        let top = F.node(nil, [])
        let head = F.block(.map([
            "did": .text(F.did),
            "version": .int(2),
            "data": .link(top.cid),
            "rev": .text("3n22yg6lg2k2f"),
            "prev": .null,
        ]))
        let checks = CarChecks.archiveChecks(try repo(F.carFile([head.cid], [head, top])), hashes: .idle)
        XCTAssertEqual(statuses(checks)[.signature], .warn)
        XCTAssertEqual(statuses(checks)[.version], .warn)
    }
}

/// Progress reports collected from a `@Sendable` callback.
final class CarProgressLog: @unchecked Sendable {
    private let lock = NSLock()
    private var recorded: [CarOpenProgress] = []

    func append(_ progress: CarOpenProgress) {
        lock.lock()
        recorded.append(progress)
        lock.unlock()
    }

    var entries: [CarOpenProgress] {
        lock.lock()
        defer { lock.unlock() }
        return recorded
    }
}
