import Foundation

// The handle debugger's logic, port of src/lib/tools/handle.ts: what a
// handle has to get right, and how to read the evidence for each step.
//
// A handle is a domain name that claims a DID, and the claim only counts
// when the DID claims it back:
//
//   handle -> DID   by a `_atproto.<handle>` TXT record holding `did=<did>`,
//                   or by `https://<handle>/.well-known/atproto-did`
//                   answering with the DID as plain text. Either is enough.
//   DID -> handle   by the DID document listing `at://<handle>` under
//                   `alsoKnownAs`.
//
// Everything here is pure: it takes what was observed and says what it
// means. The observing is `HandleDebugClient`. The web makes the TXT lookup
// and the well-known read on its server (src/app/api/tools/handle), since a
// browser can do neither against an arbitrary host; the app makes both
// itself, and reads the DID document, the PDS and the AppView directly as
// the web page does.

public enum HandleDebug {
    /// What was typed, tidied into a handle or refused with the reason.
    public enum Input: Hashable, Sendable {
        case valid(String)
        case invalid(String)

        public var handle: String? {
            if case .valid(let handle) = self { return handle }
            return nil
        }

        public var reason: String? {
            if case .invalid(let reason) = self { return reason }
            return nil
        }
    }

    /// TLDs the handle spec rules out: none of them can be resolved on the
    /// public internet, so a handle under one can never verify.
    static let disallowedTLDs: Set<String> = ["alt", "arpa", "example", "internal", "invalid", "local", "localhost", "onion"]

    /// Tidy what was typed (`@name`, `at://name`, a link, a trailing dot,
    /// capitals) into a bare handle (`normalizeHandleInput`).
    public static func normalizeInput(_ raw: String) -> Input {
        var value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { return .invalid("Enter a handle.") }
        if value.lowercased().hasPrefix("at://") {
            value = String(value.dropFirst("at://".count))
        }
        if value.hasPrefix("@") {
            value.removeFirst()
        }
        if value.lowercased().hasPrefix("did:") {
            return .invalid("That is a DID. Enter the handle you expect it to have.")
        }
        let lower = value.lowercased()
        if lower.hasPrefix("http://") || lower.hasPrefix("https://") {
            guard let host = URLComponents(string: value)?.host, !host.isEmpty else {
                return .invalid("That URL could not be read. Enter a handle such as alice.example.com.")
            }
            value = host
        }
        var handle = value.split(separator: "/", omittingEmptySubsequences: false).first.map(String.init) ?? ""
        if handle.hasSuffix(".") {
            handle.removeLast()
        }
        handle = handle.lowercased()
        if let problem = syntaxProblem(handle) {
            return .invalid(problem)
        }
        return .valid(handle)
    }

    /// Why `handle` is not a syntactically valid handle, or nil when it is
    /// (`handleSyntaxProblem`). Expects the lower case `normalizeInput`
    /// produces. Lengths are counted in UTF-16 units, as JavaScript counts.
    public static func syntaxProblem(_ handle: String) -> String? {
        if handle.utf16.count > 253 { return "A handle can be at most 253 characters." }
        let labels = handle.split(separator: ".", omittingEmptySubsequences: false).map(String.init)
        if labels.count < 2 {
            return "A handle is a domain name, so it needs at least two parts, such as alice.example.com."
        }
        for label in labels {
            if label.isEmpty { return "A handle cannot have an empty part between dots." }
            if label.utf16.count > 63 { return "Each part of a handle can be at most 63 characters." }
            if !label.unicodeScalars.allSatisfy(isLabelScalar) {
                return "A handle can only use letters, digits and hyphens between its dots."
            }
            if label.hasPrefix("-") || label.hasSuffix("-") {
                return "No part of a handle can start or end with a hyphen."
            }
        }
        let tld = labels[labels.count - 1]
        if let first = tld.unicodeScalars.first, (48...57).contains(first.value) {
            return "The last part of a handle cannot start with a digit."
        }
        if disallowedTLDs.contains(tld) {
            return ".\(tld) is a reserved name that cannot be used for a handle."
        }
        return nil
    }

    /// `[a-z0-9-]`.
    private static func isLabelScalar(_ scalar: Unicode.Scalar) -> Bool {
        (97...122).contains(scalar.value) || (48...57).contains(scalar.value) || scalar.value == 45
    }

    /// A did:plc or did:web identifier (`isDid`). Narrower than
    /// `isValidDid`, which takes any method: a handle can only name one of
    /// these two.
    public static func isDid(_ value: String) -> Bool {
        value.wholeMatch(of: handleDebugDidPattern) != nil
    }

    // MARK: What the lookups report

    /// The answer from `https://<handle>/.well-known/atproto-did`
    /// (`HttpProbe`).
    public struct HTTPProbe: Hashable, Sendable {
        public enum Status: String, Hashable, Sendable {
            /// The host returned a response, whatever its status.
            case answered
            case error
        }

        public var url: String
        public var status: Status
        public var httpStatus: Int?
        public var contentType: String?
        /// The body, trimmed and capped.
        public var body: String?
        /// Where the request ended up, when it was redirected.
        public var finalUrl: String?
        public var error: String?

        public init(
            url: String,
            status: Status,
            httpStatus: Int? = nil,
            contentType: String? = nil,
            body: String? = nil,
            finalUrl: String? = nil,
            error: String? = nil
        ) {
            self.url = url
            self.status = status
            self.httpStatus = httpStatus
            self.contentType = contentType
            self.body = body
            self.finalUrl = finalUrl
            self.error = error
        }
    }

    /// Both resolution methods, as observed (`HandleProbe`).
    public struct Probe: Hashable, Sendable {
        public var handle: String
        /// The TXT records at `_atproto.<handle>`.
        public var dns: TxtProbe
        public var http: HTTPProbe

        public init(handle: String, dns: TxtProbe, http: HTTPProbe) {
            self.handle = handle
            self.dns = dns
            self.http = http
        }
    }

    // MARK: Reading the two resolution methods

    public struct MethodReading: Hashable, Sendable {
        /// The DID this method names, when it names exactly one valid one.
        public var did: String?
        /// Nothing is set up for this method at all, which is fine if the
        /// other works.
        public var absent: Bool
        /// Something is set up but wrong. Nil when `did` is set or the
        /// method is absent.
        public var problem: String?

        public init(did: String?, absent: Bool, problem: String?) {
            self.did = did
            self.absent = absent
            self.problem = problem
        }
    }

    /// Read the TXT values at `_atproto.<handle>` (`readDnsRecords`).
    public static func readDNSRecords(_ records: [String]) -> MethodReading {
        let claims = records
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { $0.prefixMatch(of: handleDebugClaimPrefix) != nil }
        if claims.isEmpty {
            return MethodReading(
                did: nil,
                absent: true,
                problem: records.isEmpty ? nil : "There are TXT records at this name, but none of them starts with did=."
            )
        }
        var dids: [String] = []
        for claim in claims {
            let value = claimValue(claim)
            if !dids.contains(value) { dids.append(value) }
        }
        if dids.count > 1 {
            return MethodReading(did: nil, absent: false, problem: "More than one did= record is published. A handle can only name one DID.")
        }
        let did = dids[0]
        if !claims[0].hasPrefix("did=\(did)") {
            return MethodReading(did: nil, absent: false, problem: "The record must read exactly did=<your DID>, with no spaces and in lower case.")
        }
        if !isDid(did) {
            return MethodReading(did: nil, absent: false, problem: "\"\(did)\" is not a valid did:plc or did:web identifier.")
        }
        return MethodReading(did: did, absent: false, problem: nil)
    }

    /// `claim.replace(/^did\s*=\s*/i, '').trim()`.
    private static func claimValue(_ claim: String) -> String {
        guard let match = claim.prefixMatch(of: handleDebugClaimPrefix) else { return claim }
        return String(claim[match.range.upperBound...]).trimmingCharacters(in: .whitespacesAndNewlines)
    }

    /// Read the answer from `https://<handle>/.well-known/atproto-did`
    /// (`readWellKnown`).
    public static func readWellKnown(_ probe: HTTPProbe) -> MethodReading {
        if probe.status == .error {
            return MethodReading(did: nil, absent: true, problem: nil)
        }
        let status = probe.httpStatus ?? 0
        if status == 404 || status == 410 {
            return MethodReading(did: nil, absent: true, problem: nil)
        }
        if status < 200 || status >= 300 {
            return MethodReading(did: nil, absent: false, problem: "The file answered with HTTP \(status) rather than 200.")
        }
        let body = (probe.body ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        if body.isEmpty {
            return MethodReading(did: nil, absent: false, problem: "The file is empty. It must contain the DID and nothing else.")
        }
        let lower = body.lowercased()
        if lower.hasPrefix("<") || lower.contains("<html") || lower.contains("<!doctype") {
            return MethodReading(
                did: nil,
                absent: false,
                problem: "The address returns a web page rather than the DID. The host is answering every path with its site."
            )
        }
        if !isDid(body) {
            return MethodReading(did: nil, absent: false, problem: "The file must contain only the DID, as plain text on one line.")
        }
        return MethodReading(did: body, absent: false, problem: nil)
    }

    // MARK: The check list

    /// `pass` and `fail` are findings, `warn` works but is worth knowing
    /// about, `info` is a fact with no judgment, `skip` could not run
    /// because an earlier step failed, `pending` is on its way
    /// (`CheckStatus` in Checks.tsx).
    public enum CheckStatus: String, Hashable, Sendable {
        case pass
        case warn
        case fail
        case info
        case skip
        case pending
    }

    public enum CheckID: String, Hashable, Sendable {
        case dns
        case http
        case agree
        case document
        case claim
        case pds
        case appview
    }

    public struct Check: Hashable, Sendable, Identifiable {
        public var id: CheckID
        public var status: CheckStatus
        public var title: String
        public var summary: String
        /// Evidence, one line each.
        public var detail: [String]
        /// What to change, one paragraph each.
        public var fix: [String]

        public init(id: CheckID, status: CheckStatus, title: String, summary: String, detail: [String] = [], fix: [String] = []) {
            self.id = id
            self.status = status
            self.title = title
            self.summary = summary
            self.detail = detail
            self.fix = fix
        }
    }

    /// One piece of evidence: still on its way (the web's `undefined`),
    /// looked up and failed (`null`, with the reason when there is one), or
    /// in hand.
    public enum Step<Value: Hashable & Sendable>: Hashable, Sendable {
        case pending
        case failed(String?)
        case done(Value)

        public var value: Value? {
            if case .done(let value) = self { return value }
            return nil
        }

        public var isPending: Bool {
            if case .pending = self { return true }
            return false
        }
    }

    /// What the account's PDS says about it.
    public struct PDSState: Hashable, Sendable {
        public var endpoint: String
        public var reachable: Bool
        /// `handle` from describeRepo.
        public var handle: String?
        public var handleIsCorrect: Bool?
        /// From getRepoStatus: false when taken down, deactivated, and so on.
        public var active: Bool?
        public var status: String?
        public var error: String?

        public init(
            endpoint: String,
            reachable: Bool,
            handle: String? = nil,
            handleIsCorrect: Bool? = nil,
            active: Bool? = nil,
            status: String? = nil,
            error: String? = nil
        ) {
            self.endpoint = endpoint
            self.reachable = reachable
            self.handle = handle
            self.handleIsCorrect = handleIsCorrect
            self.active = active
            self.status = status
            self.error = error
        }
    }

    /// The handle Bluesky's AppView currently shows for the DID.
    public struct AppViewState: Hashable, Sendable {
        public var handle: String?
        public var error: String?

        public init(handle: String? = nil, error: String? = nil) {
            self.handle = handle
            self.error = error
        }
    }

    /// What has been observed so far (`HandleEvidence`). A step still
    /// `.pending` is on its way, which is how the list fills in step by step.
    public struct Evidence: Hashable, Sendable {
        public var handle: String
        public var probe: Step<Probe>
        /// The DID document for the DID the handle names.
        public var document: Step<DIDDocument>
        public var pds: Step<PDSState>
        public var appview: Step<AppViewState>

        public init(
            handle: String,
            probe: Step<Probe> = .pending,
            document: Step<DIDDocument> = .pending,
            pds: Step<PDSState> = .pending,
            appview: Step<AppViewState> = .pending
        ) {
            self.handle = handle
            self.probe = probe
            self.document = document
            self.pds = pds
            self.appview = appview
        }
    }

    public struct Verdict: Hashable, Sendable {
        public enum Tone: String, Hashable, Sendable {
            case pass
            case warn
            case fail
            case pending
        }

        public var tone: Tone
        public var title: String
        public var text: String
        /// The DID the handle resolves to, when it resolves at all.
        public var did: String?

        public init(tone: Tone, title: String, text: String, did: String?) {
            self.tone = tone
            self.title = title
            self.text = text
            self.did = did
        }
    }

    /// The handles a document claims, lower case, in its order
    /// (`handlesFromAlsoKnownAs`).
    public static func handles(fromAlsoKnownAs alsoKnownAs: [String]?) -> [String] {
        (alsoKnownAs ?? [])
            .filter { $0.lowercased().hasPrefix("at://") }
            .map { String($0.dropFirst("at://".count)).lowercased() }
    }

    /// The PDS a document names (`pdsEndpointFrom`): the `#atproto_pds`
    /// service by id first, then any `AtprotoPersonalDataServer`. Verbatim,
    /// trailing slash and all.
    public static func pdsEndpoint(_ document: DIDDocument?) -> String? {
        let services = document?.service ?? []
        let service = services.first { $0.id == "#atproto_pds" || $0.id.hasSuffix("#atproto_pds") }
            ?? services.first { $0.type == "AtprotoPersonalDataServer" }
        guard let endpoint = service?.serviceEndpoint, !endpoint.isEmpty else { return nil }
        return endpoint
    }

    /// The endpoint of a service by its fragment id (`#atproto_pds`), without
    /// a trailing slash. Port of `serviceEndpoint` in
    /// src/lib/tools/didDocument.ts, which the bulk resolver reads.
    public static func serviceEndpoint(_ document: DIDDocument?, fragment: String) -> String? {
        let service = document?.service?.first { $0.id == fragment || $0.id.hasSuffix(fragment) }
        guard var endpoint = service?.serviceEndpoint, !endpoint.isEmpty else { return nil }
        if endpoint.hasSuffix("/") {
            endpoint.removeLast()
        }
        return endpoint
    }

    /// The DID the two methods settle on. DNS wins when they disagree, as
    /// resolvers do (`resolvedDid`).
    public static func resolvedDid(_ probe: Probe?) -> String? {
        guard let probe else { return nil }
        return readDNSRecords(probe.dns.records).did ?? readWellKnown(probe.http).did
    }

    private static func pendingCheck(_ id: CheckID, _ title: String) -> Check {
        Check(id: id, status: .pending, title: title, summary: "Checking…")
    }

    private static func skippedCheck(_ id: CheckID, _ title: String, _ why: String) -> Check {
        Check(id: id, status: .skip, title: title, summary: why)
    }

    private static func dnsFix(_ handle: String, _ did: String?) -> [String] {
        [
            "Add a TXT record at _atproto.\(handle) with the value did=\(did ?? "<your DID>").",
            "Many DNS providers add the domain for you, so the name to enter is often just _atproto.",
        ]
    }

    private static func withoutScheme(_ url: String) -> String {
        let lower = url.lowercased()
        if lower.hasPrefix("https://") { return String(url.dropFirst("https://".count)) }
        if lower.hasPrefix("http://") { return String(url.dropFirst("http://".count)) }
        return url
    }

    private static let dnsTitle = "DNS record"
    private static let httpTitle = "Well-known file"
    private static let documentTitle = "DID document"
    private static let claimTitle = "DID claims the handle"
    private static let pdsTitle = "Account on its PDS"
    private static let appViewTitle = "Bluesky AppView"

    /// Build the check list from whatever has been observed so far
    /// (`buildHandleChecks`).
    public static func buildChecks(_ evidence: Evidence) -> [Check] {
        let handle = evidence.handle
        let probe: Probe
        switch evidence.probe {
        case .pending:
            return [
                pendingCheck(.dns, dnsTitle),
                pendingCheck(.http, httpTitle),
                pendingCheck(.document, documentTitle),
                pendingCheck(.claim, claimTitle),
                pendingCheck(.pds, pdsTitle),
                pendingCheck(.appview, appViewTitle),
            ]
        case .failed(let reason):
            let why = reason ?? "The lookup could not be made."
            return [
                Check(id: .dns, status: .fail, title: dnsTitle, summary: why),
                Check(id: .http, status: .fail, title: httpTitle, summary: why),
                skippedCheck(.document, documentTitle, "Not checked, because the handle did not resolve."),
                skippedCheck(.claim, claimTitle, "Not checked, because the handle did not resolve."),
            ]
        case .done(let observed):
            probe = observed
        }

        var checks: [Check] = []
        let dns = readDNSRecords(probe.dns.records)
        let http = readWellKnown(probe.http)
        let resolved = dns.did ?? http.did
        let eitherWorks = resolved != nil

        // DNS
        var dnsDetail = ["TXT \(probe.dns.name)"]
        if probe.dns.records.isEmpty {
            dnsDetail.append("→ no records")
        } else {
            dnsDetail += probe.dns.records.map { "→ \($0)" }
        }
        if probe.dns.status == .error {
            checks.append(Check(
                id: .dns,
                status: eitherWorks ? .warn : .fail,
                title: dnsTitle,
                summary: "The lookup failed: \(probe.dns.error ?? "no answer from the resolver").",
                detail: ["TXT \(probe.dns.name)"]
            ))
        } else if let did = dns.did {
            checks.append(Check(id: .dns, status: .pass, title: dnsTitle, summary: "The TXT record names \(did).", detail: dnsDetail))
        } else if let problem = dns.problem, !dns.absent {
            checks.append(Check(id: .dns, status: .fail, title: dnsTitle, summary: problem, detail: dnsDetail, fix: dnsFix(handle, http.did)))
        } else {
            let summary: String
            if http.did != nil {
                summary = "No did= record here. That is fine: the well-known file answers instead."
            } else {
                summary = dns.problem ?? "No TXT record is published at this name."
            }
            checks.append(Check(
                id: .dns,
                status: http.did != nil ? .info : .fail,
                title: dnsTitle,
                summary: summary,
                detail: dnsDetail,
                fix: http.did != nil ? [] : dnsFix(handle, nil)
            ))
        }

        // Well-known
        var httpDetail = ["GET \(probe.http.url)"]
        if let finalUrl = probe.http.finalUrl, finalUrl != probe.http.url {
            httpDetail.append("→ redirected to \(finalUrl)")
        }
        if probe.http.status == .answered {
            let code = probe.http.httpStatus.map(String.init) ?? ""
            var line = "→ HTTP \(code)"
            if let contentType = probe.http.contentType, !contentType.isEmpty {
                line += ", \(contentType)"
            }
            httpDetail.append(line)
            let body = (probe.http.body ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !body.isEmpty, http.did == nil, (probe.http.httpStatus ?? 0) < 400 {
                httpDetail.append(body.count > 160 ? "→ \(body.prefix(160))…" : "→ \(body)")
            }
        } else {
            httpDetail.append("→ \(probe.http.error ?? "no answer")")
        }
        let httpFix = [
            "Serve a plain text file at https://\(handle)/.well-known/atproto-did containing only \(dns.did ?? "your DID").",
            "Or leave this out and use the DNS record: only one of the two is needed.",
        ]
        if let did = http.did {
            checks.append(Check(id: .http, status: .pass, title: httpTitle, summary: "The file contains \(did).", detail: httpDetail))
        } else if let problem = http.problem, !http.absent {
            /* A broken file beside a working record is still worth fixing:
               some resolvers try this method first. */
            checks.append(Check(
                id: .http,
                status: dns.did != nil ? .warn : .fail,
                title: httpTitle,
                summary: problem,
                detail: httpDetail,
                fix: httpFix
            ))
        } else {
            let summary: String
            if dns.did != nil {
                summary = "No file here. That is fine: the DNS record answers instead."
            } else if probe.http.status == .error {
                summary = "The host could not be reached: \(probe.http.error ?? "no answer")."
            } else {
                summary = "No file is served at this address."
            }
            checks.append(Check(
                id: .http,
                status: dns.did != nil ? .info : .fail,
                title: httpTitle,
                summary: summary,
                detail: httpDetail,
                fix: dns.did != nil ? [] : httpFix
            ))
        }

        // The two agree
        if let dnsDid = dns.did, let httpDid = http.did, dnsDid != httpDid {
            checks.append(Check(
                id: .agree,
                status: .warn,
                title: "Both methods agree",
                summary: "The DNS record and the well-known file name different DIDs. Resolvers prefer the DNS record, but some treat the handle as ambiguous.",
                detail: ["DNS → \(dnsDid)", "Well-known → \(httpDid)"],
                fix: ["Remove whichever one is out of date, or make both name the same DID."]
            ))
        }

        guard let did = resolved else {
            checks.append(skippedCheck(.document, documentTitle, "Not checked, because the handle names no DID."))
            checks.append(skippedCheck(.claim, claimTitle, "Not checked, because the handle names no DID."))
            return checks
        }

        // DID document
        let document: DIDDocument
        switch evidence.document {
        case .pending:
            checks.append(pendingCheck(.document, documentTitle))
            checks.append(pendingCheck(.claim, claimTitle))
            checks.append(pendingCheck(.pds, pdsTitle))
            checks.append(pendingCheck(.appview, appViewTitle))
            return checks
        case .failed(let reason):
            let because: String
            if let reason, !reason.isEmpty {
                because = ": \(reason)"
            } else {
                because = "."
            }
            let fix: String
            if did.hasPrefix("did:web:") {
                fix = "A did:web document is served from /.well-known/did.json on its host. Check that it is reachable over https."
            } else {
                fix = "Check the DID is spelled exactly as the PLC directory has it. A did:plc is 24 characters after the prefix."
            }
            checks.append(Check(
                id: .document,
                status: .fail,
                title: documentTitle,
                summary: "\(did) could not be resolved\(because)",
                fix: [fix]
            ))
            checks.append(skippedCheck(.claim, claimTitle, "Not checked, because the DID document could not be read."))
            return checks
        case .done(let read):
            document = read
        }

        let listed = handles(fromAlsoKnownAs: document.alsoKnownAs)
        let endpoint = pdsEndpoint(document)
        var documentDetail = [did]
        if listed.isEmpty {
            documentDetail.append("alsoKnownAs: none")
        } else {
            documentDetail += listed.map { "alsoKnownAs at://\($0)" }
        }
        let documentSummary: String
        if let endpoint {
            documentSummary = "Resolved. The account's PDS is \(withoutScheme(endpoint))."
        } else {
            documentSummary = "Resolved, but it names no PDS, so there is no repository behind this identity."
        }
        checks.append(Check(
            id: .document,
            status: endpoint != nil ? .pass : .warn,
            title: documentTitle,
            summary: documentSummary,
            detail: documentDetail
        ))

        // The DID claims the handle back
        let position = listed.firstIndex(of: handle)
        if position == 0 {
            checks.append(Check(
                id: .claim,
                status: .pass,
                title: claimTitle,
                summary: "The document lists at://\(handle) as its handle, so the link holds in both directions."
            ))
        } else if position != nil {
            checks.append(Check(
                id: .claim,
                status: .warn,
                title: claimTitle,
                summary: "The document lists at://\(handle), but not first. Only the first at:// entry is the account's handle; it is currently \(listed[0]).",
                fix: ["Set this handle as the account’s handle in its app or PDS settings, which moves it to the front."]
            ))
        } else {
            let summary: String
            if let current = listed.first {
                summary = "The domain points at this DID, but the DID's handle is \(current). Until the DID claims this handle too, apps show it as invalid."
            } else {
                summary = "The domain points at this DID, but the DID document lists no handle at all."
            }
            checks.append(Check(
                id: .claim,
                status: .fail,
                title: claimTitle,
                summary: summary,
                fix: [
                    "Sign in to the account and change its handle to this domain (in Bluesky: Settings, Account, Handle, “I have my own domain”).",
                    "That writes the handle into the DID document. The DNS record or file alone is only half of the link.",
                ]
            ))
        }

        // PDS
        if let endpoint {
            switch evidence.pds {
            case .pending:
                checks.append(pendingCheck(.pds, pdsTitle))
            case .failed(let reason):
                checks.append(pdsUnreachable(endpoint: endpoint, error: reason))
            case .done(let pds):
                if !pds.reachable {
                    checks.append(pdsUnreachable(endpoint: endpoint, error: pds.error))
                } else if pds.active == false {
                    checks.append(Check(
                        id: .pds,
                        status: .warn,
                        title: pdsTitle,
                        summary: "The PDS reports this account as \(pds.status ?? "inactive"). Apps will not show it, whatever the handle says.",
                        detail: [endpoint]
                    ))
                } else if pds.handleIsCorrect == false {
                    var named = ""
                    if let known = pds.handle, !known.isEmpty {
                        named = " (\(known))"
                    }
                    checks.append(Check(
                        id: .pds,
                        status: .warn,
                        title: pdsTitle,
                        summary: "The PDS serves the account, but could not confirm its handle\(named) when it last checked.",
                        detail: [endpoint],
                        fix: ["The PDS re-checks handles on its own schedule. Saving the handle again in the account’s settings makes it check now."]
                    ))
                } else {
                    let summary: String
                    if let known = pds.handle, !known.isEmpty, known.lowercased() != handle {
                        summary = "The account is active. The PDS knows it as \(known)."
                    } else {
                        summary = "The account is active and the PDS confirms its handle."
                    }
                    checks.append(Check(id: .pds, status: .pass, title: pdsTitle, summary: summary, detail: [endpoint]))
                }
            }
        } else {
            checks.append(skippedCheck(.pds, pdsTitle, "Not checked, because the DID document names no PDS."))
        }

        // AppView
        switch evidence.appview {
        case .pending:
            checks.append(pendingCheck(.appview, appViewTitle))
        case .failed(let reason):
            checks.append(appViewMissing(error: reason))
        case .done(let appview):
            if let error = appview.error, !error.isEmpty {
                checks.append(appViewMissing(error: error))
            } else if appview.handle == "handle.invalid" {
                checks.append(Check(
                    id: .appview,
                    status: position == 0 ? .warn : .fail,
                    title: appViewTitle,
                    summary: position == 0
                        ? "Bluesky currently shows this account as handle.invalid. Everything above checks out, so it has not re-checked yet."
                        : "Bluesky shows this account as handle.invalid, because the handle and the DID do not point at each other.",
                    fix: position == 0
                        ? ["Save the handle again in the account’s settings. That sends an identity event, and the AppView re-checks when it sees one."]
                        : []
                ))
            } else if let shown = appview.handle, !shown.isEmpty, shown.lowercased() == handle {
                checks.append(Check(id: .appview, status: .pass, title: appViewTitle, summary: "Bluesky shows this account under this handle."))
            } else {
                let ending = position == 0 ? ", so it has not picked up the change yet." : "."
                checks.append(Check(
                    id: .appview,
                    status: position == 0 ? .warn : .info,
                    title: appViewTitle,
                    summary: "Bluesky shows this account as \(appview.handle ?? "an unknown handle")\(ending)"
                ))
            }
        }

        return checks
    }

    private static func pdsUnreachable(endpoint: String, error: String?) -> Check {
        var because = "."
        if let error, !error.isEmpty {
            because = ": \(error)"
        }
        return Check(
            id: .pds,
            status: .warn,
            title: pdsTitle,
            summary: "The PDS did not answer\(because) The handle can still be valid, but the account cannot be read right now.",
            detail: [endpoint]
        )
    }

    private static func appViewMissing(error: String?) -> Check {
        var because = ""
        if let error, !error.isEmpty {
            because = " (\(error))"
        }
        return Check(
            id: .appview,
            status: .info,
            title: appViewTitle,
            summary: "Bluesky's AppView has no profile for this DID\(because). That is normal for an account that does not use Bluesky."
        )
    }

    /// The one-line answer above the list (`handleVerdict`).
    public static func verdict(_ evidence: Evidence, checks: [Check]) -> Verdict {
        let handle = evidence.handle
        let did = resolvedDid(evidence.probe.value)

        if checks.contains(where: { $0.status == .pending }) {
            return Verdict(tone: .pending, title: "Checking \(handle)", text: "Looking up the DNS record and the well-known file.", did: did)
        }
        guard did != nil else {
            return Verdict(
                tone: .fail,
                title: "\(handle) does not resolve to a DID",
                text: "Neither the DNS record nor the well-known file names one. Set up either, then check again.",
                did: did
            )
        }
        if let document = checks.first(where: { $0.id == .document }), document.status == .fail {
            return Verdict(tone: .fail, title: "\(handle) names a DID that cannot be resolved", text: document.summary, did: did)
        }
        if let claim = checks.first(where: { $0.id == .claim }), claim.status == .fail {
            return Verdict(
                tone: .fail,
                title: "\(handle) is not a valid handle yet",
                text: "The domain points at the DID, but the DID does not claim this handle. Both directions have to agree.",
                did: did
            )
        }
        let warnings = checks.filter { $0.status == .warn }
        if let first = warnings.first {
            let count = warnings.count == 1 ? "one thing" : "\(warnings.count) things"
            return Verdict(tone: .warn, title: "\(handle) verifies, with \(count) to look at", text: first.summary, did: did)
        }
        return Verdict(
            tone: .pass,
            title: "\(handle) is a valid handle",
            text: "The domain names the DID and the DID claims the domain.",
            did: did
        )
    }
}

/// `isDid`: `^did:(plc:[a-z2-7]{24}|web:[A-Za-z0-9.%:_-]+)$`, matched whole.
private let handleDebugDidPattern = #/did:(?:plc:[a-z2-7]{24}|web:[A-Za-z0-9.%:_\-]+)/#

/// `^did\s*=\s*`, case-insensitive: the start of a claim and what to strip
/// to read its value.
private let handleDebugClaimPrefix = #/[dD][iI][dD]\s*=\s*/#
