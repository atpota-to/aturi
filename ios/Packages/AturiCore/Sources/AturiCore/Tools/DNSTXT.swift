import Foundation

// Port of src/lib/tools/txt.ts and the DNS-over-HTTPS lookup the tools that
// follow a TXT record make (LexiconChecker.tsx, the handle route): the
// handle debugger (`_atproto.<handle>`), the lexicon publishing checker
// (`_lexicon.<authority>`) and the record validator's schema lookup. The
// web's handle debugger asks from its server because a browser cannot read
// DNS; the app asks the same resolver the site uses directly.

/// One TXT question and what came back.
public struct TxtProbe: Hashable, Sendable {
    public enum Status: String, Hashable, Sendable {
        /// TXT records exist.
        case found
        /// The name has none.
        case none
        /// The lookup failed.
        case error
    }

    /// The name that was asked.
    public let name: String
    public let status: Status
    /// Every TXT value at the name, unquoted.
    public let records: [String]
    public let error: String?

    public init(name: String, status: Status, records: [String] = [], error: String? = nil) {
        self.name = name
        self.status = status
        self.records = records
        self.error = error
    }
}

public enum DNSTXT {
    /// `DOH_RESOLVER` in src/utils/atproto/config.ts.
    public static let resolver = URL(string: "https://dns.google/resolve")!

    /// TXT data arrives quoted, and a long record as several quoted strings;
    /// join them. Text with no quoted string is returned as it is.
    public static func unquote(_ data: String) -> String {
        var parts: [String] = []
        var current = ""
        var inQuote = false
        var escaped = false
        for character in data {
            if !inQuote {
                if character == "\"" {
                    inQuote = true
                    current = ""
                }
                continue
            }
            if escaped {
                current.append(character)
                escaped = false
            } else if character == "\\" {
                escaped = true
            } else if character == "\"" {
                parts.append(current)
                inQuote = false
            } else {
                current.append(character)
            }
        }
        return parts.isEmpty ? data : parts.joined()
    }

    /// Read a DNS-over-HTTPS JSON answer (dns.google's form) for a TXT
    /// question (`readTxtAnswer`). Status 0 (NOERROR) and 3 (NXDOMAIN) are
    /// both answers; anything else says the zone itself is misbehaving.
    public static func readAnswer(name: String, body: JSONValue?) -> TxtProbe {
        let status = body?["Status"]?.intValue
        guard status == 0 || status == 3 else {
            let code = status.map(String.init) ?? "unknown"
            return TxtProbe(name: name, status: .error, error: "the name's DNS returned an error (code \(code))")
        }
        let records = (body?["Answer"]?.arrayValue ?? []).compactMap { entry -> String? in
            guard entry["type"]?.intValue == 16, let data = entry["data"]?.stringValue else { return nil }
            return unquote(data)
        }
        return TxtProbe(name: name, status: records.isEmpty ? .none : .found, records: records)
    }

    /// `https://dns.google/resolve?name=<name>&type=TXT`.
    public static func url(for name: String) -> URL {
        makeURL(resolver, path: "", query: [("name", name), ("type", "TXT")])
    }
}

/// Asks the resolver one TXT question. Never throws: a failed request is a
/// probe with status `.error`, as the web's `lookupTxt` reports it.
public struct DNSTXTClient: Sendable {
    private let http: HTTPClient

    public init(http: HTTPClient = .shared) {
        self.http = http
    }

    public func lookup(_ name: String) async -> TxtProbe {
        let url = DNSTXT.url(for: name)
        do {
            let body = try await http.getJSON(JSONValue.self, from: url, headers: ["Accept": "application/dns-json"])
            return DNSTXT.readAnswer(name: name, body: body)
        } catch let error as HTTPError {
            return TxtProbe(name: name, status: .error, error: "the resolver answered HTTP \(error.status)")
        } catch {
            return TxtProbe(name: name, status: .error, error: "the resolver did not answer")
        }
    }
}
