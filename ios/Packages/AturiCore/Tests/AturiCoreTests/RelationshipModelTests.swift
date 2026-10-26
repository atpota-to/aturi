import Foundation
import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// Substring-routed transport for the viewer's identity lookups.
private final class RelationshipRoutedTransport: HTTPTransport, @unchecked Sendable {
    private let lock = NSLock()
    private let routes: [(pattern: String, status: Int, body: String)]
    private(set) var requests: [URLRequest] = []

    init(_ routes: [(String, Int, String)]) {
        self.routes = routes.map { (pattern: $0.0, status: $0.1, body: $0.2) }
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        record(request)
        let url = request.url!
        let match = routes.first { url.absoluteString.contains($0.pattern) }
        let status = match?.status ?? 404
        let body = match?.body ?? #"{"error":"NotFound"}"#
        let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1", headerFields: ["Content-Type": "application/json"])!
        return (Data(body.utf8), response)
    }

    private func record(_ request: URLRequest) {
        lock.lock(); defer { lock.unlock() }
        requests.append(request)
    }
}

@MainActor
final class RelationshipModelTests: XCTestCase {
    private nonisolated static let targetDid = "did:plc:relationtargetacct01"
    private nonisolated static let viewerDid = "did:plc:relationviewer000001"

    private let target = IdentityBundle(did: RelationshipModelTests.targetDid, handle: "them.example", pds: "https://pds.example")

    /// Encode a TID for a date (clock id 31).
    private func makeTid(_ date: Date) -> String {
        let micros = UInt64(date.timeIntervalSince1970 * 1_000_000)
        var value = (micros << 10) | 0x1F
        let alphabet = Array(TID.alphabet)
        var chars: [Character] = []
        for _ in 0..<13 {
            chars.append(alphabet[Int(value & 0x1F)])
            value >>= 5
        }
        return String(chars.reversed())
    }

    private func viewerResolver(pds: String = "https://pds.example") -> (IdentityResolver, RelationshipRoutedTransport) {
        let transport = RelationshipRoutedTransport([
            ("plc.directory/\(Self.viewerDid)", 200, """
                {"id":"\(Self.viewerDid)","alsoKnownAs":["at://me.example"],\
                "service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"\(pds)"}]}
                """),
            ("com.atproto.repo.describeRepo", 200, #"{"handle":"me.example","did":"\#(Self.viewerDid)","collections":[]}"#),
        ])
        return (IdentityResolver(http: HTTPClient(transport: transport)), transport)
    }

    private func profile(following: String? = nil, followedBy: String? = nil, mutuals: Int? = nil) -> BskyProfile {
        var json: [String: JSONValue] = ["did": .string(Self.targetDid), "handle": "them.example"]
        var viewer: [String: JSONValue] = [:]
        if let following { viewer["following"] = .string(following) }
        if let followedBy { viewer["followedBy"] = .string(followedBy) }
        json["viewer"] = .object(viewer)
        if let mutuals { json["knownFollowers"] = .object(["count": .number(Double(mutuals)), "followers": .array([])]) }
        return BskyProfile(json: .object(json))!
    }

    // MARK: Gating

    func testAppliesOnlyToASignedInVisitorOnSomeoneElsesRepo() {
        XCTAssertFalse(RelationshipModel.applies(viewerDid: nil, targetDid: Self.targetDid))
        XCTAssertFalse(RelationshipModel.applies(viewerDid: "", targetDid: Self.targetDid))
        XCTAssertFalse(RelationshipModel.applies(viewerDid: Self.targetDid, targetDid: Self.targetDid))
        XCTAssertTrue(RelationshipModel.applies(viewerDid: Self.viewerDid, targetDid: Self.targetDid))
    }

    func testTitleUsesTheHandleOrACutDid() {
        XCTAssertEqual(RelationshipModel.targetLabel(target), "@them.example")
        let bare = IdentityBundle(did: "did:plc:abcdefghijklmnopqrstuvwx", pds: "https://pds.example")
        XCTAssertEqual(RelationshipModel.targetLabel(bare), "did:plc:abcdefghijklmnop\u{2026}")
        XCTAssertEqual(RelationshipModel.targetLabel(IdentityBundle(did: "did:web:short", pds: "")), "did:web:short")
        let (resolver, _) = viewerResolver()
        let model = RelationshipModel(target: target, viewerDid: Self.viewerDid, profileSource: { _ in nil }, resolver: resolver)
        XCTAssertEqual(model.title, "You + @them.example")
    }

    // MARK: Loading

    func testLoadFansOutToTheProfileAndTheViewersPds() async {
        let (resolver, transport) = viewerResolver()
        let asked = Asked()
        let model = RelationshipModel(
            target: target,
            viewerDid: Self.viewerDid,
            profileSource: { actor in
                await asked.record(actor)
                return nil
            },
            resolver: resolver
        )
        XCTAssertFalse(model.isLoaded)
        await model.loadAndWait()
        XCTAssertTrue(model.isLoaded)
        let actors = await asked.actors
        XCTAssertEqual(actors, [Self.targetDid], "the profile read names the target")
        XCTAssertEqual(model.viewerPds.value ?? nil, "https://pds.example")
        XCTAssertTrue(transport.requests.contains { $0.url!.absoluteString.contains("plc.directory/\(Self.viewerDid)") })
        XCTAssertEqual(model.samePdsHost, "pds.example")
        XCTAssertFalse(model.youFollow)
        XCTAssertFalse(model.followsYou)
        XCTAssertEqual(model.mutualCount, 0)
        XCTAssertTrue(model.hasSignals, "a shared host is a signal on its own")
        XCTAssertEqual(model.chips.map(\.id), ["pds"])
        XCTAssertEqual(model.chips[0].label, "Same PDS \u{00B7} pds.example")
    }

    func testAFailedProfileReadStillLoadsTheOtherSignals() async {
        let (resolver, _) = viewerResolver(pds: "https://other.example")
        let model = RelationshipModel(
            target: target,
            viewerDid: Self.viewerDid,
            profileSource: { _ in throw HTTPError(status: 500, body: "boom", url: URL(string: "https://pds.example")!) },
            resolver: resolver
        )
        await model.loadAndWait()
        XCTAssertTrue(model.isLoaded)
        XCTAssertNil(model.profile.value ?? nil)
        XCTAssertNil(model.samePdsHost)
        XCTAssertFalse(model.hasSignals)
        XCTAssertTrue(model.chips.isEmpty)
    }

    func testAnUnresolvableViewerLeavesThePdsChipOut() async {
        let transport = RelationshipRoutedTransport([])
        let resolver = IdentityResolver(http: HTTPClient(transport: transport))
        let model = RelationshipModel(
            target: target,
            viewerDid: Self.viewerDid,
            profileSource: { [profile = profile(followedBy: "at://x/app.bsky.graph.follow/self")] _ in profile },
            resolver: resolver
        )
        await model.loadAndWait()
        XCTAssertTrue(model.isLoaded)
        XCTAssertNil(model.viewerPds.value ?? nil)
        XCTAssertNil(model.samePdsHost)
        XCTAssertTrue(model.followsYou)
        XCTAssertNil(model.theyFollowedOn, "a non-TID rkey carries no date")
        XCTAssertEqual(model.chips.map(\.id), ["follows-you"])
        XCTAssertNil(model.chips[0].note)
    }

    // MARK: Follow chips

    func testMutualFollowCollapsesToOneAccentChipWithTheSinceDate() async {
        let (resolver, _) = viewerResolver(pds: "https://other.example")
        let followedAt = Date(timeIntervalSince1970: 1_710_374_400)
        let tid = makeTid(followedAt)
        let model = RelationshipModel(
            target: target,
            viewerDid: Self.viewerDid,
            profileSource: { [profile = profile(following: "at://\(Self.viewerDid)/app.bsky.graph.follow/\(tid)", followedBy: "at://\(Self.targetDid)/app.bsky.graph.follow/\(tid)", mutuals: 1)] _ in profile },
            resolver: resolver
        )
        await model.loadAndWait()
        XCTAssertTrue(model.isMutualFollow)
        XCTAssertEqual(model.youFollowedOn?.timeIntervalSince1970 ?? 0, followedAt.timeIntervalSince1970, accuracy: 0.001)
        XCTAssertEqual(model.chips.map(\.id), ["mutual-follow", "mutuals"])
        XCTAssertEqual(model.chips[0].tone, .accent)
        XCTAssertEqual(model.chips[0].note, "\u{00B7} since \(RelationshipModel.formatShortDate(followedAt))")
        XCTAssertEqual(model.chips[1].label, "1 mutual")
        XCTAssertEqual(model.chips[1].destination, .identityTab)
    }

    func testOneWayFollowsGetTheirOwnChips() async {
        let (resolver, _) = viewerResolver(pds: "https://other.example")
        let model = RelationshipModel(
            target: target,
            viewerDid: Self.viewerDid,
            profileSource: { [profile = profile(following: "at://\(Self.viewerDid)/app.bsky.graph.follow/self", mutuals: 1234)] _ in profile },
            resolver: resolver
        )
        await model.loadAndWait()
        XCTAssertTrue(model.youFollow)
        XCTAssertFalse(model.followsYou)
        XCTAssertEqual(model.chips.map(\.id), ["you-follow", "mutuals"])
        XCTAssertEqual(model.chips[0].label, "You follow them")
        XCTAssertEqual(model.chips[1].label, "1,234 mutuals")
    }

    // MARK: Lexicons in common

    func testInCommonCountsTheIntersectionOnceBothSetsAreKnown() async {
        let (resolver, _) = viewerResolver(pds: "https://other.example")
        let model = RelationshipModel(target: target, viewerDid: Self.viewerDid, profileSource: { _ in nil }, resolver: resolver)
        await model.loadAndWait()
        XCTAssertEqual(model.inCommonCount, 0)
        model.targetCollections = ["app.bsky.feed.post", "app.bsky.actor.profile", "is.dame.now"]
        XCTAssertEqual(model.inCommonCount, 0, "nothing until the viewer's set lands")
        model.viewerCollections = ["app.bsky.feed.post", "app.bsky.actor.profile", "net.anisota.entry"]
        XCTAssertEqual(model.inCommonCount, 2)
        XCTAssertEqual(model.chips.map(\.id), ["in-common"])
        XCTAssertEqual(model.chips[0].label, "2 lexicons in common")
        XCTAssertEqual(model.chips[0].destination, .collectionsTab)
        model.viewerCollections = ["is.dame.now"]
        XCTAssertEqual(model.chips[0].label, "1 lexicon in common")
    }

    // MARK: Helpers

    func testDateFromFollowUriDecodesOnlyATidRkey() {
        let date = Date(timeIntervalSince1970: 1_709_294_400)
        let tid = makeTid(date)
        XCTAssertEqual(RelationshipModel.dateFromFollowUri("at://did:plc:x/app.bsky.graph.follow/\(tid)")?.timeIntervalSince1970 ?? 0, date.timeIntervalSince1970, accuracy: 0.001)
        XCTAssertNil(RelationshipModel.dateFromFollowUri(nil))
        XCTAssertNil(RelationshipModel.dateFromFollowUri(""))
        XCTAssertNil(RelationshipModel.dateFromFollowUri("at://did:plc:x/app.bsky.graph.follow/self"))
        XCTAssertNil(RelationshipModel.dateFromFollowUri("at://did:plc:x/app.bsky.graph.follow/notatid00000x"), "13 chars outside the alphabet")
    }

    func testSystemImagesCoverEveryChip() {
        for id in ["pds", "mutual-follow", "you-follow", "follows-you", "mutuals", "in-common"] {
            XCTAssertNotEqual(RelationshipModel.systemImage(for: id), "circle", id)
        }
        XCTAssertEqual(RelationshipModel.systemImage(for: "unknown"), "circle")
    }
}

/// Records which actors the profile source was asked about.
private actor Asked {
    private(set) var actors: [String] = []

    func record(_ actor: String) {
        actors.append(actor)
    }
}
