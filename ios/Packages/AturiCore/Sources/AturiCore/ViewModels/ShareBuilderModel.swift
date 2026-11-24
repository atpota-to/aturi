import Foundation
import Observation

/// The state behind `/tools/share`, port of `src/components/tools/ShareBuilder.tsx`.
///
/// The text and the link are the input (the web keeps them in `?text=` and
/// `?url=`, written once typing pauses so the address bar does not churn).
/// The app has no address bar to keep up to date, so the fields are the only
/// state and the share button reads them as they stand.
@MainActor
@Observable
public final class ShareBuilderModel {
    public var text = ""
    public var url = ""
    /// The client the markup links to. Nil picks the first.
    public var chosen: String?
    /// The link's label. Nil follows the client: "Share on Bluesky".
    public var label: String?

    public init(text: String = "", url: String = "") {
        self.text = text
        self.url = url
    }

    /// Take the input a link handed the tool.
    public func apply(query: [String: String]) {
        text = query["text"] ?? ""
        url = query["url"] ?? ""
    }

    public struct Example: Hashable, Sendable {
        public let label: String
        public let text: String
        public let url: String
    }

    /// The web's two "Try" examples.
    public nonisolated static let examples = [
        Example(label: "A page", text: "Touring the Atmosphere with aturi.to", url: "https://aturi.to"),
        Example(label: "Text only", text: "Hello from my own website!", url: ""),
    ]

    public func applyExample(text: String, url: String) {
        self.text = text
        self.url = url
    }

    public var post: String {
        ShareBuilder.composeText(text, url: url)
    }

    public var graphemes: Int {
        ShareBuilder.countGraphemes(post)
    }

    /// How far over the limit the post is; zero or less when it fits.
    public var over: Int {
        graphemes - ShareBuilder.postGraphemeLimit
    }

    public var urlProblem: String? {
        ShareBuilder.shareUrlProblem(url)
    }

    public var targets: [ShareBuilder.Target] {
        ShareBuilder.targets(post)
    }

    /// The client the markup is for.
    public var target: ShareBuilder.Target? {
        let all = targets
        return all.first { $0.id == chosen } ?? all.first
    }

    public var buttonLabel: String {
        if let label { return label }
        if let target { return "Share on \(target.name)" }
        return "Share"
    }

    public var anchorSnippet: String? {
        target.map { ShareBuilder.anchorSnippet(url: $0.url, label: buttonLabel) }
    }

    public var buttonSnippet: String? {
        target.map { ShareBuilder.buttonSnippet(url: $0.url, label: buttonLabel) }
    }

    public var shareQuery: [String: String] {
        ShareBuilder.shareQuery(text: text, url: url)
    }

    /// The verdict over a post that is too long, as the web words it.
    public var lengthWarning: ServiceVerdict? {
        guard over > 0 else { return nil }
        return ServiceVerdict(
            tone: .warn,
            title: "The post is too long",
            text: "\(graphemes) characters, \(over) over the limit of \(ShareBuilder.postGraphemeLimit). The composer opens, but the post can\u{2019}t be sent until it is shorter."
        )
    }
}
