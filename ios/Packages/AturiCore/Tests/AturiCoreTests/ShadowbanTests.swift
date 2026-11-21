import Foundation
import XCTest
@testable import AturiCore

/// A TID for a time, as `TID.fromTime(ms * 1000, clock)` spells it in the
/// web's tests: microseconds shifted over a ten-bit clock id, in thirteen
/// base32-sortable digits.
func toolsTid(ms: Int64, clock: Int = 0) -> String {
    let alphabet = Array(TID.alphabet)
    let micros = UInt64(ms) * 1000
    let value = (micros << 10) | UInt64(clock & 0x3FF)
    var out = ""
    for index in (0..<13).reversed() {
        let digit = (value >> UInt64(index * 5)) & 31
        out.append(alphabet[Int(digit)])
    }
    return out
}

/// A date from milliseconds, rounded the way `TID.date(from:)` rounds.
func toolsDate(ms: Int64) -> Date {
    Date(timeIntervalSince1970: TimeInterval(ms) / 1000)
}

/// Port of `src/lib/tools/__tests__/shadowban.test.ts`.
final class ShadowbanTests: XCTestCase {
    private typealias Evidence = Shadowban.Evidence
    private typealias RepoPost = Shadowban.RepoPost
    private typealias ReplyProbe = Shadowban.ReplyProbe
    private typealias ShadowbanCheck = Shadowban.ShadowbanCheck

    private static let did = "did:plc:aaaaaaaaaaaaaaaaaaaaaaaa"
    private static let other = "did:plc:bbbbbbbbbbbbbbbbbbbbbbbb"
    /// 2026-11-13T12:00:00Z, `Date.UTC(2026, 10, 13, 12, 0, 0)`.
    private static let nowMs: Int64 = 1_794_571_200_000
    private static let hourMs: Int64 = 60 * 60_000
    private static let indexGraceMs = Int64(Shadowban.indexGrace * 1000)
    private static let searchGraceMs = Int64(Shadowban.searchGrace * 1000)

    private var now: Date { toolsDate(ms: Self.nowMs) }

    private func post(_ ageMs: Int64, reply: Shadowban.ReplyRef? = nil, clock: Int = 0) -> RepoPost {
        let rkey = toolsTid(ms: Self.nowMs - ageMs, clock: clock)
        return RepoPost(
            uri: "at://\(Self.did)/app.bsky.feed.post/\(rkey)",
            rkey: rkey,
            text: "hello",
            writtenAt: toolsDate(ms: Self.nowMs - ageMs),
            reply: reply
        )
    }

    private func otherPost(_ n: Int64, author: String = ShadowbanTests.other) -> String {
        "at://\(author)/app.bsky.feed.post/\(toolsTid(ms: Self.nowMs - 10 * Self.hourMs - n))"
    }

    private func ref(_ uri: String) -> Shadowban.ReplyRef {
        Shadowban.ReplyRef(parent: uri, root: uri)
    }

    private func status(_ checks: [ShadowbanCheck], _ id: Shadowban.CheckID) -> Shadowban.CheckStatus? {
        checks.first(where: { $0.id == id })?.status
    }

    private func json(_ text: String) -> JSONValue {
        try! JSONValue.parse(Data(text.utf8))
    }

    /// An account the AppView shows in full: every post returned, search finding it.
    private func cleanAccount() -> Evidence {
        let posts = [post(2 * Self.hourMs), post(3 * Self.hourMs, reply: ref(otherPost(1))), post(5 * Self.hourMs)]
        return Evidence(
            target: .account(actor: "alice.example.com"),
            appview: Shadowban.defaultAppView,
            identity: Shadowban.Identity(did: Self.did, handle: "alice.example.com", pds: "https://pds.example.com"),
            repo: .active,
            profile: .found(Shadowban.FoundProfile(handle: "alice.example.com", displayName: "Alice", avatar: nil, labels: [])),
            posts: .ok(posts),
            shown: .ok(posts.map { $0.uri }),
            replies: .ok([ReplyProbe(uri: posts[1].uri, parent: otherPost(1), root: otherPost(1), thread: .shown)]),
            actorSearch: .ok(Shadowban.ActorSearch(inSearch: true, inTypeahead: true)),
            postSearch: .ok(posts.map { $0.uri }),
            done: true
        )
    }

    // MARK: Which AppView

    func testReadAppViewParamDefaultsToBlueskyAndReadsListedIdsInAnyCase() {
        XCTAssertEqual(Shadowban.readAppViewParam(""), .ok(Shadowban.defaultAppView))
        XCTAssertEqual(Shadowban.defaultAppView.origin, "https://api.bsky.app")
        XCTAssertEqual(Shadowban.readAppViewParam("Blacksky"), .ok(Shadowban.appViews[1]))
    }

    func testReadAppViewParamMapsAListedAppViewsHostBackToItsEntry() {
        XCTAssertEqual(Shadowban.readAppViewParam("api.bsky.app"), .ok(Shadowban.defaultAppView))
        XCTAssertEqual(Shadowban.readAppViewParam("https://api.blacksky.community/"), .ok(Shadowban.appViews[1]))
    }

    func testReadAppViewParamTakesAnyOtherHostAndItsParameterReadsBackToTheSamePlace() {
        let typed = Shadowban.readAppViewParam("https://appview.example.com/xrpc")
        let expected = Shadowban.AppView(
            param: "appview.example.com",
            name: "appview.example.com",
            origin: "https://appview.example.com",
            listed: false
        )
        XCTAssertEqual(typed, .ok(expected))
        XCTAssertEqual(Shadowban.readAppViewParam(expected.param), typed)

        let local = Shadowban.readAppViewParam("http://localhost:2584")
        guard case .ok(let localView) = local else {
            return XCTFail("a local AppView over plain http is allowed")
        }
        XCTAssertEqual(localView.origin, "http://localhost:2584")
        XCTAssertEqual(Shadowban.readAppViewParam(localView.param), local)
    }

    func testReadAppViewParamRefusesPlainHttpToAnotherMachine() {
        guard case .invalid = Shadowban.readAppViewParam("http://appview.example.com") else {
            return XCTFail("plain http to another host must be refused")
        }
    }

    // MARK: What was asked about

    func testParseShadowbanInputReadsAccountsAndPostsAndRefusesOtherRecordsInItsOwnWords() {
        XCTAssertEqual(Shadowban.parseShadowbanInput("@Alice.Example.com"), .ok(.account(actor: "alice.example.com")))
        XCTAssertEqual(
            Shadowban.parseShadowbanInput("https://bsky.app/profile/alice.example.com/post/3kabc"),
            .ok(.post(actor: "alice.example.com", rkey: "3kabc"))
        )
        XCTAssertEqual(
            Shadowban.parseShadowbanInput("at://\(Self.did)/app.bsky.graph.list/3kabc"),
            .invalid(reason: Shadowban.notChecked)
        )
    }

    // MARK: Reading records and answers

    func testReadRepoPostTakesTheTimeFromATidKeyAndTheThreadFromTheReplyRefs() {
        let rkey = toolsTid(ms: Self.nowMs - Self.hourMs)
        let parent = otherPost(1)
        let root = otherPost(2)
        let read = Shadowban.readRepoPost(
            uri: "at://\(Self.did)/app.bsky.feed.post/\(rkey)",
            value: json("""
            {"text":"hi","createdAt":"2020-01-01T00:00:00.000Z","reply":{"parent":{"uri":"\(parent)"},"root":{"uri":"\(root)"}}}
            """)
        )
        XCTAssertEqual(read.writtenAt, toolsDate(ms: Self.nowMs - Self.hourMs))
        XCTAssertEqual(read.reply, Shadowban.ReplyRef(parent: parent, root: root))
        XCTAssertEqual(read.text, "hi")
        XCTAssertEqual(read.rkey, rkey)
    }

    func testReadRepoPostFallsBackToCreatedAtForANonTidKeyAndToTheParentForAMissingRoot() {
        let read = Shadowban.readRepoPost(
            uri: "at://\(Self.did)/app.bsky.feed.post/custom-key",
            value: json("""
            {"createdAt":"2026-11-13T11:00:00.000Z","reply":{"parent":{"uri":"\(otherPost(1))"}}}
            """)
        )
        XCTAssertEqual(read.writtenAt, Formatting.isoDate("2026-11-13T11:00:00.000Z"))
        XCTAssertEqual(read.reply, ref(otherPost(1)))
        XCTAssertEqual(read.text, "")
    }

    func testReadProfileFailureTellsASuspensionFromADeactivationFromAnUnknownAccount() {
        func state(_ profile: Shadowban.ProfileState) -> String {
            switch profile {
            case .found: return "found"
            case .suspended: return "suspended"
            case .deactivated: return "deactivated"
            case .missing: return "missing"
            case .error: return "error"
            }
        }
        XCTAssertEqual(state(Shadowban.readProfileFailure(status: 400, error: "AccountTakedown", message: "Account has been suspended")), "suspended")
        XCTAssertEqual(state(Shadowban.readProfileFailure(status: 400, error: "AccountDeactivated", message: "Account is deactivated")), "deactivated")
        XCTAssertEqual(state(Shadowban.readProfileFailure(status: 400, error: "InvalidRequest", message: "Profile not found")), "missing")
        XCTAssertEqual(state(Shadowban.readProfileFailure(status: 502, error: nil, message: nil)), "error")
        XCTAssertEqual(Shadowban.readProfileFailure(status: 502, error: nil, message: nil), .error(message: "HTTP 502"))
    }

    func testPlaceReplyFindsAReplyAsAThreadViewOrABareEntryAndGivesUpOnAFullThread() {
        let uri = post(Self.hourMs).uri
        let third = otherPost(3)
        XCTAssertEqual(Shadowban.placeReply(uri, replies: json(#"[{"post":{"uri":"\#(third)"}},{"post":{"uri":"\#(uri)"}}]"#)), .shown)
        XCTAssertEqual(Shadowban.placeReply(uri, replies: json(#"[{"$type":"app.bsky.feed.defs#blockedPost","uri":"\#(uri)"}]"#)), .shown)
        XCTAssertEqual(Shadowban.placeReply(uri, replies: json(#"[{"post":{"uri":"\#(third)"}}]"#)), .absent)
        XCTAssertEqual(Shadowban.placeReply(uri, replies: nil), .absent)
        let full = JSONValue.array((0..<Int64(Shadowban.threadReplyCap)).map { n in
            JSONValue.object(["post": .object(["uri": .string(otherPost(n))])])
        })
        XCTAssertEqual(Shadowban.placeReply(uri, replies: full), .crowded)
    }

    func testRepliesToCheckKeepsRepliesTheAppViewReturnedNewestFirstUpToTheLimit() {
        let a = post(Self.hourMs, reply: ref(otherPost(1)), clock: 1)
        let b = post(2 * Self.hourMs, reply: ref(otherPost(2)), clock: 2)
        let c = post(3 * Self.hourMs)
        let d = post(4 * Self.hourMs, reply: ref(otherPost(3)), clock: 3)
        XCTAssertEqual(Shadowban.repliesToCheck([a, b, c, d], shown: [a.uri, c.uri, d.uri]), [a, d])
        XCTAssertEqual(Shadowban.repliesToCheck([a, b, c, d], shown: [a.uri, b.uri, d.uri], limit: 2), [a, b])
    }

    func testPostPresenceAllowsAPostTooNewToHaveBeenIndexed() {
        let fresh = post(Self.indexGraceMs / 2)
        let old = post(Self.indexGraceMs * 2)
        let shown: Shadowban.Probe<[String]> = .ok([])
        XCTAssertEqual(Shadowban.postPresence(fresh, shown: shown, now: now), .new)
        XCTAssertEqual(Shadowban.postPresence(old, shown: shown, now: now), .missing)
        XCTAssertEqual(Shadowban.postPresence(old, shown: .ok([old.uri]), now: now), .shown)
        XCTAssertEqual(Shadowban.postPresence(old, shown: nil, now: now), .pending)
    }

    // MARK: What a missing reply means

    private func absent(
        uri: String? = nil,
        parent: String? = nil,
        root: String? = nil,
        gate: Shadowban.Lookup<Shadowban.ThreadGate> = .answered(Shadowban.ThreadGate(restricted: false, hidden: false)),
        block: Shadowban.Lookup<Shadowban.BlockLookup> = .answered(Shadowban.BlockLookup(found: false))
    ) -> ReplyProbe {
        ReplyProbe(
            uri: uri ?? post(Self.hourMs).uri,
            parent: parent ?? otherPost(1),
            root: root ?? otherPost(1),
            thread: .absent,
            gate: gate,
            block: block
        )
    }

    func testReadReplyCallsAnUnexplainedAbsenceHidden() {
        XCTAssertEqual(Shadowban.readReply(absent(), author: Self.did).outcome, .hidden)
        var shown = absent()
        shown.thread = .shown
        XCTAssertEqual(Shadowban.readReply(shown, author: Self.did).outcome, .shown)
    }

    func testReadReplyExplainsAnAbsenceByABlockAHiddenReplyOrTheThreadsReplyRules() {
        XCTAssertEqual(Shadowban.readReply(absent(block: .answered(Shadowban.BlockLookup(found: true))), author: Self.did).outcome, .explained)
        XCTAssertEqual(
            Shadowban.readReply(absent(gate: .answered(Shadowban.ThreadGate(restricted: false, hidden: true))), author: Self.did).outcome,
            .explained
        )
        XCTAssertEqual(
            Shadowban.readReply(absent(gate: .answered(Shadowban.ThreadGate(restricted: true, hidden: false))), author: Self.did).outcome,
            .explained
        )
    }

    func testReadReplyDoesNotExcuseAMissingReplyInTheAccountsOwnThreadWithItsOwnRules() {
        let ownRoot = post(2 * Self.hourMs).uri
        let reading = Shadowban.readReply(
            absent(parent: ownRoot, root: ownRoot, gate: .answered(Shadowban.ThreadGate(restricted: true, hidden: true))),
            author: Self.did
        )
        XCTAssertEqual(reading.outcome, .hidden)
        XCTAssertTrue(reading.reason.contains("own thread"))
    }

    func testReadReplySaysWhenBlocksOrRulesCouldNotBeChecked() {
        let reading = Shadowban.readReply(absent(gate: .unanswered, block: .unanswered), author: Self.did)
        XCTAssertEqual(reading.outcome, .hidden)
        XCTAssertTrue(reading.reason.contains("Couldn’t check blocks or the thread’s reply limits"))
    }

    func testReadReplyCannotTellForACrowdedThreadAMissingParentOrAFailedRead() {
        for thread in [Shadowban.ThreadAnswer.crowded, .noParent, .error] {
            var probe = absent()
            probe.thread = thread
            XCTAssertEqual(Shadowban.readReply(probe, author: Self.did).outcome, .unknown, thread.rawValue)
        }
    }

    // MARK: An account

    func testAnAccountTheAppViewShowsInFullPassesEveryCheck() {
        let evidence = cleanAccount()
        let checks = Shadowban.buildChecks(evidence, now: now)
        XCTAssertEqual(checks.map { $0.id }, [.pds, .profile, .posts, .threads, .actorSearch, .postSearch])
        XCTAssertEqual(checks.map { $0.status }, [.pass, .pass, .pass, .pass, .pass, .pass])
        let verdict = Shadowban.shadowbanVerdict(evidence, checks: checks)
        XCTAssertEqual(verdict.tone, .pass)
        XCTAssertEqual(verdict.title, "No shadowban found on Bluesky")
    }

    func testTheChecksWaitForWhatHasNotArrivedAndSoDoesTheVerdict() {
        let evidence = Evidence(target: .account(actor: "alice.example.com"), appview: Shadowban.defaultAppView)
        let checks = Shadowban.buildChecks(evidence, now: now)
        XCTAssertTrue(checks.allSatisfy { $0.status == .pending })
        XCTAssertEqual(Shadowban.shadowbanVerdict(evidence, checks: checks).tone, .pending)
    }

    func testAPostInTheRepositoryAndNotOnTheAppViewIsASignAndAFreshOneIsNot() {
        var evidence = cleanAccount()
        guard case .ok(let posts)? = evidence.posts, case .ok(let shown)? = evidence.shown else {
            return XCTFail("the clean account has posts")
        }
        let missing = posts[0]
        let fresh = post(Self.indexGraceMs / 4, clock: 9)
        evidence.posts = .ok([fresh] + posts)
        evidence.shown = .ok(shown.filter { $0 != missing.uri })
        let checks = Shadowban.buildChecks(evidence, now: now)
        let postsCheck = checks.first(where: { $0.id == .posts })
        XCTAssertEqual(postsCheck?.status, .fail)
        XCTAssertTrue(
            postsCheck?.summary.hasPrefix(
                "1 of the 3 latest posts is on the PDS but missing from Bluesky. One post from the last two minutes was skipped."
            ) == true,
            postsCheck?.summary ?? ""
        )
        let verdict = Shadowban.shadowbanVerdict(evidence, checks: checks)
        XCTAssertEqual(verdict.tone, .fail)
        XCTAssertEqual(verdict.title, "Possible shadowban on Bluesky")
    }

    func testAReplyMissingFromItsThreadIsASignOneLeftOutAcrossABlockIsNot() {
        var evidence = cleanAccount()
        guard case .ok(let replies)? = evidence.replies, let reply = replies.first else {
            return XCTFail("the clean account has a reply")
        }

        var hidden = reply
        hidden.thread = .absent
        hidden.gate = .answered(Shadowban.ThreadGate(restricted: false, hidden: false))
        hidden.block = .answered(Shadowban.BlockLookup(found: false))
        evidence.replies = .ok([hidden])
        var checks = Shadowban.buildChecks(evidence, now: now)
        XCTAssertEqual(status(checks, .threads), .fail)
        XCTAssertEqual(Shadowban.shadowbanVerdict(evidence, checks: checks).tone, .fail)

        var blocked = hidden
        blocked.block = .answered(Shadowban.BlockLookup(found: true))
        evidence.replies = .ok([blocked])
        checks = Shadowban.buildChecks(evidence, now: now)
        XCTAssertEqual(status(checks, .threads), .info)
        XCTAssertEqual(Shadowban.shadowbanVerdict(evidence, checks: checks).tone, .pass)
    }

    func testAReplyMissingFromTheAccountsOwnThreadIsSaidToBeSo() {
        var evidence = cleanAccount()
        let root = post(6 * Self.hourMs).uri
        evidence.replies = .ok([absent(uri: post(Self.hourMs).uri, parent: root, root: root)])
        let threads = Shadowban.buildChecks(evidence, now: now).first(where: { $0.id == .threads })
        XCTAssertEqual(threads?.status, .fail)
        XCTAssertTrue(threads?.summary.contains("It’s a reply in the account’s own thread.") == true)
    }

    func testLeftOutOfSearchButFoundByTypeaheadIsASign() {
        var evidence = cleanAccount()
        evidence.actorSearch = .ok(Shadowban.ActorSearch(inSearch: false, inTypeahead: true))
        let checks = Shadowban.buildChecks(evidence, now: now)
        XCTAssertEqual(status(checks, .actorSearch), .fail)
        XCTAssertEqual(Shadowban.shadowbanVerdict(evidence, checks: checks).tone, .fail)
    }

    func testLeftOutOfSearchIsExpectedForAnAccountThatAsksNotToBeShownLoggedOut() {
        var evidence = cleanAccount()
        evidence.profile = .found(Shadowban.FoundProfile(
            handle: "alice.example.com",
            displayName: nil,
            avatar: nil,
            labels: [Shadowban.ProfileLabel(val: Shadowban.noUnauthenticated, src: Self.did)]
        ))
        evidence.actorSearch = .ok(Shadowban.ActorSearch(inSearch: false, inTypeahead: true))
        let checks = Shadowban.buildChecks(evidence, now: now)
        XCTAssertEqual(status(checks, .actorSearch), .info)
        // The self-label is not moderation, so the profile still passes.
        XCTAssertEqual(status(checks, .profile), .pass)
        XCTAssertEqual(Shadowban.shadowbanVerdict(evidence, checks: checks).tone, .pass)
    }

    func testFoundByNeitherSearchNorTypeaheadIsWorthALookNotASign() {
        var evidence = cleanAccount()
        evidence.actorSearch = .ok(Shadowban.ActorSearch(inSearch: false, inTypeahead: false))
        let checks = Shadowban.buildChecks(evidence, now: now)
        XCTAssertEqual(status(checks, .actorSearch), .warn)
        XCTAssertEqual(Shadowban.shadowbanVerdict(evidence, checks: checks).tone, .warn)
    }

    func testAnAppViewWithoutSearchSkipsTheSearchChecks() {
        var evidence = cleanAccount()
        evidence.appview = Shadowban.appViews[1]
        evidence.actorSearch = .failed("HTTP 502")
        evidence.postSearch = .failed("HTTP 502")
        let checks = Shadowban.buildChecks(evidence, now: now)
        XCTAssertEqual(status(checks, .actorSearch), .skip)
        XCTAssertEqual(status(checks, .postSearch), .skip)
        XCTAssertEqual(Shadowban.shadowbanVerdict(evidence, checks: checks).title, "No shadowban found on Blacksky")
    }

    func testPostSearchCountsOnlyPostsTheAppViewReturnsThatAreOldEnoughToBeSearchable() {
        var evidence = cleanAccount()
        guard case .ok(let posts)? = evidence.posts else { return XCTFail("the clean account has posts") }
        let young = post(Self.searchGraceMs / 2, clock: 7)
        let all = [young] + posts
        evidence.posts = .ok(all)
        evidence.shown = .ok(all.map { $0.uri })
        let a = all[1]
        let b = all[2]
        let c = all[3]

        evidence.postSearch = .ok([a.uri, b.uri, c.uri])
        XCTAssertEqual(status(Shadowban.buildChecks(evidence, now: now), .postSearch), .pass)

        evidence.postSearch = .ok([a.uri])
        XCTAssertEqual(status(Shadowban.buildChecks(evidence, now: now), .postSearch), .warn)

        evidence.postSearch = .ok([])
        XCTAssertEqual(status(Shadowban.buildChecks(evidence, now: now), .postSearch), .fail)
    }

    func testLabelsFromModerationAreAWarningModerationInTheOpen() {
        var evidence = cleanAccount()
        evidence.profile = .found(Shadowban.FoundProfile(
            handle: "alice.example.com",
            displayName: nil,
            avatar: nil,
            labels: [Shadowban.ProfileLabel(val: "spam", src: Self.other)]
        ))
        let checks = Shadowban.buildChecks(evidence, now: now)
        XCTAssertEqual(status(checks, .profile), .warn)
        XCTAssertTrue(checks[1].summary.contains("spam"))
    }

    func testASuspensionAndAnUnknownAccountAreNamedInTheVerdict() {
        var evidence = cleanAccount()
        evidence.profile = .suspended(message: "Account has been suspended")
        XCTAssertEqual(Shadowban.shadowbanVerdict(evidence, checks: Shadowban.buildChecks(evidence, now: now)).title, "Suspended on Bluesky")
        evidence.profile = .missing(message: "Profile not found")
        XCTAssertEqual(
            Shadowban.shadowbanVerdict(evidence, checks: Shadowban.buildChecks(evidence, now: now)).title,
            "Bluesky doesn’t show this account"
        )
    }

    func testAnAppViewThatDoesNotAnswerIsSaidSoNotReportedAsHidingNothing() {
        var evidence = cleanAccount()
        evidence.profile = .error(message: "the host is down")
        evidence.shown = .failed("the host is down")
        evidence.replies = nil
        evidence.actorSearch = .failed("the host is down")
        evidence.postSearch = .failed("the host is down")
        let verdict = Shadowban.shadowbanVerdict(evidence, checks: Shadowban.buildChecks(evidence, now: now))
        XCTAssertEqual(verdict.tone, .warn)
        XCTAssertEqual(verdict.title, "Bluesky didn’t answer")
    }

    func testAnAccountItsPDSHasSwitchedOffIsNotTheAppViewsDoing() {
        var evidence = cleanAccount()
        evidence.repo = .inactive(status: "takendown")
        evidence.profile = .suspended(message: "Account has been suspended")
        let verdict = Shadowban.shadowbanVerdict(evidence, checks: Shadowban.buildChecks(evidence, now: now))
        XCTAssertEqual(verdict.tone, .warn)
        XCTAssertEqual(verdict.title, "The account isn’t active on its PDS")
        XCTAssertTrue(verdict.text.contains("takendown"))
    }

    // MARK: A post

    /// A post the AppView shows, by an account it shows in full.
    private func cleanPost(reply: Shadowban.ReplyRef? = nil) -> Evidence {
        let one = post(Self.hourMs / 2, reply: reply, clock: 5)
        var evidence = cleanAccount()
        evidence.target = .post(actor: Self.did, rkey: one.rkey)
        evidence.post = .ok(one)
        evidence.postShown = .ok([one.uri])
        if let reply {
            evidence.postThread = .ok(ReplyProbe(uri: one.uri, parent: reply.parent, root: reply.root, thread: .shown))
        }
        return evidence
    }

    func testAPostIsCheckedOnItsOwnAndItsAuthorInFull() {
        let evidence = cleanPost()
        let checks = Shadowban.buildChecks(evidence, now: now)
        XCTAssertEqual(checks.map { $0.id }, [.postRecord, .post, .thread, .pds, .profile, .posts, .threads, .actorSearch, .postSearch])
        XCTAssertEqual(checks.map { $0.status }, [.pass, .pass, .skip, .pass, .pass, .pass, .pass, .pass, .pass])
        XCTAssertEqual(Shadowban.buildPostChecks(evidence, now: now).map { $0.id }, [.postRecord, .post, .thread])
        XCTAssertEqual(Shadowban.buildAccountChecks(evidence, now: now).count, 6)
        let verdict = Shadowban.shadowbanVerdict(evidence, checks: checks)
        XCTAssertEqual(verdict.tone, .pass)
        XCTAssertEqual(verdict.text, "Bluesky shows the post and everything else that was checked.")
    }

    func testAnAccountAskedAboutHasNoPostChecks() {
        XCTAssertEqual(Shadowban.buildPostChecks(cleanAccount(), now: now), [])
    }

    func testAPostTheAppViewWillNotReturnIsHidden() {
        var evidence = cleanPost(reply: ref(otherPost(1)))
        evidence.postShown = .ok([])
        evidence.postThread = nil
        let checks = Shadowban.buildChecks(evidence, now: now)
        XCTAssertEqual(status(checks, .post), .fail)
        XCTAssertEqual(status(checks, .thread), .skip)
        XCTAssertEqual(Shadowban.shadowbanVerdict(evidence, checks: checks).title, "This post is hidden on Bluesky")
    }

    func testAReplyLeftOutOfItsThreadIsHiddenAndOneLeftOutAcrossABlockIsAWarning() {
        var evidence = cleanPost(reply: ref(otherPost(1)))
        guard case .ok(let reply)? = evidence.postThread else { return XCTFail("the clean reply has a thread") }

        var hidden = reply
        hidden.thread = .absent
        hidden.gate = .answered(Shadowban.ThreadGate(restricted: false, hidden: false))
        hidden.block = .answered(Shadowban.BlockLookup(found: false))
        evidence.postThread = .ok(hidden)
        var checks = Shadowban.buildChecks(evidence, now: now)
        XCTAssertEqual(status(checks, .thread), .fail)
        XCTAssertEqual(Shadowban.shadowbanVerdict(evidence, checks: checks).title, "This post is hidden on Bluesky")

        var blocked = hidden
        blocked.block = .answered(Shadowban.BlockLookup(found: true))
        evidence.postThread = .ok(blocked)
        checks = Shadowban.buildChecks(evidence, now: now)
        XCTAssertEqual(status(checks, .thread), .warn)
        XCTAssertEqual(Shadowban.shadowbanVerdict(evidence, checks: checks).tone, .warn)
    }

    func testAPostThatShowsByAnAccountSearchLeavesOutStillReportsTheAccount() {
        var evidence = cleanPost()
        evidence.actorSearch = .ok(Shadowban.ActorSearch(inSearch: false, inTypeahead: true))
        let verdict = Shadowban.shadowbanVerdict(evidence, checks: Shadowban.buildChecks(evidence, now: now))
        XCTAssertEqual(verdict.tone, .fail)
        XCTAssertEqual(verdict.title, "Possible shadowban on Bluesky")
        XCTAssertTrue(verdict.text.hasPrefix("The post itself shows on Bluesky. Searching for alice.example.com doesn’t find it"), verdict.text)
    }

    func testAHiddenPostByAFlaggedAccountNamesBoth() {
        var evidence = cleanPost()
        evidence.postShown = .ok([])
        evidence.actorSearch = .ok(Shadowban.ActorSearch(inSearch: false, inTypeahead: true))
        let verdict = Shadowban.shadowbanVerdict(evidence, checks: Shadowban.buildChecks(evidence, now: now))
        XCTAssertEqual(verdict.title, "Possible shadowban on Bluesky")
        XCTAssertTrue(verdict.text.hasPrefix("The post is on the PDS, but Bluesky won’t return it. Searching for"), verdict.text)
    }

    func testADeletedPostIsNotAHiddenOneAndTheAccountIsStillChecked() {
        var evidence = cleanPost()
        evidence.post = .ok(nil)
        evidence.postShown = nil
        var checks = Shadowban.buildChecks(evidence, now: now)
        XCTAssertEqual(status(checks, .postRecord), .warn)
        XCTAssertEqual(status(checks, .post), .skip)
        XCTAssertEqual(status(checks, .posts), .pass)
        var verdict = Shadowban.shadowbanVerdict(evidence, checks: checks)
        XCTAssertEqual(verdict.tone, .warn)
        XCTAssertEqual(verdict.title, "This post was deleted")

        evidence.actorSearch = .ok(Shadowban.ActorSearch(inSearch: false, inTypeahead: true))
        checks = Shadowban.buildChecks(evidence, now: now)
        verdict = Shadowban.shadowbanVerdict(evidence, checks: checks)
        XCTAssertEqual(verdict.title, "Possible shadowban on Bluesky")
        XCTAssertTrue(verdict.text.hasPrefix("This post was deleted. "), verdict.text)
    }

    func testTheTidHelperRoundTripsThroughTheDecoder() {
        let rkey = toolsTid(ms: Self.nowMs, clock: 5)
        XCTAssertEqual(rkey.count, 13)
        XCTAssertEqual(TID.date(from: rkey), now)
        XCTAssertEqual(TID.clockId(from: rkey), 5)
    }
}
