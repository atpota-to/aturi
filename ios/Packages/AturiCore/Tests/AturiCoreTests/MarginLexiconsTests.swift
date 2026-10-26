import XCTest
@testable import AturiCore

final class MarginLexiconsTests: XCTestCase {
    func testDetectsTheNamespace() {
        XCTAssertTrue(MarginLexicons.isMarginLexicon("at.margin.annotation"))
        XCTAssertTrue(MarginLexicons.isMarginLexicon("at.margin.future"))
        XCTAssertFalse(MarginLexicons.isMarginLexicon("at.margin"))
        XCTAssertFalse(MarginLexicons.isMarginLexicon("app.bsky.feed.post"))
        XCTAssertFalse(MarginLexicons.isMarginLexicon(""))
    }

    func testMapsEverySupportedCollection() {
        let expected: [String: MarginLexiconType] = [
            "at.margin.annotation": .annotation,
            "at.margin.bookmark": .bookmark,
            "at.margin.highlight": .highlight,
            "at.margin.collection": .collection,
            "at.margin.collectionItem": .collectionItem,
            "at.margin.reply": .reply,
            "at.margin.like": .like,
        ]
        for (collection, type) in expected {
            XCTAssertEqual(MarginLexicons.type(of: collection), type, collection)
            XCTAssertTrue(MarginLexicons.hasCustomPreview(collection), collection)
            XCTAssertEqual(type.rawValue, collection)
        }
        XCTAssertEqual(Set(MarginLexiconType.allCases), Set(expected.values))
    }

    func testUnlistedCollectionsHaveNoType() {
        XCTAssertNil(MarginLexicons.type(of: "at.margin.future"))
        XCTAssertNil(MarginLexicons.type(of: "at.margin.Annotation"), "exact match only")
        XCTAssertNil(MarginLexicons.type(of: "app.bsky.feed.post"))
        XCTAssertFalse(MarginLexicons.hasCustomPreview("at.margin.future"))
        XCTAssertFalse(MarginLexicons.hasCustomPreview("app.bsky.feed.post"))
    }

    func testDisplayNames() {
        XCTAssertEqual(MarginLexicons.displayName(of: "at.margin.annotation"), "Annotation")
        XCTAssertEqual(MarginLexicons.displayName(of: "at.margin.bookmark"), "Bookmark")
        XCTAssertEqual(MarginLexicons.displayName(of: "at.margin.highlight"), "Highlight")
        XCTAssertEqual(MarginLexicons.displayName(of: "at.margin.collection"), "Collection")
        XCTAssertEqual(MarginLexicons.displayName(of: "at.margin.collectionItem"), "Collection Item")
        XCTAssertEqual(MarginLexicons.displayName(of: "at.margin.reply"), "Reply")
        XCTAssertEqual(MarginLexicons.displayName(of: "at.margin.like"), "Like")
        XCTAssertEqual(MarginLexicons.displayName(of: "at.margin.future"), "future", "namespace stripped")
        XCTAssertEqual(MarginLexicons.displayName(of: "app.bsky.feed.post"), "app.bsky.feed.post", "other collections pass through")
    }

    func testDescriptions() {
        XCTAssertEqual(MarginLexicons.description(of: "at.margin.annotation"), "Annotate and comment on web content")
        XCTAssertEqual(MarginLexicons.description(of: "at.margin.bookmark"), "Bookmarked webpage")
        XCTAssertEqual(MarginLexicons.description(of: "at.margin.highlight"), "Highlighted text from a webpage")
        XCTAssertEqual(MarginLexicons.description(of: "at.margin.collection"), "Collection of annotations and bookmarks")
        XCTAssertEqual(MarginLexicons.description(of: "at.margin.collectionItem"), "Item in a collection")
        XCTAssertEqual(MarginLexicons.description(of: "at.margin.reply"), "Reply to an annotation")
        XCTAssertEqual(MarginLexicons.description(of: "at.margin.like"), "Like on an annotation or reply")
        XCTAssertEqual(MarginLexicons.description(of: "at.margin.future"), "Margin record")
        XCTAssertEqual(MarginLexicons.description(of: "app.bsky.feed.post"), "Margin record")
    }
}
