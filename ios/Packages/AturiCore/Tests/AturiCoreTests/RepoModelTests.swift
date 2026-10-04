import Foundation
import XCTest
@testable import AturiCore
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

/// A transport routed by URL substring, first match wins, unknown routes
/// answer 404. Every request is recorded so tests can assert on which hosts
/// were asked (and which were not).
private final class RepoRoutedTransport: HTTPTransport, @unchecked Sendable {
    struct Reply {
        var status: Int
        var body: String
        var delayNanoseconds: UInt64 = 0
    }

    private let lock = NSLock()
    private let routes: [(pattern: String, reply: Reply)]
    private(set) var requests: [URLRequest] = []

    init(_ routes: [(String, Reply)]) {
        self.routes = routes.map { (pattern: $0.0, reply: $0.1) }
    }

    func data(for request: URLRequest) async throws -> (Data, HTTPURLResponse) {
        record(request)
        let url = request.url!
        let reply = routes.first { url.absoluteString.contains($0.pattern) }?.reply
            ?? Reply(status: 404, body: #"{"error":"NotFound"}"#)
        if reply.delayNanoseconds > 0 {
            try await Task.sleep(nanoseconds: reply.delayNanoseconds)
        }
        let response = HTTPURLResponse(
            url: url, statusCode: reply.status, httpVersion: "HTTP/1.1",
            headerFields: ["Content-Type": "application/json"]
        )!
        return (Data(reply.body.utf8), response)
    }

    private func record(_ request: URLRequest) {
        lock.lock(); defer { lock.unlock() }
        requests.append(request)
    }

    var urls: [String] {
        lock.lock(); defer { lock.unlock() }
        return requests.compactMap { $0.url?.absoluteString }
    }

    func count(containing fragment: String) -> Int {
        urls.filter { $0.contains(fragment) }.count
    }
}

@MainActor
final class RepoModelTests: XCTestCase {
    private nonisolated static let did = "did:plc:repotestaccount000001"
    private nonisolated static let viewerDid = "did:plc:viewertestaccount0002"
    private nonisolated static let handle = "alice.example"
    private nonisolated static let pds = "https://pds.example"
    private nonisolated static let headDate = Date(timeIntervalSince1970: 1_709_294_400)

    nonisolated(unsafe) private var suites: [String] = []

    override func tearDown() {
        for suite in suites {
            UserDefaults(suiteName: suite)?.removePersistentDomain(forName: suite)
        }
        suites = []
        super.tearDown()
    }

    // MARK: Fixtures

    /// Encode a TID for a date (clock id 31): 13 base32-sortable digits,
    /// most significant first.
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

    private func didDoc(_ did: String, handle: String, pds: String = RepoModelTests.pds) -> String {
        """
        {"id":"\(did)","alsoKnownAs":["at://\(handle)"],\
        "verificationMethod":[{"id":"\(did)#atproto","type":"Multikey","controller":"\(did)","publicKeyMultibase":"zQ3sh"}],\
        "service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"\(pds)"}]}
        """
    }

    private func auditLog(_ did: String) -> String {
        let services = #"{"atproto_pds":{"type":"AtprotoPersonalDataServer","endpoint":"https://pds.example"}}"#
        return """
        [{"did":"\(did)","operation":{"type":"plc_operation","prev":null,"alsoKnownAs":["at://alice.example"],\
        "services":\(services),"rotationKeys":["did:key:zA"],"verificationMethods":{"atproto":"did:key:zB"},"sig":"s1"},\
        "cid":"bafyone","nullified":false,"createdAt":"2023-05-06T01:39:13.000Z"},\
        {"did":"\(did)","operation":{"type":"plc_operation","prev":"bafyone","alsoKnownAs":["at://alice.example","at://alice.social"],\
        "services":\(services),"rotationKeys":["did:key:zA"],"verificationMethods":{"atproto":"did:key:zB"},"sig":"s2"},\
        "cid":"bafytwo","nullified":false,"createdAt":"2024-01-02T03:04:05.000Z"}]
        """
    }

    private func describeRepo(_ did: String, handle: String, collections: [String]) -> String {
        let list = collections.map { "\"\($0)\"" }.joined(separator: ",")
        return #"{"handle":"\#(handle)","did":"\#(did)","collections":[\#(list)]}"#
    }

    /// Everything a healthy did:plc repo answers, in route order: the
    /// audit log before the bare DID document (its URL contains the
    /// document's), and each describeRepo keyed by its encoded DID.
    private func healthyRoutes(delay: UInt64 = 0) -> [(String, RepoRoutedTransport.Reply)] {
        let did = Self.did
        let encoded = URIEncoding.encodeComponent(did)
        return [
            ("plc.directory/\(did)/log/audit", .init(status: 200, body: auditLog(did))),
            ("plc.directory/\(did)", .init(status: 200, body: didDoc(did, handle: Self.handle), delayNanoseconds: delay)),
            ("com.atproto.repo.describeRepo?repo=\(encoded)", .init(status: 200, body: describeRepo(did, handle: Self.handle, collections: [
                "app.bsky.feed.post", "app.bsky.actor.profile", "app.bsky.feed.like", "is.dame.now",
            ]))),
            ("com.atproto.sync.getLatestCommit", .init(status: 200, body: #"{"cid":"bafyhead","rev":"\#(makeTid(Self.headDate))"}"#)),
            ("app.bsky.actor.getProfile", .init(status: 200, body: """
                {"did":"\(did)","handle":"\(Self.handle)","displayName":" Alice ","description":"hi there",\
                "avatar":"https://cdn.example/avatar.jpg","followersCount":10,"followsCount":5,"postsCount":2}
                """)),
            ("com.atproto.repo.getRecord", .init(status: 200, body: """
                {"uri":"at://\(did)/app.bsky.actor.profile/self","cid":"bafyprofile","value":{"website":"alice.example/blog","pronouns":"she/her"}}
                """)),
            ("constellation.microcosm.blue/links/all", .init(status: 200, body: """
                {"links":{"app.bsky.graph.follow":{".subject":{"records":5,"distinct_dids":4}},\
                "app.bsky.graph.block":{".subject":{"records":3,"distinct_dids":2}}}}
                """)),
            ("api.cred.blue/api/score/alice.example", .init(status: 200, body: """
                {"handle":"alice.example","did":"\(did)","scores":{"combined":540,"bluesky":300,"atproto":240}}
                """)),
        ]
    }

    private func makeModel(
        _ transport: RepoRoutedTransport,
        input: String = RepoModelTests.did,
        preferences: PreferencesStore? = nil,
        viewerDid: String? = nil
    ) -> RepoModel {
        RepoModel(input: input, http: HTTPClient(transport: transport), preferences: preferences, viewerDid: viewerDid)
    }

    private func makePreferences() -> PreferencesStore {
        let suite = "AturiCoreTests.repoModel.\(UUID().uuidString)"
        suites.append(suite)
        return PreferencesStore(defaults: UserDefaults(suiteName: suite)!, debounce: 0)
    }

    // MARK: groupHierarchically

    func testGroupHierarchicallyBucketsMajorsAndHoistsSingletonSubgroups() async {
        let groups = CollectionGrouping.groupHierarchically([
            "app.bsky.feed.post", "app.bsky.feed.like", "app.bsky.actor.profile", "is.dame.now", "app.bsky.graph.follow",
        ], filter: "")
        XCTAssertEqual(groups.map(\.key), ["app.bsky", "is.dame"])

        let bsky = groups[0]
        // actor and graph each hold one item and are hoisted, sorted.
        XCTAssertEqual(bsky.directItems, ["app.bsky.actor.profile", "app.bsky.graph.follow"])
        XCTAssertEqual(bsky.subgroups.count, 1)
        XCTAssertEqual(bsky.subgroups[0].key, "feed")
        XCTAssertEqual(bsky.subgroups[0].fullKey, "app.bsky.feed")
        XCTAssertEqual(bsky.subgroups[0].items, ["app.bsky.feed.like", "app.bsky.feed.post"])
        XCTAssertEqual(bsky.totalCount, 4)

        let dame = groups[1]
        XCTAssertEqual(dame.directItems, ["is.dame.now"])
        XCTAssertTrue(dame.subgroups.isEmpty)
        XCTAssertEqual(dame.totalCount, 1)
    }

    func testGroupHierarchicallyDeepNsidsShareTheThirdSegment() async {
        let groups = CollectionGrouping.groupHierarchically(["app.bsky.feed.post.extra", "app.bsky.feed.post"], filter: "")
        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(groups[0].subgroups.map(\.key), ["feed"])
        XCTAssertEqual(groups[0].subgroups[0].items, ["app.bsky.feed.post", "app.bsky.feed.post.extra"])
        XCTAssertTrue(groups[0].directItems.isEmpty)
    }

    func testGroupHierarchicallyShortNsidsAreDirectLeaves() async {
        let groups = CollectionGrouping.groupHierarchically(["single", "a.b", "a.b.c"], filter: "")
        XCTAssertEqual(groups.map(\.key), ["a.b", "single"])
        XCTAssertEqual(groups[0].directItems, ["a.b", "a.b.c"])
        XCTAssertEqual(groups[1].directItems, ["single"])
    }

    func testGroupHierarchicallyFilterIsTrimmedAndCaseInsensitive() async {
        let list = ["app.bsky.feed.post", "app.bsky.feed.like", "app.bsky.actor.profile", "is.dame.now"]
        let groups = CollectionGrouping.groupHierarchically(list, filter: "  FEED ")
        XCTAssertEqual(groups.count, 1)
        XCTAssertEqual(groups[0].totalCount, 2)
        XCTAssertEqual(groups[0].subgroups[0].items, ["app.bsky.feed.like", "app.bsky.feed.post"])
        XCTAssertTrue(CollectionGrouping.groupHierarchically(list, filter: "zzz").isEmpty)
        XCTAssertTrue(CollectionGrouping.groupHierarchically([], filter: "").isEmpty)
    }

    func testGroupHierarchicallySortsMajorsSubgroupsAndItems() async {
        let groups = CollectionGrouping.groupHierarchically([
            "net.z.b.two", "net.z.b.one", "net.z.a.two", "net.z.a.one", "app.b.c", "app.a.c",
        ], filter: "")
        XCTAssertEqual(groups.map(\.key), ["app.a", "app.b", "net.z"])
        XCTAssertEqual(groups[2].subgroups.map(\.key), ["a", "b"])
        XCTAssertEqual(groups[2].subgroups[0].items, ["net.z.a.one", "net.z.a.two"])
        XCTAssertEqual(groups[2].totalCount, 4)
    }

    func testMajorKeyNamespaceCountAndPinnedKey() async {
        XCTAssertEqual(CollectionGrouping.majorKey("app.bsky.feed.post"), "app.bsky")
        XCTAssertEqual(CollectionGrouping.majorKey("single"), "single")
        XCTAssertEqual(CollectionGrouping.namespaceCount(["app.bsky.feed.post", "app.bsky.actor.profile", "is.dame.now", "x"]), 3)
        XCTAssertEqual(CollectionGrouping.pinnedKey("app.bsky.*"), "pinned:app.bsky.*")
    }

    // MARK: pinnedPartition

    func testPinnedPartitionSubsumesNarrowerGroupsAndCoveredSingles() async {
        let collections = ["app.bsky.feed.post", "app.bsky.feed.like", "app.bsky.actor.profile", "is.dame.now", "net.anisota.thing"]
        let pins = ["app.bsky.*", "app.bsky.feed.*", "is.dame.now", "net.anisota.thing", "missing.one.x", "app.bsky.feed.post"]
        let partition = CollectionGrouping.pinnedPartition(collections: collections, pinList: pins, filter: "")

        XCTAssertEqual(partition.groups.map(\.entry), ["app.bsky.*"], "app.bsky.feed.* is subsumed by app.bsky.*")
        XCTAssertEqual(partition.groups[0].prefix, "app.bsky")
        XCTAssertEqual(partition.groups[0].items, ["app.bsky.actor.profile", "app.bsky.feed.like", "app.bsky.feed.post"])
        XCTAssertEqual(partition.singles, ["is.dame.now", "net.anisota.thing"], "missing pins and group-covered pins are dropped")
        XCTAssertEqual(partition.count, 5)
        XCTAssertEqual(partition.surfaced, Set(collections))
        XCTAssertFalse(partition.isEmpty)
    }

    func testPinnedPartitionAppliesTheFilterAndDropsEmptyGroups() async {
        let collections = ["app.bsky.feed.post", "is.dame.now"]
        let partition = CollectionGrouping.pinnedPartition(collections: collections, pinList: ["app.bsky.*", "is.dame.now"], filter: " DAME ")
        XCTAssertTrue(partition.groups.isEmpty)
        XCTAssertEqual(partition.singles, ["is.dame.now"])

        let noMatch = CollectionGrouping.pinnedPartition(collections: collections, pinList: ["net.other.*"], filter: "")
        XCTAssertTrue(noMatch.isEmpty)
        XCTAssertEqual(CollectionGrouping.PinnedPartition.empty.count, 0)
    }

    // MARK: Profile header helpers

    func testNormalizeUrlAcceptsBareHostsAndRejectsNonUrls() async {
        XCTAssertEqual(RepoProfileHeader.normalizeUrl("example.com"), "https://example.com/")
        XCTAssertEqual(RepoProfileHeader.normalizeUrl("//example.com/path/"), "https://example.com/path/")
        XCTAssertEqual(RepoProfileHeader.normalizeUrl(" https://Example.com "), "https://example.com/")
        XCTAssertEqual(RepoProfileHeader.normalizeUrl("http://example.com/Blog"), "http://example.com/Blog")
        XCTAssertNil(RepoProfileHeader.normalizeUrl(nil))
        XCTAssertNil(RepoProfileHeader.normalizeUrl("   "))
        XCTAssertNil(RepoProfileHeader.normalizeUrl("not a url"))
    }

    func testPrettyHostnameDropsTheTrailingSlash() async {
        XCTAssertEqual(RepoProfileHeader.prettyHostname("https://example.com/"), "example.com")
        XCTAssertEqual(RepoProfileHeader.prettyHostname("https://example.com/blog/"), "example.com/blog")
        XCTAssertEqual(RepoProfileHeader.prettyHostname("nonsense"), "nonsense")
    }

    func testHandleAsWebsiteOnlyForDomainShapedHandles() async {
        XCTAssertEqual(RepoProfileHeader.handleAsWebsite("Dame.IS"), "https://dame.is/")
        XCTAssertNil(RepoProfileHeader.handleAsWebsite(nil))
        XCTAssertNil(RepoProfileHeader.handleAsWebsite("did:plc:abc"))
        XCTAssertNil(RepoProfileHeader.handleAsWebsite("localhost"))
        XCTAssertNil(RepoProfileHeader.handleAsWebsite("bad handle.com"))
    }

    func testProfileHeaderMergesExtrasAndPrefersTheIdentityHandle() async {
        let identity = IdentityBundle(did: Self.did, handle: "alice.example", pds: Self.pds)
        let profile = BskyProfile(did: Self.did, handle: "stale.example", displayName: "  ", description: " hi ", followersCount: 3)
        let header = RepoProfileHeader(profile: profile, identity: identity, extras: ProfileRecordExtras(website: " alice.example/blog ", pronouns: "she/her"))
        XCTAssertNil(header.displayName, "a blank display name reads as absent")
        XCTAssertEqual(header.description, "hi")
        XCTAssertEqual(header.pronouns, "she/her", "record pronouns fill in when the AppView has none")
        XCTAssertEqual(header.handle, "alice.example")
        XCTAssertEqual(header.website, "alice.example/blog")
        XCTAssertEqual(header.websiteHref, "https://alice.example/blog")
        XCTAssertEqual(header.websiteLabel, "alice.example/blog")
        XCTAssertTrue(header.hasStats)
        XCTAssertFalse(header.isEmpty)
        XCTAssertEqual(header.universalLinkPath, "/profile/alice.example")

        let bare = RepoProfileHeader(profile: BskyProfile(did: Self.did, handle: ""), identity: IdentityBundle(did: Self.did, pds: Self.pds))
        XCTAssertTrue(bare.isEmpty)
        XCTAssertNil(bare.handle)
        XCTAssertNil(bare.websiteHref)
        XCTAssertFalse(bare.hasStats)
        XCTAssertEqual(bare.universalLinkPath, "/profile/\(Self.did)")

        let extras = ProfileRecordExtras(recordValue: ["website": "x.example", "pronouns": 5])
        XCTAssertEqual(extras.website, "x.example")
        XCTAssertNil(extras.pronouns, "only string fields count")
    }

    // MARK: Status notice and facts

    func testStatusNoticeCopyPerStatus() async {
        XCTAssertEqual(RepoStatusNotice(status: "takendown").headline, "This repo has been taken down.")
        XCTAssertEqual(RepoStatusNotice(status: "suspended").headline, "This repo is suspended.")
        XCTAssertEqual(RepoStatusNotice(status: "deactivated").headline, "This account is deactivated.")
        XCTAssertEqual(RepoStatusNotice(status: "deleted").headline, "This repo has been deleted.")
        let unknown = RepoStatusNotice(status: "frozen")
        XCTAssertEqual(unknown.headline, "This repo is marked frozen.")
        XCTAssertEqual(unknown.detail, "Its host refuses record reads while the repo is in this state.")
        let missing = RepoStatusNotice(status: nil)
        XCTAssertEqual(missing.status, "inactive")
        XCTAssertEqual(missing.accessibilityLabel, "Repo status: inactive")
        XCTAssertEqual(RepoStatusNotice(status: "").status, "inactive")
    }

    func testStatusFactsNotesFollowTheLookupState() async {
        var facts = RepoStatusFacts(status: "takendown", hostname: "pds.example", handle: nil)
        XCTAssertEqual(facts.handleNote, "no at:// entry in the DID document")
        XCTAssertEqual(facts.handleLabel, "—")
        XCTAssertEqual(facts.revNote(), "checking…")
        XCTAssertEqual(facts.revLabel, "—")

        facts.handle = "alice.example"
        XCTAssertEqual(facts.handleNote, "checking…")
        XCTAssertEqual(facts.handleLabel, "@alice.example")
        facts.handleChecked = true
        XCTAssertEqual(facts.handleNote, "claimed in the DID document, could not be verified")
        facts.handleVerified = true
        XCTAssertEqual(facts.handleNote, "still resolves to this DID")
        facts.handleVerified = false
        XCTAssertEqual(facts.handleNote, "now resolves to a different DID")

        facts.revChecked = true
        XCTAssertEqual(facts.revNote(), "no rev available")
        let tid = makeTid(Self.headDate)
        facts.rev = tid
        XCTAssertEqual(facts.revDate, TID.date(from: tid))
        XCTAssertEqual(facts.revNote(now: Self.headDate.addingTimeInterval(120)), "last rev seen by the relay · 2m ago")
        XCTAssertEqual(facts.revLabel, tid)
    }

    // MARK: Audit and stats

    func testAuditEntriesAreNewestFirstWithDiffsAgainstThePreviousOperation() async throws {
        let log = try JSONDecoder().decode([PlcAuditEntry].self, from: Data(auditLog(Self.did).utf8))
        let entries = RepoAuditEntry.list(from: log)
        XCTAssertEqual(entries.map(\.id), ["bafytwo", "bafyone"])
        XCTAssertEqual(entries[0].type, "plc_operation")
        XCTAssertEqual(entries[0].changes, ["+ handle at://alice.social"])
        XCTAssertEqual(entries[1].changes, ["+ handle at://alice.example", "services updated", "keys rotated"])

        // A legacy entry without a type reads as create when it has no prev.
        let legacy = PlcAuditEntry(did: Self.did, operation: PlcOperation(prev: nil), cid: nil, createdAt: "2022-11-17T00:00:00.000Z")
        let update = PlcAuditEntry(did: Self.did, operation: PlcOperation(prev: "bafy"), cid: "", createdAt: "2022-11-18T00:00:00.000Z")
        let inferred = RepoAuditEntry.list(from: [legacy, update])
        XCTAssertEqual(inferred.map(\.type), ["update", "create"])
        XCTAssertEqual(inferred.map(\.id), ["2022-11-18T00:00:00.000Z-0", "2022-11-17T00:00:00.000Z-1"])
    }

    func testRepoStatsHintsAndCreatedAge() async {
        let tid = makeTid(Self.headDate)
        var stats = RepoStats(headRev: tid, headRevFromRelay: false)
        XCTAssertEqual(stats.lastActiveDate, TID.date(from: tid))
        XCTAssertTrue(stats.lastActiveHint.hasPrefix("Repo's most recent commit · 2024-03-01T12:00:00"))
        stats.headRevFromRelay = true
        XCTAssertTrue(stats.lastActiveHint.hasPrefix("Newest rev the relay holds for this repo · "))
        stats.headRev = nil
        XCTAssertEqual(stats.lastActiveHint, "Timestamp of the repo's most recent commit (head rev)")
        stats.inactive = "takendown"
        XCTAssertEqual(stats.lastActiveHint, "No rev available: this repo is takendown")

        stats.createdAt = "2023-05-06T01:39:13.000Z"
        let created = Formatting.isoDate("2023-05-06T01:39:13.000Z")!
        XCTAssertEqual(stats.createdDate, created)
        XCTAssertEqual(stats.createdRelativeAge(now: created.addingTimeInterval(-1)), "in the future")
        XCTAssertEqual(stats.createdRelativeAge(now: created.addingTimeInterval(3600)), "today")
        XCTAssertEqual(stats.createdRelativeAge(now: created.addingTimeInterval(86_400)), "1 day old")
        XCTAssertEqual(stats.createdRelativeAge(now: created.addingTimeInterval(12 * 86_400)), "12 days old")
        XCTAssertEqual(stats.createdRelativeAge(now: created.addingTimeInterval(70 * 86_400)), "2 months old")
        XCTAssertEqual(stats.createdRelativeAge(now: created.addingTimeInterval(400 * 86_400)), "1 yr 1 mo old")
        XCTAssertEqual(stats.createdRelativeAge(now: created.addingTimeInterval(730 * 86_400)), "2 years old")
        XCTAssertNil(RepoStats().createdRelativeAge())
    }

    func testExploreErrorTextMirrorsTheWebMessages() async {
        let http = HTTPError(status: 400, body: String(repeating: "x", count: 300), url: URL(string: "https://pds.example/xrpc/a")!)
        let text = ExploreErrorText.describe(http)
        XCTAssertTrue(text.hasPrefix("HTTP 400 for https://pds.example/xrpc/a :: "))
        XCTAssertEqual(text.count, "HTTP 400 for https://pds.example/xrpc/a :: ".count + 200)
        XCTAssertEqual(ExploreErrorText.describe(IdentityResolverError.unresolvable("nobody")), "Could not resolve nobody")
        XCTAssertEqual(ExploreErrorText.describe(IdentityResolverError.emptyInput), "resolveIdentifier: empty input")
        XCTAssertEqual(ExploreErrorText.describe(PDSClientError.invalidBase("bad host")), "Not a valid PDS host: bad host")
        XCTAssertEqual(ExploreErrorText.describe(HTTPFailure.redirectRefused(URL(string: "https://evil.example/x")!)), "Refused a redirect to evil.example")
        XCTAssertEqual(ExploreErrorText.describe(CancellationError()), "Cancelled")
    }

    // MARK: Loading a healthy repo

    func testLoadFansOutEveryReadForAHealthyPlcRepo() async {
        let transport = RepoRoutedTransport(healthyRoutes())
        let model = makeModel(transport)
        XCTAssertNil(model.stats)
        await model.load().value

        let identity = model.identity.value
        XCTAssertEqual(identity?.did, Self.did)
        XCTAssertEqual(identity?.handle, Self.handle)
        XCTAssertEqual(identity?.pds, Self.pds)
        XCTAssertNil(identity?.repoStatus)
        XCTAssertNil(model.statusNotice)
        XCTAssertNil(model.statusFacts)
        XCTAssertNil(model.notFoundMessage)
        XCTAssertTrue(model.isPlc)
        XCTAssertNil(model.plcUnavailableMessage)
        XCTAssertEqual(model.sharePath, "/profile/alice.example")
        XCTAssertEqual(model.repoSegment, "alice.example")
        XCTAssertEqual(model.pdsHost, "pds.example")

        let header = model.profile.value ?? nil
        XCTAssertEqual(header?.displayName, "Alice")
        XCTAssertEqual(header?.pronouns, "she/her")
        XCTAssertEqual(header?.websiteHref, "https://alice.example/blog")
        XCTAssertEqual(header?.profile.followersCount, 10)

        XCTAssertEqual(model.collections.value, ["app.bsky.actor.profile", "app.bsky.feed.like", "app.bsky.feed.post", "is.dame.now"])
        XCTAssertEqual(model.groups.map(\.key), ["app.bsky", "is.dame"])
        XCTAssertEqual(model.collectionsStatusLabel, "4")
        XCTAssertNil(model.collectionsEmptyMessage)
        XCTAssertNil(model.collectionsInactiveNotice)

        XCTAssertEqual(model.headRev.value??.rev, makeTid(Self.headDate))
        XCTAssertEqual(model.headRev.value??.fromRelay, false)
        XCTAssertEqual(model.plcDocument.value??.id, Self.did)
        XCTAssertEqual(model.auditLog.value?.map(\.id), ["bafytwo", "bafyone"])
        XCTAssertEqual(model.backlinkSources.value?.map(\.count), [5, 3])
        XCTAssertEqual(model.credBlue.value??.scores.combined, 540)
        XCTAssertEqual(model.credBlueProfileURL?.absoluteString, "https://cred.blue/alice.example")

        let stats = model.stats
        XCTAssertEqual(stats?.namespaces, 2)
        XCTAssertEqual(stats?.collections, 4)
        XCTAssertEqual(stats?.auditOps, 2)
        XCTAssertEqual(stats?.createdAt, "2023-05-06T01:39:13.000Z")
        XCTAssertEqual(stats?.backlinks, 8)
        XCTAssertEqual(stats?.headRev, makeTid(Self.headDate))
        XCTAssertEqual(stats?.headRevFromRelay, false)
        XCTAssertNil(stats?.inactive)

        XCTAssertEqual(transport.count(containing: "relay1.us-east.bsky.network"), 0, "a healthy repo never asks the relay")
        XCTAssertEqual(transport.count(containing: "resolveHandle"), 0, "a DID input needs no handle resolution")
    }

    func testDegradedReadsLeaveTheRestOfThePageStanding() async {
        var routes = healthyRoutes()
        routes.removeAll { $0.0.contains("links/all") || $0.0.contains("cred.blue") || $0.0.contains("getProfile") || $0.0.contains("getLatestCommit") }
        let model = makeModel(RepoRoutedTransport(routes))
        await model.load().value

        XCTAssertNotNil(model.identity.value)
        XCTAssertEqual(model.backlinkSources.errorMessage, "Backlinks unavailable (constellation).")
        XCTAssertNil(model.credBlue.value ?? nil)
        XCTAssertNil(model.profile.value ?? nil, "no AppView profile means no card")
        XCTAssertNil(model.headRev.value ?? nil)
        XCTAssertEqual(model.stats?.collections, 4)
        XCTAssertNil(model.stats?.backlinks)
        XCTAssertNil(model.stats?.headRev)
        XCTAssertEqual(model.stats?.lastActiveHint, "Timestamp of the repo's most recent commit (head rev)")
    }

    func testInactiveRepoTakesTheRevFromTheRelayAndVerifiesTheHandle() async {
        let did = Self.did
        let relayTid = makeTid(Self.headDate.addingTimeInterval(-86_400))
        var routes = healthyRoutes()
        routes.removeAll { $0.0.contains("describeRepo") || $0.0.contains("getLatestCommit") }
        routes.append(("com.atproto.repo.describeRepo", .init(status: 400, body: #"{"error":"RepoTakendown","message":"Repo has been takendown"}"#)))
        routes.append(("pds.example/xrpc/com.atproto.sync.getRepoStatus", .init(status: 200, body: #"{"did":"\#(did)","active":false,"status":"takendown"}"#)))
        routes.append(("relay1.us-east.bsky.network/xrpc/com.atproto.sync.getRepoStatus", .init(status: 200, body: #"{"did":"\#(did)","active":false,"status":"takendown","rev":"\#(relayTid)"}"#)))
        routes.append(("public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle", .init(status: 200, body: #"{"did":"\#(did)"}"#)))
        let model = makeModel(RepoRoutedTransport(routes))
        await model.load().value

        XCTAssertEqual(model.identity.value?.repoStatus?.status, "takendown")
        XCTAssertEqual(model.identity.value?.handle, Self.handle, "the DID document still carries the handle")
        XCTAssertEqual(model.statusNotice?.headline, "This repo has been taken down.")
        XCTAssertEqual(model.statusNotice?.status, "takendown")

        let facts = model.statusFacts
        XCTAssertEqual(facts?.hostname, "pds.example")
        XCTAssertEqual(facts?.status, "takendown")
        XCTAssertEqual(facts?.revChecked, true)
        XCTAssertEqual(facts?.rev, relayTid)
        XCTAssertEqual(facts?.handleChecked, true)
        XCTAssertEqual(facts?.handleVerified, true)

        XCTAssertTrue(model.collections.errorMessage?.contains("RepoTakendown") ?? false)
        XCTAssertEqual(model.collectionsInactiveNotice, "No collections to list: this repo is takendown and its PDS refuses record reads.")
        XCTAssertTrue(model.groups.isEmpty)
        XCTAssertNil(model.collectionsStatusLabel)

        XCTAssertEqual(model.headRev.value??.rev, relayTid)
        XCTAssertEqual(model.headRev.value??.fromRelay, true)
        let stats = model.stats
        XCTAssertNil(stats?.namespaces)
        XCTAssertNil(stats?.collections)
        XCTAssertEqual(stats?.inactive, "takendown")
        XCTAssertEqual(stats?.headRevFromRelay, true)
        XCTAssertEqual(stats?.auditOps, 2, "the PLC log lives outside the PDS")
        XCTAssertEqual(stats?.backlinks, 8)
    }

    func testInactiveRepoWhoseHandleMovedIsFlagged() async {
        let did = Self.did
        var routes = healthyRoutes()
        routes.removeAll { $0.0.contains("describeRepo") || $0.0.contains("getLatestCommit") }
        routes.append(("com.atproto.repo.describeRepo", .init(status: 400, body: #"{"error":"RepoDeactivated"}"#)))
        routes.append(("pds.example/xrpc/com.atproto.sync.getRepoStatus", .init(status: 200, body: #"{"did":"\#(did)","active":false,"status":"deactivated"}"#)))
        routes.append(("public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle", .init(status: 200, body: #"{"did":"did:plc:somebodyelse0000000001"}"#)))
        let model = makeModel(RepoRoutedTransport(routes))
        await model.load().value

        XCTAssertEqual(model.statusFacts?.handleVerified, false)
        XCTAssertEqual(model.statusFacts?.handleNote, "now resolves to a different DID")
        XCTAssertEqual(model.statusFacts?.revChecked, true)
        XCTAssertNil(model.statusFacts?.rev, "the relay answered 404")
        XCTAssertEqual(model.statusFacts?.revNote(), "no rev available")
        XCTAssertNil(model.headRev.value ?? nil)
    }

    func testUnresolvableInputFailsIdentityOnly() async {
        let transport = RepoRoutedTransport([
            ("com.atproto.identity.resolveHandle", .init(status: 400, body: #"{"error":"InvalidRequest"}"#)),
        ])
        let model = makeModel(transport, input: "nobody.example")
        await model.load().value
        XCTAssertEqual(model.identity.errorMessage, "Could not resolve nobody.example")
        XCTAssertEqual(
            model.notFoundMessage,
            "We tried to resolve \"nobody.example\" and the AT Protocol resolver returned: Could not resolve nobody.example. Try a handle, DID, or AT URI below."
        )
        XCTAssertNil(model.stats)
        XCTAssertNil(model.did)
        XCTAssertTrue(model.groups.isEmpty)
        if case .idle = model.collections {} else { XCTFail("collections never start without an identity") }
    }

    func testDidWebSkipsThePlcDirectory() async {
        let did = "did:web:web.example"
        let transport = RepoRoutedTransport([
            ("web.example/.well-known/did.json", .init(status: 200, body: didDoc(did, handle: "web.example"))),
            ("com.atproto.repo.describeRepo", .init(status: 200, body: describeRepo(did, handle: "web.example", collections: ["a.b.c"]))),
        ])
        let model = makeModel(transport, input: did)
        await model.load().value

        XCTAssertFalse(model.isPlc)
        XCTAssertEqual(model.plcUnavailableMessage, "did:web:web.example isn’t a did:plc:. PLC directory data isn’t available for this method.")
        XCTAssertNil(model.plcDocument.value ?? nil)
        XCTAssertEqual(model.auditLog.value?.count, 0)
        XCTAssertNil(model.stats?.auditOps)
        XCTAssertNil(model.stats?.createdAt)
        XCTAssertEqual(model.stats?.collections, 1)
        XCTAssertEqual(transport.count(containing: "plc.directory"), 0)
    }

    // MARK: Lexicons tab state

    func testPinsAreLocalFirstAndShapeTheGroupedList() async {
        let preferences = makePreferences()
        let model = makeModel(RepoRoutedTransport(healthyRoutes()), preferences: preferences)
        await model.load().value

        XCTAssertFalse(model.isSignedIn)
        XCTAssertTrue(model.pinsVisibleHere)
        XCTAssertEqual(model.pinTarget, .mine)
        XCTAssertTrue(model.pinned.isEmpty)
        XCTAssertEqual(model.shownCount, 4)

        model.togglePin("is.dame.now")
        XCTAssertTrue(model.isPinned("is.dame.now"))
        XCTAssertEqual(preferences.prefs.pinnedLexicons, ["is.dame.now"])
        XCTAssertEqual(model.pinned.singles, ["is.dame.now"])
        XCTAssertEqual(model.groups.map(\.key), ["app.bsky"], "a surfaced collection leaves the main list")
        XCTAssertEqual(model.shownCount, 4)

        model.toggleGroupPin(prefix: "app.bsky.feed")
        XCTAssertTrue(model.isGroupPinned(prefix: "app.bsky.feed"))
        XCTAssertEqual(model.pinned.groups.map(\.entry), ["app.bsky.feed.*"])
        XCTAssertEqual(model.pinned.groups[0].items, ["app.bsky.feed.like", "app.bsky.feed.post"])
        XCTAssertEqual(model.groups[0].directItems, ["app.bsky.actor.profile"])
        XCTAssertEqual(model.allGroupKeys, ["pinned:app.bsky.feed.*", "app.bsky"])

        model.togglePin("is.dame.now")
        XCTAssertFalse(model.isPinned("is.dame.now"))
        XCTAssertEqual(model.groups.map(\.key), ["app.bsky", "is.dame"])
    }

    func testOpenStateFallsBackToThePreferenceAndExpandAllTargetsVisibleKeys() async {
        let preferences = makePreferences()
        preferences.update { $0.collectionGroupsCollapsedByDefault = true }
        let model = makeModel(RepoRoutedTransport(healthyRoutes()), preferences: preferences)
        await model.load().value

        XCTAssertFalse(model.isOpen("app.bsky"))
        XCTAssertFalse(model.anyOpen)
        model.toggle("app.bsky")
        XCTAssertTrue(model.isOpen("app.bsky"))
        XCTAssertTrue(model.anyOpen)
        model.toggleAllOpen()
        XCTAssertFalse(model.anyOpen)
        XCTAssertEqual(model.openOverrides["app.bsky.feed"], false)
        model.setAllOpen(true)
        XCTAssertTrue(model.allGroupKeys.allSatisfy { model.isOpen($0) })
        XCTAssertEqual(Set(model.openOverrides.keys), Set(["app.bsky", "app.bsky.feed", "is.dame"]))
    }

    func testFilterNarrowsAndReportsTheCount() async {
        let model = makeModel(RepoRoutedTransport(healthyRoutes()))
        await model.load().value

        model.filter = " feed "
        XCTAssertTrue(model.narrowed)
        XCTAssertEqual(model.shownCount, 2)
        XCTAssertEqual(model.collectionsStatusLabel, "2/4")
        XCTAssertNil(model.collectionsEmptyMessage)

        model.filter = "nothing"
        XCTAssertEqual(model.collectionsEmptyMessage, "No collections match nothing.")
        XCTAssertEqual(model.collectionsStatusLabel, "0/4")
        XCTAssertTrue(model.allGroupKeys.isEmpty)
    }

    func testEmptyRepoSaysSo() async {
        var routes = healthyRoutes()
        routes.removeAll { $0.0.contains("describeRepo") }
        routes.append(("com.atproto.repo.describeRepo", .init(status: 200, body: describeRepo(Self.did, handle: Self.handle, collections: []))))
        let model = makeModel(RepoRoutedTransport(routes))
        await model.load().value
        XCTAssertEqual(model.collectionsEmptyMessage, "No collections on this repo.")
        XCTAssertEqual(model.stats?.namespaces, 0)
        XCTAssertEqual(model.collectionsStatusLabel, "0")
    }

    func testViewerCollectionsDriveTheCommonFilter() async {
        let viewer = Self.viewerDid
        var routes = healthyRoutes()
        routes.append(("plc.directory/\(viewer)", .init(status: 200, body: didDoc(viewer, handle: "viewer.example"))))
        routes.append((
            "com.atproto.repo.describeRepo?repo=\(URIEncoding.encodeComponent(viewer))",
            .init(status: 200, body: describeRepo(viewer, handle: "viewer.example", collections: ["app.bsky.feed.post", "net.viewer.only"]))
        ))
        let preferences = makePreferences()
        let model = makeModel(RepoRoutedTransport(routes), preferences: preferences, viewerDid: viewer)
        await model.load().value
        // The viewer lookup is its own task; give it the same await.
        await model.setViewer(did: viewer)?.value

        XCTAssertTrue(model.isSignedIn)
        XCTAssertFalse(model.isOwnRepo)
        XCTAssertEqual(model.viewerCollections, Set(["app.bsky.feed.post", "net.viewer.only"]))
        XCTAssertTrue(model.showCommonFilter)

        model.commonFilter = .mutual
        XCTAssertTrue(model.narrowed)
        XCTAssertEqual(model.groupSource, ["app.bsky.feed.post"])
        XCTAssertEqual(model.collectionsStatusLabel, "1/4")
        model.commonFilter = .notMine
        XCTAssertEqual(model.groupSource, ["app.bsky.actor.profile", "app.bsky.feed.like", "is.dame.now"])

        model.filter = "zzz"
        model.commonFilter = .mutual
        XCTAssertEqual(model.collectionsEmptyMessage, "No collections in common with this repo.")
        model.commonFilter = .notMine
        XCTAssertEqual(model.collectionsEmptyMessage, "You already have every collection this repo has.")

        // Signed in with `own` scope on someone else's repo: pins hide.
        XCTAssertEqual(preferences.prefs.pinScope, .own)
        XCTAssertFalse(model.pinsVisibleHere)
        preferences.update { $0.setPinScope(.split) }
        XCTAssertTrue(model.pinsVisibleHere)
        XCTAssertEqual(model.pinTarget, .others)
        model.togglePin("is.dame.now")
        XCTAssertEqual(preferences.prefs.pinnedLexiconsOthers, ["is.dame.now"])
        XCTAssertEqual(model.activePinList, ["is.dame.now"])
        XCTAssertTrue(preferences.prefs.pinnedLexicons.isEmpty)
    }

    func testOwnRepoSkipsTheViewerLookupAndHidesTheCommonFilter() async {
        let transport = RepoRoutedTransport(healthyRoutes())
        let preferences = makePreferences()
        let model = makeModel(transport, preferences: preferences, viewerDid: Self.did)
        await model.load().value

        XCTAssertTrue(model.isOwnRepo)
        XCTAssertNil(model.viewerCollections)
        XCTAssertFalse(model.showCommonFilter)
        XCTAssertTrue(model.pinsVisibleHere)
        XCTAssertEqual(model.pinTarget, .mine)
        // Identity resolution and the Lexicons tab each describe the repo,
        // as on the web; the own-repo viewer adds no third call.
        XCTAssertEqual(transport.count(containing: "describeRepo"), 2)

        XCTAssertNil(model.setViewer(did: nil))
        XCTAssertFalse(model.isSignedIn)
        XCTAssertFalse(model.isOwnRepo)
    }

    // MARK: Cancellation

    func testReloadSupersedesAnInFlightLoad() async {
        let transport = RepoRoutedTransport(healthyRoutes(delay: 40_000_000))
        let model = makeModel(transport)
        let first = model.load()
        let second = model.load()
        XCTAssertTrue(first.isCancelled)
        await second.value
        await first.value
        XCTAssertEqual(model.identity.value?.did, Self.did)
        XCTAssertEqual(model.collections.value?.count, 4)
        XCTAssertNotNil(model.stats)
    }

    func testCancelLeavesTheScreenInItsLoadingState() async {
        let transport = RepoRoutedTransport(healthyRoutes(delay: 40_000_000))
        let model = makeModel(transport)
        let task = model.load()
        model.cancel()
        await task.value
        XCTAssertTrue(model.identity.isLoading)
        XCTAssertNil(model.identity.value)
        XCTAssertNil(model.identity.errorMessage)
        XCTAssertNil(model.stats)
    }
}
