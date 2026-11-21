import Foundation
import XCTest
@testable import AturiCore

/// Port of `src/lib/tools/__tests__/car.test.ts`.
final class CarFileTests: XCTestCase {
    private func assertCarError(_ bytes: [UInt8], _ fragment: String, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertThrowsError(try CarReader.read(bytes), file: file, line: line) { error in
            let message = (error as? CarError)?.message ?? "\(error)"
            XCTAssertTrue(message.contains(fragment), "\(message) should say \(fragment)", file: file, line: line)
        }
    }

    func testVarintsOfOneAndSeveralBytes() throws {
        XCTAssertEqual(try CarReader.readVarint([0x05], 0), CarVarint(value: 5, next: 1))
        XCTAssertEqual(try CarReader.readVarint([0xff, 0xac, 0x02], 1), CarVarint(value: 300, next: 3))
        // Past 2^31, where a 32-bit shift would have wrapped.
        XCTAssertEqual(try CarReader.readVarint([0x80, 0x80, 0x80, 0x80, 0x10], 0), CarVarint(value: 1 << 32, next: 5))
        XCTAssertThrowsError(try CarReader.readVarint([0x80], 0)) { error in
            XCTAssertTrue(error is CarError)
        }
        XCTAssertThrowsError(try CarReader.readVarint([], 0)) { error in
            XCTAssertEqual((error as? CarError)?.message, "The file ends where a length should be")
        }
    }

    func testACIDIsParsedIntoItsPartsV1AndV0() throws {
        let data = CarFixture.encode(.map(["hello": .text("world")]))
        let cid = CarFixture.cidFor(data)
        let parsed = try CarReader.parseCid(cid.bytes)
        XCTAssertEqual(parsed.version, 1)
        XCTAssertEqual(parsed.codec, 0x71)
        XCTAssertEqual(parsed.hash, 0x12)
        XCTAssertEqual(parsed.digest, CarFixture.sha256(data))
        XCTAssertEqual(parsed.next, 36)

        let v0 = try CarReader.parseCid([0x12, 0x20] + CarFixture.sha256(data))
        XCTAssertEqual(v0.version, 0)
        XCTAssertEqual(v0.next, 34)
        XCTAssertThrowsError(try CarReader.parseCid([0x02, 0x71, 0x12, 0x20])) { error in
            XCTAssertTrue((error as? CarError)?.message.contains("version 2") ?? false)
        }
        XCTAssertThrowsError(try CarReader.parseCid([0x01, 0x71, 0x12, 0x20, 1, 2])) { error in
            XCTAssertTrue((error as? CarError)?.message.contains("runs past the end") ?? false)
        }
    }

    func testCIDTextConvertsBackToTheBytesItCameFrom() {
        let cid = CarFixture.cidFor(CarFixture.encode(.text("x")))
        XCTAssertEqual(CarReader.cidFromString(cid.string), cid.bytes)
        XCTAssertNil(CarReader.cidFromString("not a cid"))
    }

    func testACARFileGivesBackItsRootsAndEveryBlock() throws {
        let repo = CarFixture.sampleRepo()
        let bytes = repo.bytes
        let car = try CarReader.read(bytes)
        XCTAssertEqual(car.roots, [repo.head.cid.string])
        XCTAssertEqual(car.blocks.count, repo.blocks.count)
        XCTAssertEqual(car.duplicates, 0)
        XCTAssertEqual(car.size, bytes.count)
        for block in repo.blocks {
            XCTAssertEqual(car.blockData(block.cid.string), block.data)
        }
    }

    func testBlocksAreRangesOfTheFileNotCopies() throws {
        let repo = CarFixture.sampleRepo()
        let car = try CarReader.read(repo.bytes)
        let range = try XCTUnwrap(car.blocks[repo.head.cid.string])
        XCTAssertTrue(range.upperBound <= car.bytes.count)
        XCTAssertEqual(Array(car.bytes[range]), repo.head.data)
    }

    func testARepeatedBlockIsCountedOnceAndNoted() throws {
        let a = CarFixture.block(.map(["n": .int(1)]))
        let b = CarFixture.block(.map(["n": .int(2)]))
        let car = try CarReader.read(CarFixture.carFile([a.cid], [a, b, a, a]))
        XCTAssertEqual(car.blocks.count, 2)
        XCTAssertEqual(car.duplicates, 2)
    }

    func testACIDv0BlockIsTolerated() throws {
        let data = CarFixture.encode(.map(["old": .bool(true)]))
        let v0 = CarFixture.Block(cid: CarCIDLink(bytes: [0x12, 0x20] + CarFixture.sha256(data)), data: data)
        let car = try CarReader.read(CarFixture.carFile([], [v0]))
        XCTAssertEqual(car.blocks.count, 1)
        let key = try XCTUnwrap(car.blocks.keys.first)
        XCTAssertTrue(key.hasPrefix("Qm"), key)
        XCTAssertEqual(car.blockData(key), data)
    }

    func testReadingInStepsGivesTheSameFileAsReadingStraightThrough() throws {
        let bytes = CarFixture.sampleRepo().bytes
        let reader = try CarReader(bytes: bytes)
        var steps = 0
        while try !reader.step(2) {
            steps += 1
        }
        XCTAssertGreaterThanOrEqual(steps, 3)
        XCTAssertEqual(reader.offset, bytes.count)
        XCTAssertEqual(reader.file.blocks, try CarReader.read(bytes).blocks)
    }

    func testFilesThatAreNotCARv1AreRefusedInWords() {
        assertCarError([], "empty")
        assertCarError(Array(#"{"records":[]}"#.utf8), "does not look like a CAR file")
        assertCarError(Array("<!doctype html><html>".utf8), "does not look like a CAR file")
        assertCarError(CarFixture.carFile([], [], version: 2), "CARv2")
        // A header that is valid CBOR but not a map.
        let notMap = CarFixture.encode(.array([.int(1), .int(2), .int(3)]))
        assertCarError([UInt8(notMap.count)] + notMap, "not a map")
    }

    func testAFileCutShortSaysSo() {
        let bytes = CarFixture.sampleRepo().bytes
        assertCarError(Array(bytes.prefix(bytes.count - 10)), "cut short")
    }

    func testBlockHashesAreRecomputedAndComparedWithTheirCIDs() throws {
        let repo = CarFixture.sampleRepo()
        let bytes = repo.bytes
        var progress: [Int] = []
        let ok = try CarReader.verifyBlockHashes(try CarReader.read(bytes), onProgress: { done, _ in progress.append(done) })
        XCTAssertEqual(ok, CarHashCheck(checked: repo.blocks.count, skipped: 0, mismatched: []))
        XCTAssertEqual(progress, [repo.blocks.count])

        // Flip a byte inside one block's data: its CID no longer matches.
        var tampered = bytes
        tampered[tampered.count - 1] ^= 0xff
        let bad = try CarReader.verifyBlockHashes(try CarReader.read(tampered))
        XCTAssertEqual(bad.mismatched, [repo.blocks[repo.blocks.count - 1].cid.string])
    }

    func testTheSystemHashGivesTheSameAnswer() throws {
        // The app passes the system's SHA-256; any function that hashes the
        // same way must agree with the package's own.
        let car = try CarReader.read(CarFixture.sampleRepo().bytes)
        var calls = 0
        let result = try CarReader.verifyBlockHashes(car, hash: { bytes in
            calls += 1
            return OAuthSHA256.hash(bytes)
        })
        XCTAssertEqual(result.checked, calls)
        XCTAssertEqual(result.mismatched, [])
    }

    func testABlockAddressedByAnotherHashIsSkippedNotFailed() throws {
        let data = CarFixture.encode(.map(["n": .int(1)]))
        // 0x13 is sha2-512; only its length is honoured here.
        let other = CarFixture.Block(cid: CarCIDLink(bytes: [0x01, 0x71, 0x13, 0x04, 1, 2, 3, 4]), data: data)
        let result = try CarReader.verifyBlockHashes(try CarReader.read(CarFixture.carFile([], [other])))
        XCTAssertEqual(result, CarHashCheck(checked: 0, skipped: 1, mismatched: []))
    }

    func testCheckingHashesCanBeStopped() throws {
        let car = try CarReader.read(CarFixture.sampleRepo().bytes)
        XCTAssertThrowsError(try CarReader.verifyBlockHashes(car, isStopped: { true })) { error in
            XCTAssertTrue(error is CancellationError)
        }
    }

    func testSHA256MatchesThePublishedVectors() {
        // FIPS 180-2 appendix B, and a message that pads into a second block.
        XCTAssertEqual(OAuthSHA256.hexDigest(Data("abc".utf8)), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad")
        XCTAssertEqual(OAuthSHA256.hexDigest(Data()), "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855")
        XCTAssertEqual(
            OAuthSHA256.hexDigest(Data(String(repeating: "a", count: 1000).utf8)),
            "41edece42d63e8d9bf515a9ba6932e1c20cbc9f5a5d134645adb5db1b9737ea3"
        )
    }
}
