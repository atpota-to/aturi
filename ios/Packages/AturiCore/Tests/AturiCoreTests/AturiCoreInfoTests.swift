import XCTest
@testable import AturiCore

final class AturiCoreInfoTests: XCTestCase {
    func testVersionIsSet() {
        XCTAssertFalse(AturiCoreInfo.version.isEmpty)
    }
}
