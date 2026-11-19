import Foundation

// The identifier decoder, port of src/lib/tools/decode.ts: take apart the
// strings atproto is made of and say what each part means.
//
// Everything here is pure and runs on the device. Nothing typed into the
// decoder is sent anywhere, which matters because one of the things it reads
// is a token.
//
// `decode` returns every reading that fits, most specific first. A string
// can honestly be two things (`app.bsky.feed.post` is an NSID, and also a
// syntactically valid handle), and saying both is more useful than guessing.
//
// The pieces the package already has are reused rather than ported again:
// `TID` reads timestamp identifiers, `AtUri` splits at:// URIs, and
// `isValidDid`, `isValidNsid` and `isValidRecordKey` are the syntax checks.
// The handle check is the handle debugger's (`HandleDebug.syntaxProblem`),
// as the web's is.

public enum IdentifierDecode {
    public enum Kind: String, Hashable, Sendable {
        case tid
        case cid
        case atUri = "at-uri"
        case did
        case key
        case nsid
        case jwt
        case handle
        case datetime
        case recordKey = "record-key"
    }

    public struct Fact: Hashable, Sendable {
        public var label: String
        public var value: String
        /// Worth a copy button.
        public var copy: Bool
        /// Prose rather than an identifier: set in the sans face.
        public var plain: Bool

        public init(label: String, value: String, copy: Bool = false, plain: Bool = false) {
            self.label = label
            self.value = value
            self.copy = copy
            self.plain = plain
        }
    }

    public struct Link: Hashable, Sendable {
        public var label: String
        /// A path on aturi.to when it starts with `/`, otherwise an outside URL.
        public var href: String

        public init(label: String, href: String) {
            self.label = label
            self.href = href
        }
    }

    /// Decoded JSON to show whole: a token's header and claims.
    public struct JSONBlock: Hashable, Sendable {
        public var label: String
        public var value: JSONValue

        public init(label: String, value: JSONValue) {
            self.label = label
            self.value = value
        }
    }

    /// One part of a compound identifier, decoded in turn.
    public struct Part: Hashable, Sendable {
        public var label: String
        public var decoded: Decoded

        public init(label: String, decoded: Decoded) {
            self.label = label
            self.decoded = decoded
        }
    }

    public struct Decoded: Hashable, Sendable {
        public var kind: Kind
        /// What it is, e.g. "Timestamp identifier (TID)".
        public var title: String
        /// One sentence on what that means.
        public var summary: String
        public var facts: [Fact]
        public var json: [JSONBlock]
        /// Things worth a second look: an expired token, a hash atproto
        /// does not use.
        public var notes: [String]
        public var links: [Link]
        public var parts: [Part]

        public init(
            kind: Kind,
            title: String,
            summary: String,
            facts: [Fact],
            json: [JSONBlock] = [],
            notes: [String] = [],
            links: [Link] = [],
            parts: [Part] = []
        ) {
            self.kind = kind
            self.title = title
            self.summary = summary
            self.facts = facts
            self.json = json
            self.notes = notes
            self.links = links
            self.parts = parts
        }

        /// The value of the fact with this label, if there is one.
        public func fact(_ label: String) -> String? {
            facts.first { $0.label == label }?.value
        }
    }

    // MARK: Encodings

    private static let base32Index: [Unicode.Scalar: UInt32] = {
        var table: [Unicode.Scalar: UInt32] = [:]
        for (index, scalar) in "abcdefghijklmnopqrstuvwxyz234567".unicodeScalars.enumerated() {
            table[scalar] = UInt32(index)
        }
        return table
    }()

    private static let base58Index: [Unicode.Scalar: Int] = {
        var table: [Unicode.Scalar: Int] = [:]
        for (index, scalar) in "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz".unicodeScalars.enumerated() {
            table[scalar] = index
        }
        return table
    }()

    /// RFC 4648 base32, lower case, no padding: the `b` multibase CIDs use.
    public static func decodeBase32(_ text: String) -> [UInt8]? {
        var out: [UInt8] = []
        var bits = 0
        var value: UInt32 = 0
        for scalar in text.unicodeScalars {
            guard let index = base32Index[scalar] else { return nil }
            value = ((value << 5) | index) & 0xFFFF
            bits += 5
            if bits >= 8 {
                bits -= 8
                out.append(UInt8((value >> UInt32(bits)) & 0xFF))
            }
        }
        return out
    }

    /// Bitcoin's base58: the `z` multibase keys use, and CIDv0.
    public static func decodeBase58(_ text: String) -> [UInt8]? {
        // The number, big-endian, built up one digit at a time.
        var bytes: [UInt8] = []
        for scalar in text.unicodeScalars {
            guard let digit = base58Index[scalar] else { return nil }
            var carry = digit
            for position in stride(from: bytes.count - 1, through: 0, by: -1) {
                let total = Int(bytes[position]) * 58 + carry
                bytes[position] = UInt8(total & 0xFF)
                carry = total >> 8
            }
            while carry > 0 {
                bytes.insert(UInt8(carry & 0xFF), at: 0)
                carry >>= 8
            }
        }
        // Each leading "1" is a leading zero byte, which the number itself drops.
        var zeros = 0
        for scalar in text.unicodeScalars {
            guard scalar == "1" else { break }
            zeros += 1
        }
        return [UInt8](repeating: 0, count: zeros) + bytes
    }

    static func decodeBase64URL(_ text: String) -> [UInt8]? {
        let allowed = text.unicodeScalars.allSatisfy { scalar in
            let v = scalar.value
            return (65...90).contains(v) || (97...122).contains(v) || (48...57).contains(v) || v == 45 || v == 95
        }
        guard allowed else { return nil }
        var standard = text.replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        let remainder = standard.utf8.count % 4
        if remainder > 0 {
            standard += String(repeating: "=", count: 4 - remainder)
        }
        guard let data = Data(base64Encoded: standard) else { return nil }
        return [UInt8](data)
    }

    /// An unsigned LEB128 varint, as multiformats prefixes are written.
    static func readVarint(_ bytes: [UInt8], _ offset: Int) -> (value: Int, next: Int)? {
        var value = 0
        var shift = 0
        var index = offset
        while index < bytes.count, shift <= 28 {
            value |= Int(bytes[index] & 0x7F) << shift
            if bytes[index] & 0x80 == 0 {
                return (value, index + 1)
            }
            shift += 7
            index += 1
        }
        return nil
    }

    static func hex<Bytes: Sequence>(_ bytes: Bytes) -> String where Bytes.Element == UInt8 {
        let digits = Array("0123456789abcdef")
        var out = ""
        for byte in bytes {
            out.append(digits[Int(byte >> 4)])
            out.append(digits[Int(byte & 0x0F)])
        }
        return out
    }

    // MARK: Time

    private static func date(ms: Int64) -> Date {
        Date(timeIntervalSince1970: TimeInterval(ms) / 1000)
    }

    private static func milliseconds(_ date: Date) -> Int64 {
        Int64((date.timeIntervalSince1970 * 1000).rounded(.down))
    }

    /// "3 hours ago", "in 2 days", "now".
    static func relativeTime(ms: Int64, now: Int64) -> String {
        let diff = ms - now
        let magnitude = diff < 0 ? -diff : diff
        let units: [(Int64, String)] = [
            (365 * 86_400_000, "year"),
            (30 * 86_400_000, "month"),
            (86_400_000, "day"),
            (3_600_000, "hour"),
            (60_000, "minute"),
            (1000, "second"),
        ]
        for (size, name) in units where magnitude >= size {
            let count = magnitude / size
            let span = "\(count) \(name)\(count == 1 ? "" : "s")"
            return diff < 0 ? "\(span) ago" : "in \(span)"
        }
        return "now"
    }

    /// The device's own reading of a moment, `toLocaleString` with a medium
    /// date and a long time.
    private static func localTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = .current
        formatter.timeZone = .current
        formatter.dateStyle = .medium
        formatter.timeStyle = .long
        return formatter.string(from: date)
    }

    private static func timeFacts(ms: Int64, now: Int64) -> [Fact] {
        let moment = date(ms: ms)
        return [
            Fact(label: "UTC", value: Formatting.isoTimestamp(moment), copy: true),
            Fact(label: "Your time", value: localTime(moment), plain: true),
            Fact(label: "Relative", value: relativeTime(ms: ms, now: now), plain: true),
        ]
    }

    // MARK: TID

    /// The TID for a moment (`formatTid`): the inverse of `TID`'s reading.
    public static func formatTid(micros: UInt64, clockId: Int = 0) -> String {
        let alphabet = Array(TID.alphabet)
        var value = (micros << 10) | UInt64(clockId & 0x3FF)
        var out: [Character] = []
        for _ in 0..<13 {
            out.insert(alphabet[Int(value & 31)], at: 0)
            value >>= 5
        }
        return String(out)
    }

    static func decodeTid(_ text: String, now: Int64) -> Decoded? {
        guard let micros = TID.microseconds(from: text), let clockId = TID.clockId(from: text) else { return nil }
        let ms = Int64(micros / 1000)
        let year = Formatting.utcCalendar.component(.year, from: date(ms: ms))
        let nowYear = Formatting.utcCalendar.component(.year, from: date(ms: now))
        var notes: [String] = []
        /* atproto launched in 2022. A key that decodes far outside it is
           more likely thirteen letters that happen to fit the alphabet. */
        if year < 2020 || year > nowYear + 5 {
            notes.append("This decodes to \(year), which is outside the years atproto has existed. It may be a custom record key rather than a TID.")
        }
        return Decoded(
            kind: .tid,
            title: "Timestamp identifier (TID)",
            summary: "A record key or repo revision that carries the moment it was made, so keys sort in the order they were written.",
            facts: timeFacts(ms: ms, now: now) + [
                Fact(label: "Microseconds since 1970", value: String(micros), copy: true),
                Fact(label: "Clock ID", value: String(clockId)),
            ],
            notes: notes
        )
    }

    // MARK: CID

    private struct Codec {
        let name: String
        let meaning: String
    }

    private static let codecs: [Int: Codec] = [
        0x71: Codec(name: "dag-cbor", meaning: "A record, a commit or a node of the repository tree."),
        0x55: Codec(name: "raw", meaning: "A blob: an image, a video, any uploaded file."),
        0x70: Codec(name: "dag-pb", meaning: "An IPFS file node. atproto does not use this codec."),
    ]

    private static let hashes: [Int: String] = [
        0x12: "sha2-256",
        0x13: "sha2-512",
        0x1E: "blake3",
    ]

    static func decodeCid(_ text: String) -> Decoded? {
        var decoded: [UInt8]?
        var version = 1
        var encoding = ""
        if text.wholeMatch(of: cidV0Pattern) != nil {
            decoded = decodeBase58(text)
            version = 0
            encoding = "base58btc, with no prefix"
        } else if text.wholeMatch(of: cidBase32Pattern) != nil {
            decoded = decodeBase32(String(text.dropFirst()))
            encoding = "base32 (multibase prefix b)"
        } else if text.wholeMatch(of: cidBase58Pattern) != nil {
            decoded = decodeBase58(String(text.dropFirst()))
            encoding = "base58btc (multibase prefix z)"
        }
        guard let bytes = decoded, bytes.count >= 4 else { return nil }

        var offset = 0
        var codec = 0x70
        if version == 1 {
            guard let cidVersion = readVarint(bytes, 0), cidVersion.value == 1,
                let codecPrefix = readVarint(bytes, cidVersion.next)
            else { return nil }
            codec = codecPrefix.value
            offset = codecPrefix.next
        }
        guard let hash = readVarint(bytes, offset), let length = readVarint(bytes, hash.next) else { return nil }
        let digest = bytes[length.next...]
        guard digest.count == length.value else { return nil }

        let codecInfo = codecs[codec]
        let hashName = hashes[hash.value]
        var notes: [String] = []
        if version == 0 { notes.append("This is a CIDv0. atproto only uses CIDv1.") }
        if hash.value != 0x12 { notes.append("atproto records and blobs are hashed with sha2-256. This uses a different hash.") }
        if version == 1, codec != 0x71, codec != 0x55 {
            notes.append("atproto uses dag-cbor for records and raw for blobs. This is neither.")
        }

        let codecHex = "0x" + String(codec, radix: 16)
        var facts = [
            Fact(label: "Version", value: "CIDv\(version)"),
            Fact(label: "Encoding", value: encoding, plain: true),
            Fact(label: "Codec", value: codecInfo.map { "\($0.name) (\(codecHex))" } ?? codecHex),
        ]
        if let codecInfo {
            facts.append(Fact(label: "Addresses", value: codecInfo.meaning, plain: true))
        }
        let hashLabel = hashName ?? ("0x" + String(hash.value, radix: 16))
        facts.append(Fact(label: "Hash", value: "\(hashLabel), \(length.value * 8) bits"))
        facts.append(Fact(label: "Digest", value: hex(digest), copy: true))
        return Decoded(
            kind: .cid,
            title: "Content identifier (CID)",
            summary: "The hash of a piece of data, with a prefix that says how it was encoded and hashed. Change the data and the CID changes.",
            facts: facts,
            notes: notes
        )
    }

    // MARK: Keys: did:key and the multibase keys in DID documents

    private struct KeyType {
        let name: String
        let alg: String
        let length: Int
    }

    private static let keyTypes: [Int: KeyType] = [
        0xE7: KeyType(name: "secp256k1 (K-256)", alg: "ES256K", length: 33),
        0x1200: KeyType(name: "NIST P-256", alg: "ES256", length: 33),
        0xED: KeyType(name: "Ed25519", alg: "EdDSA", length: 32),
        0x1201: KeyType(name: "NIST P-384", alg: "ES384", length: 49),
    ]

    static func decodeKey(_ text: String) -> Decoded? {
        let isDidKey = text.hasPrefix("did:key:")
        let multibase = isDidKey ? String(text.dropFirst("did:key:".count)) : text
        guard multibase.wholeMatch(of: multibaseKeyPattern) != nil,
            let bytes = decodeBase58(String(multibase.dropFirst())),
            let codec = readVarint(bytes, 0),
            let type = keyTypes[codec.value]
        else { return nil }
        let key = bytes[codec.next...]
        var notes: [String] = []
        if key.count != type.length {
            notes.append("A \(type.name) public key in this form is \(type.length) bytes. This one is \(key.count).")
        }
        if codec.value != 0xE7, codec.value != 0x1200 {
            notes.append("atproto signs repositories and tokens with K-256 or P-256 keys. This is another curve.")
        }
        return Decoded(
            kind: .key,
            title: isDidKey ? "Public key (did:key)" : "Public key (multibase)",
            summary: isDidKey
                ? "A DID that is nothing but a public key: the key is the identifier. PLC operations list rotation keys in this form."
                : "A public key as a DID document writes it, under publicKeyMultibase. The #atproto key signs the account’s repository.",
            facts: [
                Fact(label: "Curve", value: type.name, plain: true),
                Fact(label: "JWT algorithm", value: type.alg),
                Fact(label: "Encoding", value: "base58btc (multibase prefix z), compressed point", plain: true),
                Fact(label: "Key bytes", value: hex(key), copy: true),
            ],
            notes: notes
        )
    }

    // MARK: DID

    static func decodeDid(_ text: String) -> Decoded? {
        if text.hasPrefix("did:key:") { return decodeKey(text) }
        guard isValidDid(text) else { return nil }
        let rest = text.dropFirst("did:".count)
        guard let colon = rest.firstIndex(of: ":") else { return nil }
        let method = String(rest[..<colon])
        let id = String(rest[rest.index(after: colon)...])
        let explore = Link(label: "Open in the Explorer", href: "/explore/\(text)")

        if method == "plc" {
            let valid = id.wholeMatch(of: plcIdentifierPattern) != nil
            let directory = Endpoints.plcDirectory.absoluteString
            return Decoded(
                kind: .did,
                title: "DID (did:plc)",
                summary: "A permanent account identifier registered in the PLC directory. It stays the same when the handle or the PDS changes.",
                facts: [
                    Fact(label: "Method", value: "plc"),
                    Fact(label: "Identifier", value: id, copy: true),
                    Fact(label: "Made from", value: "The first 15 bytes of the sha2-256 hash of the account’s first signed operation, in base32.", plain: true),
                    Fact(label: "Document", value: "\(directory)/\(text)", copy: true),
                    Fact(label: "History", value: "\(directory)/\(text)/log/audit", copy: true),
                ],
                notes: valid ? [] : ["A did:plc identifier is exactly 24 base32 characters (a to z and 2 to 7). This one is not."],
                links: [explore]
            )
        }
        if method == "web" {
            let segments = id.split(separator: ":", omittingEmptySubsequences: false).map { segment -> String in
                let raw = String(segment)
                return raw.removingPercentEncoding ?? raw
            }
            let host = segments.first ?? ""
            let path = Array(segments.dropFirst())
            let documentUrl: String
            if let url = IdentityResolver.didWebDocumentURL(for: text) {
                documentUrl = url.absoluteString
            } else if path.isEmpty {
                documentUrl = "https://\(host)/.well-known/did.json"
            } else {
                documentUrl = "https://\(host)/\(path.joined(separator: "/"))/did.json"
            }
            return Decoded(
                kind: .did,
                title: "DID (did:web)",
                summary: "An identifier that is a domain name. Its document is a file on that domain, so whoever controls the domain controls the identity.",
                facts: [
                    Fact(label: "Method", value: "web"),
                    Fact(label: "Host", value: host, copy: true),
                    Fact(label: "Document", value: documentUrl, copy: true),
                ],
                notes: path.isEmpty ? [] : ["atproto only accepts did:web identifiers that are a bare hostname, with no path."],
                links: [explore]
            )
        }
        return Decoded(
            kind: .did,
            title: "DID (did:\(method))",
            summary: "A decentralized identifier. atproto accounts use the plc and web methods; this is another one.",
            facts: [
                Fact(label: "Method", value: method),
                Fact(label: "Identifier", value: id, copy: true),
            ]
        )
    }

    // MARK: NSID and handle

    static func decodeNsid(_ text: String) -> Decoded? {
        let pieces = text.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false).map(String.init)
        guard let nsid = pieces.first, isValidNsid(nsid) else { return nil }
        let fragment: String? = pieces.count > 1 ? pieces[1] : nil
        let segments = nsid.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        guard segments.count >= 3, let name = segments.last else { return nil }
        let namespace = Array(segments.dropLast())
        let authority = namespace.reversed().joined(separator: ".")
        var facts = [
            Fact(label: "Name", value: name),
            Fact(label: "Authority", value: authority, copy: true),
            Fact(label: "Namespace", value: namespace.joined(separator: ".")),
            Fact(label: "Published at", value: "_lexicon.\(authority)", copy: true),
        ]
        if let fragment {
            facts.append(Fact(label: "Definition", value: "#\(fragment)"))
        }
        return Decoded(
            kind: .nsid,
            title: "Namespaced identifier (NSID)",
            summary: "The name of a lexicon: a record type or an API method. It reads as a reversed domain name with the type’s name on the end.",
            facts: facts,
            links: [
                Link(label: "Open in the lexicon explorer", href: "/explore/lexicons/\(nsid)"),
                Link(label: "Check how it is published", href: "/tools/lexicon?nsid=\(URIEncoding.encodeComponent(nsid))"),
            ]
        )
    }

    static func decodeHandle(_ text: String) -> Decoded? {
        var handle = text
        if handle.hasPrefix("@") {
            handle.removeFirst()
        }
        handle = handle.lowercased()
        guard HandleDebug.syntaxProblem(handle) == nil else { return nil }
        let labels = handle.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        return Decoded(
            kind: .handle,
            title: "Handle",
            summary: "A domain name used as an account’s name. It is only valid while it points at a DID and that DID points back.",
            facts: [
                Fact(label: "Handle", value: handle, copy: true),
                Fact(label: "DNS record", value: "_atproto.\(handle)", copy: true),
                Fact(label: "Well-known file", value: "https://\(handle)/.well-known/atproto-did", copy: true),
                Fact(label: "Parent domain", value: labels.dropFirst().joined(separator: ".")),
            ],
            links: [
                Link(label: "Check this handle", href: "/tools/handle?handle=\(URIEncoding.encodeComponent(handle))"),
                Link(label: "Open in the Explorer", href: "/explore/\(handle)"),
            ]
        )
    }

    // MARK: Record key

    static func decodeRecordKey(_ text: String) -> Decoded? {
        guard isValidRecordKey(text) else { return nil }
        return Decoded(
            kind: .recordKey,
            title: "Record key",
            summary: text == "self"
                ? "The key a collection uses when an account has exactly one record in it, such as a profile."
                : "The name of one record inside a collection. Most are TIDs; this one is a key the app chose.",
            facts: [
                Fact(label: "Key", value: text, copy: true),
                Fact(label: "Length", value: "\(text.count) of 512 characters", plain: true),
            ]
        )
    }

    // MARK: at:// URI

    static func decodeAtUri(_ text: String, now: Int64) -> Decoded? {
        guard !text.contains(where: { $0.isWhitespace }) else { return nil }
        var body = text
        var fragment: String?
        if let hash = text.firstIndex(of: "#") {
            body = String(text[..<hash])
            fragment = String(text[text.index(after: hash)...])
        }
        /* `AtUri` reads a prefix; the decoder wants the whole string to be
           a URI, so anything it did not read (a fourth segment, a query)
           means this is not one. */
        guard let uri = AtUri(parsing: body), uri.description == body else { return nil }
        let authority = uri.repo
        let collection = uri.collection
        let rkey = uri.rkey

        var parts: [Part] = []
        let authorityDecoded = authority.hasPrefix("did:") ? decodeDid(authority) : decodeHandle(authority)
        if let authorityDecoded {
            parts.append(Part(label: "Authority", decoded: authorityDecoded))
        }
        var collectionDecoded: Decoded?
        if let collection {
            collectionDecoded = decodeNsid(collection)
            if let collectionDecoded {
                parts.append(Part(label: "Collection", decoded: collectionDecoded))
            }
        }
        if let rkey, let rkeyDecoded = decodeTid(rkey, now: now) ?? decodeRecordKey(rkey) {
            parts.append(Part(label: "Record key", decoded: rkeyDecoded))
        }

        var notes: [String] = []
        if authorityDecoded == nil { notes.append("The authority is neither a DID nor a valid handle.") }
        if collection != nil, collectionDecoded == nil { notes.append("The collection is not a valid NSID.") }
        if !authority.hasPrefix("did:") {
            notes.append("The authority is a handle. Handles can change, so a URI that has to keep working should name the DID.")
        }

        let points: String
        if rkey != nil {
            points = "one record"
        } else if collection != nil {
            points = "a collection"
        } else {
            points = "a repository"
        }
        let path = [authority, collection, rkey].compactMap { $0 }.joined(separator: "/")
        var facts = [Fact(label: "Authority", value: authority, copy: true)]
        if let collection { facts.append(Fact(label: "Collection", value: collection, copy: true)) }
        if let rkey { facts.append(Fact(label: "Record key", value: rkey, copy: true)) }
        if let fragment { facts.append(Fact(label: "Fragment", value: "#\(fragment)")) }
        facts.append(Fact(label: "Universal link", value: "\(Endpoints.aturiBase.absoluteString)/\(path)", copy: true))
        return Decoded(
            kind: .atUri,
            title: "AT URI",
            summary: "The address of \(points): whose repository, which collection, which record.",
            facts: facts,
            notes: notes,
            links: [Link(label: "Open in the Explorer", href: "/explore/\(path)")],
            parts: parts
        )
    }

    // MARK: JWT

    private static let claimMeanings: [String: String] = [
        "iss": "Issuer: who made the token.",
        "sub": "Subject: the account it speaks for.",
        "aud": "Audience: the service it is meant for. A service must refuse a token addressed to another.",
        "exp": "Expires at.",
        "iat": "Issued at.",
        "nbf": "Not valid before.",
        "jti": "A one-off id, so a token cannot be replayed.",
        "lxm": "Lexicon method: the one XRPC method this service token may call.",
        "scope": "What the token may do.",
        "client_id": "The OAuth client it was issued to.",
        "cnf": "Confirmation: the thumbprint (jkt) of the DPoP key the token is bound to.",
        "htm": "The HTTP method this proof was made for.",
        "htu": "The URL this proof was made for.",
        "ath": "The hash of the access token this proof goes with.",
        "nonce": "The server-supplied nonce this proof answers.",
    ]

    private static let tokenTypes: [String: String] = [
        "at+jwt": "An OAuth access token.",
        "dpop+jwt": "A DPoP proof: it shows the sender holds the key an access token is bound to, for one request.",
        "refresh+jwt": "A refresh token.",
        "jwt": "A plain JWT. Service auth tokens between atproto services use this type.",
    ]

    /// Session scopes a PDS puts in the tokens it issues for password sign-ins.
    private static let sessionScopes: [String: String] = [
        "com.atproto.access": "A full session from the account password.",
        "com.atproto.refresh": "A refresh token for a password session.",
        "com.atproto.appPass": "A session from an app password.",
        "com.atproto.appPassPrivileged": "A session from an app password that may also read direct messages.",
    ]

    /* A decoded object has no order of its own here, where the web lists a
       token's claims as the token wrote them. The registered claims come
       first in this order, then the rest by name. */
    private static let claimOrder = ["iss", "sub", "aud", "scope", "client_id", "lxm", "jti", "cnf", "htm", "htu", "ath", "nonce"]

    /// What each claim in a decoded token means, for the page to print
    /// beside it.
    public static func claimMeaning(_ claim: String) -> String? {
        claimMeanings[claim]
    }

    private static func parseJSONSegment(_ segment: String) -> [String: JSONValue]? {
        guard let bytes = decodeBase64URL(segment), let value = try? JSONValue.parse(Data(bytes)) else { return nil }
        return value.objectValue
    }

    public static func looksLikeJwt(_ text: String) -> Bool {
        text.trimmingCharacters(in: .whitespacesAndNewlines).wholeMatch(of: jwtPattern) != nil
    }

    /// The text without a "Bearer " or "DPoP " copied along with a token.
    private static func strippingAuthScheme(_ text: String) -> String {
        let lower = text.lowercased()
        for scheme in ["bearer", "dpop"] where lower.hasPrefix(scheme) {
            let rest = text.dropFirst(scheme.count)
            guard let first = rest.first, first.isWhitespace else { continue }
            return String(rest.drop(while: { $0.isWhitespace }))
        }
        return text
    }

    static func decodeJwt(_ text: String, now: Int64) -> Decoded? {
        guard looksLikeJwt(text) else { return nil }
        let segments = text.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        guard segments.count == 3,
            let header = parseJSONSegment(segments[0]),
            let payload = parseJSONSegment(segments[1])
        else { return nil }
        let signature = segments[2]

        var facts: [Fact] = []
        var notes: [String] = []
        let typ = header["typ"]?.stringValue ?? ""
        if !typ.isEmpty {
            let meaning = tokenTypes[typ.lowercased()] ?? ""
            facts.append(Fact(label: "Type", value: "\(typ). \(meaning)".trimmingCharacters(in: .whitespaces), plain: true))
        }
        if let alg = header["alg"]?.stringValue { facts.append(Fact(label: "Algorithm", value: alg)) }
        if let kid = header["kid"]?.stringValue { facts.append(Fact(label: "Key ID", value: kid, copy: true)) }

        let names = claimOrder.filter { payload[$0] != nil }
            + payload.keys.filter { !claimOrder.contains($0) }.sorted()
        for claim in names where claim != "exp" && claim != "iat" && claim != "nbf" {
            guard let value = payload[claim] else { continue }
            let shown = value.stringValue ?? value.compactString()
            facts.append(Fact(label: claim, value: shown, copy: value.stringValue != nil && shown.count > 12))
        }
        for claim in ["iat", "nbf", "exp"] {
            guard let seconds = payload[claim]?.doubleValue, let ms = millisecondsFromSeconds(seconds) else { continue }
            facts.append(Fact(label: claim, value: "\(Formatting.isoTimestamp(date(ms: ms))) (\(relativeTime(ms: ms, now: now)))"))
        }

        if let seconds = payload["exp"]?.doubleValue, let ms = millisecondsFromSeconds(seconds) {
            let when = relativeTime(ms: ms, now: now)
            notes.append(ms < now ? "This token expired \(when)." : "This token is still within its lifetime. It expires \(when).")
        } else {
            notes.append("This token has no expiry claim.")
        }
        if let scope = payload["scope"]?.stringValue, let session = sessionScopes[scope] {
            notes.append(session)
        }
        if header["alg"]?.stringValue == "none" || signature.isEmpty {
            notes.append("This token is unsigned.")
        }
        notes.append("The signature is not checked here. Decoding a token shows what it claims, not that the claims are true.")

        return Decoded(
            kind: .jwt,
            title: "JSON Web Token",
            summary: "A signed set of claims. atproto uses them for sessions, OAuth access tokens, DPoP proofs and service-to-service auth.",
            facts: facts,
            json: [
                JSONBlock(label: "Header", value: .object(header)),
                JSONBlock(label: "Claims", value: .object(payload)),
            ],
            notes: notes
        )
    }

    /// A NumericDate as milliseconds, nil when it is not a usable number.
    private static func millisecondsFromSeconds(_ seconds: Double) -> Int64? {
        let ms = (seconds * 1000).rounded()
        guard ms.isFinite, abs(ms) < 8.64e15 else { return nil }
        return Int64(ms)
    }

    // MARK: Datetime

    /// Whether the text is a datetime in the shape the web accepts,
    /// `^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$`,
    /// and if so whether it carries a time and a zone.
    static func datetimeShape(_ text: String) -> (hasTime: Bool, hasZone: Bool)? {
        let scalars = Array(text.unicodeScalars)
        var cursor = 0

        func isDigit(_ scalar: Unicode.Scalar) -> Bool {
            (48...57).contains(scalar.value)
        }

        func digits(_ count: Int) -> Bool {
            guard cursor + count <= scalars.count else { return false }
            for offset in 0..<count where !isDigit(scalars[cursor + offset]) {
                return false
            }
            cursor += count
            return true
        }

        func expect(_ scalar: Unicode.Scalar) -> Bool {
            guard cursor < scalars.count, scalars[cursor] == scalar else { return false }
            cursor += 1
            return true
        }

        guard digits(4), expect("-"), digits(2), expect("-"), digits(2) else { return nil }
        if cursor == scalars.count { return (hasTime: false, hasZone: false) }
        guard expect("T") || expect(" ") else { return nil }
        guard digits(2), expect(":"), digits(2) else { return nil }
        if expect(":") {
            guard digits(2) else { return nil }
            if expect(".") {
                var count = 0
                while cursor < scalars.count, isDigit(scalars[cursor]) {
                    cursor += 1
                    count += 1
                }
                guard count > 0 else { return nil }
            }
        }
        if cursor == scalars.count { return (hasTime: true, hasZone: false) }
        if expect("Z") {
            return cursor == scalars.count ? (hasTime: true, hasZone: true) : nil
        }
        guard expect("+") || expect("-") else { return nil }
        guard digits(2) else { return nil }
        _ = expect(":")
        guard digits(2), cursor == scalars.count else { return nil }
        return (hasTime: true, hasZone: true)
    }

    private static func isDigits(_ text: String, count: Int) -> Bool {
        text.unicodeScalars.count == count && text.unicodeScalars.allSatisfy { (48...57).contains($0.value) }
    }

    /// A datetime with a time and no zone, read in the device's own time
    /// zone, as `Date.parse` reads it.
    private static func localDate(_ text: String) -> Date? {
        guard let asUTC = Formatting.isoDate(text + "Z") else { return nil }
        let parts = Formatting.utcCalendar.dateComponents([.year, .month, .day, .hour, .minute, .second, .nanosecond], from: asUTC)
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .current
        return calendar.date(from: parts)
    }

    static func decodeDatetime(_ text: String, now: Int64) -> Decoded? {
        var reading: Int64?
        var read = ""
        var notes: [String] = []
        if isDigits(text, count: 10), let seconds = Int64(text) {
            reading = seconds * 1000
            read = "Seconds since 1970"
        } else if isDigits(text, count: 13), let value = Int64(text) {
            reading = value
            read = "Milliseconds since 1970"
        } else if isDigits(text, count: 16), let micros = Int64(text) {
            reading = micros / 1000
            read = "Microseconds since 1970"
        } else if let shape = datetimeShape(text) {
            let parsed: Date?
            if shape.hasTime, !shape.hasZone {
                parsed = localDate(text)
                notes.append("No time zone was given, so this was read in your local time. atproto datetimes must carry one.")
            } else {
                // A bare date is midnight UTC, as JavaScript reads it.
                parsed = Formatting.isoDate(text)
            }
            if let parsed {
                reading = milliseconds(parsed)
                read = "A date and time"
            }
        }
        guard let ms = reading else { return nil }

        let seconds = ms >= 0 ? ms / 1000 : (ms - 999) / 1000
        var facts = timeFacts(ms: ms, now: now) + [
            Fact(label: "Seconds", value: String(seconds), copy: true),
            Fact(label: "Milliseconds", value: String(ms), copy: true),
        ]
        // A moment before 1970 has no TID.
        if ms >= 0 {
            facts.append(Fact(label: "TID", value: formatTid(micros: UInt64(ms) * 1000), copy: true))
        }
        return Decoded(
            kind: .datetime,
            title: "Timestamp",
            summary: "\(read). The TID is the record key a record written at this instant would get.",
            facts: facts,
            notes: notes
        )
    }

    // MARK: Entry point

    /// True for input that should never be kept in a link, where it would
    /// land in history and in anything that logs URLs (`isSensitiveInput`).
    /// A token with "Bearer " in front counts too.
    public static func isSensitiveInput(_ raw: String) -> Bool {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return looksLikeJwt(text) || looksLikeJwt(strippingAuthScheme(text)) || text.utf16.count > 400
    }

    /// Every way `raw` can be read, most specific first. Empty when nothing
    /// fits (`decodeIdentifier`).
    public static func decode(_ raw: String, now: Date = Date()) -> [Decoded] {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return [] }
        let nowMs = milliseconds(now)

        if let jwt = decodeJwt(text, now: nowMs) { return [jwt] }
        let stripped = strippingAuthScheme(text)
        if stripped != text, let inner = decodeJwt(stripped, now: nowMs) { return [inner] }

        if text.lowercased().hasPrefix("at://") {
            return decodeAtUri(text, now: nowMs).map { [$0] } ?? []
        }
        if text.hasPrefix("did:") {
            return decodeDid(text).map { [$0] } ?? []
        }

        var out: [Decoded] = []
        if let tid = decodeTid(text, now: nowMs) { out.append(tid) }
        if let cid = decodeCid(text) { out.append(cid) }
        if out.isEmpty, let key = decodeKey(text) { out.append(key) }
        if let datetime = decodeDatetime(text, now: nowMs) { out.append(datetime) }
        if let nsid = decodeNsid(text) { out.append(nsid) }
        if !text.contains("#"), let handle = decodeHandle(text) { out.append(handle) }
        /* A record key last, and only when nothing better explains the
           text: almost any short string is a valid one. */
        if out.isEmpty, let recordKey = decodeRecordKey(text) { out.append(recordKey) }
        return out
    }
}

/// CIDv0: `Qm` and 44 base58 characters.
private let cidV0Pattern = #/Qm[1-9A-HJ-NP-Za-km-z]{44}/#
/// CIDv1 in base32, multibase prefix `b`.
private let cidBase32Pattern = #/b[a-z2-7]{20,}/#
/// CIDv1 in base58btc, multibase prefix `z`.
private let cidBase58Pattern = #/z[1-9A-HJ-NP-Za-km-z]{20,}/#
/// A multibase (`z`) public key.
private let multibaseKeyPattern = #/z[1-9A-HJ-NP-Za-km-z]{30,}/#
/// The 24 base32 characters of a did:plc.
private let plcIdentifierPattern = #/[a-z2-7]{24}/#
/// `^eyJ...\.eyJ...\.[A-Za-z0-9_-]*$`: a header and claims that are JSON
/// objects, base64url, and a signature that may be empty.
private let jwtPattern = #/eyJ[A-Za-z0-9_\-]+\.eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]*/#
