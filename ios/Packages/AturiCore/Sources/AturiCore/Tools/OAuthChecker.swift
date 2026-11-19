import Foundation

/// The OAuth client checker's logic, port of `src/lib/tools/oauth.ts`: what
/// an atproto client metadata document has to say, and how to read one.
///
/// In atproto a client is not registered with anyone. Its `client_id` is the
/// URL of a JSON document it publishes, and every authorization server
/// fetches that document and decides from it whether to deal with the
/// client. The rules below are the "Clients" section of
/// https://atproto.com/specs/oauth, one check per rule, each in the spec's
/// own terms.
///
/// Everything here is pure. The document is read by `OAuthCheckerClient`
/// and arrives as a `ClientMetadataProbe`. A `http://localhost` client_id is
/// the exception: it has no document at all, and its metadata is derived
/// from the URL itself.
public enum OAuthChecker {
    // MARK: - The client_id

    public enum ClientIdKind: String, Hashable, Sendable {
        /// A document on the web, to be fetched.
        case hosted
        /// The development form: no document, metadata implied by the URL.
        case loopback
    }

    public enum ClientIdInput: Hashable, Sendable {
        case ok(kind: ClientIdKind, clientId: String)
        case invalid(String)

        public var clientId: String? {
            if case .ok(_, let clientId) = self { return clientId }
            return nil
        }

        public var kind: ClientIdKind? {
            if case .ok(let kind, _) = self { return kind }
            return nil
        }

        public var reason: String? {
            if case .invalid(let reason) = self { return reason }
            return nil
        }
    }

    /// `new URL(value)` as far as these checks need it: an absolute URL with
    /// a scheme. A string Foundation reads as a relative reference is not
    /// one, as JavaScript's parser would throw on it.
    static func parseURL(_ value: String) -> URL? {
        guard let url = URL(string: value), let scheme = url.scheme, !scheme.isEmpty else { return nil }
        if scheme.lowercased() == "http" || scheme.lowercased() == "https" {
            guard let host = url.host, !host.isEmpty else { return nil }
        }
        return url
    }

    static func hostname(_ url: URL) -> String {
        (url.host ?? "").lowercased()
    }

    /// `url.origin`: scheme, host and a port that is not the default one.
    static func origin(_ url: URL) -> String {
        let scheme = (url.scheme ?? "").lowercased()
        var out = "\(scheme)://\(hostname(url))"
        if let port = url.port, !(scheme == "https" && port == 443), !(scheme == "http" && port == 80) {
            out += ":\(port)"
        }
        return out
    }

    /// Decide what was typed. The string is kept exactly as given (a bare
    /// host only gains its `https://`), because the document must repeat it
    /// character for character and a tidied URL would hide a mismatch.
    public static func parseClientId(_ raw: String) -> ClientIdInput {
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { return .invalid("Enter a client_id: the URL of a client metadata document.") }
        if value.contains(where: { $0.isWhitespace }) { return .invalid("A client_id is a single URL, with no spaces.") }
        if value.range(of: "^[a-z][a-z0-9+.-]*://", options: [.regularExpression, .caseInsensitive]) == nil {
            value = "https://" + value
        }
        guard let url = parseURL(value) else {
            return .invalid("That is not a well-formed URL.")
        }
        if url.user != nil || url.password != nil {
            return .invalid("A client_id cannot carry a username or password.")
        }
        let scheme = (url.scheme ?? "").lowercased()
        if scheme == "http" {
            if hostname(url) == "localhost" { return .ok(kind: .loopback, clientId: value) }
            return .invalid("A client_id must be an https URL. The one exception is http://localhost, for development.")
        }
        if scheme != "https" {
            return .invalid("A client_id must be an https URL.")
        }
        // The URL parser drops a default port, so `:443` is read off the text.
        if value.range(of: "^https://[^/?#]*:[0-9]+", options: [.regularExpression, .caseInsensitive]) != nil {
            return .invalid("A client_id cannot include a port number.")
        }
        if !hostname(url).contains(".") {
            return .invalid("A client_id needs a public hostname, such as app.example.com.")
        }
        return .ok(kind: .hosted, clientId: value)
    }

    // MARK: - What the read reports

    public struct ClientMetadataProbe: Hashable, Sendable {
        public enum Status: String, Hashable, Sendable {
            /// The host returned a response, whatever its status.
            case answered
            case error
        }

        public var clientId: String
        public var status: Status
        public var httpStatus: Int?
        public var contentType: String?
        /// Each URL a redirect led away from, in order.
        public var redirectedFrom: [String]
        public var finalUrl: String?
        /// The body, parsed, and cut down to the fields client metadata
        /// defines (`clientMetadataFields`). Nil when it was not JSON.
        public var document: JSONValue?
        /// Names of the fields the document carried that were left out.
        public var otherFields: [String]
        /// Why there is no document: not JSON, or longer than the cap.
        public var bodyProblem: String?
        public var error: String?

        public init(
            clientId: String,
            status: Status,
            httpStatus: Int? = nil,
            contentType: String? = nil,
            redirectedFrom: [String] = [],
            finalUrl: String? = nil,
            document: JSONValue? = nil,
            otherFields: [String] = [],
            bodyProblem: String? = nil,
            error: String? = nil
        ) {
            self.clientId = clientId
            self.status = status
            self.httpStatus = httpStatus
            self.contentType = contentType
            self.redirectedFrom = redirectedFrom
            self.finalUrl = finalUrl
            self.document = document
            self.otherFields = otherFields
            self.bodyProblem = bodyProblem
            self.error = error
        }
    }

    /// The fields a client metadata document may carry: the ones the
    /// atproto profile names, and the rest of OAuth dynamic client
    /// registration (RFC 7591) that a document written for several servers
    /// is likely to include. Anything else is reported by name only.
    public static let clientMetadataFields: [String] = [
        "client_id",
        "client_name",
        "client_uri",
        "logo_uri",
        "tos_uri",
        "policy_uri",
        "redirect_uris",
        "scope",
        "grant_types",
        "response_types",
        "application_type",
        "token_endpoint_auth_method",
        "token_endpoint_auth_signing_alg",
        "dpop_bound_access_tokens",
        "jwks",
        "jwks_uri",
        "contacts",
        "software_id",
        "software_version",
        "subject_type",
        "authorization_signed_response_alg",
    ]

    /// Split a parsed body into the metadata fields and the names of the
    /// rest. JSON objects arrive here unordered, so the other names are
    /// sorted rather than kept in the document's order.
    public static func narrowClientMetadata(_ body: [String: JSONValue]) -> (document: [String: JSONValue], otherFields: [String]) {
        let known = Set(clientMetadataFields)
        var document: [String: JSONValue] = [:]
        var others: [String] = []
        for key in body.keys.sorted() {
            if known.contains(key) {
                document[key] = body[key]
            } else if others.count < 40 {
                others.append(ServiceFormat.clip(key, 80))
            }
        }
        return (document, others)
    }

    // MARK: - Reading a document

    static func stringArray(_ value: JSONValue?) -> [String]? {
        guard let items = value?.arrayValue else { return nil }
        var out: [String] = []
        for item in items {
            guard let text = item.stringValue else { return nil }
            out.append(text)
        }
        return out
    }

    /// `app.example.com` → `com.example.app`, the scheme a native redirect must use.
    public static func reverseDomain(_ hostname: String) -> String {
        hostname.lowercased().split(separator: ".", omittingEmptySubsequences: false).reversed().joined(separator: ".")
    }

    public enum Application: String, Hashable, Sendable {
        case web
        case native
    }

    public struct ClientKind: Hashable, Sendable {
        public var application: Application
        /// Confidential clients authenticate with a key; public ones do not.
        public var confidential: Bool

        public init(application: Application, confidential: Bool) {
            self.application = application
            self.confidential = confidential
        }

        /// "Public native client".
        public var label: String {
            "\(confidential ? "Confidential" : "Public") \(application.rawValue) client"
        }
    }

    public static func clientKind(_ document: JSONValue?) -> ClientKind? {
        guard let document, document.objectValue != nil else { return nil }
        return ClientKind(
            application: document["application_type"]?.stringValue == "native" ? .native : .web,
            confidential: document["token_endpoint_auth_method"]?.stringValue == "private_key_jwt"
        )
    }

    /// Why a redirect URI breaks the rules for its client type, or nil when it is fine.
    public static func redirectUriProblem(_ uri: String, application: Application, clientId: String) -> String? {
        let client = parseURL(clientId)
        var scheme: String?
        var rest = ""
        if let colon = uri.firstIndex(of: ":") {
            let candidate = String(uri[uri.startIndex..<colon])
            if candidate.range(of: "^[a-z][a-z0-9+.-]*$", options: [.regularExpression, .caseInsensitive]) != nil {
                scheme = candidate.lowercased()
                rest = String(uri[uri.index(after: colon)...])
            }
        }

        if scheme == "https" {
            guard let url = parseURL(uri) else { return "not a well-formed URL" }
            if uri.range(of: "^https://[^/?#]*:443([/?#]|$)", options: [.regularExpression, .caseInsensitive]) != nil {
                return "names the default port, which must be left out"
            }
            if application == .native, let client, origin(url) != origin(client) {
                return "an https redirect for a native client must be on the client_id's origin, \(origin(client))"
            }
            return nil
        }
        if scheme == "http" {
            return "plain http is only allowed for the http://localhost development client"
        }
        if application == .web {
            return "a web client redirects to an https URL"
        }
        guard let scheme else { return "not a URL or an app scheme" }
        // Native, with a scheme of the app's own.
        if let client {
            let expected = reverseDomain(hostname(client))
            if scheme != expected {
                return "the scheme must be \(expected), the client_id's hostname in reverse"
            }
        }
        if rest.range(of: "^/[^/]", options: .regularExpression) == nil {
            return "the scheme must be followed by one colon, one slash, then a path, such as :/callback"
        }
        return nil
    }

    private enum Title {
        static let served = "Document is served"
        static let clientId = "client_id matches"
        static let applicationType = "Application type"
        static let grantTypes = "Grant types"
        static let responseTypes = "Response types"
        static let scope = "Scope"
        static let redirectUris = "Redirect URIs"
        static let dpop = "DPoP"
        static let auth = "Client authentication"
        static let display = "Name and links"
    }

    /// One row for everything that reads the document, when there is none.
    /// Nine rows saying "not checked" would bury the one that says why.
    static let noDocument = ServiceCheck(
        id: "document",
        status: .skip,
        title: "Fields in the document",
        summary: "Not checked, because there is no document to read."
    )

    private static let documentChecks: [(String, String)] = [
        ("client_id", Title.clientId),
        ("application_type", Title.applicationType),
        ("grant_types", Title.grantTypes),
        ("response_types", Title.responseTypes),
        ("scope", Title.scope),
        ("redirect_uris", Title.redirectUris),
        ("dpop", Title.dpop),
        ("auth", Title.auth),
        ("display", Title.display),
    ]

    private static func servedCheck(_ probe: ClientMetadataProbe) -> ServiceCheck {
        var detail = ["GET \(probe.clientId)"]
        for from in probe.redirectedFrom where from != probe.clientId {
            detail.append("→ redirected from \(from)")
        }
        if probe.status == .error {
            return ServiceCheck(
                id: "served",
                status: .fail,
                title: Title.served,
                summary: "The document could not be fetched: \(probe.error ?? "no answer").",
                detail: detail,
                fix: ["Authorization servers fetch this URL from the public web. It has to answer there, over https."]
            )
        }
        let status = probe.httpStatus.map(String.init) ?? "undefined"
        let typeText = probe.contentType.map { ", " + $0 } ?? ""
        detail.append("→ HTTP \(status)\(typeText)")
        if !probe.redirectedFrom.isEmpty {
            let ended = probe.finalUrl ?? "undefined"
            detail.append("→ ended at \(ended)")
            return ServiceCheck(
                id: "served",
                status: .fail,
                title: Title.served,
                summary: "The address redirects. The response must be a 200 at the client_id itself, not a redirect.",
                detail: detail,
                fix: ["Serve the document at this exact URL, or use \(ended) as the client_id."]
            )
        }
        if probe.httpStatus != 200 {
            return ServiceCheck(
                id: "served",
                status: .fail,
                title: Title.served,
                summary: "The address answered HTTP \(status). The status must be exactly 200.",
                detail: detail
            )
        }
        guard let document = probe.document, document.objectValue != nil else {
            return ServiceCheck(
                id: "served",
                status: .fail,
                title: Title.served,
                summary: probe.bodyProblem ?? "The body is JSON, but not an object. The document must be a JSON object.",
                detail: detail
            )
        }
        let mediaType = (probe.contentType ?? "")
            .split(separator: ";", maxSplits: 1, omittingEmptySubsequences: false)
            .first.map { $0.trimmingCharacters(in: .whitespaces).lowercased() } ?? ""
        if mediaType != "application/json" {
            return ServiceCheck(
                id: "served",
                status: .fail,
                title: Title.served,
                summary: "Served as \(mediaType.isEmpty ? "no content type" : mediaType). The Content-Type must be application/json.",
                detail: detail,
                fix: ["Set the Content-Type header for this path. A static host often picks it from the .json extension."]
            )
        }
        return ServiceCheck(id: "served", status: .pass, title: Title.served, summary: "Answers 200 with a JSON object, as application/json.", detail: detail)
    }

    private static func clientIdCheck(_ doc: JSONValue, clientId: String) -> ServiceCheck {
        guard let documented = doc["client_id"]?.stringValue else {
            return ServiceCheck(
                id: "client_id",
                status: .fail,
                title: Title.clientId,
                summary: "The document has no client_id. It is required, and must be the URL the document is served from.",
                fix: ["Add \"client_id\": \"\(clientId)\"."]
            )
        }
        if documented != clientId {
            return ServiceCheck(
                id: "client_id",
                status: .fail,
                title: Title.clientId,
                summary: "The client_id in the document must exactly match the URL it was fetched from, character for character.",
                detail: ["fetched   \(clientId)", "document  \(documented)"],
                fix: ["Make the two identical, including the scheme, any trailing slash and the path."]
            )
        }
        return ServiceCheck(id: "client_id", status: .pass, title: Title.clientId, summary: "The document names the URL it was fetched from.")
    }

    private static func applicationTypeCheck(_ doc: JSONValue) -> ServiceCheck {
        guard let value = doc["application_type"] else {
            return ServiceCheck(id: "application_type", status: .info, title: Title.applicationType, summary: "Not set, so servers treat this as a web client.")
        }
        if value == "web" || value == "native" {
            return ServiceCheck(
                id: "application_type",
                status: .pass,
                title: Title.applicationType,
                summary: value == "web"
                    ? "A web client: it redirects to https URLs that open in a browser."
                    : "A native client: it may redirect to a URL scheme of its own."
            )
        }
        return ServiceCheck(
            id: "application_type",
            status: .fail,
            title: Title.applicationType,
            summary: "application_type is \(value.compactString()). It must be web or native."
        )
    }

    private static func grantTypesCheck(_ doc: JSONValue) -> ServiceCheck {
        guard let values = stringArray(doc["grant_types"]) else {
            return ServiceCheck(
                id: "grant_types",
                status: .fail,
                title: Title.grantTypes,
                summary: "grant_types is required, as an array of strings that includes authorization_code.",
                fix: ["Add \"grant_types\": [\"authorization_code\", \"refresh_token\"]."]
            )
        }
        if !values.contains("authorization_code") {
            return ServiceCheck(
                id: "grant_types",
                status: .fail,
                title: Title.grantTypes,
                summary: "grant_types must include authorization_code. It is the only grant the atproto profile supports.",
                detail: [values.isEmpty ? "(empty)" : values.joined(separator: ", ")]
            )
        }
        let others = values.filter { $0 != "authorization_code" && $0 != "refresh_token" }
        if !others.isEmpty {
            return ServiceCheck(
                id: "grant_types",
                status: .warn,
                title: Title.grantTypes,
                summary: "Lists \(others.joined(separator: ", ")), which the atproto profile does not use. Only the authorization code grant is supported.",
                detail: [values.joined(separator: ", ")]
            )
        }
        return ServiceCheck(
            id: "grant_types",
            status: .pass,
            title: Title.grantTypes,
            summary: values.contains("refresh_token")
                ? "Includes authorization_code, and refresh_token so sessions can be renewed."
                : "Includes authorization_code. Without refresh_token the client cannot refresh its tokens."
        )
    }

    private static func responseTypesCheck(_ doc: JSONValue) -> ServiceCheck {
        let values = stringArray(doc["response_types"])
        guard let values, values.contains("code") else {
            var detail: [String] = []
            if let values { detail = [values.isEmpty ? "(empty)" : values.joined(separator: ", ")] }
            return ServiceCheck(
                id: "response_types",
                status: .fail,
                title: Title.responseTypes,
                summary: "response_types is required, as an array that includes code.",
                detail: detail,
                fix: ["Add \"response_types\": [\"code\"]."]
            )
        }
        return ServiceCheck(id: "response_types", status: .pass, title: Title.responseTypes, summary: "Includes code.")
    }

    private static func scopeCheck(_ doc: JSONValue) -> ServiceCheck {
        guard let scope = doc["scope"]?.stringValue else {
            return ServiceCheck(
                id: "scope",
                status: .fail,
                title: Title.scope,
                summary: "scope is required, as one space-separated string that includes atproto.",
                fix: ["Add \"scope\": \"atproto\", followed by every other scope the client might ask for."]
            )
        }
        let analysis = OAuthCheckerScopes.analyze(scope)
        let names = analysis.scopes.map(\.raw)
        if !names.contains("atproto") {
            return ServiceCheck(
                id: "scope",
                status: .fail,
                title: Title.scope,
                summary: "scope must include atproto. Without it no server treats this as an atproto client.",
                detail: names.isEmpty ? ["(empty)"] : names
            )
        }
        let invalid = analysis.scopes.filter { $0.status == .invalid }
        let unknown = analysis.scopes.filter { $0.status == .unknown }
        if !invalid.isEmpty || !analysis.problems.isEmpty {
            let summary = invalid.isEmpty
                ? analysis.problems[0]
                : "Includes atproto, but \(invalid.count == 1 ? "one scope is" : "\(invalid.count) scopes are") not valid under the permission spec."
            var detail = invalid.map { "\($0.raw) → \($0.problems.first ?? "")" }
            if !invalid.isEmpty { detail += analysis.problems }
            return ServiceCheck(id: "scope", status: .warn, title: Title.scope, summary: summary, detail: detail)
        }
        let count = names.count == 1 ? "one scope" : "\(names.count) scopes"
        let outside = unknown.count == 1 ? "One is" : "\(unknown.count) are"
        return ServiceCheck(
            id: "scope",
            status: .pass,
            title: Title.scope,
            summary: unknown.isEmpty
                ? "Declares \(count), including atproto. A request can ask for any subset of these."
                : "Declares \(count), including atproto. \(outside) for a resource the permission spec does not define.",
            detail: names
        )
    }

    private static func redirectUrisCheck(_ doc: JSONValue, clientId: String) -> ServiceCheck {
        guard let values = stringArray(doc["redirect_uris"]), !values.isEmpty else {
            return ServiceCheck(
                id: "redirect_uris",
                status: .fail,
                title: Title.redirectUris,
                summary: "redirect_uris is required, as an array with at least one URI."
            )
        }
        let application: Application = doc["application_type"]?.stringValue == "native" ? .native : .web
        let results = values.map { (uri: $0, problem: redirectUriProblem($0, application: application, clientId: clientId)) }
        let bad = results.filter { $0.problem != nil }
        let detail = results.map { result -> String in
            if let problem = result.problem { return "\(result.uri) → \(problem)" }
            return result.uri
        }
        if !bad.isEmpty {
            return ServiceCheck(
                id: "redirect_uris",
                status: .fail,
                title: Title.redirectUris,
                summary: "\(bad.count == 1 ? "One redirect URI does" : "\(bad.count) redirect URIs do") not fit a \(application.rawValue) client.",
                detail: detail,
                fix: [
                    application == .web
                        ? "A web client’s redirect URIs are https URLs. A port is allowed, but not the default one."
                        : "A native client’s redirect URIs use the client_id’s hostname in reverse as the scheme (com.example.app:/callback), or an https URL on the client_id’s own origin.",
                ]
            )
        }
        return ServiceCheck(
            id: "redirect_uris",
            status: .pass,
            title: Title.redirectUris,
            summary: "\(values.count == 1 ? "One redirect URI" : "\(values.count) redirect URIs"), in the form a \(application.rawValue) client uses.",
            detail: detail
        )
    }

    private static func dpopCheck(_ doc: JSONValue) -> ServiceCheck {
        if doc["dpop_bound_access_tokens"]?.boolValue != true {
            return ServiceCheck(
                id: "dpop",
                status: .fail,
                title: Title.dpop,
                summary: "dpop_bound_access_tokens must be present and true. DPoP is mandatory for every atproto client.",
                fix: ["Add \"dpop_bound_access_tokens\": true."]
            )
        }
        return ServiceCheck(id: "dpop", status: .pass, title: Title.dpop, summary: "dpop_bound_access_tokens is true.")
    }

    private static func authCheck(_ doc: JSONValue) -> ServiceCheck {
        let method = doc["token_endpoint_auth_method"]
        let alg = doc["token_endpoint_auth_signing_alg"]
        let jwks = doc["jwks"]
        let jwksUri = doc["jwks_uri"]

        if alg == "none" {
            return ServiceCheck(
                id: "auth",
                status: .fail,
                title: Title.auth,
                summary: "token_endpoint_auth_signing_alg is none, which is never allowed.",
                fix: ["Use ES256, or leave the field out for a public client."]
            )
        }

        if method == nil || method == "none" {
            return ServiceCheck(
                id: "auth",
                status: .pass,
                title: Title.auth,
                summary: "A public client: it does not authenticate with a key. Servers limit sessions for public clients to about two weeks.",
                detail: jwks != nil || jwksUri != nil ? ["Keys are published, but a public client does not use them."] : []
            )
        }

        if method != "private_key_jwt" {
            return ServiceCheck(
                id: "auth",
                status: .fail,
                title: Title.auth,
                summary: "token_endpoint_auth_method is \(method?.compactString() ?? "undefined"). atproto has no client secrets: a confidential client must use private_key_jwt.",
                fix: ["Set it to private_key_jwt and publish a public key, or to none for a public client."]
            )
        }

        // Confidential from here on.
        if jwks != nil && jwksUri != nil {
            return ServiceCheck(
                id: "auth",
                status: .fail,
                title: Title.auth,
                summary: "Both jwks and jwks_uri are set. A confidential client provides one or the other, not both."
            )
        }
        if jwks == nil && jwksUri == nil {
            return ServiceCheck(
                id: "auth",
                status: .fail,
                title: Title.auth,
                summary: "A confidential client must publish at least one public key, in jwks or at a jwks_uri.",
                fix: ["Add \"jwks_uri\" with the https URL of the key set, or inline the keys as \"jwks\": { \"keys\": [...] }."]
            )
        }
        var detail: [String] = []
        if let jwks {
            guard jwks.objectValue != nil, let keys = jwks["keys"]?.arrayValue, !keys.isEmpty else {
                return ServiceCheck(
                    id: "auth",
                    status: .fail,
                    title: Title.auth,
                    summary: "jwks must be an object with a keys array holding at least one public key."
                )
            }
            if keys.contains(where: { $0.objectValue?["d"] != nil }) {
                return ServiceCheck(
                    id: "auth",
                    status: .fail,
                    title: Title.auth,
                    summary: "A key in jwks includes its private part (d). This document is public: publish public keys only.",
                    fix: ["Remove the private key from the document and replace it, since it has been exposed."]
                )
            }
            detail.append("jwks: \(keys.count == 1 ? "one key" : "\(keys.count) keys")")
        } else {
            let url = jwksUri?.stringValue.flatMap(parseURL)
            guard let url, url.scheme?.lowercased() == "https" else {
                return ServiceCheck(
                    id: "auth",
                    status: .fail,
                    title: Title.auth,
                    summary: "jwks_uri must be a fully qualified https URL.",
                    detail: [ServiceFormat.jsString(jwksUri)]
                )
            }
            detail.append("jwks_uri: \(ServiceFormat.jsString(jwksUri)) (not fetched here)")
        }
        guard let alg else {
            return ServiceCheck(
                id: "auth",
                status: .warn,
                title: Title.auth,
                summary: "A confidential client, but token_endpoint_auth_signing_alg is not set. Servers compare it with the algorithms they support.",
                detail: detail,
                fix: ["Add \"token_endpoint_auth_signing_alg\": \"ES256\", the algorithm every server must support."]
            )
        }
        if alg != "ES256" {
            return ServiceCheck(
                id: "auth",
                status: .warn,
                title: Title.auth,
                summary: "A confidential client signing with \(ServiceFormat.jsString(alg)). ES256 is the algorithm every server must support; others may be refused.",
                detail: detail
            )
        }
        return ServiceCheck(
            id: "auth",
            status: .pass,
            title: Title.auth,
            summary: "A confidential client: it signs with a key (private_key_jwt, ES256), so servers may grant it longer sessions.",
            detail: detail
        )
    }

    private static func displayCheck(_ doc: JSONValue, clientId: String) -> ServiceCheck {
        let client = parseURL(clientId)
        var problems: [String] = []
        var detail: [String] = []

        if let name = doc["client_name"]?.stringValue, !name.isEmpty {
            detail.append("client_name: \(name)")
        }
        if let uri = doc["client_uri"] {
            detail.append("client_uri: \(ServiceFormat.jsString(uri))")
            if let url = uri.stringValue.flatMap(parseURL) {
                if let client, hostname(url) != hostname(client) {
                    problems.append("client_uri must have the same hostname as the client_id, \(hostname(client)).")
                }
            } else {
                problems.append("client_uri is not a URL.")
            }
        }
        for field in ["logo_uri", "tos_uri", "policy_uri"] {
            guard let value = doc[field] else { continue }
            detail.append("\(field): \(ServiceFormat.jsString(value))")
            let url = value.stringValue.flatMap(parseURL)
            if url == nil || url?.scheme?.lowercased() != "https" {
                problems.append("\(field) must be an https URL.")
            }
        }

        if !problems.isEmpty {
            return ServiceCheck(id: "display", status: .fail, title: Title.display, summary: problems.joined(separator: " "), detail: detail)
        }
        let missing = ["client_name", "client_uri", "logo_uri", "tos_uri", "policy_uri"].filter { doc[$0] == nil }
        if !missing.isEmpty {
            return ServiceCheck(
                id: "display",
                status: .info,
                title: Title.display,
                summary: "Optional but recommended, and not set: \(missing.joined(separator: ", ")). Servers only show these for clients they trust.",
                detail: detail
            )
        }
        return ServiceCheck(
            id: "display",
            status: .pass,
            title: Title.display,
            summary: "A name, a homepage on the client_id’s host, and https links for the logo, terms and policy.",
            detail: detail
        )
    }

    /// Build the check list for a hosted client. `pending` means the fetch
    /// is still on its way; `failed` means there was no way to make it.
    public static func buildClientChecks(_ probe: ServiceStep<ClientMetadataProbe>, clientId: String) -> [ServiceCheck] {
        switch probe {
        case .pending:
            let rest = documentChecks.map { ServiceCheck(id: $0.0, status: .pending, title: $0.1, summary: "Checking…") }
            return [ServiceCheck(id: "served", status: .pending, title: Title.served, summary: "Checking…")] + rest
        case .failed:
            return [
                ServiceCheck(id: "served", status: .fail, title: Title.served, summary: "The lookup could not be made. Try again in a moment."),
                noDocument,
            ]
        case .done(let probe):
            let served = servedCheck(probe)
            guard let doc = probe.document, doc.objectValue != nil else { return [served, noDocument] }
            return [
                served,
                clientIdCheck(doc, clientId: clientId),
                applicationTypeCheck(doc),
                grantTypesCheck(doc),
                responseTypesCheck(doc),
                scopeCheck(doc),
                redirectUrisCheck(doc, clientId: clientId),
                dpopCheck(doc),
                authCheck(doc),
                displayCheck(doc, clientId: clientId),
            ]
        }
    }

    // MARK: - The localhost development client

    /// The redirect URIs a loopback client gets when it names none.
    public static let loopbackDefaultRedirects = ["http://127.0.0.1/", "http://[::1]/"]

    public struct LoopbackClient: Hashable, Sendable {
        public var checks: [ServiceCheck]
        /// The metadata a server derives from the URL, as the spec lists it.
        public var document: JSONValue
    }

    /// Read a `http://localhost` client_id. There is nothing to fetch: the
    /// spec gives this form a virtual metadata document, with the redirect
    /// URIs and scope taken from the URL's own query string.
    public static func readLoopbackClient(_ clientId: String) -> LoopbackClient {
        let components = URLComponents(string: clientId)
        let query = components?.percentEncodedQuery
        var checks: [ServiceCheck] = []

        var formProblems: [String] = []
        if clientId.range(of: "^http://localhost:[0-9]+", options: [.regularExpression, .caseInsensitive]) != nil || components?.port != nil {
            formProblems.append("The client_id cannot name a port. Ports belong on the redirect_uri, where they are ignored when matching.")
        }
        let path = components?.percentEncodedPath ?? ""
        if path != "/" && path != "" {
            formProblems.append("The path must be empty. Everything else goes in the query string.")
        }
        if formProblems.isEmpty {
            checks.append(ServiceCheck(
                id: "form",
                status: .pass,
                title: "Development client_id",
                summary: "The http://localhost form: plain http, the hostname localhost, no port and no path. There is no document to fetch."
            ))
        } else {
            checks.append(ServiceCheck(
                id: "form",
                status: .fail,
                title: "Development client_id",
                summary: formProblems.joined(separator: " "),
                fix: ["Use http://localhost, then ?redirect_uri=… and &scope=… as needed."]
            ))
        }

        let redirects = ServiceQuery.values("redirect_uri", in: query)
        let redirectProblems = redirects.compactMap { uri -> String? in
            guard let parsed = parseURL(uri) else { return "\(uri) → not a well-formed URL" }
            let host = hostname(parsed)
            if parsed.scheme?.lowercased() != "http" || (host != "127.0.0.1" && host != "[::1]" && host != "::1") {
                return "\(uri) → must be an http URL on 127.0.0.1 or [::1]"
            }
            return nil
        }
        if !redirectProblems.isEmpty {
            checks.append(ServiceCheck(
                id: "redirect_uris",
                status: .fail,
                title: Title.redirectUris,
                summary: "A development client redirects to http://127.0.0.1 or http://[::1]. The path must match; the port is ignored.",
                detail: redirectProblems,
                fix: ["Use the loopback address rather than the name localhost, for example http://127.0.0.1:8080/callback."]
            ))
        } else {
            checks.append(ServiceCheck(
                id: "redirect_uris",
                status: .pass,
                title: Title.redirectUris,
                summary: redirects.isEmpty
                    ? "None given, so the defaults apply."
                    : "Loopback redirect URIs. The path must match on the way back; the port is ignored.",
                detail: redirects.isEmpty ? loopbackDefaultRedirects : redirects
            ))
        }

        let scopes = ServiceQuery.values("scope", in: query)
        let scope = scopes.first ?? "atproto"
        let scopeItems = scope.split(whereSeparator: { $0.isWhitespace }).map(String.init)
        if scopes.count > 1 {
            checks.append(ServiceCheck(
                id: "scope",
                status: .fail,
                title: Title.scope,
                summary: "scope can be given once, as a single space-separated value."
            ))
        } else if !scopeItems.contains("atproto") {
            checks.append(ServiceCheck(id: "scope", status: .fail, title: Title.scope, summary: "scope must include atproto.", detail: [scope]))
        } else {
            checks.append(ServiceCheck(
                id: "scope",
                status: .pass,
                title: Title.scope,
                summary: scopes.isEmpty ? "Not given, so it defaults to atproto." : "Includes atproto.",
                detail: scopeItems
            ))
        }

        var extra: [String] = []
        for (key, _) in ServiceQuery.pairs(query) where key != "redirect_uri" && key != "scope" && !extra.contains(key) {
            extra.append(key)
        }
        if !extra.isEmpty {
            checks.append(ServiceCheck(
                id: "params",
                status: .warn,
                title: "Other parameters",
                summary: "Only redirect_uri and scope are read from the URL. Not used: \(extra.joined(separator: ", "))."
            ))
        }

        checks.append(ServiceCheck(
            id: "support",
            status: .info,
            title: "Server support",
            summary: "Authorization servers are encouraged to accept this form, but it is optional. It always works as a public, native client."
        ))

        let document: JSONValue = .object([
            "client_id": .string(clientId),
            "application_type": "native",
            "grant_types": ["authorization_code", "refresh_token"],
            "response_types": ["code"],
            "redirect_uris": .array((redirects.isEmpty ? loopbackDefaultRedirects : redirects).map(JSONValue.string)),
            "scope": .string(scope),
            "token_endpoint_auth_method": "none",
            "dpop_bound_access_tokens": true,
        ])
        return LoopbackClient(checks: checks, document: document)
    }

    // MARK: - Verdict

    public static func clientVerdict(_ checks: [ServiceCheck], kind: ClientIdKind) -> ServiceVerdict {
        if checks.contains(where: { $0.status == .pending }) {
            return ServiceVerdict(tone: .pending, title: "Fetching the client metadata", text: "Reading the document at the client_id.")
        }
        let failures = checks.filter { $0.status == .fail }
        let warnings = checks.filter { $0.status == .warn }
        if let first = failures.first {
            return ServiceVerdict(
                tone: .fail,
                title: failures.count == 1
                    ? "One rule of the atproto profile is not met"
                    : "\(failures.count) rules of the atproto profile are not met",
                text: first.summary
            )
        }
        if let first = warnings.first {
            let things = warnings.count == 1 ? "one thing" : "\(warnings.count) things"
            return ServiceVerdict(tone: .warn, title: "Valid, with \(things) to look at", text: first.summary)
        }
        return ServiceVerdict(
            tone: .pass,
            title: kind == .loopback ? "A valid development client_id" : "This client metadata meets the atproto profile",
            text: kind == .loopback
                ? "Servers that support the localhost exception derive the metadata below from the URL."
                : "Every required field is present and in the form authorization servers enforce."
        )
    }
}
