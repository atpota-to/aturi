import Foundation

// Port of src/lib/tools/xrpc.ts, the XRPC console's logic: which methods it
// lists, what a method's parameters are, where a request goes, and how a
// request is written into a link and read back out. Everything here is pure;
// `XrpcConsoleModel` loads lexicons, resolves an account's PDS and sends the
// request.
//
// Queries only. A procedure writes, needs a signed-in session and takes a
// body, and the keyless tools do none of that; a subscription is a
// WebSocket, which the stream monitor already covers. Both are left out of
// the list rather than shown as things the console cannot run.

/// One method the console can open (`XrpcMethod`).
public struct XrpcMethod: Hashable, Sendable, Identifiable {
    public var id: String { nsid }
    public let nsid: String
    /// `query` for everything the index lists.
    public let type: String
    public let description: String
    /// Parameter names, without their types.
    public let params: [String]
    /// False for a method typed in by hand that the index does not list.
    public let listed: Bool

    public init(nsid: String, type: String = "query", description: String, params: [String], listed: Bool = true) {
        self.nsid = nsid
        self.type = type
        self.description = description
        self.params = params
        self.listed = listed
    }

    /// The copy of the lexicon in the atproto repository, the fallback for a
    /// namespace that publishes none (the web index's `raw`). Only for the
    /// methods the index lists, which all come from that repository.
    public var raw: URL? {
        guard listed else { return nil }
        return URL(string: "https://raw.githubusercontent.com/bluesky-social/atproto/main/lexicons/" + nsid.split(separator: ".").joined(separator: "/") + ".json")
    }
}

/// `MethodGroup`.
public struct XrpcMethodGroup: Hashable, Sendable, Identifiable {
    public var id: String { namespace }
    public let namespace: String
    public let methods: [XrpcMethod]
}

/// `XrpcParamKind`.
public enum XrpcParamKind: String, Hashable, Sendable {
    case string
    case integer
    case boolean
    case array
    case unknown
}

/// One parameter of a method (`XrpcParamSpec`).
public struct XrpcParamSpec: Hashable, Sendable, Identifiable {
    public var id: String { name }
    public var name: String
    public var kind: XrpcParamKind
    /// For an array, what each item is.
    public var itemKind: XrpcParamKind?
    public var required: Bool
    public var description: String?
    /// The lexicon's default, as it would be typed.
    public var defaultValue: String?
    /// A closed set: nothing else is accepted.
    public var enumValues: [String]?
    /// An open set: these are suggestions.
    public var knownValues: [String]?
    /// A string's format (`at-identifier`, `nsid`, `datetime`, …).
    public var format: String?
    public var minimum: Double?
    public var maximum: Double?
    public var maxLength: Double?
    /// Not one of the method's own parameters: it came with the link, or was added by hand.
    public var extra: Bool

    public init(
        name: String,
        kind: XrpcParamKind,
        itemKind: XrpcParamKind? = nil,
        required: Bool = false,
        description: String? = nil,
        defaultValue: String? = nil,
        enumValues: [String]? = nil,
        knownValues: [String]? = nil,
        format: String? = nil,
        minimum: Double? = nil,
        maximum: Double? = nil,
        maxLength: Double? = nil,
        extra: Bool = false
    ) {
        self.name = name
        self.kind = kind
        self.itemKind = itemKind
        self.required = required
        self.description = description
        self.defaultValue = defaultValue
        self.enumValues = enumValues
        self.knownValues = knownValues
        self.format = format
        self.minimum = minimum
        self.maximum = maximum
        self.maxLength = maxLength
        self.extra = extra
    }

    /// What a parameter is, in a few words: `string, at-identifier`,
    /// `integer, 1 to 100` (`typeLine` in XrpcConsoleParams.tsx).
    public func typeLine(lexiconKnown: Bool) -> String {
        if extra { return lexiconKnown ? "not in the lexicon" : "" }
        var parts: [String] = []
        if kind == .array {
            if let item = itemKind, item != .unknown {
                parts.append("list of \(item.rawValue)")
            } else {
                parts.append("list of values")
            }
        } else if kind != .unknown {
            parts.append(kind.rawValue)
        }
        if let format = format { parts.append(format) }
        if let low = minimum, let high = maximum {
            parts.append("\(XrpcConsole.number(low)) to \(XrpcConsole.number(high))")
        } else if let low = minimum {
            parts.append("at least \(XrpcConsole.number(low))")
        } else if let high = maximum {
            parts.append("at most \(XrpcConsole.number(high))")
        }
        if kind == .array, let longest = maxLength { parts.append("up to \(XrpcConsole.number(longest))") }
        return parts.joined(separator: ", ")
    }
}

/// A method's parameters, and where they were read from (`XrpcParamSet`).
public struct XrpcParamSet: Hashable, Sendable {
    public enum Source: String, Hashable, Sendable {
        /// Read from the method's lexicon, so types and required-ness are known.
        case lexicon
        /// Only the names are known, and every field is text.
        case names
    }

    public let specs: [XrpcParamSpec]
    public let source: Source

    public init(specs: [XrpcParamSpec], source: Source) {
        self.specs = specs
        self.source = source
    }
}

/// `LexiconSummary`.
public struct XrpcLexiconSummary: Hashable, Sendable {
    public struct NamedError: Hashable, Sendable {
        public let name: String
        public let description: String?

        public init(name: String, description: String? = nil) {
            self.name = name
            self.description = description
        }
    }

    /// `query`, `procedure`, `record`, … or nil when the document has no main definition.
    public let type: String?
    public let description: String?
    /// The response's media type. Nil when the method returns nothing or does not say.
    public let outputEncoding: String?
    /// The errors the method names, for reading a failure.
    public let errors: [NamedError]

    public init(type: String?, description: String?, outputEncoding: String?, errors: [NamedError]) {
        self.type = type
        self.description = description
        self.outputEncoding = outputEncoding
        self.errors = errors
    }
}

/// Parameter values as the console holds them: every value a list, so an
/// array needs no second shape (`XrpcParamValues`).
public typealias XrpcParamValues = [String: [String]]

/// `HostChoice`.
public enum XrpcHostChoice: String, CaseIterable, Hashable, Sendable {
    case appview
    case pds
    case relay
    case other

    public var label: String {
        switch self {
        case .appview: return "AppView"
        case .pds: return "PDS"
        case .relay: return "Relay"
        case .other: return "Other"
        }
    }

    public var hint: String {
        switch self {
        case .appview: return "Bluesky\u{2019}s public AppView, \(Endpoints.appView.host ?? "")"
        case .pds: return "The PDS that hosts an account"
        case .relay: return "Bluesky\u{2019}s relay, \(Endpoints.relay.host ?? "")"
        case .other: return "Any host that serves XRPC"
        }
    }
}

/// `HostUrl`: a typed host as an origin, or why it is not one.
public enum XrpcHostURL: Hashable, Sendable {
    case ok(origin: String)
    case invalid(reason: String)

    public var origin: String? {
        if case .ok(let origin) = self { return origin }
        return nil
    }

    public var isOK: Bool { origin != nil }
}

/// One request, as the query string holds it (`ConsoleRequest`):
///
///     ?method=app.bsky.feed.getPosts&host=appview&p.uris=at://…&p.uris=at://…
///
/// `acct` is the account whose PDS to ask (host `pds`) and `url` the host
/// typed for `other`. Parameters carry a `p.` prefix so a method's own names
/// (`method`, `host` and `url` are all plausible ones) cannot collide with
/// the console's.
public struct XrpcConsoleRequest: Hashable, Sendable {
    public var method: String
    public var host: XrpcHostChoice
    public var acct: String
    public var url: String
    public var params: XrpcParamValues

    public init(method: String, host: XrpcHostChoice, acct: String = "", url: String = "", params: XrpcParamValues = [:]) {
        self.method = method
        self.host = host
        self.acct = acct
        self.url = url
        self.params = params
    }

    /// No method: the list of methods.
    public static let empty = XrpcConsoleRequest(method: "", host: .appview)
}

/// `XrpcFailure`.
public struct XrpcFailure: Hashable, Sendable {
    public let error: String
    public let message: String?

    public init(error: String, message: String?) {
        self.error = error
        self.message = message
    }
}

public enum XrpcConsole {
    // MARK: NSIDs

    private static let nsidShape = #/^[a-zA-Z]([a-zA-Z0-9-]*[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]*[a-zA-Z0-9])?)+$/#
    private static let methodName = #/^[a-zA-Z][a-zA-Z0-9]*$/#

    /// Whether `value` could name an XRPC method: three or more segments,
    /// the last one a name.
    public static func looksLikeMethodNsid(_ value: String) -> Bool {
        guard value.count <= 317, value.wholeMatch(of: nsidShape) != nil else { return false }
        let segments = value.split(separator: ".", omittingEmptySubsequences: false)
        guard segments.count >= 3, let last = segments.last else { return false }
        return String(last).wholeMatch(of: methodName) != nil
    }

    /// `app.bsky.feed.getAuthorFeed` -> `app.bsky.feed`.
    public static func namespaceOf(_ nsid: String) -> String {
        guard let cut = nsid.lastIndex(of: ".") else { return nsid }
        return String(nsid[..<cut])
    }

    /// `app.bsky.feed.getAuthorFeed` -> `app.bsky`, the family a namespace filter picks.
    public static func familyOf(_ nsid: String) -> String {
        nsid.split(separator: ".", omittingEmptySubsequences: false).prefix(2).joined(separator: ".")
    }

    /// `app.bsky.feed.getAuthorFeed` -> `getAuthorFeed`.
    public static func nameOf(_ nsid: String) -> String {
        guard let cut = nsid.lastIndex(of: ".") else { return nsid }
        return String(nsid[nsid.index(after: cut)...])
    }

    /// `localeCompare` as the web sorts NSIDs with it: letters compared
    /// without case first, then lowercase ahead of uppercase.
    public static func localeOrder(_ a: String, _ b: String) -> Bool {
        let la = a.lowercased()
        let lb = b.lowercased()
        if la != lb { return la < lb }
        return a > b
    }

    // MARK: The method list

    /// The queries in a list, in NSID order (`queriesFrom`).
    public static func queries(from methods: [XrpcMethod]) -> [XrpcMethod] {
        methods.filter { $0.type == "query" }.sorted { localeOrder($0.nsid, $1.nsid) }
    }

    /// Methods by namespace (`app.bsky.feed`), each group and the groups
    /// themselves in order.
    public static func groupMethods(_ methods: [XrpcMethod]) -> [XrpcMethodGroup] {
        var order: [String] = []
        var groups: [String: [XrpcMethod]] = [:]
        for method in methods {
            let namespace = namespaceOf(method.nsid)
            if groups[namespace] == nil { order.append(namespace) }
            groups[namespace, default: []].append(method)
        }
        return order.sorted { localeOrder($0, $1) }.map { XrpcMethodGroup(namespace: $0, methods: groups[$0] ?? []) }
    }

    /// The families present in a list (`app.bsky`, `com.atproto`, …), in order.
    public static func familiesOf(_ methods: [XrpcMethod]) -> [String] {
        Array(Set(methods.map { familyOf($0.nsid) })).sorted()
    }

    /// Methods matching what was typed, best first.
    ///
    /// Every word has to appear somewhere in the NSID or the description.
    /// The method's own name counts most, because that is what people
    /// remember ("getProfile", "listRecords"), then the rest of the NSID,
    /// then the description, which is how a method is found by what it does.
    public static func searchMethods(_ methods: [XrpcMethod], query: String, limit: Int = 50) -> [XrpcMethod] {
        let words = query.lowercased().split(whereSeparator: { $0.isWhitespace }).map(String.init)
        if words.isEmpty { return Array(methods.prefix(limit)) }

        var scored: [(method: XrpcMethod, score: Int)] = []
        for method in methods {
            let nsid = method.nsid.lowercased()
            let name = nameOf(nsid)
            let description = method.description.lowercased()
            var score = 0
            var matched = true
            for word in words {
                if nsid == word {
                    score += 100
                } else if name == word {
                    score += 60
                } else if name.hasPrefix(word) {
                    score += 40
                } else if name.contains(word) {
                    score += 25
                } else if nsid.contains(word) {
                    score += 15
                } else if description.contains(word) {
                    score += 5
                } else {
                    matched = false
                    break
                }
            }
            if matched { scored.append((method: method, score: score)) }
        }
        return scored
            .sorted { $0.score != $1.score ? $0.score > $1.score : localeOrder($0.method.nsid, $1.method.nsid) }
            .prefix(limit)
            .map { $0.method }
    }

    /// A method typed by its full NSID that the list does not hold: a third
    /// party's lexicon, or one newer than the index. It can still be opened,
    /// and its parameters are read from the lexicon its author published.
    public static func unlistedMethod(_ methods: [XrpcMethod], query: String) -> XrpcMethod? {
        let nsid = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard looksLikeMethodNsid(nsid), !methods.contains(where: { $0.nsid == nsid }) else { return nil }
        return XrpcMethod(
            nsid: nsid,
            description: "Not in the index. Its lexicon is looked up when you open it.",
            params: [],
            listed: false
        )
    }

    // MARK: Parameters

    private static func kindOf(_ type: JSONValue?) -> XrpcParamKind {
        guard let type = type?.stringValue else { return .unknown }
        switch type {
        case "string": return .string
        case "integer": return .integer
        case "boolean": return .boolean
        case "array": return .array
        default: return .unknown
        }
    }

    /// A number as JavaScript's `String()` writes it: no `.0` on an integer.
    static func number(_ value: Double) -> String {
        if value == value.rounded(), abs(value) < 1e15 { return String(Int64(value)) }
        return String(value)
    }

    /// Strings, numbers and booleans as text; nil for anything else or
    /// nothing at all (`stringList`).
    private static func stringList(_ value: JSONValue?) -> [String]? {
        guard let items = value?.arrayValue else { return nil }
        let list = items.compactMap { item -> String? in
            switch item {
            case .string(let s): return s
            case .number(let n): return number(n)
            case .bool(let b): return b ? "true" : "false"
            default: return nil
            }
        }
        return list.isEmpty ? nil : list
    }

    /// The `main` definition of a lexicon document, when it has one.
    private static func mainDef(_ doc: JSONValue?) -> [String: JSONValue]? {
        doc?["defs"]?["main"]?.objectValue
    }

    /// A method's parameters, from its lexicon when one is in hand.
    ///
    /// Required parameters come first, in the order the lexicon lists them
    /// as required, then the rest alphabetically: published lexicon records
    /// have their keys sorted, so the document's own order says nothing.
    ///
    /// Without a lexicon the names alone are used and every field is free
    /// text, which still lets a request be made; the host reports what it
    /// did not like.
    public static func paramSet(fromLexicon doc: JSONValue?, fallbackNames: [String]) -> XrpcParamSet {
        guard let main = mainDef(doc) else {
            return XrpcParamSet(specs: fallbackNames.map { XrpcParamSpec(name: $0, kind: .unknown) }, source: .names)
        }
        let parameters = main["parameters"]?.objectValue ?? [:]
        let properties = parameters["properties"]?.objectValue ?? [:]
        let required = (parameters["required"]?.arrayValue ?? []).compactMap(\.stringValue)

        var specs: [XrpcParamSpec] = properties.map { name, raw in
            let property = raw.objectValue ?? [:]
            let kind = kindOf(property["type"])
            let items = property["items"]?.objectValue ?? [:]
            let source = kind == .array ? items : property
            let itemKind = kindOf(items["type"])
            var defaultValue: String?
            switch property["default"] {
            case .string(let s)?: defaultValue = s
            case .number(let n)?: defaultValue = number(n)
            case .bool(let b)?: defaultValue = b ? "true" : "false"
            case .null?: defaultValue = "null"
            default: defaultValue = nil
            }
            return XrpcParamSpec(
                name: name,
                kind: kind,
                itemKind: kind == .array && itemKind != .array ? itemKind : nil,
                required: required.contains(name),
                description: property["description"]?.stringValue,
                defaultValue: defaultValue,
                enumValues: stringList(source["enum"]),
                knownValues: stringList(source["knownValues"]),
                format: source["format"]?.stringValue,
                minimum: property["minimum"]?.doubleValue,
                maximum: property["maximum"]?.doubleValue,
                maxLength: property["maxLength"]?.doubleValue
            )
        }

        func rank(_ spec: XrpcParamSpec) -> Int {
            spec.required ? (required.firstIndex(of: spec.name) ?? required.count) : required.count
        }
        specs.sort { rank($0) != rank($1) ? rank($0) < rank($1) : localeOrder($0.name, $1.name) }
        return XrpcParamSet(specs: specs, source: .lexicon)
    }

    /// `summarizeMethodLexicon`.
    public static func summarizeMethodLexicon(_ doc: JSONValue?) -> XrpcLexiconSummary {
        guard let main = mainDef(doc) else {
            return XrpcLexiconSummary(type: nil, description: nil, outputEncoding: nil, errors: [])
        }
        let errors = (main["errors"]?.arrayValue ?? []).compactMap { entry -> XrpcLexiconSummary.NamedError? in
            guard entry.objectValue != nil, let name = entry["name"]?.stringValue else { return nil }
            return XrpcLexiconSummary.NamedError(name: name, description: entry["description"]?.stringValue)
        }
        return XrpcLexiconSummary(
            type: main["type"]?.stringValue,
            description: main["description"]?.stringValue,
            outputEncoding: main["output"]?["encoding"]?.stringValue,
            errors: errors
        )
    }

    /// The fields to draw: the method's parameters, then any other name
    /// that has a value. A link can carry a parameter the lexicon does not
    /// list, and it is sent, so it has to be on the page where it can be
    /// seen and removed.
    public static func withExtraParams(_ specs: [XrpcParamSpec], values: XrpcParamValues) -> [XrpcParamSpec] {
        let known = Set(specs.map(\.name))
        let extras = values.keys
            .filter { !known.contains($0) }
            .sorted()
            .map { XrpcParamSpec(name: $0, kind: .unknown, extra: true) }
        return extras.isEmpty ? specs : specs + extras
    }

    private static let paramName = #/^[A-Za-z][A-Za-z0-9_]{0,63}$/#

    /// Whether `name` can be a parameter name: what a lexicon would allow as
    /// a property key.
    public static func isParamName(_ name: String) -> Bool {
        name.wholeMatch(of: paramName) != nil
    }

    /// The values worth sending: trimmed, with empty ones dropped.
    public static func cleanValues(_ values: XrpcParamValues) -> XrpcParamValues {
        var out: XrpcParamValues = [:]
        for (name, list) in values {
            let kept = list.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty }
            if !kept.isEmpty { out[name] = kept }
        }
        return out
    }

    /// Required parameters that have no value yet.
    public static func missingRequired(_ specs: [XrpcParamSpec], values: XrpcParamValues) -> [String] {
        let clean = cleanValues(values)
        return specs.filter { $0.required && clean[$0.name] == nil }.map(\.name)
    }

    // MARK: Where a request goes

    /// Relay-side methods under com.atproto.sync: they describe the hosts a
    /// relay crawls, which a PDS has no answer for. The rest of the
    /// namespace is served by a PDS (and mirrored by a relay), so it
    /// defaults to the PDS.
    private static let relayMethods: Set<String> = [
        "com.atproto.sync.getHostStatus",
        "com.atproto.sync.listHosts",
        "com.atproto.sync.listReposByCollection",
    ]

    /// Where a method is most likely to be answered.
    ///
    /// `app.bsky.*` is the AppView's own API, except the two methods a feed
    /// generator serves. Identity lookups are answered by the AppView too.
    /// The repo, sync and server namespaces belong to a PDS. Everything else
    /// (a labeler's `com.atproto.label.*`, Ozone, chat, a lexicon this index
    /// has never seen) lives on a service only its caller can name.
    public static func defaultHost(for nsid: String) -> XrpcHostChoice {
        if relayMethods.contains(nsid) { return .relay }
        if nsid == "app.bsky.feed.getFeedSkeleton" || nsid == "app.bsky.feed.describeFeedGenerator" { return .other }
        if nsid.hasPrefix("app.bsky.") { return .appview }
        if nsid.hasPrefix("com.atproto.identity.") { return .appview }
        if nsid.hasPrefix("com.atproto.repo.") || nsid.hasPrefix("com.atproto.sync.") || nsid.hasPrefix("com.atproto.server.") {
            return .pds
        }
        return .other
    }

    private static let schemePrefix = #/^[a-zA-Z][a-zA-Z0-9+.\-]*:\/\//#
    private static let hostLabel = #/^[A-Za-z0-9]([A-Za-z0-9\-]*[A-Za-z0-9])?$/#

    /// Tidy a typed host into an origin. A bare name gets https. Plain http
    /// is kept only for this machine, where a PDS under development runs.
    public static func normalizeHostURL(_ raw: String) -> XrpcHostURL {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else {
            return .invalid(reason: "Enter the host to send the request to, such as pds.example.com.")
        }
        let notAHost = XrpcHostURL.invalid(reason: "That is not a host name or URL.")

        var scheme = "https"
        var rest = Substring(value)
        if let match = value.prefixMatch(of: schemePrefix) {
            scheme = String(match.output.dropLast(3)).lowercased()
            rest = value[match.range.upperBound...]
        }
        let authority = rest.prefix { $0 != "/" && $0 != "?" && $0 != "#" }
        var hostPort = authority
        var credentials = false
        if let at = authority.lastIndex(of: "@") {
            credentials = true
            hostPort = authority[authority.index(after: at)...]
        }

        var host: String
        var port: String?
        if hostPort.hasPrefix("[") {
            guard let close = hostPort.firstIndex(of: "]") else { return notAHost }
            host = String(hostPort[...close]).lowercased()
            let after = hostPort[hostPort.index(after: close)...]
            if !after.isEmpty {
                guard after.hasPrefix(":") else { return notAHost }
                port = String(after.dropFirst())
            }
            let inner = host.dropFirst().dropLast()
            guard !inner.isEmpty, inner.allSatisfy({ $0.isHexDigit || $0 == ":" || $0 == "." }) else { return notAHost }
        } else {
            let parts = hostPort.split(separator: ":", maxSplits: 1, omittingEmptySubsequences: false)
            host = String(parts[0]).lowercased()
            if parts.count > 1 { port = String(parts[1]) }
            if host.hasSuffix(".") { host.removeLast() }
            let labels = host.split(separator: ".", omittingEmptySubsequences: false)
            guard !host.isEmpty, labels.allSatisfy({ String($0).wholeMatch(of: hostLabel) != nil }) else { return notAHost }
        }
        // `host:` with nothing after it is the default port, as URL reads it.
        if let portText = port, !portText.isEmpty {
            guard portText.count <= 5, portText.allSatisfy({ $0.isASCII && $0.isNumber }), (Int(portText) ?? Int.max) <= 65_535 else {
                return notAHost
            }
        }

        let local = host == "localhost" || host == "127.0.0.1" || host == "[::1]"
        if scheme == "http" && !local {
            return .invalid(reason: "Use https. The app does not send this request over plain http.")
        }
        if scheme != "https" && scheme != "http" {
            return .invalid(reason: "XRPC is served over https.")
        }
        if credentials {
            return .invalid(reason: "Leave credentials out of the host.")
        }
        var origin = "\(scheme)://\(host)"
        if let port, let number = Int(port) {
            let defaultPort = scheme == "https" ? 443 : 80
            if number != defaultPort { origin += ":\(number)" }
        }
        return .ok(origin: origin)
    }

    /// The static host for a choice, or nil when it has to be resolved or typed.
    public static func fixedOrigin(for host: XrpcHostChoice) -> String? {
        switch host {
        case .appview: return originOf(Endpoints.appView)
        case .relay: return originOf(Endpoints.relay)
        case .pds, .other: return nil
        }
    }

    private static func originOf(_ url: URL) -> String {
        var text = url.absoluteString
        if text.hasSuffix("/") { text.removeLast() }
        return text
    }

    // MARK: A request, in the link

    private static let paramPrefix = "p."

    /// `requestFromSearch`.
    public static func request(from items: NetworkToolQueryItems) -> XrpcConsoleRequest {
        let method = (NetworkToolQuery.first("method", in: items) ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        let host = NetworkToolQuery.first("host", in: items) ?? ""
        var params: XrpcParamValues = [:]
        for (key, value) in items where key.hasPrefix(paramPrefix) && key.count > paramPrefix.count {
            params[String(key.dropFirst(paramPrefix.count)), default: []].append(value)
        }
        return XrpcConsoleRequest(
            method: method,
            host: XrpcHostChoice(rawValue: host) ?? defaultHost(for: method),
            acct: (NetworkToolQuery.first("acct", in: items) ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
            url: (NetworkToolQuery.first("url", in: items) ?? "").trimmingCharacters(in: .whitespacesAndNewlines),
            params: params
        )
    }

    /// The query for a request (`requestToSearch`). The host is written only
    /// when it is not the method's default, and `acct` and `url` only for
    /// the host that reads them, so the common link is the method and its
    /// parameters and nothing else.
    public static func queryItems(for request: XrpcConsoleRequest) -> NetworkToolQueryItems {
        guard !request.method.isEmpty else { return [] }
        var items: NetworkToolQueryItems = [("method", request.method)]
        if request.host != defaultHost(for: request.method) { items.append(("host", request.host.rawValue)) }
        if request.host == .pds && !request.acct.isEmpty { items.append(("acct", request.acct)) }
        if request.host == .other && !request.url.isEmpty { items.append(("url", request.url)) }
        let params = cleanValues(request.params)
        for name in params.keys.sorted() {
            for value in params[name] ?? [] {
                items.append((paramPrefix + name, value))
            }
        }
        return items
    }

    /// `requestToSearch`, encoded as `URLSearchParams` does.
    public static func search(for request: XrpcConsoleRequest) -> String {
        NetworkToolQuery.encode(queryItems(for: request))
    }

    /// The account whose PDS a `pds` request goes to: the one named, or
    /// failing that the repository the request is about, since a read of a
    /// repo is answered by the PDS that hosts it.
    public static func pdsAccount(for request: XrpcConsoleRequest) -> String? {
        pdsAccount(acct: request.acct, params: request.params)
    }

    public static func pdsAccount(acct: String, params: XrpcParamValues) -> String? {
        if !acct.isEmpty { return acct.hasPrefix("@") ? String(acct.dropFirst()) : acct }
        let clean = cleanValues(params)
        for name in ["repo", "did", "actor"] {
            if let value = clean[name]?.first {
                return value.hasPrefix("@") ? String(value.dropFirst()) : value
            }
        }
        return nil
    }

    /// Whether a request arriving by link can be sent without asking: it
    /// names a method, every required parameter has a value, and there is a
    /// host to send it to. Needs the lexicon; with only parameter names
    /// nothing is known to be required, so nothing is assumed complete.
    public static func isComplete(_ request: XrpcConsoleRequest, paramSet: XrpcParamSet?) -> Bool {
        guard !request.method.isEmpty, let paramSet, paramSet.source == .lexicon else { return false }
        if !missingRequired(paramSet.specs, values: request.params).isEmpty { return false }
        switch request.host {
        case .pds: return pdsAccount(for: request) != nil
        case .other: return normalizeHostURL(request.url).isOK
        case .appview, .relay: return true
        }
    }

    // MARK: The request itself

    /// The URL a request is sent to. Parameters go in the lexicon's order
    /// when it is known, then any others by name; an array repeats its key,
    /// which is how XRPC spells a list.
    public static func buildRequestURL(origin: String, nsid: String, values: XrpcParamValues, specs: [XrpcParamSpec] = []) -> String {
        let clean = cleanValues(values)
        let known = specs.map(\.name).filter { clean[$0] != nil }
        let extra = clean.keys.filter { !known.contains($0) }.sorted()
        var items: NetworkToolQueryItems = []
        for name in known + extra {
            for value in clean[name] ?? [] {
                items.append((name, value))
            }
        }
        let query = NetworkToolQuery.encode(items)
        let base = origin.hasSuffix("/") ? String(origin.dropLast()) : origin
        return "\(base)/xrpc/\(nsid)" + (query.isEmpty ? "" : "?" + query)
    }

    /// The same request for a terminal. Single-quoted, so the shell leaves
    /// `&` and `?` alone.
    public static func curl(for url: String) -> String {
        "curl '" + url.replacingOccurrences(of: "'", with: "'\\''") + "'"
    }

    // MARK: The response

    private static let textualType = #/(?i)json|^text\//#

    /// Whether a media type is one the console shows as text: JSON, or
    /// anything textual.
    public static func isTextual(_ contentType: String?) -> Bool {
        guard let contentType else { return true }
        return contentType.firstMatch(of: textualType) != nil
    }

    /// The `{ error, message }` an XRPC host answers a failure with, when
    /// the body is one.
    public static func readXrpcFailure(_ body: JSONValue?) -> XrpcFailure? {
        guard let body, body.objectValue != nil, let error = body["error"]?.stringValue else { return nil }
        let message = body["message"]?.stringValue
        return XrpcFailure(error: error, message: message?.isEmpty == false ? message : nil)
    }

    /// The cursor a page of results hands back for the next one.
    public static func nextCursor(_ body: JSONValue?) -> String? {
        guard let cursor = body?["cursor"]?.stringValue, !cursor.isEmpty else { return nil }
        return cursor
    }

    public static func formatBytes(_ bytes: Int) -> String {
        if bytes < 1024 { return "\(bytes) B" }
        if bytes < 1024 * 1024 {
            return String(format: bytes < 10 * 1024 ? "%.1f KB" : "%.0f KB", Double(bytes) / 1024)
        }
        return String(format: "%.1f MB", Double(bytes) / (1024 * 1024))
    }

    public static func formatDuration(_ ms: Double) -> String {
        ms < 1000 ? "\(Int(ms.rounded())) ms" : String(format: "%.2f s", ms / 1000)
    }

    /// HTTP/2 carries no reason phrase, so the common ones are spelled here.
    public static let reasons: [Int: String] = [
        200: "OK",
        400: "Bad Request",
        401: "Unauthorized",
        403: "Forbidden",
        404: "Not Found",
        429: "Too Many Requests",
        500: "Internal Server Error",
        501: "Not Implemented",
        502: "Bad Gateway",
        503: "Service Unavailable",
        504: "Gateway Timeout",
    ]

    /// `200 OK`, or the bare status.
    public static func statusLine(_ status: Int) -> String {
        reasons[status].map { "\(status) \($0)" } ?? String(status)
    }

    /// What a failure most likely means, beyond the host's own message.
    public static func failureHint(status: Int, error: String?) -> String? {
        if status == 401 || error == "AuthMissing" || error == "AuthenticationRequired" {
            return "This method needs a signed-in session. The console sends requests without one."
        }
        if status == 501 || error == "MethodNotImplemented" || error == "XRPCNotSupported" {
            return "This host does not serve that method. Try sending it somewhere else."
        }
        if status == 404 && error == nil {
            return "This host does not serve that method, or does not serve XRPC at all."
        }
        if status == 429 { return "The host is rate limiting requests. Wait a little before sending again." }
        return nil
    }

    /// A host's message as a sentence, whether or not it ended one.
    public static func sentence(_ text: String) -> String {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        if let last = trimmed.last, ".!?".contains(last) { return trimmed + " " }
        return trimmed + ". "
    }
}
