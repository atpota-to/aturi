import Foundation
import XCTest
@testable import AturiCore

/// Port of `src/lib/tools/__tests__/labels.test.ts`.
final class LabelsTests: XCTestCase {
    private typealias Label = Labels.Label

    private static let did = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa"
    private static let labeler = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb"
    private static let other = "did:plc:cccccccccccccccccccccccc"

    private func json(_ text: String) -> JSONValue {
        try! JSONValue.parse(Data(text.utf8))
    }

    // MARK: What was asked about

    func testParseSubjectInputReadsHandlesDidsAndAtUrisAsAccounts() {
        XCTAssertEqual(Labels.parseSubjectInput(" @Alice.Example.com "), .ok(.account(actor: "alice.example.com")))
        XCTAssertEqual(Labels.parseSubjectInput(Self.did), .ok(.account(actor: Self.did)))
        XCTAssertEqual(Labels.parseSubjectInput("at://\(Self.did)"), .ok(.account(actor: Self.did)))
        // A profile record is the account, as far as labels go.
        XCTAssertEqual(
            Labels.parseSubjectInput("at://\(Self.did)/app.bsky.actor.profile/self"),
            .ok(.account(actor: Self.did))
        )
    }

    func testParseSubjectInputReadsPostsFromAtUrisAndClientLinks() {
        XCTAssertEqual(
            Labels.parseSubjectInput("at://\(Self.did)/app.bsky.feed.post/3kabc"),
            .ok(.post(actor: Self.did, rkey: "3kabc"))
        )
        XCTAssertEqual(
            Labels.parseSubjectInput("https://bsky.app/profile/alice.example.com/post/3kabc"),
            .ok(.post(actor: "alice.example.com", rkey: "3kabc"))
        )
        XCTAssertEqual(
            Labels.parseSubjectInput("https://bsky.app/profile/alice.example.com"),
            .ok(.account(actor: "alice.example.com"))
        )
    }

    func testParseSubjectInputRefusesWhatCannotCarryALabelAnAppShows() {
        func refused(_ input: String) -> Bool {
            if case .invalid = Labels.parseSubjectInput(input) { return true }
            return false
        }
        XCTAssertTrue(refused(""))
        XCTAssertTrue(refused("not a handle"))
        XCTAssertTrue(refused("at://\(Self.did)/app.bsky.graph.follow/3kabc"))
        XCTAssertTrue(refused("https://example.com/some/page"))
        XCTAssertEqual(
            Labels.parseSubjectInput("at://\(Self.did)/app.bsky.graph.follow/3kabc"),
            .invalid(reason: Labels.notLabelled)
        )
    }

    func testATargetBecomesASubjectOnceItsAccountIsResolved() {
        XCTAssertEqual(Labels.subjectFor(.account(actor: "alice.example.com"), did: Self.did), .account(did: Self.did))
        XCTAssertEqual(
            Labels.subjectFor(.post(actor: "alice.example.com", rkey: "3kabc"), did: Self.did),
            .post(did: Self.did, uri: "at://\(Self.did)/app.bsky.feed.post/3kabc")
        )
        XCTAssertNotEqual(
            Labels.targetKey(.account(actor: "alice.example.com")),
            Labels.targetKey(.post(actor: "alice.example.com", rkey: "3kabc"))
        )
    }

    // MARK: Which labelers to ask

    func testParseLabelersParamKeepsHandlesAndDidsOnceEachUpToTheCap() {
        XCTAssertEqual(
            Labels.parseLabelersParam("labeler.example.com,\(Self.labeler),labeler.example.com,nonsense!,"),
            ["labeler.example.com", Self.labeler]
        )
        XCTAssertEqual(Labels.parseLabelersParam(""), [])
        let many = (0..<(Labels.maxAddedLabelers + 5)).map { "l\($0).example.com" }.joined(separator: ",")
        XCTAssertEqual(Labels.parseLabelersParam(many).count, Labels.maxAddedLabelers)
    }

    func testTheHeaderNeverCarriesAnEntryTheAppViewWouldChokeOn() {
        // One malformed entry makes the AppView ignore the whole header.
        XCTAssertEqual(
            Labels.cleanLabelerDids([Self.labeler, "not-a-did", Self.labeler, Self.other, ""]),
            [Self.labeler, Self.other]
        )
        XCTAssertEqual(Labels.labelersHeader([Self.labeler, "alice.example.com", Self.other]), "\(Self.labeler), \(Self.other)")
    }

    func testBatchLabelersSplitsIntoRequestsOfTheStatedSize() {
        let dids = (0..<45).map { index -> String in
            let digits = String(index)
            return "did:plc:" + String(repeating: "a", count: 24 - digits.count) + digits
        }
        let batches = Labels.batchLabelers(dids)
        XCTAssertEqual(batches.map { $0.count }, [Labels.labelersPerRequest, Labels.labelersPerRequest, 5])
        XCTAssertEqual(batches.flatMap { $0 }, dids)
        XCTAssertEqual(Labels.batchLabelers([]), [])
    }

    // MARK: Reading labels

    func testReadLabelsKeepsWhatReadsAsALabelAndDropsTheRest() {
        let raw = json("""
        [
          {"src":"\(Self.labeler)","uri":"\(Self.did)","val":"spam","cts":"2025-01-01T00:00:00.000Z","ver":1,"sig":{"$bytes":"x"}},
          {"src":"\(Self.labeler)","uri":"\(Self.did)"},
          "nonsense",
          null,
          {"src":"\(Self.labeler)","uri":"\(Self.did)","val":"old","neg":true,"exp":"2025-02-01T00:00:00.000Z"}
        ]
        """)
        let labels = Labels.readLabels(raw)
        XCTAssertEqual(labels.count, 2)
        XCTAssertEqual(labels[0], Label(src: Self.labeler, uri: Self.did, val: "spam", cts: "2025-01-01T00:00:00.000Z", ver: 1))
        XCTAssertTrue(labels[1].neg)
        XCTAssertEqual(Labels.readLabels(nil), [])
    }

    func testMergeLabelsKeepsOneStatementPerLabelerSubjectAndValueTheNewest() {
        let older = Label(src: Self.labeler, uri: Self.did, val: "spam", cts: "2025-01-01T00:00:00.000Z")
        var newer = older
        newer.cts = "2025-03-01T00:00:00.000Z"
        newer.neg = true
        let other = Label(src: Self.other, uri: Self.did, val: "spam")
        XCTAssertEqual(Labels.mergeLabels([older], [other, newer]), [newer, other])
        XCTAssertEqual(Labels.mergeLabels([newer], [older]), [newer])
        XCTAssertEqual(Labels.mergeLabels([], []), [])
    }

    func testIsExpiredAndLabelScope() {
        let now = Formatting.isoDate("2026-01-01T00:00:00.000Z")!
        XCTAssertTrue(Labels.isExpired(Label(src: Self.labeler, uri: Self.did, val: "x", exp: "2025-12-31T00:00:00.000Z"), now: now))
        XCTAssertFalse(Labels.isExpired(Label(src: Self.labeler, uri: Self.did, val: "x", exp: "2026-12-31T00:00:00.000Z"), now: now))
        XCTAssertFalse(Labels.isExpired(Label(src: Self.labeler, uri: Self.did, val: "x"), now: now))
        XCTAssertFalse(Labels.isExpired(Label(src: Self.labeler, uri: Self.did, val: "x", exp: "never"), now: now))

        XCTAssertEqual(Labels.labelScope(Label(src: Self.labeler, uri: Self.did, val: "x")), .account)
        XCTAssertEqual(Labels.labelScope(Label(src: Self.did, uri: "at://\(Self.did)/app.bsky.actor.profile/self", val: "x")), .profile)
        XCTAssertEqual(Labels.labelScope(Label(src: Self.labeler, uri: "at://\(Self.did)/app.bsky.feed.post/3kabc", val: "x")), .post)
        XCTAssertEqual(Labels.labelScope(Label(src: Self.labeler, uri: "at://\(Self.did)/app.bsky.graph.list/3kabc", val: "x")), .record)
    }

    func testGroupLabelsPutsSelfLabelsFirstThenBlueskyThenTheBusiestLabeler() {
        let labels = [
            Label(src: Self.other, uri: Self.did, val: "a", cts: "2025-01-01T00:00:00.000Z"),
            Label(src: Self.labeler, uri: Self.did, val: "b", cts: "2025-01-01T00:00:00.000Z"),
            Label(src: Self.labeler, uri: Self.did, val: "c", cts: "2025-06-01T00:00:00.000Z"),
            Label(src: Labels.blueskyModerationDid, uri: Self.did, val: "spam"),
            Label(src: Self.did, uri: "at://\(Self.did)/app.bsky.actor.profile/self", val: "!no-unauthenticated"),
        ]
        let groups = Labels.groupLabels(labels, subjectDid: Self.did)
        XCTAssertEqual(groups.map { $0.src }, [Self.did, Labels.blueskyModerationDid, Self.labeler, Self.other])
        XCTAssertEqual(groups.map { $0.isSelf }, [true, false, false, false])
        // Newest first inside a group.
        XCTAssertEqual(groups[2].labels.map { $0.val }, ["c", "b"])
    }

    // MARK: What a label means

    private var definitions: [Labels.LabelDefinition] {
        Labels.readDefinitions(json("""
        [
          {
            "identifier": "spam",
            "severity": "inform",
            "blurs": "content",
            "defaultSetting": "hide",
            "adultOnly": false,
            "locales": [
              {"lang": "en", "name": "Spam", "description": "Unwanted, repeated actions."},
              {"lang": "pt-BR", "name": "Spam (pt)", "description": "Em português."}
            ]
          },
          {"identifier": "porn", "severity": "alert", "blurs": "media", "locales": [{"lang": "en", "name": "Their porn", "description": "Their wording."}]},
          {"identifier": "!hide", "severity": "none", "blurs": "none", "locales": [{"lang": "en", "name": "Hijacked", "description": "Not allowed."}]},
          {"severity": "alert"},
          "nonsense"
        ]
        """))
    }

    func testReadDefinitionsKeepsTheDefinitionsThatNameAValue() {
        XCTAssertEqual(definitions.map { $0.identifier }, ["spam", "porn", "!hide"])
        XCTAssertEqual(Labels.readDefinitions(nil), [])
    }

    func testPickLocalePrefersTheReaderThenEnglishThenWhateverIsThere() {
        let locales = definitions[0].locales
        XCTAssertEqual(Labels.pickLocale(locales, languages: ["pt-BR"])?.name, "Spam (pt)")
        // A language matches across regions.
        XCTAssertEqual(Labels.pickLocale(locales, languages: ["pt-PT"])?.name, "Spam (pt)")
        XCTAssertEqual(Labels.pickLocale(locales, languages: ["ja", "en-GB"])?.name, "Spam")
        XCTAssertEqual(Labels.pickLocale(locales, languages: ["ja"])?.name, "Spam")
        XCTAssertEqual(
            Labels.pickLocale([Labels.LabelLocale(lang: "ja", name: "スパム", description: "")], languages: ["fr"])?.name,
            "スパム"
        )
        XCTAssertNil(Labels.pickLocale([], languages: ["en"]))
    }

    func testDescribeLabelUsesTheLabelersWordingTheProtocolsOrTheBareValue() {
        let defs = definitions
        let own = Labels.describeLabel("spam", definitions: defs, languages: ["en"])
        XCTAssertEqual(own.name, "Spam")
        XCTAssertEqual(own.source, .labeler)
        XCTAssertEqual(own.blurs, "content")
        XCTAssertEqual(own.defaultSetting, "hide")

        // A labeler may redefine a global value for itself...
        XCTAssertEqual(Labels.describeLabel("porn", definitions: defs, languages: ["en"]).name, "Their porn")
        // ...but not one that starts with `!`.
        let reserved = Labels.describeLabel("!hide", definitions: defs, languages: ["en"])
        XCTAssertEqual(reserved.source, .protocolDefined)
        XCTAssertEqual(reserved.name, Labels.globalLabels["!hide"]?.name)

        XCTAssertEqual(Labels.describeLabel("porn", definitions: [], languages: ["en"]).source, .protocolDefined)
        let unknown = Labels.describeLabel("made-up", definitions: defs, languages: ["en"])
        XCTAssertEqual(unknown.name, "made-up")
        XCTAssertNil(unknown.description)
        XCTAssertEqual(unknown.source, .undefined)
        XCTAssertEqual(unknown.source.rawValue, "none")
    }

    func testTheGlobalValuesAreTheEightTheLexiconAndTheLabelsGuideList() {
        XCTAssertEqual(Labels.globalLabels.keys.sorted(), [
            "!hide",
            "!no-unauthenticated",
            "!warn",
            "bot",
            "graphic-media",
            "nudity",
            "porn",
            "sexual",
        ])
    }

    func testLabelEffectCoversTheNineBehaviours() {
        XCTAssertEqual(Labels.labelEffect(blurs: "content", severity: "alert"), "Hides the content behind a warning")
        XCTAssertEqual(Labels.labelEffect(blurs: "content", severity: "inform"), "Hides the content behind a notice")
        XCTAssertEqual(Labels.labelEffect(blurs: "content", severity: "none"), "Hides the content")
        XCTAssertEqual(Labels.labelEffect(blurs: "media", severity: "alert"), "Hides images behind a warning")
        XCTAssertEqual(Labels.labelEffect(blurs: "media", severity: "inform"), "Hides images behind a notice")
        XCTAssertEqual(Labels.labelEffect(blurs: "media", severity: "none"), "Hides images")
        XCTAssertEqual(Labels.labelEffect(blurs: "none", severity: "alert"), "Shows a warning badge")
        XCTAssertEqual(Labels.labelEffect(blurs: "none", severity: "inform"), "Shows an informational badge")
        XCTAssertEqual(Labels.labelEffect(blurs: "none", severity: "none"), "No visual effect")
        XCTAssertNil(Labels.labelEffect(blurs: nil, severity: nil))
    }

    func testScanPercentCountsFailedBatchesAsDoneAndNeverPasses100() {
        XCTAssertEqual(Labels.scanPercent(Labels.ScanProgress(total: 0, checked: 0, failed: 0)), 0)
        XCTAssertEqual(Labels.scanPercent(Labels.ScanProgress(total: 600, checked: 140, failed: 10)), 25)
        XCTAssertEqual(Labels.scanPercent(Labels.ScanProgress(total: 600, checked: 600, failed: 0)), 100)
        XCTAssertEqual(Labels.scanPercent(Labels.ScanProgress(total: 10, checked: 10, failed: 5)), 100)
    }

    func testFormatCountGroupsThousands() {
        XCTAssertEqual(Labels.formatCount(611), "611")
        XCTAssertEqual(Labels.formatCount(1234), "1,234")
    }
}
