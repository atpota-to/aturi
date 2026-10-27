import XCTest
@testable import AturiCore

final class LexiconTemplatesTests: XCTestCase {
    func testKnownCollectionsInDeclarationOrder() {
        XCTAssertEqual(LexiconTemplates.knownCollections(), [
            "app.bsky.feed.post",
            "app.bsky.actor.profile",
            "app.bsky.feed.like",
            "app.bsky.feed.repost",
            "app.bsky.graph.follow",
            "app.bsky.graph.block",
            "app.bsky.graph.list",
        ])
        XCTAssertEqual(Set(LexiconTemplates.knownCollections()), Set(LexiconTemplates.all.keys), "order and table agree")
    }

    func testLexiconForLooksUpExactly() {
        XCTAssertEqual(LexiconTemplates.lexiconFor("app.bsky.feed.post")?.label, "Bluesky post")
        XCTAssertNil(LexiconTemplates.lexiconFor("app.bsky.feed.Post"))
        XCTAssertNil(LexiconTemplates.lexiconFor("com.example.unknown"))
        XCTAssertNil(LexiconTemplates.lexiconFor(""))
        XCTAssertNil(LexiconTemplates.lexiconFor(nil))
    }

    func testPostTemplate() throws {
        let post = try XCTUnwrap(LexiconTemplates.lexiconFor("app.bsky.feed.post"))
        XCTAssertEqual(post.rkeyMode, .tid)
        XCTAssertEqual(post.typeFieldValue, "app.bsky.feed.post")
        XCTAssertNotNil(post.summary)
        XCTAssertEqual(post.fields.map { $0.key }, ["text", "langs", "createdAt"])
        XCTAssertEqual(post.fields[0].type, .textarea)
        XCTAssertTrue(post.fields[0].required)
        XCTAssertEqual(post.fields[0].maxLength, 300)
        XCTAssertEqual(post.fields[1].type, .tags)
        XCTAssertEqual(post.fields[1].default, .strings(["en"]))
        XCTAssertEqual(post.fields[1].hint, "BCP-47 codes")
        XCTAssertEqual(post.fields[2].type, .datetime)
        XCTAssertEqual(post.fields[2].default, .now)
        XCTAssertTrue(post.fields[2].required)
    }

    func testProfileTemplateUsesAFixedSelfRkey() throws {
        let profile = try XCTUnwrap(LexiconTemplates.lexiconFor("app.bsky.actor.profile"))
        XCTAssertEqual(profile.rkeyMode, .fixed)
        XCTAssertEqual(profile.rkeyDefault, "self")
        XCTAssertEqual(profile.rkeyPlaceholder, "self")
        XCTAssertEqual(profile.fields.map { $0.key }, ["displayName", "description", "pronouns"])
        XCTAssertEqual(profile.fields[0].maxLength, 64)
        XCTAssertEqual(profile.fields[1].maxLength, 256)
        XCTAssertFalse(profile.fields.contains { $0.required })
    }

    func testSubjectTemplatesShareTheCommonTimestamps() throws {
        for collection in ["app.bsky.feed.like", "app.bsky.feed.repost", "app.bsky.graph.follow", "app.bsky.graph.block"] {
            let lexicon = try XCTUnwrap(LexiconTemplates.lexiconFor(collection), collection)
            XCTAssertEqual(lexicon.rkeyMode, .tid)
            XCTAssertEqual(lexicon.typeFieldValue, collection)
            XCTAssertEqual(lexicon.fields.map { $0.key }, ["subject", "createdAt", "updatedAt"], collection)
            XCTAssertTrue(lexicon.fields[0].required)
            XCTAssertEqual(Array(lexicon.fields[1...]), LexiconTemplates.commonTimestamps)
        }
        XCTAssertEqual(LexiconTemplates.lexiconFor("app.bsky.feed.like")?.fields[0].type, .json)
        XCTAssertEqual(LexiconTemplates.lexiconFor("app.bsky.feed.like")?.fields[0].hint, "{ \"uri\": \"at://...\", \"cid\": \"...\" }")
        XCTAssertEqual(LexiconTemplates.lexiconFor("app.bsky.graph.follow")?.fields[0].type, .text)
        XCTAssertEqual(LexiconTemplates.lexiconFor("app.bsky.graph.follow")?.fields[0].placeholder, "did:plc:\u{2026}")

        let created = LexiconTemplates.commonTimestamps[0]
        XCTAssertEqual(created.key, "createdAt")
        XCTAssertTrue(created.required)
        XCTAssertFalse(created.autoOnEdit)
        let updated = LexiconTemplates.commonTimestamps[1]
        XCTAssertEqual(updated.key, "updatedAt")
        XCTAssertFalse(updated.required)
        XCTAssertTrue(updated.autoOnEdit)
        XCTAssertEqual(updated.default, .now)
    }

    func testListTemplate() throws {
        let list = try XCTUnwrap(LexiconTemplates.lexiconFor("app.bsky.graph.list"))
        XCTAssertEqual(list.fields.map { $0.key }, ["name", "purpose", "description", "createdAt", "updatedAt"])
        XCTAssertEqual(list.fields[0].maxLength, 64)
        XCTAssertEqual(list.fields[1].placeholder, "app.bsky.graph.defs#modlist or curatelist")
        XCTAssertEqual(list.fields[2].maxLength, 300)
    }

    // MARK: blankRecordFor

    func testBlankPostFillsTypeAndDefaults() {
        let now = Date(timeIntervalSince1970: 1_700_000_000.5)
        let record = LexiconTemplates.blankRecordFor("app.bsky.feed.post", now: now)
        XCTAssertEqual(record, [
            "$type": "app.bsky.feed.post",
            "langs": ["en"],
            "createdAt": "2023-11-14T22:13:20.500Z",
        ])
        XCTAssertNil(record["text"], "fields without a default are left for the form")
    }

    func testBlankProfileHasOnlyItsType() {
        XCTAssertEqual(LexiconTemplates.blankRecordFor("app.bsky.actor.profile"), ["$type": "app.bsky.actor.profile"])
    }

    func testBlankLikeHasBothTimestamps() {
        let now = Date(timeIntervalSince1970: 0)
        XCTAssertEqual(LexiconTemplates.blankRecordFor("app.bsky.feed.like", now: now), [
            "$type": "app.bsky.feed.like",
            "createdAt": "1970-01-01T00:00:00.000Z",
            "updatedAt": "1970-01-01T00:00:00.000Z",
        ])
    }

    func testBlankRecordForAnUnknownCollectionIsEmpty() {
        XCTAssertEqual(LexiconTemplates.blankRecordFor("com.example.unknown"), [:])
        XCTAssertEqual(LexiconTemplates.blankRecordFor(""), [:])
    }

    func testBlankRecordDefaultsToTheCurrentTime() throws {
        let before = Date()
        let record = LexiconTemplates.blankRecordFor("app.bsky.feed.post")
        let stamp = try XCTUnwrap(record["createdAt"]?.stringValue.flatMap(Formatting.isoDate))
        XCTAssertGreaterThanOrEqual(stamp.timeIntervalSince1970 + 0.001, before.timeIntervalSince1970 - 0.001)
        XCTAssertLessThanOrEqual(stamp.timeIntervalSince1970, Date().timeIntervalSince1970 + 1)
    }

    func testFieldDefaultJsonValues() {
        let now = Date(timeIntervalSince1970: 86_400)
        XCTAssertEqual(LexiconFieldDefault.now.jsonValue(now: now), "1970-01-02T00:00:00.000Z")
        XCTAssertEqual(LexiconFieldDefault.string("x").jsonValue(now: now), "x")
        XCTAssertEqual(LexiconFieldDefault.number(1.5).jsonValue(now: now), 1.5)
        XCTAssertEqual(LexiconFieldDefault.bool(true).jsonValue(now: now), true)
        XCTAssertEqual(LexiconFieldDefault.strings(["a", "b"]).jsonValue(now: now), ["a", "b"])
    }
}
