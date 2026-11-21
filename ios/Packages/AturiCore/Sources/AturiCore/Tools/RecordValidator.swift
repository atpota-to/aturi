import Foundation

// Port of src/lib/tools/validate.ts, validateInput.ts and validateRun.ts:
// the record validator, which checks a record against its lexicon. Every
// required field present, every value of the type and within the limits
// the schema gives.
//
// The schema is whatever the lexicon's author published, read as data, so
// nothing here trusts its shape. A definition this does not understand is
// reported as not checked rather than passed or failed.
//
// It follows the lexicon and data model specs with one deliberate limit: a
// `ref` or `union` that names another lexicon can only be checked when that
// lexicon was found too. `check(record:nsid:rkey:lookup:)` fetches them as
// they turn out to be needed and hands them in; a reference that could not
// be found is listed as unchecked, since "we could not look" must not read
// as "it is fine".
//
// Two differences from the web come from `JSONValue`: an object's keys are
// unordered, so a schema's properties (and a record's fields) are walked in
// sorted order rather than as written, which only changes the order issues
// are listed in; and numbers are doubles, as they are in JavaScript, so
// "is an integer" means "has no fractional part".

public enum RecordValidator {
    public enum Severity: String, Hashable, Sendable {
        /// The record breaks the schema.
        case error
        /// Allowed, but probably not meant: an unknown value where the schema lists known ones.
        case warning
    }

    public struct Issue: Hashable, Sendable {
        /// Where in the record, as a path: `facets[0].index.byteStart`. Empty for the record itself.
        public let path: String
        public let severity: Severity
        public let message: String

        public init(path: String, severity: Severity, message: String) {
            self.path = path
            self.severity = severity
            self.message = message
        }
    }

    /// What one validation found: the web's `ValidationResult`.
    public struct Report: Hashable, Sendable {
        public let issues: [Issue]
        /// Lexicons the schema refers to that were not available, so parts
        /// went unchecked: an NSID, or `nsid#def` for a definition missing
        /// from a document that was found.
        public let unresolved: [String]
        /// How many values were checked against a definition, as a rough measure of coverage.
        public let checked: Int

        public init(issues: [Issue], unresolved: [String], checked: Int) {
            self.issues = issues
            self.unresolved = unresolved
            self.checked = checked
        }

        public var errors: [Issue] { issues.filter { $0.severity == .error } }
        public var warnings: [Issue] { issues.filter { $0.severity == .warning } }
    }

    /// Stop walking past this depth: a schema that refers to itself must not loop on a hostile record.
    static let maxDepth = 32
    /// Stop reporting past this many issues: a wrong `$type` can produce one per field.
    static let maxIssues = 200

    // MARK: - String measures and formats

    public static func utf8Length(_ text: String) -> Int {
        text.utf8.count
    }

    /// User-perceived characters, which is what `maxGraphemes` counts: a
    /// Swift `Character` is an extended grapheme cluster, the unit
    /// `Intl.Segmenter` counts on the web.
    public static func graphemeLength(_ text: String) -> Int {
        text.count
    }

    static func isDid(_ value: String) -> Bool {
        value.utf16.count <= 2048 && value.wholeMatch(of: validatorDidPattern) != nil
    }

    static func isHandle(_ value: String) -> Bool {
        isHandleSyntax(value.lowercased())
    }

    static func isAtUri(_ value: String) -> Bool {
        if value.utf16.count > 8192 { return false }
        guard let match = value.wholeMatch(of: validatorAtUriPattern) else { return false }
        let authority = String(match.output.1)
        if !isDid(authority) && !isHandle(authority) { return false }
        if let collection = match.output.2, String(collection).wholeMatch(of: validatorNsidPattern) == nil {
            return false
        }
        if let rkey = match.output.3 {
            return String(rkey).wholeMatch(of: validatorRecordKeyPattern) != nil
        }
        return true
    }

    static func isDatetime(_ value: String) -> Bool {
        if value.wholeMatch(of: validatorDatetimePattern) == nil { return false }
        // "-00:00" is the one offset the spec rules out by name.
        if value.hasSuffix("-00:00") { return false }
        return Formatting.isoDate(value) != nil
    }

    /// Why `value` is not a valid string of `format`, or nil when it is (or the format is unknown).
    public static func formatProblem(_ format: String, _ value: String) -> String? {
        switch format {
        case "at-identifier":
            return isDid(value) || isHandle(value) ? nil : "must be a DID or a handle"
        case "at-uri":
            return isAtUri(value) ? nil : "must be an at:// URI"
        case "cid":
            return value.wholeMatch(of: validatorCidPattern) != nil ? nil : "must be a CID"
        case "datetime":
            return isDatetime(value)
                ? nil
                : "must be a datetime with seconds and a time zone, such as 2026-01-31T12:00:00.000Z"
        case "did":
            return isDid(value) ? nil : "must be a DID"
        case "handle":
            return isHandle(value) ? nil : "must be a handle"
        case "nsid":
            return value.utf16.count <= 317 && value.wholeMatch(of: validatorNsidPattern) != nil ? nil : "must be an NSID"
        case "tid":
            return value.wholeMatch(of: validatorTidPattern) != nil ? nil : "must be a TID"
        case "record-key":
            return value.wholeMatch(of: validatorRecordKeyPattern) != nil && value != "." && value != ".."
                ? nil
                : "must be a valid record key"
        case "uri":
            return value.utf16.count <= 8192 && value.wholeMatch(of: validatorUriPattern) != nil ? nil : "must be a URI"
        case "language":
            return value.wholeMatch(of: validatorLanguagePattern) != nil ? nil : "must be a language tag, such as en or pt-BR"
        default:
            return nil
        }
    }

    /// The handle grammar of `handleSyntaxProblem` in src/lib/tools/handle.ts,
    /// as a yes or no: dot-separated labels of lower-case letters, digits
    /// and inner hyphens, a TLD that does not start with a digit and is not
    /// one the spec rules out.
    static func isHandleSyntax(_ handle: String) -> Bool {
        if handle.utf16.count > 253 { return false }
        let labels = handle.split(separator: ".", omittingEmptySubsequences: false)
        if labels.count < 2 { return false }
        let letters: ClosedRange<Unicode.Scalar> = "a"..."z"
        let digits: ClosedRange<Unicode.Scalar> = "0"..."9"
        for label in labels {
            if label.isEmpty || label.utf16.count > 63 { return false }
            let allowed = label.unicodeScalars.allSatisfy { scalar in
                letters.contains(scalar) || digits.contains(scalar) || scalar == "-"
            }
            if !allowed { return false }
            if label.hasPrefix("-") || label.hasSuffix("-") { return false }
        }
        let tld = String(labels[labels.count - 1])
        if let first = tld.unicodeScalars.first, digits.contains(first) { return false }
        return !disallowedTlds.contains(tld)
    }

    /// TLDs the handle spec rules out: none of them resolve on the public internet.
    static let disallowedTlds: Set<String> = ["alt", "arpa", "example", "internal", "invalid", "local", "localhost", "onion"]

    // MARK: - Finding definitions

    /// A reference as a schema spells it (`#def`, `nsid`, `nsid#def`), read
    /// against the document it appears in. `parseLexiconRef` in
    /// src/lib/lexiconSchema.ts.
    public struct LexiconRef: Hashable, Sendable {
        public let nsid: String
        /// `main` when the ref names a whole lexicon.
        public let def: String
        /// In the document being read.
        public let local: Bool

        public init(nsid: String, def: String, local: Bool) {
            self.nsid = nsid
            self.def = def
            self.local = local
        }
    }

    public static func parseLexiconRef(_ raw: String, docId: String) -> LexiconRef {
        let nsid: String
        let def: String
        if let hash = raw.firstIndex(of: "#") {
            nsid = hash == raw.startIndex ? docId : String(raw[..<hash])
            let rest = String(raw[raw.index(after: hash)...])
            def = rest.isEmpty ? "main" : rest
        } else {
            nsid = raw
            def = "main"
        }
        return LexiconRef(nsid: nsid, def: def, local: nsid == docId)
    }

    static func defsOf(_ doc: JSONValue?) -> [String: JSONValue]? {
        doc?["defs"]?.objectValue
    }

    static func asStrings(_ value: JSONValue?) -> [String] {
        (value?.arrayValue ?? []).compactMap { $0.stringValue }
    }

    /// Every other lexicon a document refers to, each once.
    public static func referencedLexicons(_ doc: JSONValue, id: String) -> [String] {
        var found: [String] = []
        var seen = Set<String>()
        func visit(_ node: JSONValue, _ depth: Int) {
            if depth > maxDepth { return }
            switch node {
            case .array(let items):
                for item in items { visit(item, depth + 1) }
            case .object(let members):
                var refs: [String] = []
                let type = members["type"]?.stringValue
                if type == "ref", let ref = members["ref"]?.stringValue {
                    refs = [ref]
                } else if type == "union" {
                    refs = asStrings(members["refs"])
                }
                for raw in refs {
                    let ref = parseLexiconRef(raw, docId: id)
                    if !ref.local && ref.nsid != id && seen.insert(ref.nsid).inserted {
                        found.append(ref.nsid)
                    }
                }
                for key in members.keys.sorted() {
                    if let child = members[key] { visit(child, depth + 1) }
                }
            default:
                return
            }
        }
        if let defs = doc["defs"] { visit(defs, 0) }
        return found
    }

    // MARK: - The walk

    private final class Context {
        /// Lexicons by NSID. `.null` marks one that was looked for and not found.
        let docs: [String: JSONValue]
        var issues: [Issue] = []
        var unresolved: [String] = []
        var unresolvedSeen = Set<String>()
        var checked = 0

        init(docs: [String: JSONValue]) {
            self.docs = docs
        }

        func report(_ path: String, _ message: String, _ severity: Severity = .error) {
            if issues.count >= RecordValidator.maxIssues { return }
            issues.append(Issue(path: path, severity: severity, message: message))
        }

        func addUnresolved(_ entry: String) {
            if unresolvedSeen.insert(entry).inserted {
                unresolved.append(entry)
            }
        }
    }

    /// What a value is, in words, for "but is …".
    static func describe(_ value: JSONValue) -> String {
        switch value {
        case .null: return "null"
        case .array: return "an array"
        case .object: return "an object"
        case .string: return "a string"
        case .number(let number): return isInteger(number) ? "an integer" : "a decimal number"
        case .bool: return "a boolean"
        }
    }

    /// `Number.isInteger`.
    static func isInteger(_ number: Double) -> Bool {
        number.isFinite && number.rounded(.towardZero) == number
    }

    /// A number as JavaScript prints it in a template string: no `.0` on an integer.
    static func numberText(_ number: Double) -> String {
        if isInteger(number), abs(number) < 1e15 { return String(Int64(number)) }
        return String(number)
    }

    /// `String(value)` for a JSON value, `undefined` included.
    static func jsString(_ value: JSONValue?) -> String {
        guard let value else { return "undefined" }
        switch value {
        case .null: return "null"
        case .string(let text): return text
        case .number(let number): return numberText(number)
        case .bool(let flag): return flag ? "true" : "false"
        case .array(let items):
            return items.map { item in item.isNull ? "" : jsString(item) }.joined(separator: ",")
        case .object: return "[object Object]"
        }
    }

    static func join(_ path: String, _ key: String) -> String {
        path.isEmpty ? key : "\(path).\(key)"
    }

    static func join(_ path: String, index: Int) -> String {
        "\(path)[\(index)]"
    }

    /// Whether an object has a key at all, which is what `=== undefined` asks.
    static func has(_ members: [String: JSONValue], _ key: String) -> Bool {
        members.index(forKey: key) != nil
    }

    /// The definition a ref names, or nil with the reason recorded.
    private static func resolveRef(_ ctx: Context, _ raw: String, docId: String) -> (def: JSONValue, docId: String)? {
        let ref = parseLexiconRef(raw, docId: docId)
        guard let doc = ctx.docs[ref.nsid], !doc.isNull else {
            ctx.addUnresolved(ref.nsid)
            return nil
        }
        guard let def = defsOf(doc)?[ref.def], def.objectValue != nil else {
            ctx.addUnresolved("\(ref.nsid)#\(ref.def)")
            return nil
        }
        return (def, ref.nsid)
    }

    /// `$type` as a union ref would spell it: `com.example.thing` or `com.example.thing#part`.
    static func normalizeType(_ type: String) -> String {
        type.hasSuffix("#main") ? String(type.dropLast("#main".count)) : type
    }

    private static func checkString(_ ctx: Context, _ def: [String: JSONValue], _ value: JSONValue, _ path: String) {
        guard case .string(let text) = value else {
            ctx.report(path, "must be a string, but is \(describe(value))")
            return
        }
        if let constant = def["const"]?.stringValue, text != constant {
            ctx.report(path, "must be exactly \"\(constant)\"")
        }
        let allowed = asStrings(def["enum"])
        if !allowed.isEmpty && !allowed.contains(text) {
            let listed = allowed.map { "\"\($0)\"" }.joined(separator: ", ")
            ctx.report(path, "must be one of \(listed)")
        }
        let known = asStrings(def["knownValues"])
        if !known.isEmpty && !known.contains(text) {
            ctx.report(path, "\"\(text)\" is not one of the values the schema lists, though others are allowed", .warning)
        }
        if let format = def["format"]?.stringValue, let problem = formatProblem(format, text) {
            ctx.report(path, "\(problem) (format \(format))")
        }
        let maxLength = def["maxLength"]?.doubleValue
        let minLength = def["minLength"]?.doubleValue
        if maxLength != nil || minLength != nil {
            let bytes = utf8Length(text)
            if let maxLength, Double(bytes) > maxLength {
                ctx.report(path, "is \(bytes) bytes long, over the limit of \(numberText(maxLength))")
            }
            if let minLength, Double(bytes) < minLength {
                ctx.report(path, "is \(bytes) bytes long, under the minimum of \(numberText(minLength))")
            }
        }
        let maxGraphemes = def["maxGraphemes"]?.doubleValue
        let minGraphemes = def["minGraphemes"]?.doubleValue
        if maxGraphemes != nil || minGraphemes != nil {
            let graphemes = graphemeLength(text)
            if let maxGraphemes, Double(graphemes) > maxGraphemes {
                ctx.report(path, "is \(graphemes) characters long, over the limit of \(numberText(maxGraphemes))")
            }
            if let minGraphemes, Double(graphemes) < minGraphemes {
                ctx.report(path, "is \(graphemes) characters long, under the minimum of \(numberText(minGraphemes))")
            }
        }
    }

    private static func checkInteger(_ ctx: Context, _ def: [String: JSONValue], _ value: JSONValue, _ path: String) {
        guard case .number(let number) = value, isInteger(number) else {
            ctx.report(path, "must be an integer, but is \(describe(value))")
            return
        }
        if let constant = def["const"]?.doubleValue, number != constant {
            ctx.report(path, "must be exactly \(numberText(constant))")
        }
        let allowed = (def["enum"]?.arrayValue ?? []).compactMap { $0.doubleValue }
        if !allowed.isEmpty && !allowed.contains(number) {
            ctx.report(path, "must be one of \(allowed.map(numberText).joined(separator: ", "))")
        }
        if let minimum = def["minimum"]?.doubleValue, number < minimum {
            ctx.report(path, "is \(numberText(number)), under the minimum of \(numberText(minimum))")
        }
        if let maximum = def["maximum"]?.doubleValue, number > maximum {
            ctx.report(path, "is \(numberText(number)), over the maximum of \(numberText(maximum))")
        }
    }

    private static func checkBlob(_ ctx: Context, _ def: [String: JSONValue], _ value: JSONValue, _ path: String) {
        guard case .object(let blob) = value else {
            ctx.report(path, "must be a blob, but is \(describe(value))")
            return
        }
        // The form before blobs carried a $type: just a CID and a MIME type.
        let legacy = blob["cid"]?.stringValue != nil && blob["mimeType"]?.stringValue != nil && !has(blob, "$type")
        if legacy {
            ctx.report(path, "uses the older blob form (cid and mimeType with no $type); it is still accepted", .warning)
        } else {
            if blob["$type"]?.stringValue != "blob" {
                ctx.report(path, #"must be a blob: an object with $type "blob""#)
            }
            if blob["ref"]?["$link"]?.stringValue == nil {
                ctx.report(join(path, "ref"), #"must be a CID link, { "$link": "…" }"#)
            }
            if blob["mimeType"]?.stringValue == nil {
                ctx.report(join(path, "mimeType"), "must be a string")
            }
            var sizeIsInteger = false
            if let size = blob["size"]?.doubleValue {
                sizeIsInteger = isInteger(size)
            }
            if !sizeIsInteger {
                ctx.report(join(path, "size"), "must be an integer")
            }
        }
        let accept = asStrings(def["accept"])
        if let mime = blob["mimeType"]?.stringValue, !mime.isEmpty, !accept.isEmpty {
            let ok = accept.contains { pattern in
                pattern == "*/*" || pattern == mime || (pattern.hasSuffix("/*") && mime.hasPrefix(String(pattern.dropLast())))
            }
            if !ok {
                ctx.report(join(path, "mimeType"), "is \(mime), but the schema accepts \(accept.joined(separator: ", "))")
            }
        }
        if let maxSize = def["maxSize"]?.doubleValue, let size = blob["size"]?.doubleValue, size > maxSize {
            ctx.report(join(path, "size"), "is \(numberText(size)) bytes, over the limit of \(numberText(maxSize))")
        }
    }

    private static func checkObject(
        _ ctx: Context,
        _ def: [String: JSONValue],
        _ value: JSONValue,
        _ path: String,
        _ docId: String,
        _ depth: Int
    ) {
        guard case .object(let members) = value else {
            ctx.report(path, "must be an object, but is \(describe(value))")
            return
        }
        let properties = def["properties"]?.objectValue ?? [:]
        let nullable = Set(asStrings(def["nullable"]))
        for name in asStrings(def["required"]) where !has(members, name) {
            ctx.report(join(path, name), "is required, but missing")
        }
        for name in properties.keys.sorted() {
            guard let field = members[name] else { continue }
            if field.isNull {
                if !nullable.contains(name) {
                    ctx.report(join(path, name), "is null, but the schema does not allow null here")
                }
                continue
            }
            checkValue(ctx, properties[name], field, join(path, name), docId, depth + 1)
        }
    }

    /// Check one value against one definition.
    private static func checkValue(
        _ ctx: Context,
        _ def: JSONValue?,
        _ value: JSONValue,
        _ path: String,
        _ docId: String,
        _ depth: Int
    ) {
        guard depth <= maxDepth, ctx.issues.count < maxIssues, let schema = def?.objectValue else { return }
        ctx.checked += 1

        switch schema["type"]?.stringValue ?? "" {
        case "null":
            if !value.isNull {
                ctx.report(path, "must be null, but is \(describe(value))")
            }
        case "boolean":
            if case .bool(let flag) = value {
                if let constant = schema["const"]?.boolValue, flag != constant {
                    ctx.report(path, "must be \(constant ? "true" : "false")")
                }
            } else {
                ctx.report(path, "must be true or false, but is \(describe(value))")
            }
        case "integer":
            checkInteger(ctx, schema, value, path)
        case "string":
            checkString(ctx, schema, value, path)
        case "bytes":
            guard let encoded = value["$bytes"]?.stringValue, value.objectValue != nil else {
                ctx.report(path, #"must be bytes, { "$bytes": "<base64>" }"#)
                return
            }
            var stripped = Substring(encoded)
            while stripped.hasSuffix("=") { stripped = stripped.dropLast() }
            let length = (stripped.utf16.count * 3) / 4
            if let maxLength = schema["maxLength"]?.doubleValue, Double(length) > maxLength {
                ctx.report(path, "is \(length) bytes, over the limit of \(numberText(maxLength))")
            }
            if let minLength = schema["minLength"]?.doubleValue, Double(length) < minLength {
                ctx.report(path, "is \(length) bytes, under the minimum of \(numberText(minLength))")
            }
        case "cid-link":
            if let link = value["$link"]?.stringValue, value.objectValue != nil {
                if link.wholeMatch(of: validatorCidPattern) == nil {
                    ctx.report(join(path, "$link"), "must be a CID")
                }
            } else {
                ctx.report(path, #"must be a CID link, { "$link": "…" }"#)
            }
        case "blob":
            checkBlob(ctx, schema, value, path)
        case "array":
            guard case .array(let items) = value else {
                ctx.report(path, "must be an array, but is \(describe(value))")
                return
            }
            if let maxLength = schema["maxLength"]?.doubleValue, Double(items.count) > maxLength {
                ctx.report(path, "has \(items.count) items, over the limit of \(numberText(maxLength))")
            }
            if let minLength = schema["minLength"]?.doubleValue, Double(items.count) < minLength {
                ctx.report(path, "has \(items.count) items, under the minimum of \(numberText(minLength))")
            }
            for (index, item) in items.enumerated() {
                checkValue(ctx, schema["items"], item, join(path, index: index), docId, depth + 1)
            }
        case "object", "params":
            checkObject(ctx, schema, value, path, docId, depth)
        case "record":
            checkObject(ctx, schema["record"]?.objectValue ?? [:], value, path, docId, depth)
        case "token":
            // A token is a name to point at, never a value to hold.
            return
        case "unknown":
            if value.objectValue == nil {
                ctx.report(path, "must be an object, but is \(describe(value))")
            }
        case "ref":
            guard let raw = schema["ref"]?.stringValue else { return }
            if let target = resolveRef(ctx, raw, docId: docId) {
                checkValue(ctx, target.def, value, path, target.docId, depth + 1)
            }
        case "union":
            guard case .object(let members) = value else {
                ctx.report(path, "must be an object with a $type, but is \(describe(value))")
                return
            }
            guard let type = members["$type"]?.stringValue else {
                ctx.report(join(path, "$type"), "is required here, to say which of the allowed types this is")
                return
            }
            let wanted = normalizeType(type)
            let match = asStrings(schema["refs"]).first { raw in
                let ref = parseLexiconRef(raw, docId: docId)
                let spelled = ref.def == "main" ? ref.nsid : "\(ref.nsid)#\(ref.def)"
                return spelled == wanted
            }
            if let match {
                if let target = resolveRef(ctx, match, docId: docId) {
                    checkValue(ctx, target.def, value, path, target.docId, depth + 1)
                }
            } else if schema["closed"]?.boolValue == true {
                ctx.report(join(path, "$type"), "is \"\(type)\", which is not one of the types this field allows")
            }
            // An open union accepts types the schema has never heard of.
        default:
            return
        }
    }

    /// Numbers that are not integers have no place in the atproto data model.
    private static func findFloats(_ ctx: Context, _ value: JSONValue, _ path: String, _ depth: Int) {
        if depth > maxDepth { return }
        switch value {
        case .number(let number):
            if !isInteger(number) {
                ctx.report(path, "is \(numberText(number)); records can hold integers but not decimal numbers")
            }
        case .array(let items):
            for (index, item) in items.enumerated() {
                findFloats(ctx, item, join(path, index: index), depth + 1)
            }
        case .object(let members):
            for key in members.keys.sorted() {
                if let item = members[key] { findFloats(ctx, item, join(path, key), depth + 1) }
            }
        default:
            return
        }
    }

    /// Whether a record key fits the key type its lexicon declares.
    public static func recordKeyProblem(_ keyType: String?, rkey: String) -> String? {
        guard let keyType else { return nil }
        if keyType == "tid" {
            return rkey.wholeMatch(of: validatorTidPattern) != nil
                ? nil
                : "The schema asks for a TID record key; \"\(rkey)\" is not one."
        }
        if keyType == "nsid" {
            return rkey.wholeMatch(of: validatorNsidPattern) != nil
                ? nil
                : "The schema asks for an NSID record key; \"\(rkey)\" is not one."
        }
        if keyType.hasPrefix("literal:") {
            let literal = String(keyType.dropFirst("literal:".count))
            return rkey == literal
                ? nil
                : "The schema fixes the record key to \"\(literal)\"; this record\u{2019}s is \"\(rkey)\"."
        }
        return nil
    }

    /// Validate `record` as an instance of the lexicon `nsid`.
    ///
    /// `docs` holds that lexicon and as many of the ones it refers to as
    /// could be found, by NSID; map an NSID to `.null` to say it was looked
    /// for and is not published.
    public static func validate(
        record: JSONValue,
        nsid: String,
        docs: [String: JSONValue],
        rkey: String? = nil
    ) -> Report {
        let ctx = Context(docs: docs)
        let main = defsOf(docs[nsid])?["main"]

        guard case .object(let members) = record else {
            ctx.report("", "A record must be an object, but this is \(describe(record)).")
            return Report(issues: ctx.issues, unresolved: [], checked: 0)
        }
        if let type = members["$type"] {
            if type.stringValue != nsid {
                ctx.report("$type", "is \"\(jsString(type))\", but the record is being checked as \(nsid)")
            }
        } else {
            ctx.report("$type", "is required on a record, and names its lexicon")
        }

        if let mainDef = main?.objectValue {
            if mainDef["type"]?.stringValue != "record" {
                ctx.report("", "\(nsid) defines a \(jsString(mainDef["type"])), not a record type.")
            } else {
                checkValue(ctx, main, record, "", nsid, 0)
                if let rkey, !rkey.isEmpty, let problem = recordKeyProblem(mainDef["key"]?.stringValue, rkey: rkey) {
                    ctx.report("", problem)
                }
            }
        } else {
            ctx.addUnresolved(nsid)
        }
        findFloats(ctx, record, "", 0)

        return Report(issues: ctx.issues, unresolved: ctx.unresolved, checked: ctx.checked)
    }
}

// MARK: - Input (validateInput.ts)

extension RecordValidator {
    /// What was given to the record validator: the address of a record to
    /// fetch, or a record pasted as JSON.
    public enum Input: Hashable, Sendable {
        case uri(uri: String, repo: String, collection: String, rkey: String)
        case json(record: JSONValue, nsid: String)
        case error(reason: String)

        public var errorReason: String? {
            if case .error(let reason) = self { return reason }
            return nil
        }
    }

    /// Read the validator's input. Anything that starts with a brace is
    /// JSON; everything else goes through the explorer's own link reader, so
    /// the same at:// URIs and app links the search box accepts work here.
    public static func parseInput(_ raw: String) -> Input {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty { return .error(reason: "Paste a record as JSON, or the at:// URI of one.") }

        if text.hasPrefix("{") {
            let value: JSONValue
            do {
                value = try JSONValue.parse(Data(text.utf8))
            } catch {
                return .error(reason: "That is not valid JSON: \(jsonProblem(error)).")
            }
            guard case .object(let record) = value else {
                return .error(reason: "A record is a JSON object.")
            }
            // A getRecord response wraps the record; take what is inside.
            var inner = record
            if record["uri"]?.stringValue != nil, let wrapped = record["value"]?.objectValue {
                inner = wrapped
            }
            guard let nsid = inner["$type"]?.stringValue, !nsid.isEmpty else {
                return .error(
                    reason: "The record has no $type, so there is no lexicon to check it against. Add \"$type\": \"<the record\u{2019}s NSID>\"."
                )
            }
            return .json(record: .object(inner), nsid: nsid)
        }

        let path = SearchRouting.resolveSearchPath(text) ?? ""
        let parts = path.split(separator: "/", omittingEmptySubsequences: false).map(String.init)
        // `^/explore/([^/]+)/([^/]+)/([^/]+)$`: a leading empty part, then four.
        guard parts.count == 5, parts[0].isEmpty, parts[1] == "explore",
            !parts[2].isEmpty, !parts[3].isEmpty, !parts[4].isEmpty
        else {
            return .error(
                reason: "That does not point at one record. Use an at:// URI with a collection and a record key, or a link to a record."
            )
        }
        let repo = parts[2].removingPercentEncoding ?? parts[2]
        let collection = parts[3].removingPercentEncoding ?? parts[3]
        let rkey = parts[4].removingPercentEncoding ?? parts[4]
        return .uri(uri: "at://\(repo)/\(collection)/\(rkey)", repo: repo, collection: collection, rkey: rkey)
    }

    /// What the JSON parser said, as close to a sentence as it gives: the
    /// underlying error's description ("Unexpected character … around line
    /// 2, column 5"), without its closing full stop.
    static func jsonProblem(_ error: Error) -> String {
        var detail: String?
        if let decoding = error as? DecodingError, case .dataCorrupted(let context) = decoding {
            // Through `Any`, so the cast reads the same on Darwin, where every
            // error bridges, and on Linux, where only an NSError is one.
            if let underlying = context.underlyingError,
                let bridged = (underlying as Any) as? NSError,
                let description = bridged.userInfo["NSDebugDescription"] as? String {
                detail = description
            } else {
                detail = context.debugDescription
            }
        }
        var text = (detail ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
        while text.hasSuffix(".") { text.removeLast() }
        return text.isEmpty ? "it could not be parsed" : text
    }
}

// MARK: - The run (validateRun.ts)

extension RecordValidator {
    /// Rounds of "validate, then fetch what was missing". Refs rarely nest deeper than three.
    static let maxRounds = 6
    /// A ceiling on lookups for one record, whatever its schema asks for.
    static let maxLexicons = 40

    /// A record checked against the schemas its authors actually published.
    public struct Check: Hashable, Sendable {
        public let nsid: String
        /// How the record's own lexicon was found, or why it was not.
        public let schema: LexiconSchemaLookup.Answer
        public let report: Report
        /// Every lexicon consulted, in the order it was needed.
        public let lookups: [LexiconSchemaLookup.Answer]

        public init(nsid: String, schema: LexiconSchemaLookup.Answer, report: Report, lookups: [LexiconSchemaLookup.Answer]) {
            self.nsid = nsid
            self.schema = schema
            self.report = report
            self.lookups = lookups
        }

        public var verdict: Verdict {
            RecordValidator.verdict(self)
        }
    }

    public enum Verdict: String, Hashable, Sendable {
        /// Checked, nothing wrong.
        case valid
        /// Checked, with only warnings.
        case warnings
        case invalid
        /// No schema is published for this type, so there is nothing to check against.
        case noSchema = "no-schema"
    }

    public static func verdict(_ check: Check) -> Verdict {
        if !check.schema.isFound { return .noSchema }
        if check.report.issues.contains(where: { $0.severity == .error }) { return .invalid }
        return check.report.issues.isEmpty ? .valid : .warnings
    }

    /// Why a type has no schema to check against, in words.
    public static func noSchemaReason(_ schema: LexiconSchemaLookup.Answer) -> String {
        switch schema {
        case .noAuthority(_, let domain, let publisher):
            return "Nobody answers for this namespace: there is no _lexicon record on \(domain), and no account at \(publisher)."
        case .unpublished:
            return "The namespace has an owner, but no schema record has been published for this type."
        case .invalid:
            return "That type is not a valid NSID."
        case .found:
            return ""
        }
    }

    /// Validate a record against the schemas its authors published,
    /// fetching them as it goes.
    ///
    /// Schemas are fetched lazily. A lexicon can refer to dozens of others,
    /// but a given record only exercises a few of them: a post with no embed
    /// never reaches the embed lexicons. So the record is validated with
    /// what is in hand, the lexicons that turned out to be needed are looked
    /// up, and it is validated again, until nothing new is needed. The
    /// lookup keeps found schemas for an hour, so a second record of the
    /// same type costs nothing.
    public static func check(
        record: JSONValue,
        nsid: String,
        rkey: String? = nil,
        lookup: LexiconSchemaLookup = .shared
    ) async -> Check {
        var docs: [String: JSONValue] = [:]
        var lookups: [LexiconSchemaLookup.Answer] = []

        func absorb(_ answers: [LexiconSchemaLookup.Answer]) {
            for answer in answers {
                lookups.append(answer)
                docs[answer.nsid] = answer.doc ?? .null
            }
        }

        let first = await lookUp([nsid], with: lookup)
        absorb(first)
        var report = validate(record: record, nsid: nsid, docs: docs, rkey: rkey)
        var round = 0
        while round < maxRounds && !Task.isCancelled {
            // An unresolved entry is an NSID, or `nsid#def` for a definition
            // missing from a document already in hand; only the first kind
            // can be fetched.
            var seen = Set<String>()
            var wanted: [String] = []
            for entry in report.unresolved {
                let id = entry.components(separatedBy: "#").first ?? entry
                if !has(docs, id) && seen.insert(id).inserted {
                    wanted.append(id)
                }
            }
            wanted = Array(wanted.prefix(Swift.max(0, maxLexicons - docs.count)))
            if wanted.isEmpty { break }
            let answers = await lookUp(wanted, with: lookup)
            absorb(answers)
            report = validate(record: record, nsid: nsid, docs: docs, rkey: rkey)
            round += 1
        }

        return Check(nsid: nsid, schema: lookups.first ?? .invalid(nsid: nsid), report: report, lookups: lookups)
    }

    /// Look several NSIDs up at once, answers in the order asked.
    static func lookUp(_ nsids: [String], with lookup: LexiconSchemaLookup) async -> [LexiconSchemaLookup.Answer] {
        await withTaskGroup(
            of: (Int, LexiconSchemaLookup.Answer).self,
            returning: [LexiconSchemaLookup.Answer].self
        ) { group in
            for (index, nsid) in nsids.enumerated() {
                group.addTask {
                    let answer = await lookup.lookup(nsid)
                    return (index, answer)
                }
            }
            var answers = [LexiconSchemaLookup.Answer?](repeating: nil, count: nsids.count)
            while let (index, answer) = await group.next() {
                answers[index] = answer
            }
            return answers.compactMap { $0 }
        }
    }
}

// MARK: - Patterns (validate.ts)

private let validatorDidPattern = #/did:[a-z]+:[a-zA-Z0-9._:%-]*[a-zA-Z0-9._-]/#
private let validatorNsidPattern = #/[a-zA-Z](?:[a-zA-Z0-9-]{0,62})?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,62})?)+\.[a-zA-Z][a-zA-Z0-9]{0,62}/#
private let validatorTidPattern = #/[234567abcdefghij][234567abcdefghijklmnopqrstuvwxyz]{12}/#
private let validatorRecordKeyPattern = #/[a-zA-Z0-9_~.:-]{1,512}/#
private let validatorCidPattern = #/(?:b[a-z2-7]{20,}|Qm[1-9A-HJ-NP-Za-km-z]{44}|z[1-9A-HJ-NP-Za-km-z]{20,})/#
private let validatorLanguagePattern = #/(?:[a-zA-Z]{2,3}(?:-[a-zA-Z0-9]+)*|i-[a-zA-Z0-9-]+)/#
private let validatorUriPattern = #/[a-zA-Z][a-zA-Z0-9+.-]*:\S+/#
/// Digits spelled `[0-9]`: Swift's `\d` takes any Unicode digit, JavaScript's only ASCII.
private let validatorDatetimePattern = #/[0-9]{4}-[01][0-9]-[0-3][0-9]T[0-2][0-9]:[0-5][0-9]:[0-6][0-9](?:\.[0-9]{1,20})?(?:Z|[+-][0-2][0-9]:[0-5][0-9])/#
private let validatorAtUriPattern = #/at://([^/?#\s]+)(?:/([^/?#\s]+)(?:/([^/?#\s]+))?)?(?:#\S*)?/#
