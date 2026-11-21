import XCTest
@testable import AturiCore

// Port of src/lib/tools/__tests__/share.test.ts.

final class ShareBuilderTests: XCTestCase {
    func testCountGraphemesCountsWhatAReaderSees() {
        XCTAssertEqual(ShareBuilder.countGraphemes(""), 0)
        XCTAssertEqual(ShareBuilder.countGraphemes("hello"), 5)
        XCTAssertEqual(ShareBuilder.countGraphemes("caf\u{e9}"), 4)
        // One family, seven code points.
        XCTAssertEqual(ShareBuilder.countGraphemes("\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}"), 1)
        XCTAssertEqual(ShareBuilder.countGraphemes("\u{1F44D}\u{1F3FD} ok"), 4)
        XCTAssertEqual(ShareBuilder.postGraphemeLimit, 300)
    }

    func testComposeTextPutsTheLinkOnALineOfItsOwn() {
        XCTAssertEqual(ShareBuilder.composeText(" Reading this ", url: " https://example.com/a "), "Reading this\nhttps://example.com/a")
        XCTAssertEqual(ShareBuilder.composeText("Just text", url: ""), "Just text")
        XCTAssertEqual(ShareBuilder.composeText("", url: "https://example.com"), "https://example.com")
        XCTAssertEqual(ShareBuilder.composeText("", url: ""), "")
    }

    func testShareUrlProblemAcceptsWebAddressesAndAnEmptyField() {
        XCTAssertNil(ShareBuilder.shareUrlProblem(""))
        XCTAssertNil(ShareBuilder.shareUrlProblem("https://example.com/post?a=1"))
        XCTAssertNotNil(ShareBuilder.shareUrlProblem("example.com/post"))
        XCTAssertNotNil(ShareBuilder.shareUrlProblem("javascript:alert(1)"))
    }

    func testEveryTargetComesFromTheCatalogAndOnlyClientsWithAComposeRoute() {
        let targets = ShareBuilder.targets("hello")
        let withIntent = WaypointCatalog.ordered.filter { $0.composeIntent != nil }
        XCTAssertEqual(targets.count, withIntent.count)
        XCTAssertFalse(targets.isEmpty)
        for target in targets {
            guard let intent = WaypointCatalog.all[target.id]?.composeIntent else {
                XCTFail("\(target.id) has no compose intent in the catalog")
                continue
            }
            XCTAssertTrue(target.url.hasPrefix(intent.url), target.id)
            XCTAssertEqual(target.prefillsText, intent.textParam != nil, target.id)
        }
    }

    func testTheTextIsURLEncodedIntoClientsThatReadItAndLeftOffThoseThatDoNot() {
        let post = ShareBuilder.composeText("50% off & more?", url: "https://example.com/a?b=1#c")
        let targets = ShareBuilder.targets(post)
        guard let bluesky = targets.first(where: { $0.id == "bluesky" }) else {
            return XCTFail("no Bluesky target")
        }
        XCTAssertEqual(
            bluesky.url,
            "https://bsky.app/intent/compose?text=50%25%20off%20%26%20more%3F%0Ahttps%3A%2F%2Fexample.com%2Fa%3Fb%3D1%23c"
        )
        let text = URLComponents(string: bluesky.url)?.queryItems?.first { $0.name == "text" }?.value
        XCTAssertEqual(text, post)
        XCTAssertTrue(bluesky.appUrl?.hasPrefix("bluesky://intent/compose?text=") ?? false)

        for target in targets where !target.prefillsText {
            XCTAssertFalse(target.url.contains("?"), "\(target.id) ignores the text, so its link carries none")
        }
        // With nothing to say the link is the bare route.
        XCTAssertEqual(ShareBuilder.targets("").first { $0.id == "bluesky" }?.url, "https://bsky.app/intent/compose")
    }

    func testTheSnippetsEscapeWhatGoesIntoThem() {
        let url = #"https://bsky.app/intent/compose?text=a%26b&x="y""#
        let anchor = ShareBuilder.anchorSnippet(url: url, label: #"Share <now> & "then""#)
        XCTAssertEqual(
            anchor,
            #"<a href="https://bsky.app/intent/compose?text=a%26b&amp;x=&quot;y&quot;" target="_blank" rel="noopener noreferrer">Share &lt;now&gt; &amp; &quot;then&quot;</a>"#
        )
        let button = ShareBuilder.buttonSnippet(url: url, label: "Share on Bluesky")
        XCTAssertTrue(button.contains(#"style="display:inline-flex;"#))
        XCTAssertTrue(button.contains(#"rel="noopener noreferrer""#))
        XCTAssertFalse(button.contains(#"x="y""#))
    }
}

@MainActor
final class ShareBuilderModelTests: XCTestCase {
    func testTheModelFollowsItsFields() {
        let model = ShareBuilderModel()
        model.apply(query: ["text": "Hello", "url": "https://example.com"])
        XCTAssertEqual(model.post, "Hello\nhttps://example.com")
        XCTAssertEqual(model.target?.id, model.targets.first?.id)
        XCTAssertEqual(model.buttonLabel, "Share on \(model.targets.first?.name ?? "")")
        model.chosen = "deer"
        XCTAssertEqual(model.target?.id, "deer")
        XCTAssertEqual(model.buttonLabel, "Share on Deer")
        model.label = "Post it"
        XCTAssertTrue(model.anchorSnippet?.contains(">Post it</a>") ?? false)
        XCTAssertEqual(model.shareQuery, ["text": "Hello", "url": "https://example.com"])
        XCTAssertNil(model.lengthWarning)

        model.text = String(repeating: "a", count: 301)
        model.url = ""
        XCTAssertEqual(model.over, 1)
        XCTAssertEqual(model.lengthWarning?.tone, .warn)
        XCTAssertEqual(model.shareQuery, ["text": String(repeating: "a", count: 301)])
    }
}
