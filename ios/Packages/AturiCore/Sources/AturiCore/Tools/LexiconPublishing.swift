import Foundation

// Port of src/lib/tools/lexicon.ts: the lexicon publishing checker's logic,
// the chain an NSID has to complete to be published, and how to read the
// evidence for each link.
//
// A lexicon is published in two halves (the Lexicon spec, "Lexicon
// Publication and Resolution"):
//
//   NSID -> DID      Drop the NSID's last part (its name) and reverse the
//                    rest to get the authority domain. A TXT record at
//                    `_lexicon.<authority>` holds `did=<did>`.
//   DID -> schema    That DID's repository holds a record in the collection
//                    `com.atproto.lexicon.schema`, keyed by the full NSID.
//
// The first half is not hierarchical. `app.bsky.feed.post` is looked up at
// `_lexicon.feed.bsky.app` and nowhere else: a record at `_lexicon.bsky.app`
// does not cover it. That is the mistake this tool most often has to
// explain, so it looks one level up for a record and says so when it finds
// one.
//
// Everything in `LexiconPublishing` is pure: it takes what was observed and
// says what it means. `LexiconPublishingClient` does the observing (the TXT
// lookup over DNS-over-HTTPS, the DID document, the record straight from
// the authority's PDS) and `LexiconCheckerModel` walks the chain with it.

public enum LexiconPublishing {
    public static let collection = LexiconSchemaLookup.collection

    // MARK: - Input

    /// A bare NSID, or why what was typed is not one.
    public enum NsidInput: Hashable, Sendable {
        case nsid(String)
        case problem(String)

        public var nsid: String? {
            if case .nsid(let nsid) = self { return nsid }
            return nil
        }

        public var reason: String? {
            if case .problem(let reason) = self { return reason }
            return nil
        }
    }

    /// Why `value` is not a valid NSID, or nil when it is.
    public static func nsidProblem(_ value: String) -> String? {
        if isValidNsid(value) { return nil }
        if value.utf16.count > 317 { return "An NSID can be at most 317 characters." }
        if value.isEmpty || !value.unicodeScalars.allSatisfy(isNsidScalar) {
            return "An NSID uses only letters, digits, hyphens and dots."
        }
        let segments = value.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        if segments.count < 3 {
            return "An NSID has at least three parts: a reversed domain, then a name, such as com.example.thing."
        }
        if segments.contains(where: { $0.isEmpty }) { return "An NSID cannot have an empty part between dots." }
        if segments[segments.count - 1].wholeMatch(of: nsidNameSegmentPattern) == nil {
            return "The last part of an NSID is its name: letters and digits only, starting with a letter."
        }
        return "That is not a valid NSID."
    }

    private static func isNsidScalar(_ scalar: Unicode.Scalar) -> Bool {
        let upper: ClosedRange<Unicode.Scalar> = "A"..."Z"
        let lower: ClosedRange<Unicode.Scalar> = "a"..."z"
        let digits: ClosedRange<Unicode.Scalar> = "0"..."9"
        return upper.contains(scalar) || lower.contains(scalar) || digits.contains(scalar) || scalar == "." || scalar == "-"
    }

    /// Tidy what was pasted into a bare NSID: a `lex:` prefix, a
    /// `#fragment`, an at:// URI of a schema record, or a link to a lexicon
    /// page on aturi.to.
    public static func normalizeNsidInput(_ raw: String) -> NsidInput {
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { return .problem("Enter an NSID.") }

        if let key = schemaRecordKey(value) {
            value = key
        } else if let page = lexiconPageSegment(value) {
            value = page
        }
        // Not percent-encoded after all: keep it as typed.
        value = value.removingPercentEncoding ?? value
        if value.lowercased().hasPrefix("lex:") {
            value = String(value.dropFirst("lex:".count))
        }
        if let hash = value.firstIndex(of: "#") {
            value = String(value[..<hash])
        }

        if value.hasSuffix(".*") {
            return .problem("That is a whole namespace. Enter one full NSID from it, such as app.bsky.feed.post.")
        }
        if let problem = nsidProblem(value) { return .problem(problem) }
        return .nsid(value)
    }

    /// `^at://[^/]+/com.atproto.lexicon.schema/([^/?#]+)`, any case: the
    /// key of a schema record's URI.
    static func schemaRecordKey(_ value: String) -> String? {
        guard value.lowercased().hasPrefix("at://") else { return nil }
        let parts = value.dropFirst("at://".count).split(separator: "/", omittingEmptySubsequences: false)
        guard parts.count >= 3, !parts[0].isEmpty, parts[1].lowercased() == collection else { return nil }
        let key = parts[2].prefix { $0 != "?" && $0 != "#" }
        return key.isEmpty ? nil : String(key)
    }

    /// `/lexicons/([^/?#]+)` anywhere in the text: an explorer link.
    static func lexiconPageSegment(_ value: String) -> String? {
        guard let marker = value.range(of: "/lexicons/") else { return nil }
        let segment = value[marker.upperBound...].prefix { $0 != "/" && $0 != "?" && $0 != "#" }
        return segment.isEmpty ? nil : String(segment)
    }

    /// The two halves of an NSID: where its authority lives in DNS, and its name.
    public struct NsidAuthority: Hashable, Sendable {
        public let domain: String
        public let name: String

        public init(domain: String, name: String) {
            self.domain = domain
            self.name = name
        }
    }

    public static func nsidAuthority(_ nsid: String) -> NsidAuthority {
        let segments = nsid.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        return NsidAuthority(
            domain: segments.dropLast().reversed().joined(separator: ".").lowercased(),
            name: segments.last ?? ""
        )
    }

    /// The domains above an authority that are worth a look when it has no
    /// record of its own: each shorter suffix down to two labels, nearest
    /// first. `feed.bsky.app` -> `bsky.app`. Resolution never consults
    /// these; they are only read to explain a record published one level too
    /// high.
    public static func parentAuthorities(_ domain: String, limit: Int = 3) -> [String] {
        let labels = domain.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        var parents: [String] = []
        var start = 1
        while labels.count - start >= 2 && parents.count < limit {
            parents.append(labels[start...].joined(separator: "."))
            start += 1
        }
        return parents
    }

    // MARK: - The DNS half

    public struct TxtReading: Hashable, Sendable {
        /// The DID the records name, when they name exactly one valid one.
        public let did: String?
        /// Nothing at the name reads as a `did=` claim.
        public let absent: Bool
        /// Something is published but wrong. Nil when `did` is set.
        public let problem: String?

        public init(did: String?, absent: Bool, problem: String?) {
            self.did = did
            self.absent = absent
            self.problem = problem
        }
    }

    /// `isDid` in src/lib/tools/handle.ts: a did:plc or did:web, nothing else.
    public static func isDid(_ value: String) -> Bool {
        value.wholeMatch(of: publishingDidPattern) != nil
    }

    /// Read the TXT values at `_lexicon.<authority>`.
    public static func readLexiconRecords(_ records: [String]) -> TxtReading {
        var claims: [String] = []
        var values: [String] = []
        for record in records {
            let trimmed = record.trimmingCharacters(in: .whitespacesAndNewlines)
            guard let match = trimmed.prefixMatch(of: didClaimPattern) else { continue }
            claims.append(trimmed)
            values.append(String(trimmed[match.range.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines))
        }
        if claims.isEmpty {
            return TxtReading(
                did: nil,
                absent: true,
                problem: records.isEmpty ? nil : "There are TXT records at this name, but none of them starts with did=."
            )
        }
        var dids: [String] = []
        for value in values where !dids.contains(value) {
            dids.append(value)
        }
        if dids.count > 1 {
            return TxtReading(
                did: nil,
                absent: false,
                problem: "More than one did= record is published. An authority can only name one repository."
            )
        }
        let did = dids[0]
        if !claims[0].hasPrefix("did=\(did)") {
            return TxtReading(
                did: nil,
                absent: false,
                problem: "The record must read exactly did=<DID>, with no spaces and in lower case."
            )
        }
        if !isDid(did) {
            return TxtReading(did: nil, absent: false, problem: "\"\(did)\" is not a valid did:plc or did:web identifier.")
        }
        return TxtReading(did: did, absent: false, problem: nil)
    }

    // MARK: - The schema document

    public struct SchemaDocumentReading: Hashable, Sendable {
        /// What makes the document invalid as a published lexicon.
        public let problems: [String]
        /// What is allowed but worth knowing.
        public let notes: [String]
        /// What it defines, in a sentence. Nil when it could not be read at all.
        public let summary: String?

        public init(problems: [String], notes: [String], summary: String?) {
            self.problems = problems
            self.notes = notes
            self.summary = summary
        }
    }

    static func grouped(_ n: Int) -> String {
        let digits = String(n.magnitude)
        var out = ""
        for (index, character) in digits.enumerated() {
            if index > 0 && (digits.count - index) % 3 == 0 { out.append(",") }
            out.append(character)
        }
        return n < 0 ? "-" + out : out
    }

    static func plural(_ count: Int, _ one: String, _ many: String? = nil) -> String {
        "\(grouped(count)) \(count == 1 ? one : (many ?? one + "s"))"
    }

    /// `asString` in src/lib/lexiconSchema.ts: a string with something in it.
    private static func nonBlank(_ value: JSONValue?) -> String? {
        guard let text = value?.stringValue, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        return text
    }

    /// How many fields a definition has, as `summarizeLexicon` counts them
    /// across its sections: a record's or an object's properties, a query's
    /// parameters with its input and output when those are objects, a
    /// subscription's message.
    static func fieldCount(_ def: JSONValue) -> Int {
        let node = def.objectValue ?? [:]
        func fields(_ value: JSONValue?) -> Int {
            value?["properties"]?.objectValue?.count ?? 0
        }
        switch nonBlank(node["type"]) ?? "unknown" {
        case "record":
            return fields(node["record"])
        case "query", "procedure", "subscription":
            var total = fields(node["parameters"])
            let parts: [JSONValue?] = node["type"]?.stringValue == "subscription"
                ? [node["message"]]
                : [node["input"], node["output"]]
            for part in parts {
                if let schema = part?["schema"], schema.objectValue != nil, nonBlank(schema["type"]) == "object" {
                    total += fields(schema)
                }
            }
            return total
        case "object":
            return fields(def)
        default:
            return 0
        }
    }

    /// Check the value of a schema record against what the spec asks of one.
    public static func readSchemaDocument(_ nsid: String, _ value: JSONValue) -> SchemaDocumentReading {
        var problems: [String] = []
        var notes: [String] = []
        guard case .object(let doc) = value else {
            return SchemaDocumentReading(problems: ["The record is not a JSON object."], notes: notes, summary: nil)
        }

        if doc["$type"]?.stringValue != collection {
            if let type = doc["$type"] {
                notes.append("The record's $type is \(RecordValidator.jsString(type)), not \(collection).")
            } else {
                notes.append("The record has no $type. It should be \(collection).")
            }
        }
        if doc["lexicon"]?.doubleValue != 1 {
            if let lexicon = doc["lexicon"] {
                problems.append("The lexicon field is \(lexicon.compactString()). It must be the number 1.")
            } else {
                problems.append("The lexicon field is missing. It must be the number 1.")
            }
        }
        if let id = doc["id"]?.stringValue {
            if id != nsid {
                problems.append("The document's id is \(id), but the record key is \(nsid). They must match.")
            }
        } else {
            problems.append("The id field is missing. It must be the NSID, the same as the record key.")
        }

        guard let defs = doc["defs"]?.objectValue else {
            problems.append("The defs field is missing. It holds the definitions, as an object keyed by name.")
            return SchemaDocumentReading(problems: problems, notes: notes, summary: nil)
        }
        let names = defs.keys.sorted()
        if names.isEmpty { problems.append("The defs object is empty, so the lexicon defines nothing.") }
        let hashed = names.filter { $0.contains("#") }
        if !hashed.isEmpty {
            problems.append("Definition names must not include a #: \(hashed.joined(separator: ", ")).")
        }

        let others = names.filter { $0 != "main" }.count
        var sentence: String
        if let main = defs["main"] {
            let node = main.objectValue ?? [:]
            let type = nonBlank(node["type"]) ?? "unknown"
            let key = type == "record" ? nonBlank(node["key"]) : nil
            let fields = fieldCount(main)
            sentence = "Defines a \(type)"
            if let key { sentence += " keyed by \(key)" }
            if fields > 0 { sentence += " with \(plural(fields, "field"))" }
            if others > 0 { sentence += ", and \(plural(others, "other definition"))" }
            sentence += "."
        } else {
            sentence = "Has no main definition. It holds \(plural(others, "named definition")) for other lexicons to refer to."
        }
        return SchemaDocumentReading(problems: problems, notes: notes, summary: sentence)
    }

    // MARK: - The check list

    public enum CheckStatus: String, Hashable, Sendable {
        case pass, warn, fail, info, skip, pending
    }

    public enum CheckID: String, Hashable, Sendable, CaseIterable {
        case nsid, dns, authority, record, schema, convention

        public var title: String {
            switch self {
            case .nsid: return "NSID"
            case .dns: return "DNS record"
            case .authority: return "Authority\u{2019}s repository"
            case .record: return "Schema record"
            case .schema: return "Schema document"
            case .convention: return "Handle convention"
            }
        }
    }

    public struct Check: Hashable, Sendable, Identifiable {
        public let id: CheckID
        public let status: CheckStatus
        public let title: String
        public let summary: String
        /// Evidence, one line each.
        public let detail: [String]?
        /// What to change, one paragraph each.
        public let fix: [String]?

        public init(
            id: CheckID,
            status: CheckStatus,
            title: String? = nil,
            summary: String,
            detail: [String]? = nil,
            fix: [String]? = nil
        ) {
            self.id = id
            self.status = status
            self.title = title ?? id.title
            self.summary = summary
            self.detail = detail
            self.fix = fix
        }
    }

    public enum RecordProbe: Hashable, Sendable {
        case found(pds: String, uri: String, cid: String?, value: JSONValue)
        /// The PDS answered, and has no such record.
        case missing(pds: String)
        /// The PDS could not be asked.
        case error(pds: String, error: String)
    }

    /// The lookup aturi.to's lexicons explorer falls back on when no DNS
    /// record exists: the first two parts of the NSID, reversed, as a
    /// handle (`app.bsky.feed.post` -> `bsky.app`). Not part of the spec,
    /// and reported only so a reader knows why the explorer can show a
    /// schema that a conforming resolver cannot find.
    public struct ConventionProbe: Hashable, Sendable {
        public let handle: String
        /// Nil when the handle does not resolve.
        public let did: String?
        public let record: RecordProbe?

        public init(handle: String, did: String?, record: RecordProbe?) {
            self.handle = handle
            self.did = did
            self.record = record
        }
    }

    /// A `_lexicon` record found above the authority.
    public struct ParentRecord: Hashable, Sendable {
        public let name: String
        public let did: String

        public init(name: String, did: String) {
            self.name = name
            self.did = did
        }
    }

    /// The DID document of the DID the DNS record names.
    public enum DocumentState: Hashable, Sendable {
        case resolved(DIDDocument)
        /// The lookup was made and failed, with what went wrong when known.
        case failed(String?)
    }

    /// What has been observed so far. A field left nil is still on its way,
    /// which is how the list fills in step by step.
    public struct Evidence: Hashable, Sendable {
        public var nsid: String
        public var dns: TxtProbe?
        /// `_lexicon` records found above the authority, nearest first. Hints only.
        public var parents: [ParentRecord]?
        public var document: DocumentState?
        public var record: RecordProbe?
        public var convention: ConventionProbe?

        public init(
            nsid: String,
            dns: TxtProbe? = nil,
            parents: [ParentRecord]? = nil,
            document: DocumentState? = nil,
            record: RecordProbe? = nil,
            convention: ConventionProbe? = nil
        ) {
            self.nsid = nsid
            self.dns = dns
            self.parents = parents
            self.document = document
            self.record = record
            self.convention = convention
        }
    }

    public struct Verdict: Hashable, Sendable {
        public enum Tone: String, Hashable, Sendable {
            case pass, warn, fail, pending
        }

        public let tone: Tone
        public let title: String
        public let text: String

        public init(tone: Tone, title: String, text: String) {
            self.tone = tone
            self.title = title
            self.text = text
        }
    }

    /// The record a published schema lives at.
    public static func schemaRecordUri(did: String, nsid: String) -> String {
        LexiconSchemaLookup.schemaRecordUri(did: did, nsid: nsid)
    }

    /// The PDS a DID document names: the `#atproto_pds` service, or failing
    /// that any `AtprotoPersonalDataServer`. `pdsEndpointFrom` in handle.ts,
    /// which also accepts a fully qualified service id.
    public static func pdsEndpoint(from document: DIDDocument) -> String? {
        let services = document.service ?? []
        let service = services.first(where: { $0.id == "#atproto_pds" || $0.id.hasSuffix("#atproto_pds") })
            ?? services.first(where: { $0.type == "AtprotoPersonalDataServer" })
        guard let endpoint = service?.serviceEndpoint, !endpoint.isEmpty else { return nil }
        return endpoint
    }

    private static func pending(_ id: CheckID) -> Check {
        Check(id: id, status: .pending, summary: "Checking\u{2026}")
    }

    private static func skipped(_ id: CheckID, _ why: String) -> Check {
        Check(id: id, status: .skip, summary: why)
    }

    private static func recordFix(_ nsid: String) -> [String] {
        [
            "Create a record in the collection \(collection) with the record key \(nsid), holding the lexicon document.",
            "From a folder of lexicon files, goat lex publish does this for every schema in it.",
        ]
    }

    private static func schemaCheck(_ nsid: String, _ value: JSONValue) -> Check {
        let reading = readSchemaDocument(nsid, value)
        if !reading.problems.isEmpty {
            return Check(
                id: .schema,
                status: .fail,
                summary: reading.problems.count == 1
                    ? reading.problems[0]
                    : "The record is there, but \(reading.problems.count) things are wrong with the document.",
                detail: reading.problems.count > 1 ? reading.problems : nil,
                fix: ["Publish the record again with lexicon set to 1, id equal to the NSID, and the definitions under defs."]
            )
        }
        if !reading.notes.isEmpty {
            return Check(
                id: .schema,
                status: .warn,
                summary: "\(reading.summary ?? "A lexicon document.") \(reading.notes[0])",
                detail: reading.notes.count > 1 ? reading.notes : nil
            )
        }
        let summary = "A well-formed lexicon document. \(reading.summary ?? "")"
        return Check(id: .schema, status: .pass, summary: summary.trimmingCharacters(in: .whitespaces))
    }

    /// Build the check list from whatever has been observed so far.
    public static func buildChecks(_ evidence: Evidence) -> [Check] {
        let nsid = evidence.nsid
        let authority = nsidAuthority(nsid)
        let domain = authority.domain
        let dnsName = "_lexicon.\(domain)"
        var checks = [
            Check(
                id: .nsid,
                status: .pass,
                summary: "A valid NSID. Its name is \(authority.name), and the rest, reversed, is its authority: \(domain)."
            ),
        ]

        guard let dns = evidence.dns else {
            checks.append(contentsOf: [pending(.dns), pending(.authority), pending(.record), pending(.schema)])
            return checks
        }

        // ── DNS ──
        let reading = readLexiconRecords(dns.records)
        let recordLines = dns.records.isEmpty ? ["\u{2192} no records"] : dns.records.map { "\u{2192} \($0)" }
        let dnsDetail = ["TXT \(dns.name)"] + recordLines
        let parent = evidence.parents?.first
        // A DID is only offered for the record when there is a reason to
        // think it is the right one: the domain above already names it, or
        // its repository already holds this schema.
        var conventionDid: String?
        if let convention = evidence.convention, case .found? = convention.record {
            conventionDid = convention.did
        }
        let knownDid = parent?.did ?? conventionDid
        let dnsFix = [
            "Add a TXT record at \(dnsName) with the value did=\(knownDid ?? "<the DID of the repository that holds the schema>").",
            "Every authority needs its own record. One for the domain above it does not cover it.",
        ]

        if dns.status == .error {
            checks.append(Check(
                id: .dns,
                status: .fail,
                summary: "The lookup failed: \(dns.error ?? "no answer from the resolver").",
                detail: ["TXT \(dns.name)"]
            ))
        } else if let did = reading.did {
            checks.append(Check(id: .dns, status: .pass, summary: "The TXT record names \(did).", detail: dnsDetail))
        } else if let problem = reading.problem, !reading.absent {
            checks.append(Check(id: .dns, status: .fail, summary: problem, detail: dnsDetail, fix: dnsFix))
        } else if let parent {
            checks.append(Check(
                id: .dns,
                status: .fail,
                summary: "No did= record at this name. There is one at \(parent.name), but lexicon resolution does not look up the hierarchy.",
                detail: dnsDetail + ["TXT \(parent.name)", "\u{2192} did=\(parent.did)"],
                fix: dnsFix
            ))
        } else {
            checks.append(Check(
                id: .dns,
                status: .fail,
                summary: reading.problem ?? "No TXT record is published at this name.",
                detail: dnsDetail,
                fix: dnsFix
            ))
        }

        guard let did = reading.did else {
            let why = "Not checked, because the DNS record names no DID."
            checks.append(contentsOf: [skipped(.authority, why), skipped(.record, why), skipped(.schema, why)])
            checks.append(conventionCheck(nsid, evidence.convention))
            return checks
        }

        // ── The DID and its PDS ──
        guard let document = evidence.document else {
            checks.append(contentsOf: [pending(.authority), pending(.record), pending(.schema)])
            return checks
        }
        var endpoint: String?
        if case .resolved(let resolved) = document {
            endpoint = pdsEndpoint(from: resolved)
        }
        guard let endpoint else {
            let why = "Not checked, because the repository could not be found."
            let summary: String
            let fix: String
            switch document {
            case .failed(let error):
                summary = error.map { "\(did) could not be resolved: \($0)" } ?? "\(did) could not be resolved."
                fix = "Check the DID in the TXT record is spelled exactly as its DID document has it."
            case .resolved:
                summary = "\(did) resolves, but its DID document names no PDS, so there is no repository to hold a schema."
                fix = "Point the TXT record at the DID of an account with a repository."
            }
            checks.append(Check(id: .authority, status: .fail, summary: summary, fix: [fix]))
            checks.append(contentsOf: [skipped(.record, why), skipped(.schema, why)])
            return checks
        }
        checks.append(Check(
            id: .authority,
            status: .pass,
            summary: "The DID resolves. Its repository is on \(displayHost(endpoint)).",
            detail: [did]
        ))

        // ── The record ──
        guard let record = evidence.record else {
            checks.append(contentsOf: [pending(.record), pending(.schema)])
            return checks
        }
        let uri = schemaRecordUri(did: did, nsid: nsid)
        switch record {
        case .found(_, _, _, let value):
            checks.append(Check(
                id: .record,
                status: .pass,
                summary: "The repository holds a schema record for this NSID.",
                detail: [uri]
            ))
            checks.append(schemaCheck(nsid, value))
        case .missing:
            checks.append(Check(
                id: .record,
                status: .fail,
                summary: "The repository has no schema record for this NSID.",
                detail: [uri, "\u{2192} RecordNotFound"],
                fix: recordFix(nsid)
            ))
            checks.append(skipped(.schema, "Not checked, because there is no record to read."))
        case .error(_, let error):
            checks.append(Check(
                id: .record,
                status: .fail,
                summary: "The PDS could not be asked for the record: \(error).",
                detail: [uri]
            ))
            checks.append(skipped(.schema, "Not checked, because the record could not be read."))
        }
        return checks
    }

    /// `https://pds.example.com/` -> `pds.example.com`.
    static func displayHost(_ endpoint: String) -> String {
        var host = endpoint
        if host.lowercased().hasPrefix("https://") {
            host = String(host.dropFirst("https://".count))
        } else if host.lowercased().hasPrefix("http://") {
            host = String(host.dropFirst("http://".count))
        }
        if host.hasSuffix("/") { host.removeLast() }
        return host
    }

    private static func conventionCheck(_ nsid: String, _ convention: ConventionProbe?) -> Check {
        guard let convention else { return pending(.convention) }
        let handle = convention.handle
        guard let did = convention.did else {
            return Check(
                id: .convention,
                status: .info,
                summary: "Without a DNS record, the lexicons explorer here tries \(handle) as a handle. It does not resolve, so no schema can be found that way either."
            )
        }
        if case .found(_, let uri, _, let value)? = convention.record {
            let reading = readSchemaDocument(nsid, value)
            let caveat = reading.problems.isEmpty ? "" : ", though the document has problems"
            return Check(
                id: .convention,
                status: .info,
                summary: "\(handle) resolves as a handle, and its repository holds a schema record for this NSID\(caveat). The lexicons explorer here finds it that way. A resolver that follows the spec does not.",
                detail: [uri] + reading.problems
            )
        }
        return Check(
            id: .convention,
            status: .info,
            summary: "\(handle) resolves as a handle, but its repository has no schema record for this NSID either.",
            detail: [schemaRecordUri(did: did, nsid: nsid)]
        )
    }

    /// The handle the lexicons explorer would try for an NSID with no DNS record.
    public static func conventionHandle(_ nsid: String) -> String {
        UFOsClient.publisherForNsid(nsid).lowercased()
    }

    /// The schema record the evidence turned up, by the spec's route or the convention's.
    public struct FoundSchema: Hashable, Sendable {
        public enum Via: String, Hashable, Sendable {
            case dns, convention
        }

        public let via: Via
        public let did: String
        public let uri: String
        public let cid: String?
        public let value: JSONValue

        public init(via: Via, did: String, uri: String, cid: String?, value: JSONValue) {
            self.via = via
            self.did = did
            self.uri = uri
            self.cid = cid
            self.value = value
        }
    }

    public static func foundSchema(_ evidence: Evidence) -> FoundSchema? {
        let did = evidence.dns.flatMap { readLexiconRecords($0.records).did }
        if let did, case .found(_, let uri, let cid, let value)? = evidence.record {
            return FoundSchema(via: .dns, did: did, uri: uri, cid: cid, value: value)
        }
        if did == nil, let convention = evidence.convention, let conventionDid = convention.did,
            case .found(_, let uri, let cid, let value)? = convention.record {
            return FoundSchema(via: .convention, did: conventionDid, uri: uri, cid: cid, value: value)
        }
        return nil
    }

    /// The one-line answer above the list.
    public static func verdict(_ evidence: Evidence, _ checks: [Check]) -> Verdict {
        let nsid = evidence.nsid
        let domain = nsidAuthority(nsid).domain
        func by(_ id: CheckID) -> Check? {
            checks.first { $0.id == id }
        }

        if checks.contains(where: { $0.status == .pending }) {
            return Verdict(tone: .pending, title: "Checking \(nsid)", text: "Looking up the TXT record at _lexicon.\(domain).")
        }
        if by(.dns)?.status != .pass {
            if foundSchema(evidence)?.via == .convention {
                let handle = evidence.convention?.handle ?? ""
                return Verdict(
                    tone: .warn,
                    title: "\(nsid) has a schema, but is not published",
                    text: "The record exists in \(handle)'s repository, but no TXT record at _lexicon.\(domain) points there, so a resolver cannot find it."
                )
            }
            return Verdict(
                tone: .fail,
                title: "\(nsid) is not published",
                text: "No TXT record at _lexicon.\(domain) names the repository that holds its schema."
            )
        }
        for id in [CheckID.authority, .record, .schema] {
            guard let check = by(id), check.status == .fail else { continue }
            let title: String
            switch id {
            case .schema: title = "\(nsid) is published, but its document is not valid"
            case .record: title = "\(nsid) has an authority, but no schema"
            default: title = "\(nsid) names a repository that cannot be found"
            }
            return Verdict(tone: .fail, title: title, text: check.summary)
        }
        if let warning = checks.first(where: { $0.status == .warn }) {
            return Verdict(tone: .warn, title: "\(nsid) is published, with one thing to look at", text: warning.summary)
        }
        return Verdict(
            tone: .pass,
            title: "\(nsid) is published",
            text: "The DNS record names a repository, and the schema record is in it."
        )
    }
}

// MARK: - Observing

/// The reads the publishing checker makes, port of the fetches in
/// LexiconChecker.tsx. Each one reports a failure as evidence rather than
/// throwing, since a link that could not be read is part of the answer.
public struct LexiconPublishingClient: Sendable {
    private let http: HTTPClient
    private let dns: DNSTXTClient
    private let slingshot: SlingshotClient
    private let resolver: IdentityResolver

    public init(http: HTTPClient = .shared) {
        self.http = http
        dns = DNSTXTClient(http: http)
        slingshot = SlingshotClient(http: http)
        resolver = IdentityResolver(http: http)
    }

    /// One TXT lookup over DNS-over-HTTPS.
    public func lookupTxt(_ name: String) async -> TxtProbe {
        await dns.lookup(name)
    }

    /// The `_lexicon` records above an authority that name a DID, nearest first.
    public func parentRecords(_ domains: [String]) async -> [LexiconPublishing.ParentRecord] {
        let dns = dns
        return await withTaskGroup(
            of: (Int, LexiconPublishing.ParentRecord?).self,
            returning: [LexiconPublishing.ParentRecord].self
        ) { group in
            for (index, domain) in domains.enumerated() {
                group.addTask {
                    let probe = await dns.lookup("_lexicon.\(domain)")
                    guard let did = LexiconPublishing.readLexiconRecords(probe.records).did else { return (index, nil) }
                    return (index, LexiconPublishing.ParentRecord(name: probe.name, did: did))
                }
            }
            var found = [LexiconPublishing.ParentRecord?](repeating: nil, count: domains.count)
            while let (index, parent) = await group.next() {
                found[index] = parent
            }
            return found.compactMap { $0 }
        }
    }

    /// The handle convention's identity, through Slingshot.
    public func resolveMiniDoc(_ identifier: String) async -> MiniDoc? {
        await slingshot.resolveMiniDoc(identifier)
    }

    /// The DID document, or why it could not be read.
    public func loadDocument(_ did: String) async -> LexiconPublishing.DocumentState {
        do {
            let document = try await resolver.loadDIDDocument(did)
            return .resolved(document)
        } catch let error as HTTPError {
            return .failed("HTTP \(error.status)")
        } catch is IdentityResolverError {
            return .failed("Only did:plc and did:web can be resolved")
        } catch {
            return .failed(nil)
        }
    }

    /// Ask a PDS for the schema record itself. A 400 naming RecordNotFound
    /// is the PDS saying it has no such record, which is an answer; anything
    /// else that is not a 200 means it could not be asked.
    public func readSchemaRecord(pds: String, did: String, nsid: String) async -> LexiconPublishing.RecordProbe {
        let base = pds.hasSuffix("/") ? String(pds.dropLast()) : pds
        let url: URL
        do {
            url = try PDSClient.recordURL(pds: base, repo: did, collection: LexiconPublishing.collection, rkey: nsid)
        } catch {
            return .error(pds: base, error: "the PDS did not answer")
        }
        do {
            let (data, _) = try await http.get(url, refuseRedirects: true)
            let body = try? JSONValue.parse(data)
            if let value = body?["value"] {
                let uri = body?["uri"]?.stringValue ?? LexiconPublishing.schemaRecordUri(did: did, nsid: nsid)
                return .found(pds: base, uri: uri, cid: body?["cid"]?.stringValue, value: value)
            }
            // The web reads `error` whatever the status: a 200 naming
            // RecordNotFound is still a missing record.
            let code = body?["error"]?.stringValue ?? ""
            if code == "RecordNotFound" { return .missing(pds: base) }
            return .error(pds: base, error: code.isEmpty ? "HTTP 200" : "\(code) (HTTP 200)")
        } catch let error as HTTPError {
            let body = try? JSONValue.parse(Data(error.body.utf8))
            let code = body?["error"]?.stringValue ?? ""
            if code == "RecordNotFound" { return .missing(pds: base) }
            return .error(pds: base, error: code.isEmpty ? "HTTP \(error.status)" : "\(code) (HTTP \(error.status))")
        } catch {
            return .error(pds: base, error: "the PDS did not answer")
        }
    }
}

/// `^[A-Za-z][A-Za-z0-9]*$`, an NSID's name segment.
private let nsidNameSegmentPattern = #/[A-Za-z][A-Za-z0-9]*/#
/// `^did:(plc:[a-z2-7]{24}|web:[A-Za-z0-9.%:_-]+)$` from handle.ts.
private let publishingDidPattern = #/did:(?:plc:[a-z2-7]{24}|web:[A-Za-z0-9.%:_-]+)/#
/// `^did\s*=\s*`, any case: a TXT value that claims a DID.
private let didClaimPattern = #/did\s*=\s*/#.ignoresCase()
