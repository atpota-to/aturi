import Foundation
import XCTest
@testable import AturiCore

/// The label checker's and the shadowban checker's own runs, against the
/// account the explorer's check tests use (`ChecksFixture`).
@MainActor
final class AccountToolModelsTests: XCTestCase {
    private var p1Rkey: String {
        String(ChecksFixture.p1.split(separator: "/").last ?? "")
    }

    // MARK: Labels

    func testTheLabelCheckerAsksAddedLabelersFirstThenScansEveryOne() async {
        let transport = ChecksFixture.transport()
        let model = LabelsToolModel(http: HTTPClient(transport: transport), clock: { ChecksFixture.now })
        model.check(.account(actor: ChecksFixture.did), added: [ChecksFixture.labeler])
        XCTAssertEqual(model.base.status, .loading)
        await model.waitForRuns()

        XCTAssertEqual(model.base.status, .done)
        XCTAssertEqual(model.base.data?.asked, [Labels.blueskyModerationDid, ChecksFixture.labeler])
        XCTAssertEqual(model.base.data?.added, [LabelsClient.AddedLabeler(value: ChecksFixture.labeler, did: ChecksFixture.labeler)])
        // The added labeler's label is in the first answer, before any scan.
        XCTAssertEqual(model.base.data?.labels.map { $0.val }, ["cornerstone"])
        XCTAssertEqual(model.scan.status, .done)
        XCTAssertEqual(model.scan.data?.progress.total, 3)
        // The same label from the scan is one label.
        XCTAssertEqual(model.allLabels.map { $0.val }, ["cornerstone"])
        XCTAssertEqual(model.labelers[ChecksFixture.labeler]?.displayName, "Labeler One")
        XCTAssertFalse(model.isScanning)

        // Asking again about the same subject sends nothing.
        let requests = transport.urls.count
        model.check(.account(actor: ChecksFixture.did), added: [ChecksFixture.labeler])
        XCTAssertEqual(transport.urls.count, requests)
    }

    func testTheLabelCheckerAsksAboutAPost() async {
        let transport = ChecksFixture.transport()
        let model = LabelsToolModel(http: HTTPClient(transport: transport), clock: { ChecksFixture.now })
        model.check(.post(actor: ChecksFixture.did, rkey: p1Rkey), added: [])
        await model.waitForRuns()
        XCTAssertEqual(model.base.data?.subject, .post(did: ChecksFixture.did, uri: ChecksFixture.p1))
        XCTAssertNil(model.base.data?.unavailable)
        XCTAssertGreaterThanOrEqual(transport.count(containing: ChecksFixture.postsRoute), 1)
        XCTAssertEqual(transport.count(containing: ChecksFixture.profileRoute), 0, "a post is asked about by getPosts")
    }

    func testASubjectBlueskyWillNotDescribeIsNotScanned() async {
        let transport = ChecksFixture.transport([(ChecksFixture.profileRoute, ChecksFakeTransport.reply(400, ChecksFixture.notFound))])
        let model = LabelsToolModel(http: HTTPClient(transport: transport), clock: { ChecksFixture.now })
        model.check(.account(actor: ChecksFixture.did), added: [])
        await model.waitForRuns()
        XCTAssertEqual(model.base.data?.unavailable, "Profile not found")
        XCTAssertEqual(model.scan.status, .idle)
        XCTAssertEqual(transport.count(containing: ChecksFixture.relayRoute), 0)
    }

    func testAnUnresolvableSubjectFailsInWords() async {
        let transport = ChecksFixture.transport()
        let model = LabelsToolModel(http: HTTPClient(transport: transport), clock: { ChecksFixture.now })
        model.check(.account(actor: "nobody.invalid"), added: [])
        await model.waitForRuns()
        XCTAssertEqual(model.base.status, .error)
        XCTAssertEqual(model.base.error, "nobody.invalid does not resolve to an account. Check the spelling, or use its DID.")
    }

    // MARK: Visibility

    func testTheShadowbanCheckerResolvesTheAccountAndRunsEveryCheck() async {
        let document = ##"{"id":"did:plc:alice123","alsoKnownAs":["at://alice.test"],"service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"https://pds.example"}]}"##
        let transport = ChecksFixture.transport([
            ("plc.directory/did:plc:alice123", ChecksFakeTransport.reply(200, document)),
        ])
        let model = ShadowbanToolModel(http: HTTPClient(transport: transport), clock: { ChecksFixture.now })
        model.check(.account(actor: ChecksFixture.did), appview: Shadowban.defaultAppView)
        XCTAssertEqual(model.run.status, .loading)
        await model.waitForRun()

        XCTAssertEqual(model.run.status, .done)
        guard let evidence = model.run.data else { return XCTFail("the run kept its evidence") }
        XCTAssertTrue(evidence.done)
        XCTAssertEqual(evidence.identity?.pds, "https://pds.example")
        let checks = Shadowban.buildAccountChecks(evidence, now: evidence.checkedAt ?? ChecksFixture.now)
        XCTAssertEqual(checks.map { $0.status }, [.pass, .pass, .pass, .pass, .pass, .pass])
        XCTAssertEqual(transport.count(containing: "plc.directory"), 1)
    }

    func testTheShadowbanCheckerChecksAPostOnItsOwnAsWell() async {
        let document = ##"{"id":"did:plc:alice123","alsoKnownAs":["at://alice.test"],"service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"https://pds.example"}]}"##
        let record = #"{"uri":"\#(ChecksFixture.p1)","cid":"c1","value":{"$type":"app.bsky.feed.post","text":"one","createdAt":"2026-11-18T10:00:00.000Z"}}"#
        let transport = ChecksFixture.transport([
            ("plc.directory/did:plc:alice123", ChecksFakeTransport.reply(200, document)),
            ("pds.example/xrpc/com.atproto.repo.getRecord", ChecksFakeTransport.reply(200, record)),
        ])
        let model = ShadowbanToolModel(http: HTTPClient(transport: transport), clock: { ChecksFixture.now })
        model.check(.post(actor: ChecksFixture.did, rkey: p1Rkey), appview: Shadowban.defaultAppView)
        await model.waitForRun()

        guard let evidence = model.run.data else { return XCTFail("the run kept its evidence") }
        guard case .ok(let found)? = evidence.post, let post = found else { return XCTFail("the PDS has the post") }
        XCTAssertEqual(post.uri, ChecksFixture.p1)
        XCTAssertTrue(evidence.postShown?.value?.contains(ChecksFixture.p1) ?? false)
        let postChecks = Shadowban.buildPostChecks(evidence, now: evidence.checkedAt ?? ChecksFixture.now)
        XCTAssertEqual(postChecks.count, 3)
        XCTAssertFalse(postChecks.contains { $0.status == .fail })
    }

    func testAnotherAppViewIsAChecksOwnRun() async {
        let document = ##"{"id":"did:plc:alice123","alsoKnownAs":["at://alice.test"],"service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"https://pds.example"}]}"##
        let transport = ChecksFixture.transport([
            ("plc.directory/did:plc:alice123", ChecksFakeTransport.reply(200, document)),
        ])
        let model = ShadowbanToolModel(http: HTTPClient(transport: transport), clock: { ChecksFixture.now })
        model.check(.account(actor: ChecksFixture.did), appview: Shadowban.defaultAppView)
        await model.waitForRun()
        guard case .ok(let blacksky) = Shadowban.readAppViewParam("blacksky") else { return XCTFail("Blacksky is listed") }
        model.check(.account(actor: ChecksFixture.did), appview: blacksky)
        XCTAssertEqual(model.run.status, .loading)
        await model.waitForRun()
        XCTAssertEqual(model.run.data?.appview.name, "Blacksky")
        XCTAssertTrue(transport.urls.contains { $0.hasPrefix("https://api.blacksky.community/") })
    }
}
