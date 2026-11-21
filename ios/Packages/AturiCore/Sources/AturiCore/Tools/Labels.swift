import Foundation

/// The label checker's logic: what was asked about, which labelers to ask,
/// and how to read what comes back. Port of `src/lib/tools/labels.ts`.
///
/// A label is a signed statement by a labeler about an account or a record:
/// `{ src, uri, val }`, "this DID says this thing is `val`". Labelers are
/// independent, and an app only shows labels from the ones its user
/// subscribes to, so "what labels are on this?" has no single answer. The
/// checker asks Bluesky's AppView on behalf of every labeler in turn.
///
/// The AppView attaches labels to the profiles and posts it returns, limited
/// to the labelers named in the request's `atproto-accept-labelers` header.
/// Three things about that header were checked against the live service and
/// are encoded here rather than left to call sites:
///
///   - Only `api.bsky.app` reads it. `public.api.bsky.app` is the cached
///     front of the same service and answers every request as if the header
///     named Bluesky's own labeler and nothing else.
///   - One malformed entry makes the AppView ignore the whole header and fall
///     back to that default, so entries are validated before they are sent.
///   - Naming labelers replaces the default rather than adding to it, so
///     Bluesky's own labeler has to be listed like any other.
///
/// A labeler the AppView has never indexed is dropped without a word, and
/// nothing in the answer says which ones were honoured, so "no labels" from
/// an obscure labeler can also mean "not asked".
///
/// Everything here is pure. The requests are in `LabelsClient`.
///
/// Names follow the web's, in Swift's spelling: the SCREAMING_CASE constants
/// are lowerCamelCase statics, and the types sit inside this namespace so
/// `Label` cannot collide with SwiftUI's. Times are `Date`s where the web
/// passes milliseconds.
public enum Labels {
    /// Bluesky's own moderation service, moderation.bsky.app. The one
    /// labeler every Bluesky user is subscribed to and cannot turn off, so it
    /// is always checked first.
    public static let blueskyModerationDid = "did:plc:ar7c4by46qjdydhdevvrndac"

    /// The AppView host that honours `atproto-accept-labelers` (see above).
    public static let labelAppView = URL(string: "https://api.bsky.app")!

    /// The record a labeler declares itself with, at rkey `self`.
    public static let labelerCollection = "app.bsky.labeler.service"

    /// Labelers named per request. The AppView accepted three times this when
    /// tried, but twenty is the most the official client ever sends, and
    /// staying inside what the service sees every day is the polite place to
    /// be.
    public static let labelersPerRequest = 20

    /// Requests in flight at once during a scan of every labeler.
    public static let scanConcurrency = 3

    /// Labelers a person may add by hand, on top of Bluesky's.
    public static let maxAddedLabelers = 20

    static let postCollection = "app.bsky.feed.post"
    static let profileCollection = "app.bsky.actor.profile"

    // MARK: - What was asked about

    /// An account or a post, with the account still as typed (a handle or a DID).
    public enum LabelTarget: Hashable, Sendable {
        case account(actor: String)
        case post(actor: String, rkey: String)

        public var actor: String {
            switch self {
            case .account(let actor): return actor
            case .post(let actor, _): return actor
            }
        }
    }

    public enum LabelInput: Hashable, Sendable {
        case ok(LabelTarget)
        case invalid(reason: String)
    }

    /// The reason given for a record that is neither an account nor a post.
    public static let notLabelled =
        "Apps show labels on accounts and posts. Enter a handle, a DID, or a link to a post."

    /// `parseAccountToken` from `src/lib/streamMonitor.ts`: a DID, or a
    /// handle lowercased, from the way people paste one (with an `@`, or as
    /// the repo of an `at://` URI). Nil for anything else.
    static func parseAccountToken(_ input: String) -> String? {
        var value = input.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.hasPrefix("at://") {
            let rest = value.dropFirst("at://".count)
            value = String(rest.prefix { $0 != "/" })
        }
        if value.hasPrefix("@") {
            value.removeFirst()
        }
        if value.hasPrefix("did:") {
            return isValidDid(value) ? value : nil
        }
        let handle = value.lowercased()
        return isValidHandle(handle) ? handle : nil
    }

    private static func targetFrom(_ actor: String, collection: String? = nil, rkey: String? = nil) -> LabelInput {
        guard let account = parseAccountToken(actor) else {
            return .invalid(reason: "\u{201C}\(actor)\u{201D} is not a handle or a DID.")
        }
        if collection == nil || collection == "" || collection == profileCollection {
            return .ok(.account(actor: account))
        }
        if collection == postCollection, let rkey, !rkey.isEmpty {
            return .ok(.post(actor: account, rkey: rkey))
        }
        return .invalid(reason: notLabelled)
    }

    /// Read a handle, a DID, an at:// URI, or a profile or post link from any
    /// client the link resolver knows (bsky.app and the rest of that family).
    public static func parseSubjectInput(_ raw: String) -> LabelInput {
        let value = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty {
            return .invalid(reason: "Enter a handle, a DID, or a link to a post.")
        }
        let lower = value.lowercased()

        if lower.hasPrefix("at://") {
            guard let parsed = AtUri(parsing: value) else {
                return .invalid(reason: "That at:// URI could not be read.")
            }
            return targetFrom(parsed.repo, collection: parsed.collection, rkey: parsed.rkey)
        }

        if lower.hasPrefix("http://") || lower.hasPrefix("https://") {
            guard let url = URL(string: value), let host = url.host, !host.isEmpty else {
                return .invalid(reason: "That link could not be read.")
            }
            guard let match = matchSupportedUrl(url) else {
                return .invalid(
                    reason: "That link is not a profile or a post this tool recognises. Paste the handle instead."
                )
            }
            return targetFrom(match.parsed.handle, collection: match.parsed.collection, rkey: match.parsed.rkey)
        }

        return targetFrom(value)
    }

    /// A stable string for a target, to key a run on.
    public static func targetKey(_ target: LabelTarget) -> String {
        switch target {
        case .post(let actor, let rkey): return "post:\(actor)/\(rkey)"
        case .account(let actor): return "account:\(actor)"
        }
    }

    /// The target once its account is resolved: what the AppView is asked about.
    public enum LabelSubject: Hashable, Sendable {
        case account(did: String)
        case post(did: String, uri: String)

        public var did: String {
            switch self {
            case .account(let did): return did
            case .post(let did, _): return did
            }
        }
    }

    public static func subjectFor(_ target: LabelTarget, did: String) -> LabelSubject {
        switch target {
        case .account:
            return .account(did: did)
        case .post(_, let rkey):
            return .post(did: did, uri: "at://\(did)/\(postCollection)/\(rkey)")
        }
    }

    // MARK: - Which labelers to ask

    /// The labelers a person added, as the `labelers` query parameter holds them.
    public static func parseLabelersParam(_ raw: String) -> [String] {
        var out: [String] = []
        for part in raw.split(separator: ",", omittingEmptySubsequences: false) {
            guard let value = parseAccountToken(String(part)) else { continue }
            if !out.contains(value) {
                out.append(value)
            }
            if out.count >= maxAddedLabelers { break }
        }
        return out
    }

    /// Valid DIDs only, each once, in the order given.
    public static func cleanLabelerDids(_ dids: [String]) -> [String] {
        var seen = Set<String>()
        var out: [String] = []
        for did in dids where isValidDid(did) && !seen.contains(did) {
            seen.insert(did)
            out.append(did)
        }
        return out
    }

    /// The value of `atproto-accept-labelers` for a batch.
    public static func labelersHeader(_ dids: [String]) -> String {
        cleanLabelerDids(dids).joined(separator: ", ")
    }

    /// Split labelers into the batches one request each can carry.
    public static func batchLabelers(_ dids: [String], size: Int = Labels.labelersPerRequest) -> [[String]] {
        let clean = cleanLabelerDids(dids)
        guard size > 0 else { return clean.isEmpty ? [] : [clean] }
        return stride(from: 0, to: clean.count, by: size).map { start in
            Array(clean[start..<min(start + size, clean.count)])
        }
    }

    // MARK: - Reading labels

    /// One label. `neg` is false where the web leaves it undefined: an
    /// answer only ever carries `true` or nothing.
    public struct Label: Hashable, Sendable {
        /// The DID that applied it. The subject's own DID for a self-label.
        public var src: String
        /// What it is on: a DID for an account, an at:// URI for a record.
        public var uri: String
        public var cid: String?
        public var val: String
        /// When it was created.
        public var cts: String?
        /// When it stops applying.
        public var exp: String?
        /// True for a negation, which withdraws an earlier label of the same value.
        public var neg: Bool
        public var ver: Int?

        public init(
            src: String,
            uri: String,
            val: String,
            cid: String? = nil,
            cts: String? = nil,
            exp: String? = nil,
            neg: Bool = false,
            ver: Int? = nil
        ) {
            self.src = src
            self.uri = uri
            self.val = val
            self.cid = cid
            self.cts = cts
            self.exp = exp
            self.neg = neg
            self.ver = ver
        }
    }

    /// Keep what reads as a label; an upstream answer is not trusted to be one.
    public static func readLabels(_ raw: JSONValue?) -> [Label] {
        guard let entries = raw?.arrayValue else { return [] }
        var out: [Label] = []
        for entry in entries {
            guard entry.objectValue != nil,
                let src = entry["src"]?.stringValue,
                let uri = entry["uri"]?.stringValue,
                let val = entry["val"]?.stringValue
            else { continue }
            out.append(Label(
                src: src,
                uri: uri,
                val: val,
                cid: entry["cid"]?.stringValue,
                cts: entry["cts"]?.stringValue,
                exp: entry["exp"]?.stringValue,
                neg: entry["neg"]?.boolValue == true,
                ver: entry["ver"]?.intValue
            ))
        }
        return out
    }

    private static func labelKey(_ label: Label) -> String {
        "\(label.src)\n\(label.uri)\n\(label.val)"
    }

    /// Fold batches of labels into one list. The same label can arrive twice
    /// (the first check and a later scan both ask Bluesky's labeler), and a
    /// label is identified by who said what about which thing, so the newer
    /// statement replaces the older one, in the older one's place.
    public static func mergeLabels(_ existing: [Label], _ incoming: [Label]) -> [Label] {
        var order: [String] = []
        var byKey: [String: Label] = [:]
        for label in existing + incoming {
            let key = labelKey(label)
            if let held = byKey[key] {
                if (label.cts ?? "") >= (held.cts ?? "") {
                    byKey[key] = label
                }
            } else {
                order.append(key)
                byKey[key] = label
            }
        }
        return order.compactMap { byKey[$0] }
    }

    public static func isExpired(_ label: Label, now: Date) -> Bool {
        guard let exp = label.exp, let at = Formatting.isoDate(exp) else { return false }
        return at <= now
    }

    /// What a label is attached to, in words.
    public enum LabelScope: String, Hashable, Sendable {
        case account
        case profile
        case post
        case record
    }

    public static func labelScope(_ label: Label) -> LabelScope {
        if label.uri.hasPrefix("did:") { return .account }
        let collection = AtUri(parsing: label.uri)?.collection
        if collection == profileCollection { return .profile }
        if collection == postCollection { return .post }
        return .record
    }

    /// The labels one labeler applied. `isSelf` is the web's `self`, which
    /// Swift keeps for itself.
    public struct LabelGroup: Hashable, Sendable {
        /// The labeler's DID.
        public var src: String
        /// The subject labelled itself.
        public var isSelf: Bool
        public var labels: [Label]

        public init(src: String, isSelf: Bool, labels: [Label]) {
            self.src = src
            self.isSelf = isSelf
            self.labels = labels
        }
    }

    /// Labels by who applied them: the subject's own first, then Bluesky's
    /// labeler, then the rest with the most labels first. Within a group,
    /// newest first. Ties between labelers fall to plain string order where
    /// the web uses `localeCompare`; the two agree on DIDs.
    public static func groupLabels(_ labels: [Label], subjectDid: String) -> [LabelGroup] {
        var order: [String] = []
        var bySrc: [String: [Label]] = [:]
        for label in labels {
            if bySrc[label.src] == nil {
                order.append(label.src)
                bySrc[label.src] = []
            }
            bySrc[label.src]?.append(label)
        }
        let groups = order.map { src -> LabelGroup in
            let list = toolsStableSorted(bySrc[src] ?? []) { ($0.cts ?? "") > ($1.cts ?? "") }
            return LabelGroup(src: src, isSelf: src == subjectDid, labels: list)
        }
        let blueskyDid = blueskyModerationDid
        return toolsStableSorted(groups) { a, b in
            let rankA = a.src == subjectDid ? 0 : (a.src == blueskyDid ? 1 : 2)
            let rankB = b.src == subjectDid ? 0 : (b.src == blueskyDid ? 1 : 2)
            if rankA != rankB { return rankA < rankB }
            if a.labels.count != b.labels.count { return a.labels.count > b.labels.count }
            return a.src < b.src
        }
    }

    // MARK: - What a label means

    public struct LabelLocale: Hashable, Sendable {
        public var lang: String
        public var name: String
        public var description: String

        public init(lang: String, name: String, description: String) {
            self.lang = lang
            self.name = name
            self.description = description
        }
    }

    /// A labeler's definition of one of its values (`labelValueDefinition`).
    public struct LabelDefinition: Hashable, Sendable {
        public var identifier: String
        /// How loudly a client should show it: `alert`, `inform` or `none`.
        public var severity: String?
        /// What it hides: `content`, `media` or `none`.
        public var blurs: String?
        /// What a subscriber gets before changing anything: `hide`, `warn` or `ignore`.
        public var defaultSetting: String?
        public var adultOnly: Bool
        public var locales: [LabelLocale]

        public init(
            identifier: String,
            severity: String? = nil,
            blurs: String? = nil,
            defaultSetting: String? = nil,
            adultOnly: Bool = false,
            locales: [LabelLocale] = []
        ) {
            self.identifier = identifier
            self.severity = severity
            self.blurs = blurs
            self.defaultSetting = defaultSetting
            self.adultOnly = adultOnly
            self.locales = locales
        }
    }

    /// Read `policies.labelValueDefinitions` from a labeler's service view.
    public static func readDefinitions(_ raw: JSONValue?) -> [LabelDefinition] {
        guard let entries = raw?.arrayValue else { return [] }
        var out: [LabelDefinition] = []
        for def in entries {
            guard def.objectValue != nil, let identifier = def["identifier"]?.stringValue else { continue }
            var locales: [LabelLocale] = []
            for locale in def["locales"]?.arrayValue ?? [] {
                guard locale.objectValue != nil,
                    let lang = locale["lang"]?.stringValue,
                    let name = locale["name"]?.stringValue
                else { continue }
                locales.append(LabelLocale(lang: lang, name: name, description: locale["description"]?.stringValue ?? ""))
            }
            out.append(LabelDefinition(
                identifier: identifier,
                severity: def["severity"]?.stringValue,
                blurs: def["blurs"]?.stringValue,
                defaultSetting: def["defaultSetting"]?.stringValue,
                adultOnly: def["adultOnly"]?.boolValue == true,
                locales: locales
            ))
        }
        return out
    }

    public struct GlobalLabel: Hashable, Sendable {
        public var name: String
        public var description: String

        public init(name: String, description: String) {
            self.name = name
            self.description = description
        }
    }

    /// The label values the protocol itself defines, with what the labels
    /// guide says each does (atproto.com/guides/labels, "Global label
    /// values"). They need no definition from a labeler, and they are the
    /// only values an account may put on its own content.
    public static let globalLabels: [String: GlobalLabel] = [
        "!hide": GlobalLabel(
            name: "Hide",
            description: "Puts a warning on the content that cannot be clicked through, and filters it from listings. A subscriber cannot turn this off."
        ),
        "!warn": GlobalLabel(
            name: "Warn",
            description: "Puts a warning on the content that can be clicked through. A subscriber cannot turn this off."
        ),
        "!no-unauthenticated": GlobalLabel(
            name: "Signed-in users only",
            description: "Asks apps not to show the content to people who are not signed in."
        ),
        "porn": GlobalLabel(
            name: "Adult content",
            description: "Puts a warning on images, which can only be clicked through by adults who have enabled adult content."
        ),
        "sexual": GlobalLabel(
            name: "Sexually suggestive",
            description: "Handled like adult content, and meant for less explicit material."
        ),
        "graphic-media": GlobalLabel(
            name: "Graphic media",
            description: "Handled like adult content, and meant for violence and gore."
        ),
        "nudity": GlobalLabel(
            name: "Nudity",
            description: "Puts a warning on images. It is not restricted to adults, and is ignored unless a subscriber turns it on."
        ),
        "bot": GlobalLabel(
            name: "Bot",
            description: "Marks the account as automated."
        ),
    ]

    private static func languageBase(_ tag: String) -> String {
        String(tag.prefix { $0 != "-" })
    }

    /// The locale to show: the reader's language where the labeler wrote one,
    /// then English, then whatever comes first.
    public static func pickLocale(_ locales: [LabelLocale], languages: [String]) -> LabelLocale? {
        guard let first = locales.first else { return nil }
        for language in languages {
            let lower = language.lowercased()
            let base = languageBase(lower)
            if let exact = locales.first(where: { $0.lang.lowercased() == lower }) {
                return exact
            }
            if let sameBase = locales.first(where: { languageBase($0.lang.lowercased()) == base }) {
                return sameBase
            }
        }
        return locales.first(where: { $0.lang.lowercased().hasPrefix("en") }) ?? first
    }

    /// Where a label's wording comes from. The raw values are the web's.
    public enum MeaningSource: String, Hashable, Sendable {
        case labeler
        case protocolDefined = "protocol"
        case undefined = "none"
    }

    public struct LabelMeaning: Hashable, Sendable {
        /// The label's name for a reader. The raw value when nothing defines it.
        public var name: String
        public var description: String?
        public var severity: String?
        public var blurs: String?
        public var defaultSetting: String?
        public var adultOnly: Bool
        /// Who the wording comes from.
        public var source: MeaningSource

        public init(
            name: String,
            description: String?,
            severity: String?,
            blurs: String?,
            defaultSetting: String?,
            adultOnly: Bool,
            source: MeaningSource
        ) {
            self.name = name
            self.description = description
            self.severity = severity
            self.blurs = blurs
            self.defaultSetting = defaultSetting
            self.adultOnly = adultOnly
            self.source = source
        }
    }

    private static func nonEmpty(_ value: String?) -> String? {
        guard let value, !value.isEmpty else { return nil }
        return value
    }

    /// What a label value means when this labeler applies it.
    ///
    /// A labeler's own definition comes first: it may redefine any global
    /// value for itself, except the ones that start with `!`, which are
    /// reserved and always mean what the protocol says.
    public static func describeLabel(_ val: String, definitions: [LabelDefinition], languages: [String]) -> LabelMeaning {
        let global = globalLabels[val]
        let own: LabelDefinition? = val.hasPrefix("!") ? nil : definitions.first(where: { $0.identifier == val })
        if let own {
            let locale = pickLocale(own.locales, languages: languages)
            return LabelMeaning(
                name: nonEmpty(locale?.name) ?? global?.name ?? val,
                description: nonEmpty(locale?.description) ?? global?.description,
                severity: own.severity,
                blurs: own.blurs,
                defaultSetting: own.defaultSetting,
                adultOnly: own.adultOnly,
                source: .labeler
            )
        }
        if let global {
            return LabelMeaning(
                name: global.name,
                description: global.description,
                severity: nil,
                blurs: nil,
                defaultSetting: nil,
                adultOnly: false,
                source: .protocolDefined
            )
        }
        return LabelMeaning(
            name: val,
            description: nil,
            severity: nil,
            blurs: nil,
            defaultSetting: nil,
            adultOnly: false,
            source: .undefined
        )
    }

    /// What an app does with a label, from the two attributes that decide it
    /// (the labels guide's table of nine behaviours). Nil when the definition
    /// gives neither.
    public static func labelEffect(blurs: String?, severity: String?) -> String? {
        if nonEmpty(blurs) == nil && nonEmpty(severity) == nil { return nil }
        let how: String
        switch severity {
        case "alert": how = " behind a warning"
        case "inform": how = " behind a notice"
        default: how = ""
        }
        if blurs == "content" { return "Hides the content\(how)" }
        if blurs == "media" { return "Hides images\(how)" }
        if severity == "alert" { return "Shows a warning badge" }
        if severity == "inform" { return "Shows an informational badge" }
        return "No visual effect"
    }

    // MARK: - A scan of every labeler

    public struct ScanProgress: Hashable, Sendable {
        /// Labelers to ask.
        public var total: Int
        /// Labelers whose batch has answered.
        public var checked: Int
        /// Labelers whose batch failed and could not be asked.
        public var failed: Int

        public init(total: Int, checked: Int = 0, failed: Int = 0) {
            self.total = total
            self.checked = checked
            self.failed = failed
        }
    }

    /// Progress as a whole percentage, for the bar.
    public static func scanPercent(_ progress: ScanProgress) -> Int {
        guard progress.total > 0 else { return 0 }
        let ratio = Double(progress.checked + progress.failed) / Double(progress.total) * 100
        return min(100, Int(ratio.rounded()))
    }

    /// `1,234`, as `toLocaleString()` prints a count for an English reader.
    public static func formatCount(_ n: Int) -> String {
        JetstreamModel.grouped(n)
    }
}

/// `Array.prototype.sort`, which is stable: elements the comparator calls
/// equal keep their order. Swift's `sorted(by:)` does not promise that.
func toolsStableSorted<T>(_ items: [T], by areInIncreasingOrder: (T, T) -> Bool) -> [T] {
    items.enumerated()
        .sorted { lhs, rhs in
            if areInIncreasingOrder(lhs.element, rhs.element) { return true }
            if areInIncreasingOrder(rhs.element, lhs.element) { return false }
            return lhs.offset < rhs.offset
        }
        .map { $0.element }
}
