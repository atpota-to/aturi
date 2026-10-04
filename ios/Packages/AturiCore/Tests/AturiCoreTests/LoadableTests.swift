import XCTest
@testable import AturiCore

final class LoadableTests: XCTestCase {
    func testAccessorsReflectEachState() {
        let idle: Loadable<Int> = .idle
        XCTAssertTrue(idle.isIdle)
        XCTAssertFalse(idle.isLoading)
        XCTAssertNil(idle.value)
        XCTAssertNil(idle.errorMessage)
        XCTAssertFalse(idle.isFailed)

        let loading: Loadable<Int> = .loading
        XCTAssertTrue(loading.isLoading)
        XCTAssertFalse(loading.isIdle)
        XCTAssertNil(loading.value)

        let loaded: Loadable<Int> = .loaded(7)
        XCTAssertEqual(loaded.value, 7)
        XCTAssertFalse(loaded.isLoading)
        XCTAssertNil(loaded.errorMessage)

        let failed: Loadable<Int> = .failed("boom")
        XCTAssertEqual(failed.errorMessage, "boom")
        XCTAssertTrue(failed.isFailed)
        XCTAssertNil(failed.value)
        XCTAssertFalse(failed.isLoading)
    }

    func testEquatableWhenTheValueIs() {
        XCTAssertEqual(Loadable<[String]>.loaded(["a"]), .loaded(["a"]))
        XCTAssertNotEqual(Loadable<[String]>.loaded(["a"]), .loaded(["b"]))
        XCTAssertEqual(Loadable<String>.failed("x"), .failed("x"))
        XCTAssertNotEqual(Loadable<String>.idle, .loading)
    }

    func testOptionalValuesAreDistinguishable() {
        // A loaded nil is still "loaded": the load finished and found nothing.
        let loadedNil: Loadable<String?> = .loaded(nil)
        XCTAssertFalse(loadedNil.isIdle)
        XCTAssertNotNil(loadedNil.value as Any?)
        if case .loaded(let inner) = loadedNil { XCTAssertNil(inner) } else { XCTFail("expected loaded") }
    }
}
