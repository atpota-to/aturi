import Foundation
import XCTest
@testable import AturiCore

/// Port of `src/lib/__tests__/pdsExplorer.test.ts`, plus the server card's
/// sign-in reading and the sort menu.
final class PDSExplorerTests: XCTestCase {
    private let path = "/explore/pds/pds.example.com"

    /// A query string as `URLSearchParams` reads it.
    private func q(_ query: String = "") -> [String: String] {
        var out: [String: String] = [:]
        for item in URLComponents(string: "https://aturi.to/?" + query)?.queryItems ?? [] where out[item.name] == nil {
            out[item.name] = item.value ?? ""
        }
        return out
    }

    private func parse(_ query: String = "") -> PDSExplorer.Location? {
        PDSExplorer.parse(path: path, query: q(query))
    }

    private func date(_ iso: String) -> Date {
        Formatting.isoDate(iso)!
    }

    // MARK: The address

    func testKnowsThePDSRouteAndNothingElse() {
        XCTAssertTrue(PDSExplorer.isPdsPath(path))
        XCTAssertFalse(PDSExplorer.isPdsPath("/explore/pds/"))
        XCTAssertFalse(PDSExplorer.isPdsPath("/explore/pds"))
        XCTAssertFalse(PDSExplorer.isPdsPath("/explore/pds/a/b"))
        XCTAssertFalse(PDSExplorer.isPdsPath("/explore/alice.example"))
        XCTAssertFalse(PDSExplorer.isPdsPath(nil))
    }

    func testABareAddressNamesNoViewAndTheHostIsDecoded() {
        let loc = PDSExplorer.parse(path: "/explore/pds/localhost%3A2583", query: q())
        XCTAssertEqual(loc?.host, "localhost:2583")
        XCTAssertNil(loc?.tab)
        XCTAssertEqual(loc?.status, "all")
        XCTAssertEqual(loc?.sort, .listed)
        XCTAssertEqual(loc?.desc, false)
        XCTAssertNil(loc?.account)
    }

    func testAnyAccountParameterImpliesTheAccountsView() {
        XCTAssertEqual(parse("status=active")?.tab, .accounts)
        XCTAssertEqual(parse("commit=7d")?.tab, .accounts)
        XCTAssertEqual(parse("sort=commit")?.tab, .accounts)
        XCTAssertEqual(parse("account=did:plc:abc")?.tab, .accounts)
        // The default direction of the default order says nothing.
        XCTAssertNil(parse("dir=asc")?.tab)
    }

    func testAccountParametersAreDroppedFromAnotherView() {
        let loc = parse("tab=relays&status=active&account=did:plc:abc")
        XCTAssertEqual(loc?.tab, .relays)
        XCTAssertEqual(loc?.status, "all")
        XCTAssertNil(loc?.account)
    }

    func testUnknownValuesAreIgnoredNotRefused() {
        let loc = parse("tab=nope&status=Not%20A%20Status&commit=2d&sort=size&account=alice")
        XCTAssertNil(loc?.tab)
        XCTAssertEqual(loc?.status, "all")
        XCTAssertNil(loc?.commit)
        XCTAssertEqual(loc?.sort, .listed)
        XCTAssertNil(loc?.account)
        // A status the explorer has no words for is still a status.
        XCTAssertEqual(parse("status=throttled")?.status, "throttled")
    }

    func testEachOrderHasItsOwnNaturalDirection() {
        XCTAssertEqual(parse("sort=commit")?.desc, true)
        XCTAssertEqual(parse("sort=commit&dir=asc")?.desc, false)
        XCTAssertEqual(parse("sort=handle")?.desc, false)
        XCTAssertEqual(parse("sort=listed&dir=desc")?.desc, true)
    }

    func testAddressesAreTheShortestThatReadBackTheSame() throws {
        var base = try XCTUnwrap(parse())
        XCTAssertEqual(PDSExplorer.address(base), path)
        base.tab = .overview
        XCTAssertEqual(PDSExplorer.address(base, defaultTab: .overview), path)
        XCTAssertEqual(PDSExplorer.address(base, defaultTab: .accounts), path + "?tab=overview")
        base.tab = .accounts
        XCTAssertEqual(PDSExplorer.address(base, defaultTab: .overview), path + "?tab=accounts")
        XCTAssertEqual(PDSExplorer.address(base, defaultTab: .accounts), path)

        // A filter says "accounts" by itself.
        var active = base
        active.status = "active"
        XCTAssertEqual(PDSExplorer.address(active, defaultTab: .overview), path + "?status=active")
        var newest = base
        newest.sort = .commit
        newest.desc = true
        XCTAssertEqual(PDSExplorer.address(newest), path + "?sort=commit")
        newest.desc = false
        XCTAssertEqual(PDSExplorer.address(newest), path + "?sort=commit&dir=asc")

        // Another view carries no account parameters.
        var relays = base
        relays.tab = .relays
        relays.status = "active"
        XCTAssertEqual(PDSExplorer.address(relays), path + "?tab=relays")
    }

    func testEveryAddressRoundTrips() throws {
        let cases = [
            "",
            "tab=overview",
            "tab=accounts",
            "tab=relays",
            "status=inactive",
            "status=deactivated&commit=dormant",
            "commit=24h&sort=handle&dir=desc",
            "sort=status&account=did:plc:abc123",
            "account=did:web:example.com",
        ]
        for query in cases {
            let loc = try XCTUnwrap(parse(query), query)
            let again = try XCTUnwrap(URLComponents(string: "https://aturi.to" + PDSExplorer.address(loc)), query)
            var params: [String: String] = [:]
            for item in again.queryItems ?? [] {
                params[item.name] = item.value ?? ""
            }
            XCTAssertEqual(PDSExplorer.parse(path: again.percentEncodedPath, query: params), loc, query)
        }
    }

    func testWithoutAccountParamsAndTheTitle() throws {
        let loc = try XCTUnwrap(parse("status=active&sort=commit&account=did:plc:abc"))
        let bare = PDSExplorer.withoutAccountParams(loc)
        XCTAssertEqual(bare.tab, .accounts)
        XCTAssertEqual(bare.status, "all")
        XCTAssertEqual(bare.sort, .listed)
        XCTAssertNil(bare.account)
        XCTAssertEqual(PDSExplorer.title(host: "pds.example.com", tab: .overview), "pds.example.com · PDS · Atmosphere Explorer")
        XCTAssertEqual(PDSExplorer.title(host: "pds.example.com", tab: .accounts), "Accounts · pds.example.com · PDS · Atmosphere Explorer")
    }

    // MARK: Standing

    func testAnAccountStandsAsListReposSaysAndAsActiveWhenItSaysNothing() {
        XCTAssertEqual(PDSExplorer.standing(active: true, status: nil), "active")
        XCTAssertEqual(PDSExplorer.standing(active: nil, status: nil), "active")
        XCTAssertEqual(PDSExplorer.standing(active: false, status: "deactivated"), "deactivated")
        XCTAssertEqual(PDSExplorer.standing(active: false, status: "TakenDown"), "takendown")
        XCTAssertEqual(PDSExplorer.standing(active: false, status: nil), "inactive")
        XCTAssertEqual(PDSExplorer.standing(active: nil, status: "suspended"), "suspended")
        XCTAssertEqual(PDSExplorer.statusLabel("takendown"), "Taken down")
        XCTAssertEqual(PDSExplorer.statusLabel("throttled"), "Throttled")
        XCTAssertEqual(PDSExplorer.statusLabel("migrating"), "Migrating")
    }

    func testStatusMeaningsAndTones() {
        XCTAssertEqual(PDSExplorer.statusMeaning("active"), "The host serves this repo’s records.")
        XCTAssertEqual(
            PDSExplorer.statusMeaning("migrating"),
            "The host gives this repo the status “migrating” and won’t serve its records."
        )
        XCTAssertEqual(PDSExplorer.statusTone("active"), .good)
        XCTAssertEqual(PDSExplorer.statusTone("deactivated"), .warn)
        XCTAssertEqual(PDSExplorer.statusTone("takendown"), .bad)
        XCTAssertEqual(PDSExplorer.statusTone("desynchronized"), .quiet)
        XCTAssertLessThan(PDSExplorer.compareStatus("active", "deactivated"), 0)
        XCTAssertLessThan(PDSExplorer.compareStatus("deleted", "migrating"), 0)
        XCTAssertLessThan(PDSExplorer.compareStatus("desynchronized", "throttled"), 0)
        XCTAssertEqual(PDSExplorer.compareStatus("throttled", "throttled"), 0)
    }

    func testStatusFilters() {
        XCTAssertTrue(PDSExplorer.matchesStatus("active", "all"))
        XCTAssertTrue(PDSExplorer.matchesStatus("active", "active"))
        XCTAssertFalse(PDSExplorer.matchesStatus("deactivated", "active"))
        XCTAssertTrue(PDSExplorer.matchesStatus("deactivated", "inactive"))
        XCTAssertTrue(PDSExplorer.matchesStatus("deactivated", "deactivated"))
        XCTAssertFalse(PDSExplorer.matchesStatus("takendown", "deactivated"))
    }

    // MARK: Last commit

    func testCommitWindowsIncludeOneAnotherAndDormantIsTheRest() {
        let now = date("2026-11-18T00:00:00Z")
        func hoursAgo(_ hours: Double) -> Date { now.addingTimeInterval(-hours * 3600) }
        XCTAssertTrue(PDSExplorer.matchesCommit(hoursAgo(2), .day, now: now))
        XCTAssertTrue(PDSExplorer.matchesCommit(hoursAgo(2), .week, now: now))
        XCTAssertFalse(PDSExplorer.matchesCommit(hoursAgo(30), .day, now: now))
        XCTAssertTrue(PDSExplorer.matchesCommit(hoursAgo(24 * 200), .year, now: now))
        XCTAssertFalse(PDSExplorer.matchesCommit(hoursAgo(24 * 400), .year, now: now))
        XCTAssertTrue(PDSExplorer.matchesCommit(hoursAgo(24 * 400), .dormant, now: now))
        XCTAssertFalse(PDSExplorer.matchesCommit(nil, .week, now: now))
        XCTAssertFalse(PDSExplorer.matchesCommit(nil, .dormant, now: now))
        XCTAssertTrue(PDSExplorer.matchesCommit(nil, nil, now: now))
        XCTAssertEqual(PDSExplorer.CommitWindow.allCases.map(\.rawValue), ["24h", "7d", "30d", "1y", "dormant"])
        XCTAssertEqual(PDSExplorer.CommitWindow.dormant.label, "Over a year ago")
    }

    // MARK: Counting

    func testEachFacetCountsUnderTheOtherFacetsChoiceNotItsOwn() {
        let now = date("2026-11-18T00:00:00Z")
        func daysAgo(_ days: Double) -> Date { now.addingTimeInterval(-days * 86_400) }
        let rows: [(standing: String, date: Date?)] = [
            (standing: "active", date: daysAgo(0.5)),
            (standing: "active", date: daysAgo(20)),
            (standing: "deactivated", date: daysAgo(3)),
            (standing: "takendown", date: daysAgo(500)),
            (standing: "active", date: nil),
        ]
        let all = PDSExplorer.countFacets(rows, status: "all", commit: nil, now: now)
        XCTAssertEqual(all.statusAll, 5)
        XCTAssertEqual(all.byStatus["active"], 3)
        XCTAssertEqual(all.count(.week), 2)
        XCTAssertEqual(all.count(.month), 3)
        XCTAssertEqual(all.count(.dormant), 1)

        let activeThisWeek = PDSExplorer.countFacets(rows, status: "active", commit: .week, now: now)
        // Status counts honour the week, not "active".
        XCTAssertEqual(activeThisWeek.statusAll, 2)
        XCTAssertEqual(activeThisWeek.byStatus["deactivated"], 1)
        // Commit counts honour "active", not the week.
        XCTAssertEqual(activeThisWeek.commitAll, 3)
        XCTAssertEqual(activeThisWeek.count(.month), 2)
        XCTAssertEqual(activeThisWeek.count(.dormant), 0)
    }

    // MARK: Sorting

    func testSortingKeepsTheUnknownLastAndTiesInTheHostsOrder() {
        let january = date("2026-01-01T00:00:00Z")
        func row(_ index: Int, _ handle: String?, _ day: Int?, _ standing: String = "active") -> PDSExplorer.SortableAccount {
            PDSExplorer.SortableAccount(
                index: index,
                standing: standing,
                date: day.map { january.addingTimeInterval(Double($0 - 1) * 86_400) },
                handle: handle
            )
        }
        let rows = [
            row(0, "carol.test", 3),
            row(1, nil, nil, "deactivated"),
            row(2, "alice.test", 9),
            row(3, "bob.test", 3, "takendown"),
        ]
        func order(_ sort: PDSExplorer.AccountSort, _ desc: Bool) -> [Int] {
            rows.sorted { PDSExplorer.compareAccounts($0, $1, sort: sort, desc: desc) < 0 }.map(\.index)
        }
        XCTAssertEqual(order(.listed, false), [0, 1, 2, 3])
        XCTAssertEqual(order(.listed, true), [3, 2, 1, 0])
        XCTAssertEqual(order(.handle, false), [2, 3, 0, 1])
        XCTAssertEqual(order(.handle, true), [0, 3, 2, 1])
        XCTAssertEqual(order(.commit, true), [2, 0, 3, 1])
        XCTAssertEqual(order(.commit, false), [0, 3, 2, 1])
        XCTAssertEqual(order(.status, false), [0, 2, 1, 3])
    }

    func testTheSortMenuListsEveryOrderOnce() {
        XCTAssertEqual(PDSExplorer.sortChoices.count, 8)
        XCTAssertEqual(Set(PDSExplorer.sortChoices.map(\.id)).count, 8)
        XCTAssertEqual(PDSExplorer.sortLabel(.commit, desc: true), "Newest commit")
        XCTAssertEqual(PDSExplorer.sortLabel(.listed, desc: false), "As listed")
        XCTAssertTrue(PDSExplorer.AccountSort.commit.descByDefault)
        XCTAssertFalse(PDSExplorer.AccountSort.handle.descByDefault)
    }

    // MARK: The server

    func testSignInReadsTheAuthorizationServers() {
        XCTAssertNil(PDSExplorer.authorizationServers(nil))
        XCTAssertNil(PDSExplorer.authorizationServers(["ftp://entryway.example", "nonsense"]))
        XCTAssertEqual(
            PDSExplorer.authorizationServers(["https://entryway.example", "javascript:alert(1)", "http://local.test:2583"]),
            ["https://entryway.example", "http://local.test:2583"]
        )
        XCTAssertEqual(
            PDSExplorer.signIn(authServers: ["https://PDS.example.com/", "https://Entryway.example"], base: "https://pds.example.com"),
            [.onThisPDS, .through(host: "entryway.example")]
        )
    }

    func testOnlyWebLinksAreLinks() {
        XCTAssertTrue(PDSExplorer.isWebLink("https://pds.example.com/privacy"))
        XCTAssertTrue(PDSExplorer.isWebLink("HTTP://pds.example.com/tos"))
        XCTAssertFalse(PDSExplorer.isWebLink("javascript:alert(1)"))
        XCTAssertFalse(PDSExplorer.isWebLink("mailto:admin@pds.example.com"))
    }
}
