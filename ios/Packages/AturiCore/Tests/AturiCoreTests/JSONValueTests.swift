import XCTest
@testable import AturiCore

final class JSONValueTests: XCTestCase {
    private let nested: JSONValue = [
        "text": "hello",
        "count": 3,
        "ratio": 0.5,
        "flag": true,
        "nothing": nil,
        "tags": ["a", "b", ["deep", nil, 2]],
        "embed": ["images": [["alt": "one"], ["alt": "", "size": 1.25]], "empty": [:]],
    ]

    func testParseRoundTripsNestedDocument() throws {
        let text = nested.compactString()
        let parsed = try JSONValue.parse(Data(text.utf8))
        XCTAssertEqual(parsed, nested)
        XCTAssertEqual(parsed.compactString(), text)
    }

    func testCodableRoundTrip() throws {
        let data = try JSONEncoder().encode(nested)
        let decoded = try JSONDecoder().decode(JSONValue.self, from: data)
        XCTAssertEqual(decoded, nested)
    }

    func testJSONSerializationBridgingRoundTrip() throws {
        let raw = Data(#"{"b":true,"f":false,"one":1,"zero":0,"half":1.5,"s":"x","n":null,"a":[1,true,null,"s"]}"#.utf8)
        let object = try JSONSerialization.jsonObject(with: raw)
        let value = try JSONValue(any: object)
        XCTAssertEqual(value["b"], .bool(true))
        XCTAssertEqual(value["f"], .bool(false))
        XCTAssertEqual(value["one"], .number(1))
        XCTAssertEqual(value["zero"], .number(0))
        XCTAssertEqual(value["half"], .number(1.5))
        XCTAssertEqual(value["s"], .string("x"))
        XCTAssertEqual(value["n"], .null)
        XCTAssertEqual(value["a"], [1, true, nil, "s"])

        let back = value.toAny()
        let again = try JSONValue(any: back)
        XCTAssertEqual(again, value)
        XCTAssertTrue(JSONSerialization.isValidJSONObject(back))
    }

    func testToAnyThenSerializeParsesBack() throws {
        let data = try JSONSerialization.data(withJSONObject: nested.toAny())
        XCTAssertEqual(try JSONValue.parse(data), nested)
    }

    func testSubscriptsAndAccessors() {
        XCTAssertEqual(nested["text"]?.stringValue, "hello")
        XCTAssertEqual(nested["count"]?.intValue, 3)
        XCTAssertEqual(nested["count"]?.doubleValue, 3)
        XCTAssertNil(nested["ratio"]?.intValue)
        XCTAssertEqual(nested["ratio"]?.doubleValue, 0.5)
        XCTAssertEqual(nested["flag"]?.boolValue, true)
        XCTAssertEqual(nested["nothing"]?.isNull, true)
        XCTAssertNil(nested["missing"])
        XCTAssertEqual(nested["tags"]?[0]?.stringValue, "a")
        XCTAssertEqual(nested["tags"]?[2]?[1]?.isNull, true)
        XCTAssertNil(nested["tags"]?[9])
        XCTAssertNil(nested["tags"]?[-1])
        XCTAssertNil(nested["text"]?[0])
        XCTAssertNil(nested["text"]?["x"])
        XCTAssertEqual(nested["embed"]?["images"]?.arrayValue?.count, 2)
        XCTAssertEqual(nested["embed"]?["empty"]?.objectValue?.isEmpty, true)
        XCTAssertNil(nested["text"]?.arrayValue)
        XCTAssertNil(nested["tags"]?.objectValue)
    }

    func testPrettyPrintedSortsKeysAndIndents() {
        let value: JSONValue = ["b": [1, 2], "a": ["z": nil, "y": "q\"uote"]]
        let expected = """
        {
          "a": {
            "y": "q\\"uote",
            "z": null
          },
          "b": [
            1,
            2
          ]
        }
        """
        XCTAssertEqual(value.prettyPrinted(), expected)
        XCTAssertEqual(JSONValue.array([]).prettyPrinted(), "[]")
        XCTAssertEqual(JSONValue.object([:]).prettyPrinted(), "{}")
    }

    func testStringEscaping() throws {
        let value: JSONValue = ["s": "line\nbreak\ttab \\ slash / \u{01} \u{2028} emoji \u{1F600}"]
        let text = value.compactString()
        XCTAssertTrue(text.contains("\\n"))
        XCTAssertTrue(text.contains("\\t"))
        XCTAssertTrue(text.contains("\\\\"))
        XCTAssertTrue(text.contains("\\u0001"))
        XCTAssertEqual(try JSONValue.parse(Data(text.utf8)), value)
    }

    func testNumberFormatting() {
        XCTAssertEqual(JSONValue.number(3).compactString(), "3")
        XCTAssertEqual(JSONValue.number(-42).compactString(), "-42")
        XCTAssertEqual(JSONValue.number(1.5).compactString(), "1.5")
        XCTAssertEqual(JSONValue.number(.nan).compactString(), "null")
        XCTAssertEqual(JSONValue.number(.infinity).compactString(), "null")
    }

    func testParseRejectsMalformedInput() {
        XCTAssertThrowsError(try JSONValue.parse(Data("{not json".utf8)))
        XCTAssertThrowsError(try JSONValue.parse(Data()))
    }

    func testTopLevelScalarsParse() throws {
        XCTAssertEqual(try JSONValue.parse(Data("null".utf8)), .null)
        XCTAssertEqual(try JSONValue.parse(Data("true".utf8)), .bool(true))
        XCTAssertEqual(try JSONValue.parse(Data("\"s\"".utf8)), .string("s"))
        XCTAssertEqual(try JSONValue.parse(Data("12.5".utf8)), .number(12.5))
    }

    func testInitAnyRejectsForeignObjects() {
        XCTAssertThrowsError(try JSONValue(any: Date()))
    }
}
