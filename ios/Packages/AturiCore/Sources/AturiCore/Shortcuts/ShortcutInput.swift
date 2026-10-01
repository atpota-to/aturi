import Foundation

// Input handling for the app's Shortcuts and Siri actions (its App
// Intents). An action's text arrives from wherever the person's shortcut got
// it: the share sheet, the clipboard, another action's output, or Siri
// dictation. These helpers read it with the same parsers the Links tab and
// the explorer use, so an action accepts what the screen it mirrors accepts.

public enum ShortcutInput {
    /// What "Open Lexicon" opens: one lexicon's page, or a namespace's group
    /// page (`app.bsky.*`, or a bare `app.bsky`).
    public enum LexiconTarget: Hashable, Sendable {
        case lexicon(nsid: String)
        case group(prefix: String)
    }

    /// Trimmed input, with a handle Siri heard spelled out ("dame dot is")
    /// rewritten to the handle it names ("dame.is"). Only input carrying no
    /// dot, slash or colon of its own is rewritten, so a typed handle, DID,
    /// AT URI or link passes through untouched.
    public static func normalized(_ input: String) -> String {
        let trimmed = input.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.contains("."), !trimmed.contains("/"), !trimmed.contains(":") else { return trimmed }
        let words = trimmed.lowercased().split(whereSeparator: { $0.isWhitespace })
        guard words.count >= 3, words.contains("dot"), words.first != "dot", words.last != "dot" else { return trimmed }
        /* Dictation also splits a label it does not recognise ("b sky"),
           so the words are joined with nothing between them. A leading
           "at" is the spoken @ ("at dame dot is"), unless it is the first
           label itself ("at dot proto dot com"). */
        var spoken = words
        if spoken.first == "at", spoken[1] != "dot" {
            spoken.removeFirst()
        }
        return spoken.map { $0 == "dot" ? "." : String($0) }.joined()
    }

    /// The account an input names: a handle (with or without its @), a DID,
    /// an `at://` URI, or a link to the account or one of its records on any
    /// client the Links tab understands. Handles are lowercased, as atproto
    /// normalises them. Nil when nothing in the input reads as a handle or DID.
    public static func accountIdentifier(from input: String) -> String? {
        guard var components = extractAtUriComponents(normalized(input)) else { return nil }
        if components.identifier.hasPrefix("@") {
            components.identifier.removeFirst()
        }
        let identifier = components.identifier
        if isValidDid(identifier) {
            return identifier
        }
        guard isValidHandle(identifier) else { return nil }
        return identifier.lowercased()
    }

    /// The aturi.to universal link for anything the Links tab accepts, built
    /// offline from the input as written (no handle or DID lookup), the way
    /// the web's `convertToAturiLinkSync` builds it. Nil when the input names
    /// nothing, names it malformed, or names a permissioned space.
    public static func aturiLink(from input: String) -> String? {
        guard var components = extractAtUriComponents(normalized(input)) else { return nil }
        if components.identifier.hasPrefix("@") {
            components.identifier.removeFirst()
        }
        let identifier = components.identifier
        guard isValidDid(identifier) || isValidHandle(identifier) else { return nil }
        let parsed = parseURI(handle: identifier, collection: components.collection, rkey: components.rkey)
        guard parsed.error == nil else { return nil }
        return generateAturiLink(AtUriComponents(identifier: identifier, collection: parsed.collection, rkey: parsed.rkey))
    }

    /// The lexicon page an input names: an NSID, a group wildcard
    /// (`app.bsky.feed.*`), or a bare two-segment namespace (`app.bsky`).
    /// Nil for anything else, rather than a page that cannot exist.
    public static func lexiconTarget(from input: String) -> LexiconTarget? {
        let value = normalized(input)
        if PinnedLexicons.isLikelyNsid(value) {
            return .lexicon(nsid: value)
        }
        if PinnedLexicons.isGroup(value) {
            guard PinnedLexicons.isLikelyPinEntry(value) else { return nil }
            return .group(prefix: PinnedLexicons.groupPrefix(value))
        }
        if PinnedLexicons.isLikelyPinEntry(value + PinnedLexicons.groupSuffix) {
            return .group(prefix: value)
        }
        return nil
    }
}
