import XCTest
@testable import AturiCore

final class DIDDocumentTests: XCTestCase {
    private func decode(_ json: String) throws -> DIDDocument {
        try JSONDecoder().decode(DIDDocument.self, from: Data(json.utf8))
    }

    private let plcShaped = """
    {"@context":["https://www.w3.org/ns/did/v1"],"id":"did:plc:livehealthyaccount00001","alsoKnownAs":["at://alive.example"],"verificationMethod":[{"id":"did:plc:livehealthyaccount00001#atproto","type":"Multikey","controller":"did:plc:livehealthyaccount00001","publicKeyMultibase":"zQ3shExample"}],"service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"https://pds.example"}]}
    """

    func testDecodesAPLCShapedDocument() throws {
        let doc = try decode(plcShaped)
        XCTAssertEqual(doc.id, "did:plc:livehealthyaccount00001")
        XCTAssertEqual(doc.alsoKnownAs, ["at://alive.example"])
        XCTAssertEqual(doc.verificationMethod?.count, 1)
        XCTAssertEqual(doc.verificationMethod?[0].type, "Multikey")
        XCTAssertEqual(doc.verificationMethod?[0].controller, "did:plc:livehealthyaccount00001")
        XCTAssertEqual(doc.verificationMethod?[0].publicKeyMultibase, "zQ3shExample")
        XCTAssertEqual(doc.service, [DIDDocument.Service(id: "#atproto_pds", type: "AtprotoPersonalDataServer", serviceEndpoint: "https://pds.example")])
        XCTAssertEqual(doc.pdsEndpoint, "https://pds.example")
        XCTAssertEqual(doc.handle, "alive.example")
    }

    func testRoundTripsThroughCodable() throws {
        let doc = try decode(plcShaped)
        let data = try JSONEncoder().encode(doc)
        let again = try JSONDecoder().decode(DIDDocument.self, from: data)
        XCTAssertEqual(again, doc)
    }

    // MARK: pdsEndpoint

    func testPdsEndpointMatchesByIdOrByType() throws {
        let byType = try decode(##"{"id":"did:web:x.example","service":[{"id":"#other","type":"AtprotoPersonalDataServer","serviceEndpoint":"https://pds.x.example/"}]}"##)
        XCTAssertEqual(byType.pdsEndpoint, "https://pds.x.example/", "verbatim, trailing slash kept for the caller to strip")

        let byId = try decode(##"{"id":"did:web:x.example","service":[{"id":"#atproto_pds","type":"Something","serviceEndpoint":"https://pds.x.example"}]}"##)
        XCTAssertEqual(byId.pdsEndpoint, "https://pds.x.example")

        let firstMatchWins = try decode(##"{"id":"did:web:x.example","service":[{"id":"#atproto_labeler","type":"AtprotoLabeler","serviceEndpoint":"https://labeler.example"},{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"https://pds.example"}]}"##)
        XCTAssertEqual(firstMatchWins.pdsEndpoint, "https://pds.example")
    }

    func testPdsEndpointIsNilWithoutAPDSService() throws {
        XCTAssertNil(try decode(##"{"id":"did:web:x.example"}"##).pdsEndpoint)
        XCTAssertNil(try decode(##"{"id":"did:web:x.example","service":[]}"##).pdsEndpoint)
        XCTAssertNil(try decode(##"{"id":"did:web:x.example","service":[{"id":"#atproto_labeler","type":"AtprotoLabeler","serviceEndpoint":"https://labeler.example"}]}"##).pdsEndpoint)
        XCTAssertNil(try decode(##"{"id":"did:web:x.example","service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":""}]}"##).pdsEndpoint)
    }

    // MARK: handle

    func testHandleIsTheFirstAtEntryInAlsoKnownAs() throws {
        let doc = try decode(##"{"id":"did:plc:x","alsoKnownAs":["https://alice.example","at://alice.example","at://second.example"]}"##)
        XCTAssertEqual(doc.handle, "alice.example")
    }

    func testHandleIsNilWhenAbsentOrEmpty() throws {
        XCTAssertNil(try decode(##"{"id":"did:plc:x"}"##).handle)
        XCTAssertNil(try decode(##"{"id":"did:plc:x","alsoKnownAs":[]}"##).handle)
        XCTAssertNil(try decode(##"{"id":"did:plc:x","alsoKnownAs":["https://alice.example"]}"##).handle)
        XCTAssertNil(try decode(##"{"id":"did:plc:x","alsoKnownAs":["at://"]}"##).handle, "an empty claim is no handle")
    }

    // MARK: lenient decoding

    func testServiceEndpointArrayTakesTheFirstEntry() throws {
        let doc = try decode(##"{"id":"did:web:x.example","service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":["https://one.example","https://two.example"]}]}"##)
        XCTAssertEqual(doc.pdsEndpoint, "https://one.example")
    }

    func testServiceEndpointMapDecodesAsNoEndpoint() throws {
        let doc = try decode(##"{"id":"did:web:x.example","service":[{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":{"uri":"https://one.example"}}]}"##)
        XCTAssertEqual(doc.service?.count, 1)
        XCTAssertEqual(doc.service?[0].serviceEndpoint, "")
        XCTAssertNil(doc.pdsEndpoint)
    }

    func testMalformedEntriesAreDroppedNotFatal() throws {
        let doc = try decode("""
        {"id":"did:web:x.example","verificationMethod":[{"id":"#k1","type":"Multikey"},{"type":"no id"},"just a string"],"service":[{"id":"#broken"},{"id":"#atproto_pds","type":"AtprotoPersonalDataServer","serviceEndpoint":"https://pds.example"},42]}
        """)
        XCTAssertEqual(doc.verificationMethod?.map(\.id), ["#k1"])
        XCTAssertNil(doc.verificationMethod?[0].controller)
        XCTAssertEqual(doc.service?.map(\.id), ["#atproto_pds"])
        XCTAssertEqual(doc.pdsEndpoint, "https://pds.example")
    }

    func testAMissingIdIsStillAnError() {
        XCTAssertThrowsError(try decode(##"{"alsoKnownAs":["at://alice.example"]}"##))
    }

    func testUnknownTopLevelKeysAreIgnored() throws {
        let doc = try decode(##"{"id":"did:web:x.example","@context":"https://www.w3.org/ns/did/v1","authentication":["#k1"],"keyAgreement":[]}"##)
        XCTAssertEqual(doc.id, "did:web:x.example")
        XCTAssertNil(doc.service)
        XCTAssertNil(doc.verificationMethod)
    }
}
