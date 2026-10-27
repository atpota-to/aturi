import Foundation
import XCTest
@testable import AturiCore

/// Nothing syncs the Swift catalog from `src/utils/waypoints.data.ts`; it is a
/// hand port. These tests are the drift guard: they read the TypeScript file
/// and the asset catalog straight from the repository checkout and fail when
/// a waypoint exists in one place and not the others. Outside the repo (the
/// package built on its own) there is nothing to compare against, so they
/// skip rather than fail.
final class CatalogDriftTests: XCTestCase {
    /// `ios/Packages/AturiCore/Tests/AturiCoreTests/<this file>` is five
    /// levels below the repository root.
    private var repoRoot: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent() // AturiCoreTests
            .deletingLastPathComponent() // Tests
            .deletingLastPathComponent() // AturiCore
            .deletingLastPathComponent() // Packages
            .deletingLastPathComponent() // ios
            .deletingLastPathComponent() // repo root
    }

    private func webCatalogOrder() throws -> [String] {
        let file = repoRoot.appendingPathComponent("src/utils/waypoints.data.ts")
        guard let source = try? String(contentsOf: file, encoding: .utf8) else {
            throw XCTSkip("web catalog not available at \(file.path)")
        }
        // `export const WAYPOINT_ORDER = [ 'anisota', 'bluesky', ... ];`
        guard let block = source.firstMatch(of: #/WAYPOINT_ORDER = \[([^\]]*)\]/#) else {
            XCTFail("WAYPOINT_ORDER not found in waypoints.data.ts")
            return []
        }
        return block.1.matches(of: #/'([^']+)'/#).map { String($0.1) }
    }

    func testOrderMatchesWebCatalog() throws {
        let web = try webCatalogOrder()
        XCTAssertFalse(web.isEmpty)
        XCTAssertEqual(WaypointCatalog.order, web, "WaypointCatalog.order must list the same ids in the same order as WAYPOINT_ORDER")
        for id in web {
            XCTAssertNotNil(WaypointCatalog.all[id], "waypoint \(id) is in the web catalog but not the Swift one")
        }
        XCTAssertEqual(Set(WaypointCatalog.all.keys), Set(web), "the Swift catalog has ids the web catalog does not")
    }

    func testEveryWaypointHasAMarkInTheAssetCatalog() throws {
        let marks = repoRoot.appendingPathComponent("ios/Aturi/Resources/Assets.xcassets/Waypoints")
        guard let sets = try? FileManager.default.contentsOfDirectory(atPath: marks.path) else {
            throw XCTSkip("asset catalog not available at \(marks.path)")
        }
        let present = Set(sets.filter { $0.hasSuffix(".imageset") }.map { String($0.dropLast(".imageset".count)) })
        for id in WaypointCatalog.order {
            XCTAssertTrue(present.contains(id), "no image set for \(id); run ios/scripts/export-waypoint-icons.mjs")
        }
    }
}
