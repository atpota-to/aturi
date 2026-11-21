import Foundation

// The query strings of the two network tools, the stream monitor and the XRPC
// console, which keep their whole input in the address the way the web keeps
// it with `URLSearchParams`. Both repeat keys (`type=create&type=delete`,
// `p.uris=…&p.uris=…`), so they read and write ordered pairs rather than a
// dictionary; `dictionary(_:)` folds the pairs into the single-valued map a
// `Route.tool` carries.

/// Ordered `(name, value)` pairs, the shape `URLSearchParams` holds.
public typealias NetworkToolQueryItems = [(String, String)]

public enum NetworkToolQuery {
    /// `URLSearchParams.toString()`: application/x-www-form-urlencoded, so a
    /// space is `+` and everything but letters, digits and `*-._` is
    /// percent-encoded. Tests compare against the web's strings with this.
    public static func encode(_ items: NetworkToolQueryItems) -> String {
        items.map { formEncode($0.0) + "=" + formEncode($0.1) }.joined(separator: "&")
    }

    /// Read `a=1&b=2&a=3` back into pairs, decoding `+` as a space as
    /// `URLSearchParams` does. A leading `?` is ignored.
    public static func decode(_ query: String) -> NetworkToolQueryItems {
        var text = Substring(query)
        if text.hasPrefix("?") { text = text.dropFirst() }
        var items: NetworkToolQueryItems = []
        for pair in text.split(separator: "&", omittingEmptySubsequences: true) {
            let parts = pair.split(separator: "=", maxSplits: 1, omittingEmptySubsequences: false)
            let name = formDecode(parts[0])
            let value = parts.count > 1 ? formDecode(parts[1]) : ""
            items.append((name, value))
        }
        return items
    }

    /// The pairs a single-valued route query stands for, keys sorted so one
    /// input always reads the same way. A link the app was handed keeps only
    /// the first value of a repeated key (`LinkParts`), so that is all there
    /// is to read.
    public static func items(from query: [String: String]) -> NetworkToolQueryItems {
        query.keys.sorted().map { ($0, query[$0] ?? "") }
    }

    /// The first value of each key, and whether that loses nothing: false
    /// when a key repeats, which a `[String: String]` cannot hold.
    public static func dictionary(_ items: NetworkToolQueryItems) -> (query: [String: String], lossless: Bool) {
        var query: [String: String] = [:]
        var lossless = true
        for (name, value) in items {
            if query[name] == nil {
                query[name] = value
            } else {
                lossless = false
            }
        }
        return (query, lossless)
    }

    /// Every value of `name`, in order (`URLSearchParams.getAll`).
    public static func all(_ name: String, in items: NetworkToolQueryItems) -> [String] {
        items.filter { $0.0 == name }.map(\.1)
    }

    /// The first value of `name` (`URLSearchParams.get`).
    public static func first(_ name: String, in items: NetworkToolQueryItems) -> String? {
        items.first { $0.0 == name }?.1
    }

    private static let unreserved: Set<UInt8> = {
        var set = Set<UInt8>()
        for byte in UInt8(ascii: "A")...UInt8(ascii: "Z") { set.insert(byte) }
        for byte in UInt8(ascii: "a")...UInt8(ascii: "z") { set.insert(byte) }
        for byte in UInt8(ascii: "0")...UInt8(ascii: "9") { set.insert(byte) }
        for char in "*-._" { set.insert(char.asciiValue!) }
        return set
    }()

    private static let hexDigits = Array("0123456789ABCDEF")

    static func formEncode(_ value: String) -> String {
        var out = ""
        out.reserveCapacity(value.utf8.count)
        for byte in value.utf8 {
            if unreserved.contains(byte) {
                out.unicodeScalars.append(Unicode.Scalar(byte))
            } else if byte == UInt8(ascii: " ") {
                out += "+"
            } else {
                out += "%"
                out.append(hexDigits[Int(byte >> 4)])
                out.append(hexDigits[Int(byte & 0x0F)])
            }
        }
        return out
    }

    private static func formDecode(_ raw: Substring) -> String {
        let spaced = raw.replacingOccurrences(of: "+", with: " ")
        return spaced.removingPercentEncoding ?? spaced
    }
}
