import Foundation

/// How the editor renders one field of a lexicon template.
public enum LexiconFieldType: String, Hashable, Sendable, CaseIterable {
    case text
    case textarea
    case markdown
    case datetime
    case tags
    case json
    case boolean
    case number
}

/// A field's initial value. `now` is the web's `'now'` sentinel: the
/// current time in ISO form, filled in when the record is created.
public enum LexiconFieldDefault: Hashable, Sendable {
    case now
    case string(String)
    case number(Double)
    case bool(Bool)
    case strings([String])

    /// The value as it goes into the record.
    public func jsonValue(now: Date) -> JSONValue {
        switch self {
        case .now: return .string(Formatting.isoTimestamp(now))
        case .string(let s): return .string(s)
        case .number(let n): return .number(n)
        case .bool(let b): return .bool(b)
        case .strings(let list): return .array(list.map { .string($0) })
        }
    }
}

/// One editable field of a lexicon template. Port of `LexiconField`.
public struct LexiconField: Hashable, Sendable {
    public var key: String
    public var label: String
    public var type: LexiconFieldType
    public var required: Bool
    /// Refreshed to the current time on every edit (updatedAt).
    public var autoOnEdit: Bool
    public var `default`: LexiconFieldDefault?
    public var placeholder: String?
    public var maxLength: Int?
    public var hint: String?

    public init(
        key: String,
        label: String,
        type: LexiconFieldType,
        required: Bool = false,
        autoOnEdit: Bool = false,
        default: LexiconFieldDefault? = nil,
        placeholder: String? = nil,
        maxLength: Int? = nil,
        hint: String? = nil
    ) {
        self.key = key
        self.label = label
        self.type = type
        self.required = required
        self.autoOnEdit = autoOnEdit
        self.default = `default`
        self.placeholder = placeholder
        self.maxLength = maxLength
        self.hint = hint
    }
}

/// Who picks the record key: a TID generated on create, or the caller.
public enum LexiconRkeyMode: String, Hashable, Sendable {
    case tid
    case fixed
}

/// A form template for one collection. Port of `Lexicon` in
/// `src/utils/atproto/lexicons.ts`.
public struct Lexicon: Hashable, Sendable {
    public var label: String
    public var summary: String?
    public var rkeyMode: LexiconRkeyMode
    public var rkeyPlaceholder: String?
    public var rkeyDefault: String?
    /// The `$type` written into a new record.
    public var typeFieldValue: String?
    public var fields: [LexiconField]

    public init(
        label: String,
        summary: String? = nil,
        rkeyMode: LexiconRkeyMode,
        rkeyPlaceholder: String? = nil,
        rkeyDefault: String? = nil,
        typeFieldValue: String? = nil,
        fields: [LexiconField]
    ) {
        self.label = label
        self.summary = summary
        self.rkeyMode = rkeyMode
        self.rkeyPlaceholder = rkeyPlaceholder
        self.rkeyDefault = rkeyDefault
        self.typeFieldValue = typeFieldValue
        self.fields = fields
    }
}

/// Lexicon templates for the record editor. Anything not listed falls back
/// to a raw JSON editor. Port of `LEXICONS` and its helpers.
///
/// Deliberately lightweight: the most-edited common fields only. The JSON
/// toggle inside the editor reaches anything that is not modelled.
public enum LexiconTemplates {
    /// `createdAt` (required, now) and `updatedAt` (now, refreshed on edit).
    public static let commonTimestamps: [LexiconField] = [
        LexiconField(key: "createdAt", label: "Created at", type: .datetime, required: true, default: .now),
        LexiconField(key: "updatedAt", label: "Updated at", type: .datetime, autoOnEdit: true, default: .now),
    ]

    /// Collections with a template, in the order the web declares them.
    public static let order: [String] = [
        "app.bsky.feed.post",
        "app.bsky.actor.profile",
        "app.bsky.feed.like",
        "app.bsky.feed.repost",
        "app.bsky.graph.follow",
        "app.bsky.graph.block",
        "app.bsky.graph.list",
    ]

    /// `LEXICONS`.
    public static let all: [String: Lexicon] = [
        "app.bsky.feed.post": Lexicon(
            label: "Bluesky post",
            summary: "Plain text posts. Embeds are out of scope for the templated editor; use raw JSON.",
            rkeyMode: .tid,
            typeFieldValue: "app.bsky.feed.post",
            fields: [
                LexiconField(key: "text", label: "Text", type: .textarea, required: true, maxLength: 300),
                LexiconField(key: "langs", label: "Languages", type: .tags, default: .strings(["en"]), hint: "BCP-47 codes"),
                LexiconField(key: "createdAt", label: "Created at", type: .datetime, required: true, default: .now),
            ]
        ),
        "app.bsky.actor.profile": Lexicon(
            label: "Bluesky profile",
            summary: "Display name, bio, links. Avatar/banner blob references not editable via the form.",
            rkeyMode: .fixed,
            rkeyPlaceholder: "self",
            rkeyDefault: "self",
            typeFieldValue: "app.bsky.actor.profile",
            fields: [
                LexiconField(key: "displayName", label: "Display name", type: .text, maxLength: 64),
                LexiconField(key: "description", label: "Description", type: .textarea, maxLength: 256),
                LexiconField(key: "pronouns", label: "Pronouns", type: .text),
            ]
        ),
        "app.bsky.feed.like": Lexicon(
            label: "Bluesky like",
            rkeyMode: .tid,
            typeFieldValue: "app.bsky.feed.like",
            fields: [
                LexiconField(key: "subject", label: "Subject (raw JSON)", type: .json, required: true, hint: "{ \"uri\": \"at://...\", \"cid\": \"...\" }"),
            ] + commonTimestamps
        ),
        "app.bsky.feed.repost": Lexicon(
            label: "Bluesky repost",
            rkeyMode: .tid,
            typeFieldValue: "app.bsky.feed.repost",
            fields: [
                LexiconField(key: "subject", label: "Subject (raw JSON)", type: .json, required: true, hint: "{ \"uri\": \"at://...\", \"cid\": \"...\" }"),
            ] + commonTimestamps
        ),
        "app.bsky.graph.follow": Lexicon(
            label: "Bluesky follow",
            rkeyMode: .tid,
            typeFieldValue: "app.bsky.graph.follow",
            fields: [
                LexiconField(key: "subject", label: "Subject DID", type: .text, required: true, placeholder: "did:plc:\u{2026}"),
            ] + commonTimestamps
        ),
        "app.bsky.graph.block": Lexicon(
            label: "Bluesky block",
            rkeyMode: .tid,
            typeFieldValue: "app.bsky.graph.block",
            fields: [
                LexiconField(key: "subject", label: "Subject DID", type: .text, required: true, placeholder: "did:plc:\u{2026}"),
            ] + commonTimestamps
        ),
        "app.bsky.graph.list": Lexicon(
            label: "Bluesky list",
            rkeyMode: .tid,
            typeFieldValue: "app.bsky.graph.list",
            fields: [
                LexiconField(key: "name", label: "Name", type: .text, required: true, maxLength: 64),
                LexiconField(key: "purpose", label: "Purpose", type: .text, placeholder: "app.bsky.graph.defs#modlist or curatelist"),
                LexiconField(key: "description", label: "Description", type: .textarea, maxLength: 300),
            ] + commonTimestamps
        ),
    ]

    /// The template for a collection; nil for no collection or an unknown one.
    public static func lexiconFor(_ collection: String?) -> Lexicon? {
        guard let collection = collection, !collection.isEmpty else { return nil }
        return all[collection]
    }

    /// Every collection that has a template, in declaration order.
    public static func knownCollections() -> [String] {
        order
    }

    /// A fresh record for a new item of `collection`: `$type` plus every
    /// field default, with `now` rendered as an ISO timestamp. An unknown
    /// collection yields an empty object.
    public static func blankRecordFor(_ collection: String, now: Date = Date()) -> JSONValue {
        var out: [String: JSONValue] = [:]
        guard let lexicon = lexiconFor(collection) else { return .object(out) }
        if let type = lexicon.typeFieldValue {
            out["$type"] = .string(type)
        }
        for field in lexicon.fields {
            if let value = field.default {
                out[field.key] = value.jsonValue(now: now)
            }
        }
        return .object(out)
    }
}
