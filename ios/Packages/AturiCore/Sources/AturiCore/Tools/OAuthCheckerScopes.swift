import Foundation

/// Reading and writing atproto OAuth scope strings, port of
/// `src/lib/tools/oauthScopes.ts` for the OAuth client checker's scope view.
///
/// A scope string is a space-separated list. Three kinds of item can appear:
///
///     atproto                 required by every atproto session (specs/oauth)
///     transition:generic      the three "transitional" scopes that stand in for
///     transition:chat.bsky    app-password access (specs/oauth)
///     transition:email
///     resource:positional?name=value&name=value
///                             a granular permission (specs/permission)
///
/// The permission spec defines five resources (`repo`, `rpc`, `blob`,
/// `account`, `identity`) and one meta resource (`include`, a permission set
/// by NSID). Each has one parameter that may be written after the colon
/// instead of by name: `repo:app.example.post` and
/// `repo?collection=app.example.post` are the same permission. Everything
/// here follows https://atproto.com/specs/permission; a resource it does not
/// list is reported as unknown rather than guessed at.
///
/// The app's own sign-in scopes (`Scopes` in OAuth/Scopes.swift) are a fixed
/// list this reads like any other; nothing here changes them.
public enum OAuthCheckerScopes {
    public enum RepoAction: String, Hashable, Sendable, CaseIterable {
        case create
        case update
        case delete
    }

    public static let repoActions: [RepoAction] = [.create, .update, .delete]

    public enum AccountAttr: String, Hashable, Sendable {
        case email
        case repo
    }

    public enum AccountAction: String, Hashable, Sendable {
        case read
        case manage
    }

    public enum IdentityAttr: String, Hashable, Sendable {
        case handle
        case all = "*"
    }

    /// A permission in parts, as the builder holds it before it becomes a string.
    public enum Draft: Hashable, Sendable {
        case repo(collection: [String], action: [RepoAction])
        case rpc(lxm: [String], aud: String)
        case blob(accept: [String])
        case account(attr: AccountAttr, action: AccountAction)
        case identity(attr: IdentityAttr)
        case include(nsid: String, aud: String?)
    }

    public enum Resource: String, Hashable, Sendable {
        case repo
        case rpc
        case blob
        case account
        case identity
        case include
    }

    public enum Kind: String, Hashable, Sendable {
        case atproto
        case transition
        case repo
        case rpc
        case blob
        case account
        case identity
        case include
        case unknown
    }

    public enum Validity: String, Hashable, Sendable {
        /// A scope the specs define, well formed.
        case valid
        /// Well formed, but a resource the permission spec does not list.
        case unknown
        /// Breaks the syntax or the rules of its resource.
        case invalid
    }

    public struct Parsed: Hashable, Sendable {
        /// The item exactly as written.
        public var raw: String
        public var kind: Kind
        public var status: Validity
        /// What it grants, in a sentence.
        public var meaning: String
        /// Why it is invalid. Empty otherwise.
        public var problems: [String]
        /// Worth knowing, but not wrong.
        public var notes: [String]
        /// The permission in parts, for a valid granular scope.
        public var draft: Draft?
    }

    public struct Analysis: Hashable, Sendable {
        public var scopes: [Parsed]
        /// What is wrong with the string as a whole.
        public var problems: [String]
        public var notes: [String]
    }

    public static let transitionScopes: [String: String] = [
        "transition:generic":
            "Broad access, equal to an app password: write any record, upload blobs, read and write preferences, and call most APIs. No account management and no DMs.",
        "transition:chat.bsky":
            "Direct messages: the chat.bsky APIs, as the “DM access” toggle on an app password allows.",
        "transition:email": "Read the account’s email address and whether it is confirmed.",
    ]

    // MARK: - Syntax

    struct Syntax {
        var resource: String
        /// The part after the colon, decoded. Nil when there is no colon.
        var positional: String?
        var params: [(String, String)]
        /// Parameters that are not `name=value`.
        var malformed: [String]
    }

    /// `decodeURIComponent`, nil where it would throw.
    private static func decode(_ value: String) -> String? {
        value.removingPercentEncoding
    }

    /// Split one scope into its parts. Nil when it falls outside the general
    /// syntax altogether: the spec allows only printable, non-whitespace ASCII.
    static func parseSyntax(_ raw: String) -> Syntax? {
        guard !raw.isEmpty, raw.unicodeScalars.allSatisfy({ $0.value >= 0x21 && $0.value <= 0x7e }) else { return nil }
        let head: String
        let query: String
        if let question = raw.firstIndex(of: "?") {
            head = String(raw[raw.startIndex..<question])
            query = String(raw[raw.index(after: question)...])
        } else {
            head = raw
            query = ""
        }
        let colon = head.firstIndex(of: ":")
        let resource = colon.map { String(head[head.startIndex..<$0]) } ?? head
        if resource.isEmpty { return nil }

        var positional: String?
        if let colon {
            guard let decoded = decode(String(head[head.index(after: colon)...])) else { return nil }
            positional = decoded
        }

        var params: [(String, String)] = []
        var malformed: [String] = []
        if !query.isEmpty {
            for piece in query.split(separator: "&", omittingEmptySubsequences: false) {
                let pair = String(piece)
                guard let equals = pair.firstIndex(of: "=") else {
                    malformed.append(pair)
                    continue
                }
                let name = decode(String(pair[pair.startIndex..<equals]))
                let value = decode(String(pair[pair.index(after: equals)...]))
                if let name, !name.isEmpty, let value, !value.isEmpty {
                    params.append((name, value))
                } else {
                    malformed.append(pair)
                }
            }
        }
        return Syntax(resource: resource, positional: positional, params: params, malformed: malformed)
    }

    /// Percent-encode a value for a scope string. The spec's own examples
    /// leave `:`, `/` and `*` bare and encode `#`
    /// (`aud=did:web:api.example.com%23svc`), which is `encodeURIComponent`
    /// with two characters put back.
    static func encode(_ value: String) -> String {
        URIEncoding.encodeComponent(value)
            .replacingOccurrences(of: "%3A", with: ":")
            .replacingOccurrences(of: "%2F", with: "/")
    }

    // MARK: - Semantics, one resource at a time

    private enum ParamShape {
        case one
        case many
    }

    /// Each resource's parameters, and which one may be written after the colon.
    private static func spec(_ resource: Resource) -> (positional: String, params: [(String, ParamShape)]) {
        switch resource {
        case .repo: return ("collection", [("collection", .many), ("action", .many)])
        case .rpc: return ("lxm", [("lxm", .many), ("aud", .one)])
        case .blob: return ("accept", [("accept", .many)])
        case .account: return ("attr", [("attr", .one), ("action", .one)])
        case .identity: return ("attr", [("attr", .one)])
        // The spec only ever writes the set's NSID after the colon and never
        // names the parameter, so the by-name form is not accepted here.
        case .include: return ("", [("aud", .one)])
        }
    }

    private static func list(_ values: [String], all: String) -> String {
        if values.contains("*") { return all }
        if values.isEmpty { return "nothing" }
        if values.count == 1 { return values[0] }
        return "\(values.dropLast().joined(separator: ", ")) and \(values[values.count - 1])"
    }

    private struct Reading {
        var meaning: String
        var problems: [String]
        var notes: [String]
        var draft: Draft?
    }

    /// Collect a resource's parameters by name, reporting what the syntax got wrong.
    private static func gather(_ syntax: Syntax, _ resource: Resource, _ problems: inout [String]) -> [String: [String]] {
        let shape = spec(resource)
        var values: [String: [String]] = [:]
        if let positional = syntax.positional, !shape.positional.isEmpty {
            if positional.isEmpty {
                problems.append("Nothing follows the colon. Write \(resource.rawValue):<\(shape.positional)>.")
            } else {
                values[shape.positional] = [positional]
            }
        }
        for pair in syntax.malformed {
            problems.append("“\(pair)” is not a name=value parameter.")
        }
        for (name, value) in syntax.params {
            guard shape.params.contains(where: { $0.0 == name }) else {
                problems.append("\(name) is not a parameter of \(resource.rawValue) permissions.")
                continue
            }
            if name == shape.positional && syntax.positional != nil {
                problems.append("\(name) is given after the colon and again as a parameter. Use one form.")
                continue
            }
            values[name, default: []].append(value)
        }
        for (name, kind) in shape.params where kind == .one && (values[name]?.count ?? 0) > 1 {
            problems.append("\(name) takes a single value.")
        }
        return values
    }

    private static func checkNsids(_ values: [String], what: String, _ problems: inout [String]) {
        for value in values where value != "*" {
            if value.contains("*") {
                problems.append("\(value) is a partial wildcard, which is not supported. Use * or a full NSID.")
            } else if !isValidNsid(value) {
                problems.append("\(value) is not a valid NSID for \(what).")
            }
        }
    }

    private static func readRepo(_ syntax: Syntax) -> Reading {
        var problems: [String] = []
        var notes: [String] = []
        let values = gather(syntax, .repo, &problems)
        let collection = values["collection"] ?? []
        let action = values["action"] ?? []
        if collection.isEmpty && syntax.positional != "" {
            problems.append("A repo permission needs a collection: an NSID, or * for every collection.")
        }
        checkNsids(collection, what: "a record type", &problems)
        for value in action where RepoAction(rawValue: value) == nil {
            problems.append("\(value) is not an action. The actions are create, update and delete.")
        }
        if Set(action).count != action.count { problems.append("Each action can be listed once.") }
        if collection.contains("*") {
            notes.append("A wildcard collection cannot be used inside a permission set, only in a scope string.")
        }

        let actions = repoActions.filter { action.isEmpty || action.contains($0.rawValue) }
        let verbs = actions.count == 3 ? "create, update and delete" : actions.map(\.rawValue).joined(separator: " and ")
        return Reading(
            meaning: ServiceFormat.sentence("\(verbs) records in \(list(collection, all: "every collection"))."),
            problems: problems,
            notes: notes,
            draft: problems.isEmpty ? .repo(collection: collection, action: actions) : nil
        )
    }

    private static func readRpc(_ syntax: Syntax) -> Reading {
        var problems: [String] = []
        let values = gather(syntax, .rpc, &problems)
        let lxm = values["lxm"] ?? []
        let aud = values["aud"]?.first
        if lxm.isEmpty && syntax.positional != "" {
            problems.append("An rpc permission needs a method: an NSID, or * for every method.")
        }
        checkNsids(lxm, what: "an API method", &problems)
        if let aud {
            if aud != "*" && !OAuthScopeShapes.isServiceReference(aud) {
                problems.append("\(aud) is not a service reference. Write a DID followed by its service fragment, such as did:web:api.example.com#svc_appview.")
            }
        } else {
            problems.append("An rpc scope always needs aud: the service it may call, as a DID and service fragment, or *.")
        }
        if aud == "*" && lxm.contains("*") {
            problems.append("The method and the audience cannot both be *. Any method on any service is not a permission that can be granted.")
        }
        let target: String
        if let aud {
            target = aud == "*" ? "any service" : aud
        } else {
            target = "a service"
        }
        var draft: Draft?
        if problems.isEmpty, let aud {
            draft = .rpc(lxm: lxm, aud: aud)
        }
        return Reading(meaning: "Call \(list(lxm, all: "any API method")) on \(target).", problems: problems, notes: [], draft: draft)
    }

    private static func readBlob(_ syntax: Syntax) -> Reading {
        var problems: [String] = []
        let values = gather(syntax, .blob, &problems)
        let accept = values["accept"] ?? []
        if accept.isEmpty && syntax.positional != "" {
            problems.append("A blob permission needs the MIME types it accepts, such as */* or image/*.")
        }
        for value in accept where !OAuthScopeShapes.isMime(value) {
            problems.append("\(value) is not a MIME type or pattern such as image/* or */*.")
        }
        return Reading(
            meaning: accept.contains("*/*") ? "Upload files of any type." : "Upload \(list(accept, all: "any")) files.",
            problems: problems,
            notes: ["Blob permissions cannot be part of a permission set. They are always requested directly."],
            draft: problems.isEmpty ? .blob(accept: accept) : nil
        )
    }

    private static func readAccount(_ syntax: Syntax) -> Reading {
        var problems: [String] = []
        var notes: [String] = []
        let values = gather(syntax, .account, &problems)
        let attr = values["attr"]?.first
        let action = values["action"]?.first ?? "read"
        if let attr {
            if attr != "email" && attr != "repo" {
                problems.append("\(attr) is not an account attribute. The attributes are email and repo, and a wildcard is not supported.")
            }
        } else if syntax.positional != "" {
            problems.append("An account permission needs an attribute: email or repo.")
        }
        if action != "read" && action != "manage" {
            problems.append("\(action) is not an action. An account permission takes read or manage.")
        }
        var meaning = "Control part of the account’s hosting details."
        if attr == "email" {
            meaning = action == "manage"
                ? "Read and change the account’s email address."
                : "Read the account’s email address and whether it is confirmed."
        } else if attr == "repo" {
            meaning = action == "manage"
                ? "Replace the whole repository from a CAR file, as an account migration does."
                : "Nothing: reading the repository needs no permission."
            if action != "manage" { notes.append("account:repo only does something with action=manage.") }
        }
        var draft: Draft?
        if problems.isEmpty, let attr, let parsedAttr = AccountAttr(rawValue: attr), let parsedAction = AccountAction(rawValue: action) {
            draft = .account(attr: parsedAttr, action: parsedAction)
        }
        return Reading(meaning: meaning, problems: problems, notes: notes, draft: draft)
    }

    private static func readIdentity(_ syntax: Syntax) -> Reading {
        var problems: [String] = []
        let values = gather(syntax, .identity, &problems)
        let attr = values["attr"]?.first
        if let attr {
            if attr != "handle" && attr != "*" {
                problems.append("\(attr) is not an identity attribute. The attributes are handle and *.")
            }
        } else if syntax.positional != "" {
            problems.append("An identity permission needs an attribute: handle, or * for full control.")
        }
        var draft: Draft?
        if problems.isEmpty, let attr, let parsed = IdentityAttr(rawValue: attr) {
            draft = .identity(attr: parsed)
        }
        return Reading(
            meaning: attr == "*" ? "Full control of the account’s DID document and handle." : "Change the account’s handle.",
            problems: problems,
            notes: attr == "*" || attr == "handle"
                ? ["A PDS can only act on this when it controls the DID document, which it does not for a did:web account."]
                : [],
            draft: draft
        )
    }

    private static func readInclude(_ syntax: Syntax) -> Reading {
        var problems: [String] = []
        var notes: [String] = []
        let values = gather(syntax, .include, &problems)
        let nsid = syntax.positional ?? ""
        let aud = values["aud"]?.first
        if nsid.isEmpty {
            problems.append("Name the permission set after the colon: include:<NSID>.")
        } else if !isValidNsid(nsid) {
            problems.append("\(nsid) is not a valid NSID for a permission set.")
        }
        if let aud, aud != "*", !OAuthScopeShapes.isServiceReference(aud) {
            problems.append("\(aud) is not a service reference. Write a DID followed by its service fragment.")
        }
        if aud == nil {
            notes.append("No aud is given, so any API calls in the set that inherit their audience are dropped.")
        }
        var inherited = ""
        if let aud {
            inherited = ", with its inherited API calls sent to \(aud == "*" ? "any service" : aud)"
        }
        return Reading(
            meaning: "Everything in the permission set \(nsid.isEmpty ? "(unnamed)" : nsid)\(inherited).",
            problems: problems,
            notes: notes,
            draft: problems.isEmpty && !nsid.isEmpty ? .include(nsid: nsid, aud: aud) : nil
        )
    }

    private static func read(_ resource: Resource, _ syntax: Syntax) -> Reading {
        switch resource {
        case .repo: return readRepo(syntax)
        case .rpc: return readRpc(syntax)
        case .blob: return readBlob(syntax)
        case .account: return readAccount(syntax)
        case .identity: return readIdentity(syntax)
        case .include: return readInclude(syntax)
        }
    }

    private static func kind(_ resource: Resource) -> Kind {
        switch resource {
        case .repo: return .repo
        case .rpc: return .rpc
        case .blob: return .blob
        case .account: return .account
        case .identity: return .identity
        case .include: return .include
        }
    }

    /// Read one item of a scope string.
    public static func parseScope(_ raw: String) -> Parsed {
        if raw == "atproto" {
            return Parsed(
                raw: raw,
                kind: .atproto,
                status: .valid,
                meaning: "Required. Says the client follows the atproto OAuth profile. On its own it only identifies the account.",
                problems: [],
                notes: []
            )
        }

        guard let syntax = parseSyntax(raw) else {
            return Parsed(
                raw: raw,
                kind: .unknown,
                status: .invalid,
                meaning: "Not a scope.",
                problems: ["A scope can only use printable ASCII characters, with anything else percent-encoded."],
                notes: []
            )
        }

        if syntax.resource == "atproto" {
            return Parsed(
                raw: raw,
                kind: .atproto,
                status: .invalid,
                meaning: "The atproto scope, with something added to it.",
                problems: ["atproto takes no parameters. Write it on its own."],
                notes: []
            )
        }

        if syntax.resource == "transition" {
            if let meaning = transitionScopes[raw] {
                return Parsed(
                    raw: raw,
                    kind: .transition,
                    status: .valid,
                    meaning: meaning,
                    problems: [],
                    notes: ["A transitional scope. The intent is to retire these in favour of granular permissions."]
                )
            }
            return Parsed(
                raw: raw,
                kind: .transition,
                status: .invalid,
                meaning: "Not one of the transitional scopes.",
                problems: ["The transitional scopes are transition:generic, transition:chat.bsky and transition:email."],
                notes: []
            )
        }

        if let resource = Resource(rawValue: syntax.resource) {
            let reading = read(resource, syntax)
            var notes = reading.problems.isEmpty ? reading.notes : []
            // Both forms parse, but every example in the spec encodes it, and
            // so do the servers' own scope formatters.
            if reading.problems.isEmpty && raw.contains("#") {
                notes.append("Write the # in a service reference as %23, as the spec’s examples do.")
            }
            return Parsed(
                raw: raw,
                kind: kind(resource),
                status: reading.problems.isEmpty ? .valid : .invalid,
                meaning: reading.meaning,
                problems: reading.problems,
                notes: notes,
                draft: reading.draft
            )
        }

        return Parsed(
            raw: raw,
            kind: .unknown,
            status: .unknown,
            meaning: "A “\(syntax.resource)” permission, which the permission spec does not define.",
            problems: [],
            notes: ["The spec defines repo, rpc, blob, account, identity and include. A server that does not know this resource will not grant it."]
        )
    }

    /// Split a scope string into its items, on any run of whitespace.
    public static func split(_ input: String) -> [String] {
        input.split(whereSeparator: { $0.isWhitespace }).map(String.init)
    }

    /// Read a whole scope string: every item, and what is wrong with the set.
    public static func analyze(_ input: String) -> Analysis {
        let items = split(input)
        let scopes = items.map(parseScope)
        var problems: [String] = []
        var notes: [String] = []

        if !items.isEmpty && !items.contains("atproto") {
            problems.append("The atproto scope is missing. Every atproto session has to ask for it.")
        }
        if items.contains("transition:chat.bsky") && !items.contains("transition:generic") {
            problems.append("transition:chat.bsky does nothing without transition:generic.")
        }
        var seen = Set<String>()
        var repeated: [String] = []
        for item in items {
            if seen.contains(item), !repeated.contains(item) { repeated.append(item) }
            seen.insert(item)
        }
        if !repeated.isEmpty {
            notes.append("Listed more than once: \(repeated.joined(separator: ", ")).")
        }
        return Analysis(scopes: scopes, problems: problems, notes: notes)
    }

    // MARK: - Writing

    private static func withPositional(_ resource: String, _ name: String, _ values: [String], _ rest: [String]) -> String {
        // One value goes after the colon; several can only be written by name.
        if values.count == 1 {
            let tail = rest.isEmpty ? "" : "?" + rest.joined(separator: "&")
            return "\(resource):\(encode(values[0]))\(tail)"
        }
        let params = values.map { "\(name)=\(encode($0))" } + rest
        return "\(resource)?\(params.joined(separator: "&"))"
    }

    /// Write a permission as a scope. Defaults are left out, as the spec's
    /// examples do: all three repo actions is the same as none listed, and an
    /// account permission reads unless it says otherwise.
    public static func format(_ draft: Draft) -> String {
        switch draft {
        case .repo(let collection, let action):
            let actions = repoActions.filter { action.contains($0) }
            let rest = actions.isEmpty || actions.count == 3 ? [] : actions.map { "action=\($0.rawValue)" }
            return withPositional("repo", "collection", collection, rest)
        case .rpc(let lxm, let aud):
            return withPositional("rpc", "lxm", lxm, ["aud=\(encode(aud))"])
        case .blob(let accept):
            return withPositional("blob", "accept", accept, [])
        case .account(let attr, let action):
            return "account:\(attr.rawValue)\(action == .manage ? "?action=manage" : "")"
        case .identity(let attr):
            return "identity:\(attr.rawValue)"
        case .include(let nsid, let aud):
            let audience = aud.map { "?aud=\(encode($0))" } ?? ""
            return "include:\(encode(nsid))\(audience)"
        }
    }

    /// Add an item to a scope string, keeping `atproto` first and skipping a repeat.
    public static func add(_ input: String, _ scope: String) -> String {
        var items = split(input)
        if !items.contains("atproto") { items.insert("atproto", at: 0) }
        if !scope.isEmpty && !items.contains(scope) { items.append(scope) }
        return items.joined(separator: " ")
    }

    /// Remove the item at `index` from a scope string.
    public static func remove(_ input: String, at index: Int) -> String {
        split(input).enumerated().filter { $0.offset != index }.map(\.element).joined(separator: " ")
    }

    /// The scope string with its items separated by single spaces.
    public static func normalized(_ input: String) -> String {
        split(input).joined(separator: " ")
    }

    // MARK: - The builder

    /// The kinds of permission the builder adds, in the order it offers them.
    public enum BuilderKind: String, Hashable, Sendable, CaseIterable, Identifiable {
        case repo
        case rpc
        case blob
        case account
        case identity
        case include
        case transition

        public var id: String { rawValue }

        public var label: String {
            switch self {
            case .repo: return "Records"
            case .rpc: return "API calls"
            case .blob: return "Uploads"
            case .account: return "Account"
            case .identity: return "Identity"
            case .include: return "Permission set"
            case .transition: return "Transitional"
            }
        }

        public var hint: String {
            switch self {
            case .repo: return "Write records of a type to the account’s repository."
            case .rpc: return "Call a service on the account’s behalf, through its PDS."
            case .blob: return "Upload images, video and other files."
            case .account: return "The account’s email address, or importing a whole repository."
            case .identity: return "The account’s handle and DID document."
            case .include: return "A bundle of permissions a lexicon’s author published, by NSID."
            case .transition: return "The broad scopes that stand in for an app password."
            }
        }
    }

    /// The fields of the form that adds one permission. It holds the parts,
    /// writes them with `format`, and reads that back with `parseScope`, so
    /// what it offers to add is checked by the same rules the list applies.
    public struct BuilderForm: Hashable, Sendable {
        public var kind: BuilderKind = .repo
        public var collection = ""
        public var actions: [RepoAction] = OAuthCheckerScopes.repoActions
        public var lxm = ""
        public var aud = ""
        public var accept = "*/*"
        public var accountAttr: AccountAttr = .email
        public var accountAction: AccountAction = .read
        public var identityAttr: IdentityAttr = .handle
        public var nsid = ""
        public var includeAud = ""
        /// `generic`, `chat.bsky` or `email`.
        public var transition = "generic"

        public init() {}

        /// Several values in one field, separated by spaces or commas.
        static func values(_ text: String) -> [String] {
            text.split(whereSeparator: { $0.isWhitespace || $0 == "," }).map(String.init)
        }

        /// Turn an action on or off, keeping the actions in their usual order.
        public mutating func toggle(_ action: RepoAction) {
            if actions.contains(action) {
                actions.removeAll { $0 == action }
            } else {
                actions = OAuthCheckerScopes.repoActions.filter { $0 == action || actions.contains($0) }
            }
        }

        /// The scope the fields spell, or nil until they spell one.
        public var candidate: String? {
            let trimmedAud = aud.trimmingCharacters(in: .whitespacesAndNewlines)
            let trimmedNsid = nsid.trimmingCharacters(in: .whitespacesAndNewlines)
            let trimmedIncludeAud = includeAud.trimmingCharacters(in: .whitespacesAndNewlines)
            switch kind {
            case .repo:
                let collections = Self.values(collection)
                guard !collections.isEmpty, !actions.isEmpty else { return nil }
                return OAuthCheckerScopes.format(.repo(collection: collections, action: actions))
            case .rpc:
                let methods = Self.values(lxm)
                guard !methods.isEmpty, !trimmedAud.isEmpty else { return nil }
                return OAuthCheckerScopes.format(.rpc(lxm: methods, aud: trimmedAud))
            case .blob:
                let types = Self.values(accept)
                guard !types.isEmpty else { return nil }
                return OAuthCheckerScopes.format(.blob(accept: types))
            case .account:
                return OAuthCheckerScopes.format(.account(attr: accountAttr, action: accountAction))
            case .identity:
                return OAuthCheckerScopes.format(.identity(attr: identityAttr))
            case .include:
                guard !trimmedNsid.isEmpty else { return nil }
                return OAuthCheckerScopes.format(.include(nsid: trimmedNsid, aud: trimmedIncludeAud.isEmpty ? nil : trimmedIncludeAud))
            case .transition:
                return "transition:\(transition)"
            }
        }

        /// The candidate, read back.
        public var parsed: Parsed? {
            candidate.map(OAuthCheckerScopes.parseScope)
        }
    }

    // MARK: - The verdict over a string

    /// The heading above the scope list, as `OAuthCheckerScopes.tsx` words it.
    public static func verdict(_ analysis: Analysis) -> ServiceVerdict? {
        let scopes = analysis.scopes
        guard !scopes.isEmpty else { return nil }
        let invalid = scopes.filter { $0.status == .invalid }.count
        let unknown = scopes.filter { $0.status == .unknown }.count
        let count = scopes.count == 1 ? "one scope" : "\(scopes.count) scopes"
        let tone: ServiceVerdict.Tone = invalid > 0 || !analysis.problems.isEmpty ? .fail : unknown > 0 ? .warn : .pass
        let title: String
        if invalid > 0 {
            title = scopes.count == 1
                ? "This scope is not valid"
                : "\(invalid) of \(scopes.count) scopes \(invalid == 1 ? "is" : "are") not valid"
        } else if !analysis.problems.isEmpty {
            title = "This string would be refused"
        } else if unknown > 0 {
            title = "\(ServiceFormat.sentence(count)), \(unknown == 1 ? "one" : String(unknown)) outside the permission spec"
        } else {
            title = "\(ServiceFormat.sentence(count)), all valid"
        }
        let text: String
        if let problem = analysis.problems.first {
            text = problem
        } else if invalid > 0 {
            text = "An authorization server drops or rejects a scope it cannot read."
        } else if unknown > 0 {
            text = "A server that does not know a resource will not grant it."
        } else {
            text = "Each one is read below, in the words a consent screen would need."
        }
        return ServiceVerdict(tone: tone, title: title, text: text)
    }
}

/// The MIME pattern and the service reference are checked by hand rather than
/// with a regex: both are one fixed shape over a small alphabet.
enum OAuthScopeShapes {
    private static let mimeCharacters = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!#$&^_.+-")
    private static let didCharacters = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:%-")
    private static let fragmentCharacters = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._~-")
    private static let methodCharacters = Set("abcdefghijklmnopqrstuvwxyz")

    /// `^(\*\/\*|[A-Za-z0-9!#$&^_.+-]+\/(\*|[A-Za-z0-9!#$&^_.+-]+))$`.
    static func isMime(_ value: String) -> Bool {
        if value == "*/*" { return true }
        let parts = value.split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count == 2, !parts[0].isEmpty, !parts[1].isEmpty else { return false }
        guard parts[0].allSatisfy({ mimeCharacters.contains($0) }) else { return false }
        return parts[1] == "*" || parts[1].allSatisfy({ mimeCharacters.contains($0) })
    }

    /// A DID followed by the required service fragment, e.g.
    /// `did:web:api.example.com#svc`:
    /// `^did:[a-z]+:[A-Za-z0-9._:%-]+#[A-Za-z0-9._~-]+$`.
    static func isServiceReference(_ value: String) -> Bool {
        guard value.hasPrefix("did:"), let hash = value.firstIndex(of: "#") else { return false }
        let did = value[value.index(value.startIndex, offsetBy: 4)..<hash]
        let fragment = value[value.index(after: hash)...]
        guard !fragment.isEmpty, fragment.allSatisfy({ fragmentCharacters.contains($0) }) else { return false }
        guard let colon = did.firstIndex(of: ":") else { return false }
        let method = did[did.startIndex..<colon]
        let rest = did[did.index(after: colon)...]
        guard !method.isEmpty, method.allSatisfy({ methodCharacters.contains($0) }) else { return false }
        return !rest.isEmpty && rest.allSatisfy({ didCharacters.contains($0) })
    }
}
