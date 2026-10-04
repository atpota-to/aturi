import XCTest
@testable import AturiCore

final class RecordImagesTests: XCTestCase {
    // MARK: imageUrlFromValue

    func testAcceptsHttpUrlsWithAnImageExtension() {
        XCTAssertEqual(RecordImages.imageUrlFromValue("https://example.com/pic.jpg"), "https://example.com/pic.jpg")
        XCTAssertEqual(RecordImages.imageUrlFromValue("http://example.com/pic.jpeg"), "http://example.com/pic.jpeg")
        XCTAssertEqual(RecordImages.imageUrlFromValue("https://example.com/a/b/pic.PNG"), "https://example.com/a/b/pic.PNG", "extension match is case-insensitive")
        XCTAssertEqual(RecordImages.imageUrlFromValue("HTTPS://example.com/pic.webp"), "HTTPS://example.com/pic.webp", "scheme match is case-insensitive")
        for ext in ["gif", "avif", "svg", "bmp", "ico", "apng", "jfif", "heic", "heif", "tif", "tiff"] {
            XCTAssertNotNil(RecordImages.imageUrlFromValue(.string("https://example.com/x.\(ext)")), ext)
        }
    }

    func testQueryStringsAndFragmentsDoNotDefeatTheMatch() {
        // arena appends `?<timestamp>` to its mirror image URLs.
        XCTAssertEqual(RecordImages.imageUrlFromValue("https://example.com/pic.jpg?1700000000"), "https://example.com/pic.jpg?1700000000")
        XCTAssertEqual(RecordImages.imageUrlFromValue("https://example.com/pic.png#section"), "https://example.com/pic.png#section")
        XCTAssertNil(RecordImages.imageUrlFromValue("https://example.com/page?img=pic.jpg"), "the extension must be on the path")
    }

    func testTrimsSurroundingWhitespace() {
        XCTAssertEqual(RecordImages.imageUrlFromValue("  https://example.com/pic.jpg\n"), "https://example.com/pic.jpg")
    }

    func testRejectsNonImagesAndNonHttp() {
        XCTAssertNil(RecordImages.imageUrlFromValue("https://example.com/page.html"))
        XCTAssertNil(RecordImages.imageUrlFromValue("https://example.com/pic"))
        XCTAssertNil(RecordImages.imageUrlFromValue("https://example.com/pic.jpg.txt"))
        XCTAssertNil(RecordImages.imageUrlFromValue("ftp://example.com/pic.jpg"))
        XCTAssertNil(RecordImages.imageUrlFromValue("//example.com/pic.jpg"))
        XCTAssertNil(RecordImages.imageUrlFromValue("/pic.jpg"))
        XCTAssertNil(RecordImages.imageUrlFromValue("data:image/png;base64,AAAA"))
        XCTAssertNil(RecordImages.imageUrlFromValue(""))
    }

    func testRejectsNonStrings() {
        XCTAssertNil(RecordImages.imageUrlFromValue(nil))
        XCTAssertNil(RecordImages.imageUrlFromValue(.null))
        XCTAssertNil(RecordImages.imageUrlFromValue(42))
        XCTAssertNil(RecordImages.imageUrlFromValue(["src": "https://example.com/pic.jpg"]))
    }

    // MARK: imageBlobFromValue

    func testReadsTheCurrentBlobShape() {
        let blob: JSONValue = ["$type": "blob", "ref": ["$link": "bafkreiabc"], "mimeType": "image/jpeg", "size": 1985909]
        XCTAssertEqual(RecordImages.imageBlobFromValue(blob), ImageBlobRef(cid: "bafkreiabc", mimeType: "image/jpeg"))
    }

    func testReadsTheLegacyInlineCidShape() {
        XCTAssertEqual(RecordImages.imageBlobFromValue(["cid": "bafylegacy", "mimeType": "image/png"]), ImageBlobRef(cid: "bafylegacy", mimeType: "image/png"))
    }

    func testPrefersTheRefLinkOverAnInlineCid() {
        XCTAssertEqual(RecordImages.imageBlobFromValue(["ref": ["$link": "fromref"], "cid": "inline", "mimeType": "image/gif"])?.cid, "fromref")
        XCTAssertEqual(RecordImages.imageBlobFromValue(["ref": ["$link": ""], "cid": "inline", "mimeType": "image/gif"])?.cid, "inline", "an empty link falls through")
    }

    func testRejectsNonImageBlobsAndMalformedValues() {
        XCTAssertNil(RecordImages.imageBlobFromValue(["$type": "blob", "ref": ["$link": "bafyvideo"], "mimeType": "video/mp4"]))
        XCTAssertNil(RecordImages.imageBlobFromValue(["ref": ["$link": "x"]]), "no mimeType")
        XCTAssertNil(RecordImages.imageBlobFromValue(["mimeType": "image/png"]), "no cid anywhere")
        XCTAssertNil(RecordImages.imageBlobFromValue(["mimeType": "image/png", "cid": ""]))
        XCTAssertNil(RecordImages.imageBlobFromValue(["mimeType": 7, "cid": "x"]))
        XCTAssertNil(RecordImages.imageBlobFromValue("image/png"))
        XCTAssertNil(RecordImages.imageBlobFromValue(nil))
        XCTAssertNil(RecordImages.imageBlobFromValue(.null))
    }

    // MARK: getBlobUrl

    func testBuildsTheGetBlobUrl() {
        XCTAssertEqual(
            RecordImages.getBlobUrl(pds: "https://pds.example.com", did: "did:plc:abc", cid: "bafkreixyz"),
            "https://pds.example.com/xrpc/com.atproto.sync.getBlob?did=did%3Aplc%3Aabc&cid=bafkreixyz"
        )
    }

    func testStripsOneTrailingSlashFromThePds() {
        XCTAssertEqual(
            RecordImages.getBlobUrl(pds: "https://pds.example.com/", did: "did:web:example.com", cid: "c"),
            "https://pds.example.com/xrpc/com.atproto.sync.getBlob?did=did%3Aweb%3Aexample.com&cid=c"
        )
    }

    // MARK: didFromAtUri

    func testExtractsADidAuthority() {
        XCTAssertEqual(RecordImages.didFromAtUri("at://did:plc:abc/app.bsky.feed.post/3k"), "did:plc:abc")
        XCTAssertEqual(RecordImages.didFromAtUri("at://did:web:example.com"), "did:web:example.com")
        XCTAssertEqual(RecordImages.didFromAtUri("at://did:plc:abc/"), "did:plc:abc")
    }

    func testReturnsNilForHandlesAndNonAtUris() {
        XCTAssertNil(RecordImages.didFromAtUri("at://alice.test/app.bsky.feed.post/3k"))
        XCTAssertNil(RecordImages.didFromAtUri("https://bsky.app/profile/did:plc:abc"))
        XCTAssertNil(RecordImages.didFromAtUri("did:plc:abc"))
        XCTAssertNil(RecordImages.didFromAtUri(""))
    }
}
