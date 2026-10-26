import Foundation
import XCTest
@testable import AturiCore

/// Ports the preference-plumbing half of src/utils/__tests__/autoRedirect.test.ts,
/// extension/lib/__tests__/prefs-known.test.ts and prefs-adopt.test.ts (with
/// the web's semantics where the extension's differ), the custom URL cases
/// of template.test.ts, and adds round-trip and migration coverage for the
/// record shape.
final class PreferencesTests: XCTestCase {
    private func json(_ text: String) -> JSONValue {
        try! JSONValue.parse(Data(text.utf8))
    }

    private var sampleCustom: CustomWaypoint {
        CustomWaypoint(
            id: "custom:one",
            name: "MyApp",
            domain: "myapp.example",
            supportedTypes: [.profile, .post],
            templates: [.profile: "https://myapp.example/u/{handle}", .post: "https://myapp.example/u/{handle}/p/{rkey}"],
            redirectCompat: [.blueskySocial]
        )
    }

    /// A thoroughly customised value for round trips.
    private var customized: Preferences {
        var prefs = Preferences.defaults
        prefs.colorScheme = .ember
        prefs.customWaypoints = [sampleCustom]
        prefs.waypointGroups = [
            WaypointGroup(id: "publications", name: "Reading", waypointIds: ["leaflet", "custom:one"], collapsed: true),
            WaypointGroup(id: "g_abc", name: "Mine", waypointIds: ["bluesky", "deer"]),
        ]
        prefs.hiddenWaypoints = ["pdsls"]
        prefs.waypointOrder = ["deer", "bluesky"]
        prefs.autoRedirect = true
        prefs.favoriteByFamily = [.blueskySocial: "deer", .tangled: "tangled"]
        prefs.waypointLayout = .grid
        prefs.knownWaypointIds = ["bluesky", "deer", "leaflet"]
        prefs.lastSeenReleaseId = "2026-01"
        prefs.announceReleases = false
        prefs.pinnedLexicons = ["app.bsky.feed.post", "sh.tangled.*"]
        prefs.pinnedLexiconsOthers = ["app.bsky.actor.profile"]
        prefs.pinScope = .split
        prefs.collectionGroupsCollapsedByDefault = true
        prefs.repoGlanceCollapsedByDefault = true
        prefs.minimalPostPreview = true
        prefs.setSectionHidden(page: .record, id: "richPreview", hidden: true)
        prefs.setSectionHidden(page: .record, id: "rawJson", hidden: false)
        prefs.setSectionHidden(page: .repo, id: "relationship", hidden: true)
        prefs.setSectionHidden(page: .repo, id: "profile", hidden: true)
        prefs.updatedAt = "2026-09-19T10:00:00.000Z"
        return prefs
    }

    // MARK: Defaults

    func testDefaultsMirrorTheWeb() {
        let d = Preferences.defaults
        XCTAssertEqual(d.colorScheme, .moss)
        XCTAssertEqual(d.waypointLayout, .dense)
        XCTAssertFalse(d.autoRedirect)
        XCTAssertTrue(d.favoriteByFamily.isEmpty)
        XCTAssertEqual(d.knownWaypointIds, WaypointCatalog.order)
        XCTAssertEqual(d.pinScope, .own)
        XCTAssertTrue(d.announceReleases)
        XCTAssertEqual(d.updatedAt, "1970-01-01T00:00:00.000Z")
        XCTAssertEqual(d.waypointGroups.map(\.id), ["blueskyClients", "blueskyForks", "publications", "atmosphereApps", "devTools"])
        XCTAssertEqual(d.waypointGroups[0].name, "Bluesky Clients")
        XCTAssertEqual(d.waypointGroups[0].waypointIds, ["anisota", "bluesky", "bluepy", "reddwarf", "impro", "lea"])
        XCTAssertEqual(d.waypointGroups[1].waypointIds, ["blacksky", "witchsky", "mu", "deer", "northsky"])
        XCTAssertEqual(d.waypointGroups[4].waypointIds, ["aturiExplore", "pdsls", "atptools", "taproot"])
        XCTAssertEqual(Set(d.waypointGroups.flatMap(\.waypointIds)), Set(WaypointCatalog.order))
        XCTAssertEqual(d.recordSections.map(\.id), ["richPreview", "structuredJson", "rawJson", "engagement", "copyRow", "lexiconUsage", "backlinks", "signIn"])
        XCTAssertEqual(d.recordSections.filter(\.hidden).map(\.id), ["rawJson"])
        XCTAssertEqual(d.repoSections.map(\.id), ["relationship", "profile", "identity", "repoGlance"])
        XCTAssertFalse(d.repoSections.contains { $0.hidden })
        XCTAssertFalse(d.hasLocalCustomization)
        XCTAssertEqual(Preferences.recordCollection, "to.aturi.actor.preferences")
        XCTAssertEqual(Preferences.recordKey, "self")
    }

    func testDefaultGroupsWithCustomWaypointsAppendCustomGroup() {
        let groups = Preferences.defaultWaypointGroups(customWaypoints: [sampleCustom])
        XCTAssertEqual(groups.count, 6)
        XCTAssertEqual(groups.last, WaypointGroup(id: "custom", name: "My Waypoints", waypointIds: ["custom:one"]))
    }

    // MARK: mergeWithDefaults (autoRedirect.test.ts, preference plumbing)

    func testStoredPreferencesWithoutNewFieldsMigrateToTheSafeDefault() {
        let merged = Preferences.mergeWithDefaults(["colorScheme": "moss"])
        XCTAssertFalse(merged.autoRedirect)
        XCTAssertTrue(merged.favoriteByFamily.isEmpty)
        XCTAssertEqual(merged.waypointLayout, .dense)
        XCTAssertEqual(merged.lastSeenReleaseId, "")
        XCTAssertTrue(merged.announceReleases)
    }

    func testMergeDropsUnknownFamiliesAndNonStringIds() {
        let merged = Preferences.mergeWithDefaults(json(#"""
        {"autoRedirect": true, "favoriteByFamily": {"bluesky-social": "deer", "not-a-family": "deer", "tangled": 42, "margin": null, "pinksky": ""}}
        """#))
        XCTAssertTrue(merged.autoRedirect)
        XCTAssertEqual(merged.favoriteByFamily, [.blueskySocial: "deer"])
    }

    func testNonBooleanAutoRedirectIsNotTruthyCoerced() {
        XCTAssertFalse(Preferences.mergeWithDefaults(["autoRedirect": "yes"]).autoRedirect)
        XCTAssertFalse(Preferences.mergeWithDefaults(["autoRedirect": 1]).autoRedirect)
    }

    func testCustomWaypointWithMalformedRedirectCompatIsRejectedWholesale() {
        let merged = Preferences.mergeWithDefaults(json(#"""
        {"customWaypoints": [{"id": "custom:bad", "name": "Bad", "supportedTypes": ["post"], "templates": {"post": "https://x.test/{rkey}"}, "redirectCompat": "bluesky-social"}]}
        """#))
        XCTAssertEqual(merged.customWaypoints.count, 0)
    }

    func testCustomWaypointValidation() {
        XCTAssertNil(CustomWaypoint(json: json(#"{"id": "custom:a", "name": "A", "supportedTypes": ["post", 3], "templates": {}}"#)), "non-string type rejects")
        XCTAssertNil(CustomWaypoint(json: json(#"{"id": "custom:a", "name": "A", "supportedTypes": ["post"], "templates": {"post": 3}}"#)), "non-string template rejects")
        XCTAssertNil(CustomWaypoint(json: json(#"{"id": "custom:a", "name": "A", "supportedTypes": ["post"], "templates": {}, "redirectCompat": null}"#)), "null redirectCompat rejects")
        XCTAssertNil(CustomWaypoint(json: json(#"{"id": "custom:a", "name": "A", "supportedTypes": ["post"]}"#)), "missing templates rejects")
        let lenient = CustomWaypoint(json: json(#"{"id": "custom:a", "name": "A", "domain": 5, "supportedTypes": ["post", "future"], "templates": {"post": "https://x/{rkey}", "future": "y"}, "redirectCompat": ["bluesky-social", "future-family"]}"#))
        XCTAssertEqual(lenient?.supportedTypes, [.post])
        XCTAssertEqual(lenient?.templates, [.post: "https://x/{rkey}"])
        XCTAssertEqual(lenient?.redirectCompat, [.blueskySocial])
        XCTAssertNil(lenient?.domain)
        let bare = CustomWaypoint(json: json(#"{"id": "custom:a", "name": "A", "supportedTypes": [], "templates": {}}"#))
        XCTAssertNil(bare?.redirectCompat)
    }

    func testWaypointGroupValidation() {
        XCTAssertNil(WaypointGroup(json: json(#"{"id": "g", "name": "G", "waypointIds": ["a", 1]}"#)))
        XCTAssertNil(WaypointGroup(json: json(#"{"id": "g", "waypointIds": []}"#)))
        let group = WaypointGroup(json: json(#"{"id": "g", "name": "G", "waypointIds": ["a"], "collapsed": "yes"}"#))
        XCTAssertEqual(group, WaypointGroup(id: "g", name: "G", waypointIds: ["a"], collapsed: nil))
        XCTAssertEqual(WaypointGroup(json: json(#"{"id": "g", "name": "G", "waypointIds": [], "collapsed": true}"#))?.collapsed, true)
    }

    func testMergeWithNonObjectIsDefaults() {
        XCTAssertEqual(Preferences.mergeWithDefaults(nil), .defaults)
        XCTAssertEqual(Preferences.mergeWithDefaults(.null), .defaults)
        XCTAssertEqual(Preferences.mergeWithDefaults(.array([])), .defaults)
        XCTAssertEqual(Preferences.mergeWithDefaults("x"), .defaults)
    }

    func testMergeReadsEveryScalarLeniently() {
        let merged = Preferences.mergeWithDefaults(json(#"""
        {"colorScheme": "sunset", "waypointLayout": "cards", "pinScope": "everyone", "pinnedLexicons": ["a.b.c", 4, null],
         "knownWaypointIds": ["bluesky", 7], "updatedAt": 12, "announceReleases": "no", "lastSeenReleaseId": "r1"}
        """#))
        XCTAssertEqual(merged.colorScheme, .moss)
        XCTAssertEqual(merged.waypointLayout, .dense)
        XCTAssertEqual(merged.pinScope, .own)
        XCTAssertEqual(merged.pinnedLexicons, ["a.b.c"])
        XCTAssertEqual(merged.knownWaypointIds, ["bluesky"])
        XCTAssertEqual(merged.updatedAt, Preferences.epochUpdatedAt)
        XCTAssertTrue(merged.announceReleases)
        XCTAssertEqual(merged.lastSeenReleaseId, "r1")
    }

    func testLegacyBooleansSeedTheSectionLists() {
        let merged = Preferences.mergeWithDefaults(json(#"""
        {"hideRichPreview": true, "showRawRecordJson": true, "minimalProfile": true, "hideRepoGlance": true}
        """#))
        XCTAssertEqual(merged.recordSections.filter(\.hidden).map(\.id), ["richPreview"])
        XCTAssertEqual(merged.repoSections.filter(\.hidden).map(\.id), ["profile", "repoGlance"])
        // minimalPostPreview carries over into hideRichPreview when the newer flag is absent.
        let old = Preferences.mergeWithDefaults(["minimalPostPreview": true])
        XCTAssertTrue(old.hideRichPreview)
        XCTAssertTrue(old.minimalPostPreview)
        XCTAssertTrue(ExploreSections.sectionHidden(old.recordSections, id: "richPreview"))
        let explicit = Preferences.mergeWithDefaults(["minimalPostPreview": true, "hideRichPreview": false])
        XCTAssertFalse(explicit.hideRichPreview)
    }

    func testSavedSectionListsAreReconciled() {
        let merged = Preferences.mergeWithDefaults(json(#"""
        {"recordSections": [{"id": "rawJson", "hidden": false}, {"id": "bogus", "hidden": true}, {"id": "structuredJson", "hidden": true}, {"id": "rawJson", "hidden": true}, {"id": "copyRow"}],
         "repoSections": "nope"}
        """#))
        XCTAssertEqual(merged.recordSections.map(\.id), ["rawJson", "structuredJson", "richPreview", "engagement", "copyRow", "lexiconUsage", "backlinks", "signIn"])
        XCTAssertEqual(merged.recordSections.filter(\.hidden).map(\.id), ["structuredJson"])
        XCTAssertEqual(merged.repoSections, ExploreSections.defaultRepoSections)
    }

    func testKnownWaypointIdsAreSeededFromGroupsAndHiddenWhenAbsent() {
        let seeded = Preferences.mergeWithDefaults(json(#"""
        {"waypointGroups": [{"id": "g", "name": "G", "waypointIds": ["bluesky", "custom:x", "bluesky"]}], "hiddenWaypoints": ["deer", "custom:y"]}
        """#))
        XCTAssertEqual(seeded.knownWaypointIds, ["bluesky", "deer"])
        // Absent groups are migrated to the defaults first, so the seed is
        // every built-in in group order (the web does the same); the
        // catalog-order fallback only fires when the groups are all empty.
        let fresh = Preferences.mergeWithDefaults(["colorScheme": "tide"])
        XCTAssertEqual(fresh.knownWaypointIds, Preferences.defaultWaypointGroups().flatMap(\.waypointIds))
        XCTAssertEqual(Set(fresh.knownWaypointIds), Set(WaypointCatalog.order))
        XCTAssertEqual(Preferences.mergeWithDefaults(["waypointGroups": [["id": "g", "name": "G", "waypointIds": []]]]).knownWaypointIds, WaypointCatalog.order)
        // An explicit array is trusted even when empty.
        XCTAssertEqual(Preferences.mergeWithDefaults(["knownWaypointIds": []]).knownWaypointIds, [])
    }

    // MARK: migrateToGroups

    func testMigrateToGroupsFromLegacyPayload() {
        let groups = Preferences.migrateToGroups(
            customWaypoints: [sampleCustom],
            hiddenWaypoints: ["bluesky", "pdsls"],
            waypointOrder: ["tangled", "anisota", "retiredWaypoint", "anisota"]
        )
        XCTAssertEqual(groups.map(\.id), ["blueskyClients", "blueskyForks", "publications", "atmosphereApps", "devTools", "custom"])
        XCTAssertEqual(groups[0].waypointIds, ["anisota", "bluepy", "reddwarf", "impro", "lea"], "hidden bluesky skipped, stored order honoured")
        XCTAssertEqual(groups[3].waypointIds.first, "tangled", "stored order moves tangled to the front of its bucket")
        XCTAssertEqual(groups[4].waypointIds, ["aturiExplore", "atptools", "taproot"], "hidden pdsls skipped")
        XCTAssertEqual(groups[5], WaypointGroup(id: "custom", name: "My Waypoints", waypointIds: ["retiredWaypoint", "custom:one"]))
        XCTAssertEqual(groups[2].name, "Publications")
    }

    func testMergeMigratesWhenGroupsAreAbsentOrAllInvalid() {
        let merged = Preferences.mergeWithDefaults(json(#"""
        {"hiddenWaypoints": ["anisota"], "waypointOrder": ["deer"], "waypointGroups": [{"id": 1}]}
        """#))
        XCTAssertEqual(merged.waypointGroups.map(\.id), ["blueskyClients", "blueskyForks", "publications", "atmosphereApps", "devTools"])
        XCTAssertFalse(merged.waypointGroups.flatMap(\.waypointIds).contains("anisota"))
        XCTAssertEqual(merged.waypointGroups[1].waypointIds.first, "deer")
        XCTAssertEqual(merged.hiddenWaypoints, ["anisota"], "legacy lists are kept for the write path")
        XCTAssertEqual(merged.waypointOrder, ["deer"])
    }

    func testMigrateWithNothingHiddenEqualsDefaults() {
        XCTAssertEqual(Preferences.migrateToGroups(), Preferences.defaultWaypointGroups())
    }

    func testPrettyGroupName() {
        XCTAssertEqual(Preferences.prettyGroupName("blueskyClients"), "Bluesky Clients")
        XCTAssertEqual(Preferences.prettyGroupName("devTools"), "Dev Tools")
        XCTAssertEqual(Preferences.prettyGroupName("custom"), "Custom")
    }

    // MARK: Record encoding

    func testRecordValueCarriesTheWebKeys() {
        let record = customized.toRecordValue(now: Date(timeIntervalSince1970: 1_758_276_000))
        let expectedKeys: Set<String> = [
            "$type", "colorScheme", "waypointGroups", "customWaypoints", "autoRedirect", "favoriteByFamily", "waypointLayout",
            "knownWaypointIds", "lastSeenReleaseId", "announceReleases", "pinnedLexicons", "pinnedLexiconsOthers", "pinScope",
            "collectionGroupsCollapsedByDefault", "repoGlanceCollapsedByDefault", "recordSections", "repoSections",
            "hideRelationshipBar", "hideRepoGlance", "minimalProfile", "hideRichPreview", "hideRichJsonPreview", "showRawRecordJson",
            "hiddenWaypoints", "waypointOrder", "updatedAt",
        ]
        XCTAssertEqual(Set(record.objectValue?.keys ?? [:].keys), expectedKeys)
        XCTAssertEqual(record["$type"]?.stringValue, "to.aturi.actor.preferences")
        XCTAssertEqual(record["updatedAt"]?.stringValue, "2025-09-19T10:00:00.000Z")
        // Derived booleans come from the section lists, not the stored flags.
        XCTAssertEqual(record["hideRichPreview"]?.boolValue, true)
        XCTAssertEqual(record["showRawRecordJson"]?.boolValue, true)
        XCTAssertEqual(record["hideRichJsonPreview"]?.boolValue, false)
        XCTAssertEqual(record["hideRelationshipBar"]?.boolValue, true)
        XCTAssertEqual(record["minimalProfile"]?.boolValue, true)
        XCTAssertEqual(record["hideRepoGlance"]?.boolValue, false)
        XCTAssertEqual(record["hiddenWaypoints"], ["pdsls"])
        XCTAssertEqual(record["waypointOrder"], ["deer", "bluesky"])
        XCTAssertEqual(record["favoriteByFamily"], ["bluesky-social": "deer", "tangled": "tangled"])
        XCTAssertEqual(record["waypointGroups"]?[0]?["collapsed"]?.boolValue, true)
        XCTAssertNil(record["waypointGroups"]?[1]?["collapsed"], "absent collapsed is omitted like JSON.stringify drops undefined")
        XCTAssertEqual(record["customWaypoints"]?[0]?["templates"]?["post"]?.stringValue, "https://myapp.example/u/{handle}/p/{rkey}")
        XCTAssertEqual(record["customWaypoints"]?[0]?["redirectCompat"], ["bluesky-social"])
        XCTAssertNil(record["customWaypoints"]?[0]?["description"])
        XCTAssertNil(record["minimalPostPreview"], "the record never carries the deprecated flag")
    }

    func testRecordRoundTrip() {
        let original = customized
        let stamp = Date(timeIntervalSince1970: 1_758_276_000)
        let record = original.toRecordValue(now: stamp)
        // Through the wire form, as the PDS would hand it back.
        let wire = try! JSONValue.parse(Data(record.compactString().utf8))
        let restored = Preferences(recordValue: wire)
        // The record carries a fresh updatedAt, no minimalPostPreview, and the
        // per-section booleans derived from the section lists, so those are
        // the only fields a round trip is allowed to change.
        var expected = original
        expected.updatedAt = Formatting.isoTimestamp(stamp)
        expected.minimalPostPreview = false
        expected.hideRichPreview = true
        expected.hideRichJsonPreview = false
        expected.showRawRecordJson = true
        expected.hideRelationshipBar = true
        expected.minimalProfile = true
        expected.hideRepoGlance = false
        XCTAssertTrue(Preferences.preferencesAreEqual(expected, restored))
        XCTAssertEqual(restored, expected)
        XCTAssertEqual(restored.hiddenWaypoints, ["pdsls"])
        XCTAssertEqual(restored.waypointOrder, ["deer", "bluesky"])
        XCTAssertEqual(restored.customWaypoints, [sampleCustom])
        XCTAssertEqual(restored.waypointGroups, original.waypointGroups)
        // The deprecated flag is not in the record; the web derives hideRichPreview instead.
        XCTAssertFalse(restored.minimalPostPreview)
        XCTAssertTrue(restored.hideRichPreview)
    }

    func testCodableRoundTripIsLossless() throws {
        let original = customized
        let data = try JSONEncoder().encode(original)
        let decoded = try JSONDecoder().decode(Preferences.self, from: data)
        XCTAssertEqual(decoded, original)
        let keys = Set((try JSONValue.parse(data)).objectValue?.keys ?? [:].keys)
        XCTAssertTrue(keys.contains("minimalPostPreview"))
        XCTAssertTrue(keys.contains("updatedAt"))
        XCTAssertFalse(keys.contains("$type"))
        XCTAssertEqual(try JSONDecoder().decode([CustomWaypoint].self, from: JSONEncoder().encode([sampleCustom])), [sampleCustom])
        XCTAssertEqual(try JSONDecoder().decode([WaypointGroup].self, from: JSONEncoder().encode(original.waypointGroups)), original.waypointGroups)
    }

    func testDecodesARecordTheWebWrote() {
        let record = json(#"""
        {"$type": "to.aturi.actor.preferences", "colorScheme": "dusk",
         "waypointGroups": [{"id": "blueskyClients", "name": "Bluesky", "waypointIds": ["bluesky"], "collapsed": false}],
         "customWaypoints": [{"id": "custom:k", "name": "K", "domain": "k.test", "supportedTypes": ["profile"], "templates": {"profile": "https://k.test/{actor}"}}],
         "autoRedirect": true, "favoriteByFamily": {"bluesky-social": "bluesky", "tangled": null},
         "waypointLayout": "classic", "knownWaypointIds": ["bluesky"], "lastSeenReleaseId": "2026-03", "announceReleases": false,
         "pinnedLexicons": ["app.bsky.*"], "pinnedLexiconsOthers": [], "pinScope": "all",
         "collectionGroupsCollapsedByDefault": true, "repoGlanceCollapsedByDefault": false,
         "recordSections": [{"id": "rawJson", "hidden": false}], "repoSections": [{"id": "profile", "hidden": true}],
         "hideRelationshipBar": false, "hideRepoGlance": false, "minimalProfile": true, "hideRichPreview": false,
         "hideRichJsonPreview": false, "showRawRecordJson": true, "hiddenWaypoints": [], "waypointOrder": [],
         "updatedAt": "2026-09-01T00:00:00.000Z"}
        """#)
        let prefs = Preferences(recordValue: record)
        XCTAssertEqual(prefs.colorScheme, .dusk)
        XCTAssertEqual(prefs.waypointGroups, [WaypointGroup(id: "blueskyClients", name: "Bluesky", waypointIds: ["bluesky"], collapsed: false)])
        XCTAssertEqual(prefs.customWaypoints.first?.templates, [.profile: "https://k.test/{actor}"])
        XCTAssertTrue(prefs.autoRedirect)
        XCTAssertEqual(prefs.favoriteByFamily, [.blueskySocial: "bluesky"])
        XCTAssertEqual(prefs.waypointLayout, .classic)
        XCTAssertEqual(prefs.knownWaypointIds, ["bluesky"])
        XCTAssertEqual(prefs.lastSeenReleaseId, "2026-03")
        XCTAssertFalse(prefs.announceReleases)
        XCTAssertEqual(prefs.pinScope, .all)
        XCTAssertEqual(prefs.recordSections.first, SectionConfig(id: "rawJson", hidden: false))
        XCTAssertEqual(prefs.recordSections.count, 8)
        XCTAssertEqual(prefs.repoSections.first, SectionConfig(id: "profile", hidden: true))
        XCTAssertEqual(prefs.updatedAt, "2026-09-01T00:00:00.000Z")
    }

    // MARK: Equality and merging

    func testPreferencesAreEqualNoticesAChangedFavorite() {
        var a = Preferences.defaults
        a.autoRedirect = true
        var b = a
        b.setFavorite(for: .blueskySocial, waypointId: "deer")
        XCTAssertFalse(Preferences.preferencesAreEqual(a, b))
        XCTAssertTrue(Preferences.preferencesAreEqual(b, b))
        var cleared = b
        cleared.setFavorite(for: .blueskySocial, waypointId: nil)
        XCTAssertTrue(cleared.favoriteByFamily.isEmpty)
        XCTAssertTrue(Preferences.preferencesAreEqual(a, cleared))
        var blank = b
        blank.setFavorite(for: .blueskySocial, waypointId: "")
        XCTAssertTrue(blank.favoriteByFamily.isEmpty, "an empty id clears like nil")
    }

    func testPreferencesAreEqualIgnoresLegacyLists() {
        var a = Preferences.defaults
        var b = a
        b.hiddenWaypoints = ["x"]
        b.waypointOrder = ["y"]
        XCTAssertTrue(Preferences.preferencesAreEqual(a, b))
        XCTAssertNotEqual(a, b, "full struct equality still sees them")
        a.updatedAt = "2026-01-01T00:00:00.000Z"
        XCTAssertFalse(Preferences.preferencesAreEqual(a, b))
    }

    func testFavoriteByFamilySerializesInAStableKeyOrder() {
        var one = Preferences.defaults
        one.setFavorite(for: .tangled, waypointId: "tangled")
        one.setFavorite(for: .blueskySocial, waypointId: "deer")
        var two = Preferences.defaults
        two.setFavorite(for: .blueskySocial, waypointId: "deer")
        two.setFavorite(for: .tangled, waypointId: "tangled")
        XCTAssertEqual(one.jsonValue()["favoriteByFamily"]?.compactString(), two.jsonValue()["favoriteByFamily"]?.compactString())
        XCTAssertEqual(one, two)
    }

    func testPickNewer() {
        var older = Preferences.defaults
        older.updatedAt = "2026-01-01T00:00:00.000Z"
        var newer = Preferences.defaults
        newer.updatedAt = "2026-02-01T00:00:00.000Z"
        newer.colorScheme = .sol
        XCTAssertEqual(Preferences.pickNewer(older, newer), newer)
        XCTAssertEqual(Preferences.pickNewer(newer, older), newer)
        var tie = older
        tie.colorScheme = .noir
        XCTAssertEqual(Preferences.pickNewer(older, tie), tie, "ties prefer the second argument")
        var broken = newer
        broken.updatedAt = "not a date"
        XCTAssertEqual(Preferences.pickNewer(older, broken), older, "an unparsable timestamp never wins")
        XCTAssertEqual(Preferences.pickNewer(broken, older), broken)
    }

    func testHasLocalCustomization() {
        XCTAssertFalse(Preferences.defaults.hasLocalCustomization)
        var scheme = Preferences.defaults
        scheme.colorScheme = .ember
        XCTAssertTrue(scheme.hasLocalCustomization)
        var groups = Preferences.defaults
        groups.removeGroup(id: "devTools")
        XCTAssertTrue(groups.hasLocalCustomization)
        var pins = Preferences.defaults
        pins.addPinnedLexicon("app.bsky.feed.post")
        XCTAssertFalse(pins.hasLocalCustomization, "pins do not count, matching the provider")
    }

    // MARK: Templates (template.test.ts, web semantics)

    func testExpandTemplate() {
        let ctx = CustomWaypointContext(handle: "alice.test", did: "did:plc:abc", collection: "app.bsky.feed.post", rkey: "3k")
        XCTAssertEqual(expandTemplate("https://x.test/{handle}/{rkey}", context: ctx), "https://x.test/alice.test/3k")
        // The web replaces only the literal "did%3A", so the second colon of a
        // did:plc value stays encoded. Faithful to the quirk, not a bug here.
        XCTAssertEqual(expandTemplate("https://x.test/{did}/{collection}/{rkey}", context: ctx), "https://x.test/did:plc%3Aabc/app.bsky.feed.post/3k")
        XCTAssertEqual(expandTemplate("https://x.test/{actor}", context: ctx), "https://x.test/did:plc%3Aabc", "{actor} prefers the DID")
        XCTAssertEqual(expandTemplate("https://x.test/{actor}", context: CustomWaypointContext(handle: "alice.test")), "https://x.test/alice.test")
        XCTAssertEqual(expandTemplate("https://x.test/{handle}?u={handle}", context: ctx), "https://x.test/alice.test?u=alice.test", "every occurrence is replaced")
        XCTAssertEqual(expandTemplate("https://x.test/q/{rkey}", context: CustomWaypointContext(handle: "a b", rkey: "r/k")), "https://x.test/q/r%2Fk")
        XCTAssertEqual(expandTemplate("https://x.test/{handle}", context: CustomWaypointContext(handle: "a b")), "https://x.test/a%20b")
        XCTAssertNil(expandTemplate("https://x.test/{rkey}", context: CustomWaypointContext(handle: "alice.test")), "a missing placeholder value is nil")
        XCTAssertNil(expandTemplate("https://x.test/{handle}", context: CustomWaypointContext(handle: "")), "an empty value counts as missing")
        XCTAssertEqual(expandTemplate("https://x.test/static", context: CustomWaypointContext()), "https://x.test/static")
        XCTAssertEqual(expandTemplate("https://x.test/{unknown}", context: ctx), "https://x.test/{unknown}", "unknown tokens are left alone")
    }

    func testCustomWaypointUrlPicksTheTemplateForTheTarget() {
        let cw = sampleCustom
        XCTAssertEqual(customWaypointUrl(cw, context: CustomWaypointContext(handle: "alice")), "https://myapp.example/u/alice")
        XCTAssertEqual(cw.url(for: CustomWaypointContext(handle: "alice", collection: "app.bsky.feed.post", rkey: "rk")), "https://myapp.example/u/alice/p/rk")
        // A list record on a waypoint without list support: the web falls to
        // the `post` key (there is no record template), not to profile.
        XCTAssertEqual(customWaypointUrl(cw, context: CustomWaypointContext(handle: "alice", collection: "app.bsky.graph.list", rkey: "lk")), "https://myapp.example/u/alice/p/lk")
        // Collection without rkey is a profile.
        XCTAssertEqual(customWaypointUrl(cw, context: CustomWaypointContext(handle: "alice", collection: "app.bsky.feed.post")), "https://myapp.example/u/alice")

        let recordOnly = CustomWaypoint(id: "custom:r", name: "R", supportedTypes: [.record], templates: [.record: "https://r.test/{actor}/{collection}/{rkey}"])
        XCTAssertEqual(customWaypointUrl(recordOnly, context: CustomWaypointContext(handle: "alice", did: "did:plc:x", collection: "sh.tangled.repo", rkey: "r")), "https://r.test/did:plc%3Ax/sh.tangled.repo/r")
        XCTAssertNil(customWaypointUrl(recordOnly, context: CustomWaypointContext(handle: "alice")), "profile falls back to record, which needs a collection")

        let profileOnly = CustomWaypoint(id: "custom:p", name: "P", supportedTypes: [.profile], templates: [.profile: "https://p.test/{handle}"])
        XCTAssertEqual(customWaypointUrl(profileOnly, context: CustomWaypointContext(handle: "alice", collection: "com.example.x", rkey: "1")), "https://p.test/alice", "record falls back to profile")

        let blankPost = CustomWaypoint(id: "custom:b", name: "B", supportedTypes: [.post, .record], templates: [.post: "", .record: "https://b.test/{rkey}"])
        XCTAssertEqual(customWaypointUrl(blankPost, context: CustomWaypointContext(handle: "alice", collection: "app.bsky.feed.post", rkey: "z")), "https://b.test/z", "an empty template is skipped")
        XCTAssertNil(customWaypointUrl(CustomWaypoint(id: "custom:n", name: "N", supportedTypes: [.post], templates: [:]), context: CustomWaypointContext(handle: "alice")))
    }

    func testGetRedirectCompatFor() {
        XCTAssertEqual(getRedirectCompatFor("bluesky", customWaypoints: []), [.blueskySocial])
        XCTAssertEqual(getRedirectCompatFor("taproot", customWaypoints: []), [])
        XCTAssertEqual(getRedirectCompatFor("nope", customWaypoints: []), [])
        XCTAssertEqual(getRedirectCompatFor("custom:one", customWaypoints: [sampleCustom]), [.blueskySocial])
        var noFamily = sampleCustom
        noFamily.redirectCompat = nil
        XCTAssertEqual(getRedirectCompatFor("custom:one", customWaypoints: [noFamily]), [])
        XCTAssertEqual(getRedirectCompatFor("custom:missing", customWaypoints: [sampleCustom]), [])
    }

    // MARK: Known waypoints (prefs-known.test.ts)

    func testNewBuiltinWaypointIds() {
        var prefs = Preferences.defaults
        XCTAssertEqual(prefs.newBuiltinWaypointIds, [])
        prefs.knownWaypointIds = WaypointCatalog.order.filter { $0 != "bluepy" && $0 != "deer" }
        XCTAssertEqual(prefs.newBuiltinWaypointIds, ["bluepy", "deer"], "ordered by the catalog, so bluepy comes before deer")
        prefs.knownWaypointIds = []
        XCTAssertEqual(prefs.newBuiltinWaypointIds, WaypointCatalog.order, "an empty known list flags everything; seeding happens on read")
        prefs.knownWaypointIds = WaypointCatalog.order + ["retiredWaypoint", "custom:x"]
        XCTAssertEqual(prefs.newBuiltinWaypointIds, [])
    }

    func testAddWaypointToGroupDoesNotTouchKnownIds() {
        // The extension's addWaypointToGroup marks the id known; the web's
        // does not, and the banner's Add action goes through
        // addWaypointsToDefaultGroups instead.
        var prefs = Preferences.defaults
        prefs.waypointGroups = [WaypointGroup(id: "g1", name: "Test", waypointIds: [])]
        prefs.knownWaypointIds = WaypointCatalog.order.filter { $0 != "bluepy" }
        prefs.addWaypoint("bluepy", toGroup: "g1")
        XCTAssertEqual(prefs.waypointGroups[0].waypointIds, ["bluepy"])
        XCTAssertEqual(prefs.newBuiltinWaypointIds, ["bluepy"])
        prefs.addWaypoint("bluepy", toGroup: "g1")
        XCTAssertEqual(prefs.waypointGroups[0].waypointIds, ["bluepy"], "no duplicates")
        prefs.addWaypoint("custom:abc", toGroup: "g1")
        XCTAssertEqual(prefs.waypointGroups[0].waypointIds, ["bluepy", "custom:abc"])
        prefs.addWaypoint("x", toGroup: "missing")
        XCTAssertEqual(prefs.waypointGroups.count, 1)
    }

    func testMarkWaypointsKnown() {
        var prefs = Preferences.defaults
        prefs.knownWaypointIds = WaypointCatalog.order.filter { $0 != "standardReader" }
        let before = prefs
        XCTAssertFalse(prefs.markWaypointsKnown(["custom:abc"]), "custom ids are ignored")
        XCTAssertFalse(prefs.markWaypointsKnown(["bluepy"]), "already known")
        XCTAssertEqual(prefs, before)
        XCTAssertTrue(prefs.markWaypointsKnown(["standardReader", "standardReader"]))
        XCTAssertEqual(prefs.knownWaypointIds.filter { $0 == "standardReader" }.count, 1)
        XCTAssertEqual(prefs.newBuiltinWaypointIds, [])
        XCTAssertEqual(prefs.waypointGroups, before.waypointGroups, "marking known adds nothing to a group")
    }

    // MARK: Adopting new built-ins (prefs-adopt.test.ts, web semantics)

    /// A user who arranged their own groups before standardReader shipped.
    private var customizedGroups: Preferences {
        var prefs = Preferences.defaults
        prefs.waypointGroups = [
            WaypointGroup(id: "publications", name: "Reading", waypointIds: ["leaflet"]),
            WaypointGroup(id: "blueskyClients", name: "Bluesky", waypointIds: ["bluesky", "deer"]),
        ]
        prefs.knownWaypointIds = WaypointCatalog.order.filter { $0 != "standardReader" }
        return prefs
    }

    func testAddToDefaultGroupsPlacesANewBuiltinIntoItsCategoryGroupByIdEvenWhenRenamed() {
        var prefs = customizedGroups
        XCTAssertEqual(prefs.newBuiltinWaypointIds, ["standardReader"])
        prefs.addWaypointsToDefaultGroups(["standardReader"])
        XCTAssertEqual(prefs.waypointGroups[0].waypointIds, ["leaflet", "standardReader"])
        XCTAssertEqual(prefs.waypointGroups[0].name, "Reading")
        XCTAssertEqual(prefs.waypointGroups.map(\.id), ["publications", "blueskyClients"])
        XCTAssertEqual(prefs.waypointGroups[1], customizedGroups.waypointGroups[1])
        XCTAssertEqual(prefs.newBuiltinWaypointIds, [])
    }

    func testAddToDefaultGroupsRecreatesADeletedCategoryGroupAtTheEnd() {
        // The web appends a recreated group; the extension slots it into
        // CATEGORY_ORDER position. This is the web's behaviour.
        var prefs = Preferences.defaults
        prefs.waypointGroups = [
            WaypointGroup(id: "blueskyClients", name: "Bluesky", waypointIds: ["bluesky"]),
            WaypointGroup(id: "atmosphereApps", name: "Atmosphere", waypointIds: ["tangled"]),
        ]
        prefs.addWaypointsToDefaultGroups(["standardReader"])
        XCTAssertEqual(prefs.waypointGroups.map(\.id), ["blueskyClients", "atmosphereApps", "publications"])
        XCTAssertEqual(prefs.waypointGroups[2], WaypointGroup(id: "publications", name: "Publications", waypointIds: ["standardReader"]))
    }

    func testAddToDefaultGroupsIsIdempotentAndIgnoresUnknownIds() {
        var prefs = customizedGroups
        prefs.addWaypointsToDefaultGroups(["standardReader"])
        let once = prefs
        prefs.addWaypointsToDefaultGroups(["standardReader", "custom:mu", "retiredWaypoint"])
        XCTAssertEqual(prefs.waypointGroups, once.waypointGroups)
        XCTAssertFalse(prefs.knownWaypointIds.contains("custom:mu"))
        // markWaypointsKnown sees every non-custom id, so a retired id lands
        // in the known list (harmless, and what the web does).
        XCTAssertTrue(prefs.knownWaypointIds.contains("retiredWaypoint"))
        XCTAssertEqual(prefs.knownWaypointIds.filter { $0 == "standardReader" }.count, 1)
    }

    func testAddToDefaultGroupsOneIdAtATime() {
        var prefs = Preferences.defaults
        prefs.waypointGroups = [WaypointGroup(id: "publications", name: "Reading", waypointIds: [])]
        prefs.knownWaypointIds = WaypointCatalog.order.filter { $0 != "standardReader" && $0 != "taproot" }
        for id in prefs.newBuiltinWaypointIds { prefs.addWaypointsToDefaultGroups([id]) }
        XCTAssertEqual(prefs.newBuiltinWaypointIds, [])
        XCTAssertEqual(prefs.waypointGroups.map(\.id), ["publications", "devTools"])
        XCTAssertEqual(prefs.waypointGroups[0].waypointIds, ["standardReader"])
        XCTAssertEqual(prefs.waypointGroups[1].waypointIds, ["taproot"])
    }

    // MARK: Group mutators

    func testGroupMutators() {
        var prefs = Preferences.defaults
        let id = prefs.addGroup(named: "   ")
        XCTAssertTrue(id.hasPrefix("g_"))
        XCTAssertEqual(prefs.waypointGroups.last, WaypointGroup(id: id, name: "New group", waypointIds: []))
        prefs.renameGroup(id: id, name: "  Faves ")
        XCTAssertEqual(prefs.waypointGroups.last?.name, "Faves")
        prefs.renameGroup(id: id, name: " ")
        XCTAssertEqual(prefs.waypointGroups.last?.name, "Faves", "blank rename is a no-op")
        prefs.setGroupCollapsed(id: id, collapsed: true)
        XCTAssertEqual(prefs.waypointGroups.last?.collapsed, true)
        prefs.setGroupWaypointOrder(groupId: id, ids: ["deer", "bluesky", "tangled"])
        XCTAssertEqual(prefs.waypointGroups.last?.waypointIds, ["deer", "bluesky", "tangled"])
        prefs.removeWaypoint("bluesky", fromGroup: id)
        XCTAssertEqual(prefs.waypointGroups.last?.waypointIds, ["deer", "tangled"])
        prefs.removeGroup(id: id)
        XCTAssertEqual(prefs.waypointGroups.map(\.id), Preferences.defaults.waypointGroups.map(\.id))
        prefs.setWaypointGroups([])
        XCTAssertTrue(prefs.waypointGroups.isEmpty)
        XCTAssertNotEqual(Preferences.newGroupId(), Preferences.newGroupId())
        XCTAssertTrue(CustomWaypoint.newId().hasPrefix("custom:"))
        XCTAssertNotEqual(CustomWaypoint.newId(), CustomWaypoint.newId())
    }

    func testAutoRedirectAndLayoutSetters() {
        var prefs = Preferences.defaults
        prefs.setAutoRedirect(true)
        prefs.setWaypointLayout(.classic)
        XCTAssertTrue(prefs.autoRedirect)
        XCTAssertEqual(prefs.waypointLayout, .classic)
    }

    // MARK: Pins

    func testPinMutators() {
        var prefs = Preferences.defaults
        prefs.togglePinnedLexicon("app.bsky.feed.post")
        XCTAssertEqual(prefs.pinnedLexicons, ["app.bsky.feed.post"])
        prefs.addPinnedLexicon("app.bsky.feed.post")
        XCTAssertEqual(prefs.pinnedLexicons, ["app.bsky.feed.post"], "no duplicate")
        prefs.addPinnedLexicon("sh.tangled.*", target: .others)
        XCTAssertEqual(prefs.pinnedLexiconsOthers, ["sh.tangled.*"])
        prefs.togglePinnedLexicon("app.bsky.feed.post")
        XCTAssertEqual(prefs.pinnedLexicons, [])
        prefs.removePinnedLexicon("sh.tangled.*", target: .others)
        XCTAssertEqual(prefs.pinnedLexiconsOthers, [])
        prefs.setPinScope(.split)
        XCTAssertEqual(prefs.pinScope, .split)
        XCTAssertEqual(PinnedLexicons.target(scope: .split, isOwnRepo: false), .others)
        XCTAssertEqual(PinnedLexicons.target(scope: .split, isOwnRepo: true), .mine)
        XCTAssertEqual(PinnedLexicons.target(scope: .all, isOwnRepo: false), .mine)
    }

    func testPinEntryHelpers() {
        XCTAssertTrue(PinnedLexicons.isGroup("app.bsky.*"))
        XCTAssertFalse(PinnedLexicons.isGroup("app.bsky.feed.post"))
        XCTAssertEqual(PinnedLexicons.groupPrefix("app.bsky.feed.*"), "app.bsky.feed")
        XCTAssertEqual(PinnedLexicons.groupPrefix("app.bsky.feed.post"), "app.bsky.feed.post")
        XCTAssertTrue(PinnedLexicons.matches(entry: "app.bsky.feed.post", nsid: "app.bsky.feed.post"))
        XCTAssertFalse(PinnedLexicons.matches(entry: "app.bsky.feed.post", nsid: "app.bsky.feed.like"))
        XCTAssertTrue(PinnedLexicons.matches(entry: "app.bsky.feed.*", nsid: "app.bsky.feed"))
        XCTAssertTrue(PinnedLexicons.matches(entry: "app.bsky.feed.*", nsid: "app.bsky.feed.post"))
        XCTAssertFalse(PinnedLexicons.matches(entry: "app.bsky.feed.*", nsid: "app.bsky.feedback"))
        XCTAssertTrue(PinnedLexicons.covered(by: ["x.y.z", "app.bsky.*"], nsid: "app.bsky.graph.list"))
        XCTAssertFalse(PinnedLexicons.covered(by: ["app.bsky.graph.list"], nsid: "app.bsky.graph.list"), "only group pins count")
        XCTAssertTrue(PinnedLexicons.isLikelyNsid("app.bsky.feed.post"))
        XCTAssertTrue(PinnedLexicons.isLikelyNsid("  com.example.thing  "))
        XCTAssertFalse(PinnedLexicons.isLikelyNsid("app.bsky"))
        XCTAssertFalse(PinnedLexicons.isLikelyNsid("app.bsky.*"))
        XCTAssertFalse(PinnedLexicons.isLikelyNsid("app.1bsky.post"))
        XCTAssertFalse(PinnedLexicons.isLikelyNsid(""))
        XCTAssertFalse(PinnedLexicons.isLikelyNsid(String(repeating: "a.", count: 127) + "b"))
        XCTAssertTrue(PinnedLexicons.isLikelyPinEntry("app.bsky.*"))
        XCTAssertTrue(PinnedLexicons.isLikelyPinEntry("app.bsky.feed.*"))
        XCTAssertFalse(PinnedLexicons.isLikelyPinEntry("app.*"))
        XCTAssertTrue(PinnedLexicons.isLikelyPinEntry("app.bsky.feed.post"))
        XCTAssertFalse(PinnedLexicons.isLikelyPinEntry("app.bsky"))
    }

    // MARK: Sections

    func testSetSectionHiddenKeepsOneGuaranteedDataViewVisible() {
        var prefs = Preferences.defaults
        // rawJson is hidden by default, so structuredJson is the last data view.
        prefs.setSectionHidden(page: .record, id: "structuredJson", hidden: true)
        XCTAssertFalse(ExploreSections.sectionHidden(prefs.recordSections, id: "structuredJson"))
        prefs.setSectionHidden(page: .record, id: "richPreview", hidden: true)
        XCTAssertTrue(ExploreSections.sectionHidden(prefs.recordSections, id: "richPreview"), "non-guaranteed sections hide freely")
        prefs.setSectionHidden(page: .record, id: "rawJson", hidden: false)
        prefs.setSectionHidden(page: .record, id: "structuredJson", hidden: true)
        XCTAssertTrue(ExploreSections.sectionHidden(prefs.recordSections, id: "structuredJson"))
        prefs.setSectionHidden(page: .record, id: "rawJson", hidden: true)
        XCTAssertFalse(ExploreSections.sectionHidden(prefs.recordSections, id: "rawJson"), "cannot hide the last one")
        prefs.setSectionHidden(page: .repo, id: "profile", hidden: true)
        prefs.setSectionHidden(page: .repo, id: "identity", hidden: true)
        XCTAssertEqual(prefs.repoSections.filter(\.hidden).map(\.id), ["profile"])
        XCTAssertEqual(ExploreSections.countVisibleGuaranteed(prefs.repoSections, page: .repo), 1)
    }

    func testToggleRecordDataViewShowsThePartner() {
        var prefs = Preferences.defaults
        prefs.toggleRecordDataView("structuredJson")
        XCTAssertTrue(ExploreSections.sectionHidden(prefs.recordSections, id: "structuredJson"))
        XCTAssertFalse(ExploreSections.sectionHidden(prefs.recordSections, id: "rawJson"), "hiding one shows the other")
        prefs.toggleRecordDataView("structuredJson")
        XCTAssertFalse(ExploreSections.sectionHidden(prefs.recordSections, id: "structuredJson"))
        XCTAssertFalse(ExploreSections.sectionHidden(prefs.recordSections, id: "rawJson"), "showing one leaves the other alone")
        prefs.toggleRecordDataView("rawJson")
        XCTAssertTrue(ExploreSections.sectionHidden(prefs.recordSections, id: "rawJson"))
        prefs.setSections(page: .repo, sections: [SectionConfig(id: "identity", hidden: false)])
        XCTAssertEqual(prefs.sections(for: .repo).count, 1)
        prefs.resetSections(page: .repo)
        XCTAssertEqual(prefs.repoSections, ExploreSections.defaultRepoSections)
        prefs.resetSections(page: .record)
        XCTAssertEqual(prefs.recordSections, ExploreSections.defaultRecordSections)
    }

    func testExploreSectionMetadata() {
        XCTAssertEqual(ExploreSections.meta(for: .record).count, 8)
        XCTAssertEqual(ExploreSections.meta(for: .repo).count, 4)
        XCTAssertEqual(ExploreSections.meta(for: .record).first?.kind, .recordData)
        XCTAssertEqual(ExploreSections.meta(for: .repo).first?.kind, .helper)
        XCTAssertTrue(ExploreSections.isGuaranteedDataView(.record, id: "rawJson"))
        XCTAssertFalse(ExploreSections.isGuaranteedDataView(.record, id: "richPreview"))
        XCTAssertTrue(ExploreSections.isGuaranteedDataView(.repo, id: "identity"))
        XCTAssertEqual(ExploreSections.defaults(for: .record), ExploreSections.defaultRecordSections)
        XCTAssertNil(SectionConfig(json: ["id": "x", "hidden": "no"]))
        XCTAssertEqual(SectionConfig(json: ["id": "x", "hidden": true]), SectionConfig(id: "x", hidden: true))
    }
}
