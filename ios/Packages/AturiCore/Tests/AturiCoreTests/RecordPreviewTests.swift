import XCTest
@testable import AturiCore

final class RecordPreviewTests: XCTestCase {
    // MARK: previewFor

    func testPrefersTitleFieldsInOrder() {
        XCTAssertEqual(RecordPreview.previewFor(["title": "T", "name": "N", "text": "X"]), "T")
        XCTAssertEqual(RecordPreview.previewFor(["name": "N", "displayName": "D"]), "N")
        XCTAssertEqual(RecordPreview.previewFor(["displayName": "D", "status": "S"]), "D")
        XCTAssertEqual(RecordPreview.previewFor(["status": "S", "text": "X"]), "S")
        XCTAssertEqual(RecordPreview.previewFor(["text": "X", "description": "Y"]), "X")
        XCTAssertEqual(RecordPreview.previewFor(["description": "Y", "summary": "Z"]), "Y")
        XCTAssertEqual(RecordPreview.previewFor(["summary": "Z"]), "Z")
    }

    func testBlankAndNonStringCandidatesAreSkipped() {
        XCTAssertEqual(RecordPreview.previewFor(["title": "   ", "text": "  real  "]), "real")
        XCTAssertEqual(RecordPreview.previewFor(["title": 12, "name": nil, "text": "yes"]), "yes")
        XCTAssertEqual(RecordPreview.previewFor(["title": ["nested"], "text": "yes"]), "yes")
    }

    func testFallsBackToTheSubject() {
        XCTAssertEqual(RecordPreview.previewFor(["subject": ["uri": "at://did:plc:a/app.bsky.feed.post/1", "cid": "c"]]), "at://did:plc:a/app.bsky.feed.post/1")
        XCTAssertEqual(RecordPreview.previewFor(["subject": ["handle": "alice.test", "did": "did:plc:a"]]), "alice.test")
        XCTAssertEqual(RecordPreview.previewFor(["subject": ["did": "did:plc:a"]]), "did:plc:a")
        XCTAssertEqual(RecordPreview.previewFor(["subject": "did:plc:follow", "createdAt": "2024-01-01T00:00:00Z"]), "did:plc:follow")
        XCTAssertEqual(RecordPreview.previewFor(["subject": ["other": 1], "createdAt": "2024-01-01T00:00:00Z"]), "2024-01-01T00:00:00Z", "a subject with none of the known keys falls through")
    }

    func testFallsBackToCreatedAtUntruncatedThenEmpty() {
        XCTAssertEqual(RecordPreview.previewFor(["createdAt": "2024-01-01T00:00:00Z"]), "2024-01-01T00:00:00Z")
        XCTAssertEqual(RecordPreview.previewFor(["createdAt": 5]), "")
        XCTAssertEqual(RecordPreview.previewFor(["other": "x"]), "")
        XCTAssertEqual(RecordPreview.previewFor([:]), "")
        XCTAssertEqual(RecordPreview.previewFor(nil), "")
        XCTAssertEqual(RecordPreview.previewFor("string"), "")
        XCTAssertEqual(RecordPreview.previewFor([1, 2]), "")
        XCTAssertEqual(RecordPreview.previewFor(.null), "")
    }

    func testPreviewIsTruncatedAt140() {
        let long = String(repeating: "a", count: 200)
        let preview = RecordPreview.previewFor(["text": .string(long)])
        XCTAssertEqual(preview.count, 140)
        XCTAssertTrue(preview.hasSuffix("\u{2026}"))
        XCTAssertEqual(preview, String(repeating: "a", count: 139) + "\u{2026}")
    }

    func testPreviewTrimsBeforeMeasuring() {
        XCTAssertEqual(RecordPreview.previewFor(["text": "\n  hello world \t"]), "hello world")
    }

    // MARK: truncate

    func testTruncateLeavesShortStringsAlone() {
        XCTAssertEqual(RecordPreview.truncate("abc", 3), "abc")
        XCTAssertEqual(RecordPreview.truncate("abc", 10), "abc")
        XCTAssertEqual(RecordPreview.truncate("", 0), "")
    }

    func testTruncateCutsToNMinusOneAndAddsAnEllipsis() {
        XCTAssertEqual(RecordPreview.truncate("abcdef", 4), "abc\u{2026}")
        XCTAssertEqual(RecordPreview.truncate("abcdef", 1), "\u{2026}")
    }

    func testTruncateDropsTrailingWhitespaceBeforeTheEllipsis() {
        XCTAssertEqual(RecordPreview.truncate("hello   world", 8), "hello\u{2026}")
        XCTAssertEqual(RecordPreview.truncate("hello\n\nworld", 7), "hello\u{2026}")
    }

    func testTruncateCountsCharactersSoEmojiAreNeverSplit() {
        let text = "\u{1F98B}\u{1F98B}\u{1F98B}\u{1F98B}"
        XCTAssertEqual(RecordPreview.truncate(text, 4), text)
        XCTAssertEqual(RecordPreview.truncate(text, 3), "\u{1F98B}\u{1F98B}\u{2026}")
    }

    // MARK: titleFor

    func testTitleUsesTitleNameOrDisplayName() {
        XCTAssertEqual(RecordPreview.titleFor(["title": "  A title ", "name": "n"]), "A title")
        XCTAssertEqual(RecordPreview.titleFor(["name": "A name"]), "A name")
        XCTAssertEqual(RecordPreview.titleFor(["displayName": "A display name", "text": "ignored"]), "A display name")
        XCTAssertEqual(RecordPreview.titleFor(["text": "not a title"], collection: "app.bsky.feed.post"), "post")
    }

    func testTitleIsTruncatedAt100() {
        let long = String(repeating: "t", count: 150)
        let title = RecordPreview.titleFor(["title": .string(long)])
        XCTAssertEqual(title.count, 100)
        XCTAssertTrue(title.hasSuffix("\u{2026}"))
    }

    func testTitleFallsBackToCollectionTailThenRkeyThenRecord() {
        XCTAssertEqual(RecordPreview.titleFor(nil, collection: "app.bsky.graph.follow", rkey: "3k"), "follow")
        XCTAssertEqual(RecordPreview.titleFor([:], collection: "nodots", rkey: "3k"), "nodots")
        XCTAssertEqual(RecordPreview.titleFor([:], collection: "trailing.dot.", rkey: "3k"), "3k", "an empty tail is not a title")
        XCTAssertEqual(RecordPreview.titleFor([:], collection: "", rkey: "3k"), "3k")
        XCTAssertEqual(RecordPreview.titleFor([:], rkey: "3k"), "3k")
        XCTAssertEqual(RecordPreview.titleFor([:], rkey: ""), "record")
        XCTAssertEqual(RecordPreview.titleFor(nil), "record")
        XCTAssertEqual(RecordPreview.titleFor("just a string", collection: "a.b.c"), "c")
    }
}
