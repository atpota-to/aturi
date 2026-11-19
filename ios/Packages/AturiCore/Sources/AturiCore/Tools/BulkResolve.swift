import Foundation
#if canImport(FoundationNetworking)
import FoundationNetworking
#endif

// The bulk identity resolver's logic, port of src/lib/tools/resolve.ts:
// reading a pasted list into identifiers, saying how each one came out, and
// writing the table back out.
//
// Lists arrive in every shape a spreadsheet, a chat message or a web page
// can give them: one per line or run together with commas, with an @ in
// front, as at:// URIs, as profile links. Each entry is read down to the
// one thing that identifies an account, a DID or a handle, and anything that
// is neither is kept in the table and marked, so nothing typed goes missing.
//
// Everything in `BulkResolve` is pure. The lookups are `BulkResolveClient`
// below, the run is `BulkResolveModel`.

public enum BulkResolve {
    /// Most identifiers resolved in one go. Each is at least one request.
    public static let maxIdentifiers = 500

    /// Longest list kept in the link. Past this the address gets unwieldy
    /// and some clients cut it, so a longer list is resolved but not
    /// shareable.
    public static let maxQueryLength = 1500

    public enum Kind: String, Hashable, Sendable {
        case did
        case handle
        case invalid
    }

    public struct Entry: Hashable, Sendable {
        /// As typed, trimmed of the punctuation around it.
        public var input: String
        public var kind: Kind
        /// The DID, or the handle in lower case. For `invalid`, the input.
        public var value: String
        /// Why it was not read as an identifier.
        public var reason: String?

        public init(input: String, kind: Kind, value: String, reason: String? = nil) {
            self.input = input
            self.kind = kind
            self.value = value
            self.reason = reason
        }

        /// What tells two entries apart: the same account spelled two ways
        /// is one entry.
        public var key: String {
            "\(kind.rawValue):\(value)"
        }
    }

    /// Quotes and brackets come along from CSV cells and from prose.
    private static let leadingPunctuation: Set<Character> = ["\"", "'", "<", "(", "["]
    private static let trailingPunctuation: Set<Character> = ["\"", "'", ">", ")", "]", ",", "."]

    /// Read one entry of a list down to the DID or handle it names
    /// (`readIdentifier`).
    public static func readIdentifier(_ raw: String) -> Entry {
        var input = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        while let first = input.first, leadingPunctuation.contains(first) {
            input.removeFirst()
        }
        while let last = input.last, trailingPunctuation.contains(last) {
            input.removeLast()
        }
        var value = input

        let lower = value.lowercased()
        if lower.hasPrefix("http://") || lower.hasPrefix("https://") {
            guard let url = URLComponents(string: value), let host = url.host, !host.isEmpty else {
                return Entry(input: input, kind: .invalid, value: input, reason: "Not a URL that could be read.")
            }
            /* A profile link (bsky.app and every client that kept its
               routes) names the account in its path; any other link names it
               by its host. */
            let segments = url.percentEncodedPath.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
            if segments.count >= 3, segments[0].isEmpty, segments[1] == "profile", !segments[2].isEmpty {
                value = segments[2].removingPercentEncoding ?? segments[2]
            } else {
                value = host.lowercased()
            }
        }
        if value.lowercased().hasPrefix("at://") {
            value = String(value.dropFirst("at://".count))
        }
        if value.hasPrefix("@") {
            value.removeFirst()
        }
        value = value.split(separator: "/", omittingEmptySubsequences: false).first.map(String.init) ?? ""

        if value.lowercased().hasPrefix("did:") {
            if HandleDebug.isDid(value) {
                return Entry(input: input, kind: .did, value: value)
            }
            return Entry(input: input, kind: .invalid, value: input, reason: "Not a valid did:plc or did:web identifier.")
        }
        var handle = value
        if handle.hasSuffix(".") {
            handle.removeLast()
        }
        handle = handle.lowercased()
        if let problem = HandleDebug.syntaxProblem(handle) {
            return Entry(input: input, kind: .invalid, value: input, reason: problem)
        }
        return Entry(input: input, kind: .handle, value: handle)
    }

    public struct IdentifierList: Hashable, Sendable {
        public var entries: [Entry]
        /// Entries left out because the same identifier was already in the list.
        public var duplicates: Int
        /// Entries left out because the list ran past the cap.
        public var dropped: Int

        public init(entries: [Entry] = [], duplicates: Int = 0, dropped: Int = 0) {
            self.entries = entries
            self.duplicates = duplicates
            self.dropped = dropped
        }
    }

    /// Split pasted text into identifiers: one per line, or separated by
    /// commas, semicolons or spaces. The first mention of each is kept, in
    /// the order given, up to `max` (`parseIdentifierList`).
    public static func parseList(_ text: String, max: Int = BulkResolve.maxIdentifiers) -> IdentifierList {
        var seen = Set<String>()
        var list = IdentifierList()
        let tokens = text.split(whereSeparator: { $0.isWhitespace || $0 == "," || $0 == ";" })
        for token in tokens {
            let entry = readIdentifier(String(token))
            if entry.input.isEmpty { continue }
            if seen.contains(entry.key) {
                list.duplicates += 1
                continue
            }
            if list.entries.count >= max {
                list.dropped += 1
                continue
            }
            seen.insert(entry.key)
            list.entries.append(entry)
        }
        return list
    }

    /// The list as it goes in the link (`?list=`), or nil when it is too
    /// long to keep there (`listForQuery`).
    public static func listForQuery(_ entries: [Entry]) -> String? {
        let joined = entries.map { $0.kind == .invalid ? $0.input : $0.value }.joined(separator: ",")
        return joined.utf16.count <= maxQueryLength ? joined : nil
    }

    // MARK: Rows

    /// What a resolver found for one identifier (`ResolveOutcome`).
    public struct Outcome: Hashable, Sendable {
        public var did: String
        /// The account's handle, `handle.invalid` when it does not verify,
        /// or nil when it has none.
        public var handle: String?
        /// The PDS endpoint, as a URL.
        public var pds: String?

        public init(did: String, handle: String? = nil, pds: String? = nil) {
            self.did = did
            self.handle = handle
            self.pds = pds
        }
    }

    public enum Flag: String, Hashable, Sendable {
        /// The DID document lists no handle.
        case noHandle = "no-handle"
        /// The handle the DID lists does not point back at it.
        case handleInvalid = "handle-invalid"
        /// A handle was given, and the DID it resolves to now goes by another.
        case handleDiffers = "handle-differs"
        /// The DID document names no PDS.
        case noPds = "no-pds"
    }

    public enum RowState: String, Hashable, Sendable {
        case pending
        case resolved
        case unresolved
        case invalid
    }

    public struct Row: Hashable, Sendable, Identifiable {
        public var entry: Entry
        public var state: RowState
        public var did: String?
        public var handle: String?
        public var pds: String?
        public var flags: [Flag]

        public init(entry: Entry, state: RowState, did: String? = nil, handle: String? = nil, pds: String? = nil, flags: [Flag] = []) {
            self.entry = entry
            self.state = state
            self.did = did
            self.handle = handle
            self.pds = pds
            self.flags = flags
        }

        public var id: String { entry.key }
        public var input: String { entry.input }
        public var kind: Kind { entry.kind }
        public var value: String { entry.value }
        public var reason: String? { entry.reason }
    }

    /// The row for an entry not resolved yet (`pendingRow`).
    public static func pendingRow(_ entry: Entry) -> Row {
        Row(entry: entry, state: entry.kind == .invalid ? .invalid : .pending)
    }

    /// Turn what a resolver found into a row, with whatever is worth
    /// flagging about it (`classifyRow`).
    public static func classifyRow(_ entry: Entry, outcome: Outcome?) -> Row {
        if entry.kind == .invalid { return pendingRow(entry) }
        guard let outcome else { return Row(entry: entry, state: .unresolved) }

        var flags: [Flag] = []
        var handle: String?
        if let found = outcome.handle, !found.isEmpty {
            handle = found.lowercased()
        }
        if handle == nil {
            flags.append(.noHandle)
        } else if handle == "handle.invalid" {
            flags.append(.handleInvalid)
        } else if entry.kind == .handle, handle != entry.value {
            flags.append(.handleDiffers)
        }
        if outcome.pds == nil || outcome.pds == "" {
            flags.append(.noPds)
        }
        return Row(
            entry: entry,
            state: .resolved,
            did: outcome.did,
            handle: handle == "handle.invalid" ? nil : handle,
            pds: outcome.pds,
            flags: flags
        )
    }

    public struct RowStatus: Hashable, Sendable {
        public enum Tone: String, Hashable, Sendable {
            case pass
            case warn
            case fail
        }

        public var tone: Tone?
        public var label: String
        /// More to say than the label holds.
        public var note: String?

        public init(tone: Tone? = nil, label: String, note: String? = nil) {
            self.tone = tone
            self.label = label
            self.note = note
        }
    }

    /// A row's outcome in a word or two, and a sentence when it needs one
    /// (`rowStatus`).
    public static func rowStatus(_ row: Row) -> RowStatus {
        switch row.state {
        case .pending:
            return RowStatus(label: "Resolving")
        case .invalid:
            return RowStatus(tone: .fail, label: "Not an identifier", note: row.reason)
        case .unresolved:
            if row.kind == .handle {
                return RowStatus(tone: .fail, label: "Does not resolve", note: "No DNS record or well-known file names a DID for this handle.")
            }
            return RowStatus(tone: .fail, label: "DID not found", note: "No DID document could be found for this DID.")
        case .resolved:
            break
        }
        if row.flags.contains(.handleInvalid) {
            return RowStatus(tone: .warn, label: "Handle not verified", note: "The DID lists a handle that does not point back at it.")
        }
        if row.flags.contains(.handleDiffers) {
            return RowStatus(tone: .warn, label: "Handle differs", note: "This handle resolves to a DID that now goes by \(row.handle ?? "another handle").")
        }
        if row.flags.contains(.noHandle) {
            return RowStatus(tone: .warn, label: "No handle", note: "The DID document lists no handle.")
        }
        if row.flags.contains(.noPds) {
            return RowStatus(tone: .warn, label: "No PDS", note: "The DID document names no PDS.")
        }
        return RowStatus(tone: .pass, label: "Resolved")
    }

    /// The host of a PDS endpoint, for the table and the explorer link
    /// (`pdsHost`).
    public static func pdsHost(_ pds: String?) -> String? {
        guard let pds, !pds.isEmpty else { return nil }
        let host = PDSServer.pdsHostname(pds)
        return host.isEmpty ? nil : host
    }

    public struct Counts: Hashable, Sendable {
        public var total = 0
        public var settled = 0
        public var resolved = 0
        public var failed = 0
        public var flagged = 0

        public init(total: Int = 0, settled: Int = 0, resolved: Int = 0, failed: Int = 0, flagged: Int = 0) {
            self.total = total
            self.settled = settled
            self.resolved = resolved
            self.failed = failed
            self.flagged = flagged
        }
    }

    public static func countRows(_ rows: [Row]) -> Counts {
        var counts = Counts(total: rows.count)
        for row in rows {
            if row.state != .pending { counts.settled += 1 }
            if row.state == .resolved {
                counts.resolved += 1
                if !row.flags.isEmpty { counts.flagged += 1 }
            } else if row.state != .pending {
                counts.failed += 1
            }
        }
        return counts
    }

    // MARK: Export

    private static let csvColumns = ["input", "did", "handle", "pds", "status"]

    /// `^[=+\-@\t\r]`: what a spreadsheet reads as the start of a formula.
    private static let formulaStarts: Set<Unicode.Scalar> = ["=", "+", "-", "@", "\t", "\r"]

    /// One CSV cell. Quoted when it holds a comma, a quote or a line break,
    /// and given a leading apostrophe when it starts with a character a
    /// spreadsheet would run as a formula: the list is pasted from anywhere,
    /// and `@name` or `=cmd` in a cell should stay text when the file is
    /// opened.
    static func csvCell(_ value: String) -> String {
        var safe = value
        if let first = value.unicodeScalars.first, formulaStarts.contains(first) {
            safe = "'" + value
        }
        let needsQuotes = safe.unicodeScalars.contains { $0 == "\"" || $0 == "," || $0 == "\r" || $0 == "\n" }
        guard needsQuotes else { return safe }
        return "\"" + safe.replacingOccurrences(of: "\"", with: "\"\"") + "\""
    }

    /// The table as CSV, CRLF line endings, a header row first (`rowsToCsv`).
    public static func rowsToCsv(_ rows: [Row]) -> String {
        var lines = [csvColumns.joined(separator: ",")]
        for row in rows {
            let cells = [row.input, row.did ?? "", row.handle ?? "", row.pds ?? "", rowStatus(row).label]
            lines.append(cells.map(csvCell).joined(separator: ","))
        }
        return lines.joined(separator: "\r\n") + "\r\n"
    }

    /// The table as JSON, the CSV's columns in the CSV's order, indented as
    /// `JSON.stringify(rows, null, 2)` writes it (`rowsToJson`).
    public static func rowsToJson(_ rows: [Row]) -> String {
        guard !rows.isEmpty else { return "[]" }
        let objects = rows.map { row -> String in
            let fields: [(String, String?)] = [
                ("input", row.input),
                ("did", row.did),
                ("handle", row.handle),
                ("pds", row.pds),
                ("status", rowStatus(row).label),
            ]
            let members = fields.map { field -> String in
                let encoded = field.1.map { JSONValue.string($0).compactString() } ?? "null"
                return "    \"\(field.0)\": \(encoded)"
            }
            return "  {\n" + members.joined(separator: ",\n") + "\n  }"
        }
        return "[\n" + objects.joined(separator: ",\n") + "\n]"
    }
}

/// The bulk resolver's lookups, port of `resolveOne` in
/// src/components/tools/BulkResolver.tsx.
///
/// Slingshot answers both directions in one request and verifies a handle
/// against its DID document, so it is asked first. It only knows what it can
/// reach, though, so a miss is put to the sources directly before the row is
/// called unresolved: the AppView and bsky.social for the handle, then the
/// DID document for the rest.
public struct BulkResolveClient: Sendable {
    private let slingshot: SlingshotClient
    private let resolver: IdentityResolver

    public init(http: HTTPClient = .shared, resolver: IdentityResolver? = nil) {
        slingshot = SlingshotClient(http: http)
        self.resolver = resolver ?? (http === HTTPClient.shared ? IdentityResolver.shared : IdentityResolver(http: http))
    }

    /// What one identifier resolves to, or nil when it does not.
    public func resolve(_ entry: BulkResolve.Entry) async -> BulkResolve.Outcome? {
        guard entry.kind != .invalid else { return nil }
        if let mini = await slingshot.resolveMiniDoc(entry.value) {
            return BulkResolve.Outcome(did: mini.did, handle: mini.handle, pds: mini.pds.isEmpty ? nil : mini.pds)
        }
        if Task.isCancelled { return nil }

        let did: String
        if entry.kind == .did {
            did = entry.value
        } else {
            guard let resolved = await resolver.resolveHandle(entry.value) else { return nil }
            did = resolved
        }
        guard did.hasPrefix("did:") else { return nil }
        do {
            let document = try await resolver.loadDIDDocument(did)
            return BulkResolve.Outcome(
                did: did,
                handle: HandleDebug.handles(fromAlsoKnownAs: document.alsoKnownAs).first,
                pds: HandleDebug.serviceEndpoint(document, fragment: "#atproto_pds")
            )
        } catch {
            /* A handle that names a DID nobody can find a document for
               still resolved, as far as it goes. A DID with no document did
               not. */
            return entry.kind == .handle ? BulkResolve.Outcome(did: did) : nil
        }
    }
}
