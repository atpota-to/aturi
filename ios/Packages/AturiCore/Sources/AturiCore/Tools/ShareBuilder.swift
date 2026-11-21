import Foundation

/// The share button builder's logic, port of `src/lib/tools/share.ts`: one
/// piece of text, and the link that opens each client's composer with it.
///
/// Bluesky defined the route (`/intent/compose?text=…`, see
/// https://docs.bsky.app/docs/advanced-guides/intent-links) and the clients
/// built on its app inherit it. Which clients have one, and whether each
/// reads the text, comes from the waypoint catalog (`WaypointCatalog`'s
/// compose intents) and nowhere else: an entry is only added there once the
/// client's own route has been confirmed, and a link to a client without one
/// lands on a 404.
public enum ShareBuilder {
    /// Bluesky's post limit, in grapheme clusters.
    public static let postGraphemeLimit = 300

    /// Count what a reader would call characters: an emoji with a skin tone,
    /// or a family joined by zero-width joiners, is one. A Swift `Character`
    /// is a grapheme cluster, which is what the web's `Intl.Segmenter` counts.
    public static func countGraphemes(_ text: String) -> Int {
        text.count
    }

    /// The post: the text, then the link on a line of its own, as the
    /// example in Bluesky's own intent-link guide puts them together.
    public static func composeText(_ text: String, url: String) -> String {
        [text.trimmingCharacters(in: .whitespacesAndNewlines), url.trimmingCharacters(in: .whitespacesAndNewlines)]
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
    }

    /// Why a link is not one to share, or nil when it is fine (or absent).
    public static func shareUrlProblem(_ url: String) -> String? {
        let value = url.trimmingCharacters(in: .whitespacesAndNewlines)
        if value.isEmpty { return nil }
        // `new URL(value)` throws on anything without a scheme, and on an
        // http(s) address without a host; Foundation reads both as relative.
        guard value.range(of: "^[a-z][a-z0-9+.-]*:", options: [.regularExpression, .caseInsensitive]) != nil,
            let parsed = URL(string: value), let scheme = parsed.scheme?.lowercased()
        else {
            return "That is not a full address. Start it with https://."
        }
        if scheme != "https" && scheme != "http" {
            return "A link to share has to be an http or https address."
        }
        guard let host = parsed.host, !host.isEmpty else {
            return "That is not a full address. Start it with https://."
        }
        return nil
    }

    public struct Target: Hashable, Sendable, Identifiable {
        /// The waypoint id, which also keys its icon.
        public var id: String
        public var name: String
        /// The link that opens the client's composer.
        public var url: String
        /// The same intent as a deep link into the client's own app, when it has one.
        public var appUrl: String?
        /// False when the client opens its composer but ignores the text.
        public var prefillsText: Bool

        public init(id: String, name: String, url: String, appUrl: String? = nil, prefillsText: Bool) {
            self.id = id
            self.name = name
            self.url = url
            self.appUrl = appUrl
            self.prefillsText = prefillsText
        }
    }

    /// Every client with a compose route, in catalog order, with `post` filled in.
    public static func targets(_ post: String) -> [Target] {
        WaypointCatalog.composeIntentWaypoints().compactMap { waypoint -> Target? in
            guard let url = WaypointCatalog.composeIntentUrl(waypoint, text: post) else { return nil }
            let textParam = waypoint.composeIntent?.textParam ?? ""
            return Target(
                id: waypoint.id,
                name: waypoint.name,
                url: url,
                appUrl: WaypointCatalog.composeIntentAppUrl(waypoint, text: post),
                prefillsText: !textParam.isEmpty
            )
        }
    }

    static func escapeHTML(_ value: String) -> String {
        value
            .replacingOccurrences(of: "&", with: "&amp;")
            .replacingOccurrences(of: "<", with: "&lt;")
            .replacingOccurrences(of: ">", with: "&gt;")
            .replacingOccurrences(of: "\"", with: "&quot;")
    }

    /// A plain link, to style however the page it goes on is styled.
    public static func anchorSnippet(url: String, label: String) -> String {
        "<a href=\"\(escapeHTML(url))\" target=\"_blank\" rel=\"noopener noreferrer\">\(escapeHTML(label))</a>"
    }

    /// The inline style of the self-contained button. The green is the site's
    /// moss, which holds white text and reads on a light page or a dark one,
    /// since the snippet cannot know which it will land on. The preview in
    /// the app draws the same button from `buttonBackgroundRGB`.
    public static let buttonCSS =
        "display:inline-flex;align-items:center;padding:9px 16px;border-radius:8px;background:#3f5e2e;color:#ffffff;font:600 14px/1.2 system-ui,-apple-system,sans-serif;text-decoration:none"

    /// `#3f5e2e` and `#ffffff` as RGB components, for the preview.
    public static let buttonBackgroundRGB: (red: Double, green: Double, blue: Double) = (63.0 / 255, 94.0 / 255, 46.0 / 255)

    /// The same link, carrying its own styling, for a page with no stylesheet to lean on.
    public static func buttonSnippet(url: String, label: String) -> String {
        [
            "<a href=\"\(escapeHTML(url))\" target=\"_blank\" rel=\"noopener noreferrer\"",
            "   style=\"\(buttonCSS)\">\(escapeHTML(label))</a>",
        ].joined(separator: "\n")
    }

    /// The tool's address: the text and the link, when there are any.
    public static func shareQuery(text: String, url: String) -> [String: String] {
        var query: [String: String] = [:]
        if !text.isEmpty { query["text"] = text }
        if !url.isEmpty { query["url"] = url }
        return query
    }
}
