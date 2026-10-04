import Foundation

/// A dynamically typed JSON document.
///
/// atproto records are open schemas: a PDS hands back whatever the writing
/// client put there, and the explorer renders it as a tree. `Codable` structs
/// cannot describe that, so the raw side of every client speaks this type and
/// the typed views (`BskyPost`, `DIDDocument`, ...) are decoded from it
/// leniently where a shape is known.
///
/// Numbers are stored as `Double`, the same precision JavaScript gives the web
/// app, so integers above 2^53 round exactly as they do there.
public enum JSONValue: Codable, Hashable, Sendable {
    case string(String)
    case number(Double)
    case bool(Bool)
    case null
    case array([JSONValue])
    case object([String: JSONValue])

    // MARK: Traversal

    /// Object member, or nil when this is not an object or has no such key.
    public subscript(key: String) -> JSONValue? {
        if case .object(let members) = self { return members[key] }
        return nil
    }

    /// Array element, or nil when this is not an array or the index is out of range.
    public subscript(index: Int) -> JSONValue? {
        if case .array(let elements) = self, elements.indices.contains(index) {
            return elements[index]
        }
        return nil
    }

    public var stringValue: String? {
        if case .string(let s) = self { return s }
        return nil
    }

    public var doubleValue: Double? {
        if case .number(let d) = self { return d }
        return nil
    }

    /// The number when it is integral and fits in `Int`; `3.5` and `1e300` are nil.
    public var intValue: Int? {
        if case .number(let d) = self { return Int(exactly: d) }
        return nil
    }

    public var boolValue: Bool? {
        if case .bool(let b) = self { return b }
        return nil
    }

    public var arrayValue: [JSONValue]? {
        if case .array(let elements) = self { return elements }
        return nil
    }

    public var objectValue: [String: JSONValue]? {
        if case .object(let members) = self { return members }
        return nil
    }

    public var isNull: Bool {
        if case .null = self { return true }
        return false
    }

    // MARK: Codable

    public init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let b = try? container.decode(Bool.self) {
            self = .bool(b)
        } else if let d = try? container.decode(Double.self) {
            self = .number(d)
        } else if let s = try? container.decode(String.self) {
            self = .string(s)
        } else if let a = try? container.decode([JSONValue].self) {
            self = .array(a)
        } else if let o = try? container.decode([String: JSONValue].self) {
            self = .object(o)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Value is not representable as JSON"
            )
        }
    }

    public func encode(to encoder: Encoder) throws {
        var container = encoder.singleValueContainer()
        switch self {
        case .string(let s): try container.encode(s)
        case .number(let d): try container.encode(d)
        case .bool(let b): try container.encode(b)
        case .null: try container.encodeNil()
        case .array(let a): try container.encode(a)
        case .object(let o): try container.encode(o)
        }
    }

    // MARK: JSONSerialization bridging

    /// Build from the object graph `JSONSerialization.jsonObject` returns.
    ///
    /// Booleans and numbers both arrive as `NSNumber`, and a bridged `1` will
    /// happily cast to `Bool`, so the boolean test has to look at the number's
    /// encoded type rather than at a cast: booleans carry the `c` (Darwin) or
    /// `B` (swift-corelibs) objCType, integers and doubles never do.
    public init(any: Any) throws {
        if any is NSNull {
            self = .null
        } else if let b = any as? Bool, Self.isBooleanNumber(any) {
            self = .bool(b)
        } else if let n = any as? NSNumber {
            self = .number(n.doubleValue)
        } else if let d = any as? Double {
            self = .number(d)
        } else if let i = any as? Int {
            self = .number(Double(i))
        } else if let s = any as? String {
            self = .string(s)
        } else if let a = any as? [Any] {
            self = .array(try a.map { try JSONValue(any: $0) })
        } else if let o = any as? [String: Any] {
            var members: [String: JSONValue] = [:]
            members.reserveCapacity(o.count)
            for (key, value) in o { members[key] = try JSONValue(any: value) }
            self = .object(members)
        } else {
            throw JSONValueError.unsupportedValue(String(describing: type(of: any)))
        }
    }

    private static func isBooleanNumber(_ any: Any) -> Bool {
        // A native Swift Bool (from `toAny()` or hand-built input) is never an
        // NSNumber on Linux; on Darwin it bridges to one whose objCType is "c".
        if let n = any as? NSNumber {
            let type = String(cString: n.objCType)
            return type == "c" || type == "B"
        }
        return any is Bool
    }

    /// Back to the graph `JSONSerialization.data(withJSONObject:)` accepts.
    /// Integral numbers become `Int` so they serialize without a trailing `.0`.
    public func toAny() -> Any {
        switch self {
        case .string(let s): return s
        case .number(let d):
            if let i = Int(exactly: d) { return i }
            return d
        case .bool(let b): return b
        case .null: return NSNull()
        case .array(let a): return a.map { $0.toAny() }
        case .object(let o): return o.mapValues { $0.toAny() }
        }
    }

    // MARK: Serialization

    /// Parse raw bytes. Throws a `DecodingError` for anything that is not JSON.
    public static func parse(_ data: Data) throws -> JSONValue {
        try JSONDecoder().decode(JSONValue.self, from: data)
    }

    /// Two-space indented text, keys sorted by default so the same record
    /// always renders the same way (and so tests can compare output).
    public func prettyPrinted(sortKeys: Bool = true) -> String {
        var out = ""
        write(into: &out, indent: 0, sortKeys: sortKeys, pretty: true)
        return out
    }

    /// Compact single-line text, the form that goes on the wire.
    public func compactString(sortKeys: Bool = true) -> String {
        var out = ""
        write(into: &out, indent: 0, sortKeys: sortKeys, pretty: false)
        return out
    }

    private func write(into out: inout String, indent: Int, sortKeys: Bool, pretty: Bool) {
        switch self {
        case .string(let s):
            Self.writeEscaped(s, into: &out)
        case .number(let d):
            out += Self.formatNumber(d)
        case .bool(let b):
            out += b ? "true" : "false"
        case .null:
            out += "null"
        case .array(let a):
            if a.isEmpty { out += "[]"; return }
            out += "["
            let inner = String(repeating: "  ", count: indent + 1)
            for (i, element) in a.enumerated() {
                if i > 0 { out += "," }
                if pretty { out += "\n" + inner }
                element.write(into: &out, indent: indent + 1, sortKeys: sortKeys, pretty: pretty)
            }
            if pretty { out += "\n" + String(repeating: "  ", count: indent) }
            out += "]"
        case .object(let o):
            if o.isEmpty { out += "{}"; return }
            out += "{"
            let inner = String(repeating: "  ", count: indent + 1)
            let keys = sortKeys ? o.keys.sorted() : Array(o.keys)
            for (i, key) in keys.enumerated() {
                if i > 0 { out += "," }
                if pretty { out += "\n" + inner }
                Self.writeEscaped(key, into: &out)
                out += pretty ? ": " : ":"
                o[key]!.write(into: &out, indent: indent + 1, sortKeys: sortKeys, pretty: pretty)
            }
            if pretty { out += "\n" + String(repeating: "  ", count: indent) }
            out += "}"
        }
    }

    /// JSON has no NaN or infinity; JavaScript's `JSON.stringify` writes
    /// `null` for them and so do we. Integral values print without a
    /// fraction, the way JavaScript prints them.
    private static func formatNumber(_ d: Double) -> String {
        if !d.isFinite { return "null" }
        if d == d.rounded(), abs(d) < 1e15 { return String(Int64(d)) }
        return String(d)
    }

    private static func writeEscaped(_ s: String, into out: inout String) {
        out += "\""
        for scalar in s.unicodeScalars {
            switch scalar {
            case "\"": out += "\\\""
            case "\\": out += "\\\\"
            case "\n": out += "\\n"
            case "\r": out += "\\r"
            case "\t": out += "\\t"
            case "\u{08}": out += "\\b"
            case "\u{0C}": out += "\\f"
            default:
                if scalar.value < 0x20 {
                    let hex = String(scalar.value, radix: 16, uppercase: false)
                    out += "\\u" + String(repeating: "0", count: 4 - hex.count) + hex
                } else {
                    out.unicodeScalars.append(scalar)
                }
            }
        }
        out += "\""
    }
}

public enum JSONValueError: Error, Equatable {
    /// `init(any:)` met an object that JSONSerialization never produces.
    case unsupportedValue(String)
}

extension JSONValue: ExpressibleByStringLiteral, ExpressibleByIntegerLiteral,
    ExpressibleByFloatLiteral, ExpressibleByBooleanLiteral, ExpressibleByNilLiteral,
    ExpressibleByArrayLiteral, ExpressibleByDictionaryLiteral {
    public init(stringLiteral value: String) { self = .string(value) }
    public init(integerLiteral value: Int) { self = .number(Double(value)) }
    public init(floatLiteral value: Double) { self = .number(value) }
    public init(booleanLiteral value: Bool) { self = .bool(value) }
    public init(nilLiteral: ()) { self = .null }
    public init(arrayLiteral elements: JSONValue...) { self = .array(elements) }
    public init(dictionaryLiteral elements: (String, JSONValue)...) {
        var members: [String: JSONValue] = [:]
        for (key, value) in elements { members[key] = value }
        self = .object(members)
    }
}
