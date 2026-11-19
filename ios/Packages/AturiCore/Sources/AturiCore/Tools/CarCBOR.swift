import Foundation

/// A DAG-CBOR decoder, for the repo archive inspector. Port of
/// `src/lib/tools/cbor.ts`.
///
/// Every block in a repository export is DAG-CBOR: the commit, each node of
/// the tree, each record. It is CBOR with the choices taken out, which is what
/// makes it small to read: lengths are always stated up front, map keys are
/// always strings, the only tag is 42 (a link to another block by its CID),
/// and the only float is the 64-bit one.
///
/// This reads exactly that and refuses the rest by name, rather than guessing
/// at a block that was not written to the format. It is a decoder only, since
/// nothing in the inspector writes blocks.
///
/// Two things come back in a form JSON cannot hold, because the inspector
/// needs the bytes themselves: a byte string stays bytes (a tree key, a
/// signature) and a link is a `CarCIDLink`. `CarCBOR.toJSON` turns a decoded
/// value into the JSON the rest of the app shows records in, `{ "$bytes": … }`
/// and `{ "$link": … }`.
public struct CarCBORError: Error, Hashable, Sendable, CustomStringConvertible {
    public let message: String

    public init(_ message: String) {
        self.message = message
    }

    public var description: String { message }
}

/// A link to another block: the CID's bytes, without the zero byte tag 42
/// puts in front of them.
public struct CarCIDLink: Hashable, Sendable {
    public let bytes: [UInt8]

    public init(bytes: [UInt8]) {
        self.bytes = bytes
    }

    /// The CID as text, base32 for a CIDv1 and base58 for a CIDv0.
    public var string: String {
        CarCBOR.cidString(bytes)
    }
}

/// One decoded DAG-CBOR value.
///
/// Integers that fit in 64 signed bits are `int`. CBOR can also hold
/// unsigned integers up to 2^64 - 1 and negative ones down to -2^64, which
/// come back as `bigInt` with their decimal digits; the web reads both past
/// 2^53 as a BigInt and writes them into JSON as digits, and so does
/// `toJSON`.
public enum CarCBORValue: Hashable, Sendable {
    case null
    case bool(Bool)
    case int(Int64)
    case bigInt(String)
    case float(Double)
    case text(String)
    case bytes([UInt8])
    case link(CarCIDLink)
    case array([CarCBORValue])
    case map([String: CarCBORValue])

    /// The member under `key` when this is a map.
    public subscript(key: String) -> CarCBORValue? {
        if case .map(let members) = self { return members[key] }
        return nil
    }
}

public enum CarCBOR {
    /// Nesting past this is refused: no record needs it, and a hostile block
    /// could use it to exhaust the stack.
    static let maxDepth = 256

    /// The largest integer a JavaScript number holds exactly, past which the
    /// web keeps an integer as a BigInt and JSON gets its digits.
    static let maxSafeInteger: Int64 = 9_007_199_254_740_991

    /// A length past what a JavaScript number holds is refused outright, as
    /// the web refuses a BigInt length; below it, a length past the data
    /// fails as data that ends early.
    private static let maxLength: UInt64 = 9_007_199_254_740_991

    // MARK: Decoding

    /// Decode a block that holds exactly one value. Bytes left over are an error.
    public static func decode(_ bytes: [UInt8]) throws -> CarCBORValue {
        try decode(bytes, in: 0..<bytes.count)
    }

    /// Decode the one value `range` of `bytes` holds, the form a block takes
    /// inside the file it was read from.
    public static func decode(_ bytes: [UInt8], in range: Range<Int>) throws -> CarCBORValue {
        let decoded = try decodeAt(bytes, offset: range.lowerBound, end: range.upperBound)
        if decoded.next != range.upperBound {
            throw CarCBORError("There is more data after the end of the value")
        }
        return decoded.value
    }

    /// Decode one value starting at `offset` and say where it ended, for data
    /// that is followed by more: a CAR header before its blocks. Nothing at or
    /// past `end` (the whole array when nil) is read.
    public static func decodeAt(_ bytes: [UInt8], offset: Int = 0, end: Int? = nil) throws -> (value: CarCBORValue, next: Int) {
        let limit = min(end ?? bytes.count, bytes.count)
        var cursor = Cursor(bytes: bytes, at: offset, end: limit)
        let value = try cursor.readValue(depth: 0)
        return (value, cursor.at)
    }

    private struct Cursor {
        let bytes: [UInt8]
        var at: Int
        let end: Int

        func need(_ count: Int) throws {
            if count < 0 || at > end || count > end - at {
                throw CarCBORError("The data ends in the middle of a value")
            }
        }

        mutating func byte() throws -> UInt8 {
            try need(1)
            let value = bytes[at]
            at += 1
            return value
        }

        mutating func bigEndian(_ count: Int) throws -> UInt64 {
            try need(count)
            var value: UInt64 = 0
            for i in 0..<count {
                value = (value << 8) | UInt64(bytes[at + i])
            }
            at += count
            return value
        }

        /// The number that follows a type byte: in the byte itself when it is
        /// under 24, otherwise in the next 1, 2, 4 or 8 bytes.
        mutating func readArgument(_ info: UInt8) throws -> UInt64 {
            if info < 24 { return UInt64(info) }
            switch info {
            case 24:
                let single = try byte()
                return UInt64(single)
            case 25: return try bigEndian(2)
            case 26: return try bigEndian(4)
            case 27: return try bigEndian(8)
            case 31: throw CarCBORError("Indefinite lengths are not allowed in DAG-CBOR")
            default: throw CarCBORError("Reserved length encoding (\(info))")
            }
        }

        /// A length, which unlike an integer value can never sensibly be huge.
        mutating func readLength(_ info: UInt8) throws -> Int {
            let length = try readArgument(info)
            if length > CarCBOR.maxLength {
                throw CarCBORError("A length is larger than any block could be")
            }
            return Int(length)
        }

        mutating func readText(_ length: Int) throws -> String {
            try need(length)
            let start = at
            at += length
            return String(decoding: bytes[start..<(start + length)], as: UTF8.self)
        }

        mutating func readValue(depth: Int) throws -> CarCBORValue {
            if depth > CarCBOR.maxDepth {
                throw CarCBORError("The data is nested too deeply")
            }
            let initial = try byte()
            let major = initial >> 5
            let info = initial & 0x1f

            switch major {
            case 0:
                let value = try readArgument(info)
                if value <= UInt64(Int64.max) { return .int(Int64(value)) }
                return .bigInt(String(value))
            case 1:
                // A negative integer is stored as -1 minus the number.
                let value = try readArgument(info)
                if value <= UInt64(Int64.max) { return .int(-1 - Int64(value)) }
                let (magnitude, overflow) = value.addingReportingOverflow(1)
                return .bigInt(overflow ? "-18446744073709551616" : "-" + String(magnitude))
            case 2:
                let length = try readLength(info)
                try need(length)
                let out = Array(bytes[at..<(at + length)])
                at += length
                return .bytes(out)
            case 3:
                let length = try readLength(info)
                let text = try readText(length)
                return .text(text)
            case 4:
                let length = try readLength(info)
                // Every item takes at least a byte, so a count past what is left is a lie.
                try need(length)
                var out: [CarCBORValue] = []
                out.reserveCapacity(length)
                for _ in 0..<length {
                    let item = try readValue(depth: depth + 1)
                    out.append(item)
                }
                return .array(out)
            case 5:
                let length = try readLength(info)
                try need(length)
                var out: [String: CarCBORValue] = [:]
                out.reserveCapacity(length)
                for _ in 0..<length {
                    let keyInitial = try byte()
                    if keyInitial >> 5 != 3 {
                        throw CarCBORError("Map keys must be strings in DAG-CBOR")
                    }
                    let keyLength = try readLength(keyInitial & 0x1f)
                    let key = try readText(keyLength)
                    let member = try readValue(depth: depth + 1)
                    out[key] = member
                }
                return .map(out)
            case 6:
                let tag = try readArgument(info)
                if tag != 42 {
                    throw CarCBORError("Tag \(tag) is not allowed in DAG-CBOR; the only tag is 42, a link")
                }
                let inner = try readValue(depth: depth + 1)
                // A link is a byte string: a zero byte, then the CID.
                guard case .bytes(let raw) = inner, raw.count >= 2, raw[0] == 0 else {
                    throw CarCBORError("A link (tag 42) must hold a CID as bytes after a zero byte")
                }
                return .link(CarCIDLink(bytes: Array(raw[1...])))
            default:
                switch info {
                case 20: return .bool(false)
                case 21: return .bool(true)
                case 22: return .null
                case 27:
                    let pattern = try bigEndian(8)
                    return .float(Double(bitPattern: pattern))
                case 25, 26: throw CarCBORError("Only 64-bit floats are allowed in DAG-CBOR")
                case 23: throw CarCBORError("\"undefined\" is not allowed in DAG-CBOR")
                case 31: throw CarCBORError("Indefinite lengths are not allowed in DAG-CBOR")
                default: throw CarCBORError("Simple value \(info) is not allowed in DAG-CBOR")
                }
            }
        }
    }

    // MARK: JSON

    /// A decoded value as the JSON atproto uses for records: a link becomes
    /// `{ "$link": "<CID>" }` and bytes become `{ "$bytes": "<base64>" }`.
    ///
    /// An integer too large for a JavaScript number becomes its digits in a
    /// string, as on the web, since JSON written from here has to parse back
    /// exactly. The data model allows 64-bit integers; in practice records
    /// do not hold them.
    public static func toJSON(_ value: CarCBORValue) -> JSONValue {
        switch value {
        case .null: return .null
        case .bool(let flag): return .bool(flag)
        case .int(let number):
            if number > maxSafeInteger || number < -maxSafeInteger { return .string(String(number)) }
            return .number(Double(number))
        case .bigInt(let digits): return .string(digits)
        case .float(let number): return .number(number)
        case .text(let text): return .string(text)
        case .bytes(let bytes): return .object(["$bytes": .string(encodeBase64(bytes))])
        case .link(let link): return .object(["$link": .string(link.string)])
        case .array(let items): return .array(items.map { toJSON($0) })
        case .map(let members): return .object(members.mapValues { toJSON($0) })
        }
    }

    // MARK: Text forms

    private static let base32Alphabet: [UInt8] = Array("abcdefghijklmnopqrstuvwxyz234567".utf8)
    private static let base58Alphabet: [UInt8] = Array("123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz".utf8)

    /// RFC 4648 base32, lower case, no padding.
    public static func encodeBase32<Bytes: Collection>(_ bytes: Bytes) -> String where Bytes.Element == UInt8 {
        var out: [UInt8] = []
        out.reserveCapacity((bytes.count * 8 + 4) / 5)
        var bits = 0
        var value: UInt32 = 0
        for byte in bytes {
            value = (value << 8) | UInt32(byte)
            bits += 8
            while bits >= 5 {
                bits -= 5
                out.append(base32Alphabet[Int((value >> UInt32(bits)) & 31)])
            }
            // Keep only the bits not yet written, so the shift never overflows.
            value &= (UInt32(1) << UInt32(bits)) - 1
        }
        if bits > 0 {
            out.append(base32Alphabet[Int((value << UInt32(5 - bits)) & 31)])
        }
        return String(decoding: out, as: UTF8.self)
    }

    /// RFC 4648 base32 back to bytes, lower case without padding. Nil for a
    /// character outside the alphabet.
    public static func decodeBase32<Text: StringProtocol>(_ text: Text) -> [UInt8]? {
        var out: [UInt8] = []
        var bits = 0
        var value: UInt32 = 0
        for char in text.utf8 {
            guard let index = base32Alphabet.firstIndex(of: char) else { return nil }
            value = ((value << 5) | UInt32(index)) & 0xffff
            bits += 5
            if bits >= 8 {
                bits -= 8
                out.append(UInt8((value >> UInt32(bits)) & 0xff))
            }
        }
        return out
    }

    /// Bitcoin's base58, the form a CIDv0 is written in.
    public static func encodeBase58<Bytes: Collection>(_ bytes: Bytes) -> String where Bytes.Element == UInt8 {
        // Repeated division of the number the bytes spell, kept as base-58
        // digits, least significant first.
        var digits: [UInt8] = []
        for byte in bytes {
            var carry = Int(byte)
            for i in 0..<digits.count {
                carry += Int(digits[i]) << 8
                digits[i] = UInt8(carry % 58)
                carry /= 58
            }
            while carry > 0 {
                digits.append(UInt8(carry % 58))
                carry /= 58
            }
        }
        var out: [UInt8] = []
        // Each leading zero byte is a leading "1", which the number itself drops.
        for byte in bytes {
            if byte != 0 { break }
            out.append(base58Alphabet[0])
        }
        for digit in digits.reversed() {
            out.append(base58Alphabet[Int(digit)])
        }
        return String(decoding: out, as: UTF8.self)
    }

    /// Bitcoin's base58 back to bytes. Nil for a character outside the alphabet.
    public static func decodeBase58<Text: StringProtocol>(_ text: Text) -> [UInt8]? {
        // The bytes of the number, least significant first.
        var bytes: [UInt8] = []
        for char in text.utf8 {
            guard let index = base58Alphabet.firstIndex(of: char) else { return nil }
            var carry = index
            for i in 0..<bytes.count {
                carry += Int(bytes[i]) * 58
                bytes[i] = UInt8(carry & 0xff)
                carry >>= 8
            }
            while carry > 0 {
                bytes.append(UInt8(carry & 0xff))
                carry >>= 8
            }
        }
        var out: [UInt8] = []
        for char in text.utf8 {
            if char != base58Alphabet[0] { break }
            out.append(0)
        }
        out.append(contentsOf: bytes.reversed())
        return out
    }

    /// Bytes as standard base64 without padding, the form `$bytes` takes.
    public static func encodeBase64(_ bytes: [UInt8]) -> String {
        var text = Data(bytes).base64EncodedString()
        while text.hasSuffix("=") {
            text.removeLast()
        }
        return text
    }

    /// A CID as text, from its binary form: base32 with the `b` prefix for a
    /// CIDv1, which is how atproto writes them, and bare base58 for a CIDv0.
    public static func cidString<Bytes: Collection>(_ bytes: Bytes) -> String where Bytes.Element == UInt8 {
        if bytes.count == 34 {
            var iterator = bytes.makeIterator()
            if iterator.next() == 0x12, iterator.next() == 0x20 {
                return encodeBase58(bytes)
            }
        }
        return "b" + encodeBase32(bytes)
    }
}
