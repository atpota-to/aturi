import SwiftUI
import UIKit
import AturiCore

/// `/tools/decode`, port of `src/components/tools/IdentifierDecoder.tsx`:
/// takes an identifier apart on the device. The reading itself is
/// `IdentifierDecode` (AturiCore); nothing typed here is sent anywhere.
///
/// The input is kept in the link like every other tool's (`?q=`), with one
/// exception: a token, or anything long enough to be one, stays on this
/// screen and never reaches the share link.
struct DecodeToolView: View {
    let query: [String: String]

    /* Explicit, as the app's shared views are: `ToolPageView` builds this
       from another file, and the private state below has to stay out of a
       generated initializer's reach. */
    init(query: [String: String]) {
        self.query = query
    }

    @State private var text = ""
    /// What was last decoded, and when: "3 hours ago" is read against the
    /// moment of decoding, so it does not shift while the page is open.
    @State private var input = ""
    @State private var readings: [IdentifierDecode.Decoded] = []
    @State private var started = false

    @Environment(\.aturiTheme) private var theme

    private static let slug = "decode"

    private static let examples: [(label: String, value: String)] = [
        (label: "A record key", value: "3n22yg6lg2k2f"),
        (label: "An at:// URI", value: "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3n22yg6lg2k2f"),
        (label: "A CID", value: "bafyreibu7nij5fidh2dx7ljpypstqetii3q7333it52w3l3uekrpbuj5rq"),
        (label: "A signing key", value: "zQ3shQo6TF2moaqMTrUZEM1jeuYRQXeHEx4evX9751y2qPqRA"),
        (label: "An NSID", value: "app.bsky.feed.post"),
    ]

    var body: some View {
        ToolFrame(slug: Self.slug, shareQuery: shareQuery) {
            VStack(alignment: .leading, spacing: 10) {
                ToolInputBar(
                    placeholder: "TID, CID, URI, DID or NSID",
                    text: $text,
                    buttonTitle: "Decode",
                    keyboard: .asciiCapable
                ) {
                    decode(text)
                }
                examplesRow
            }
        } content: {
            results
        }
        .onAppear(perform: start)
    }

    private var isHeld: Bool {
        !input.isEmpty && IdentifierDecode.isSensitiveInput(input)
    }

    /// `?q=`, unless the input is a token or long enough to be one.
    private var shareQuery: [String: String] {
        guard !input.isEmpty, !isHeld else { return [:] }
        return ["q": input]
    }

    private func start() {
        guard !started else { return }
        started = true
        if let q = query["q"], !q.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            text = q
            decode(q)
        }
    }

    private func decode(_ value: String) {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        input = trimmed
        readings = IdentifierDecode.decode(trimmed, now: Date())
    }

    private var examplesRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                Text("Try")
                    .font(AturiFont.caption)
                    .foregroundStyle(theme.textTertiary)
                ForEach(Self.examples, id: \.label) { example in
                    Button {
                        text = example.value
                        decode(example.value)
                    } label: {
                        Chip(example.label)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Try \(example.label)")
                }
            }
            .padding(.vertical, 2)
        }
    }

    @ViewBuilder
    private var results: some View {
        if !input.isEmpty, readings.isEmpty {
            Text("That does not read as a TID, CID, at:// URI, DID, key, NSID, handle, timestamp or token.")
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .cardBackground()
        }
        ForEach(readings, id: \.kind) { decoded in
            ToolSection(decoded.title, detail: readings.count > 1 ? "One of \(readings.count) ways to read it" : nil) {
                DecodedBody(decoded: decoded)
            }
        }
        if isHeld {
            Label("Tokens are decoded in this app and are not added to the link or sent anywhere.", systemImage: "lock")
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
        if input.isEmpty {
            intro
        }
    }

    private var intro: some View {
        ToolIntro("What it reads", items: [
            (
                "Record keys and revisions",
                "A TID holds the microsecond it was made and a clock ID. A timestamp converts back to the TID for that instant."
            ),
            (
                "Content identifiers",
                "A CID’s version, codec and hash: whether it addresses a record or a blob, and the digest itself."
            ),
            (
                "Addresses",
                "An at:// URI split into its authority, collection and record key, each decoded in turn. DIDs by method, and NSIDs with the domain that publishes them."
            ),
            (
                "Keys and tokens",
                "The curve behind a did:key or a DID document’s signing key, and the claims inside a session, OAuth or service token."
            ),
        ])
    }
}

// MARK: - A reading

/// One reading of the input. A compound identifier (an at:// URI) nests
/// its parts inside, each read in turn.
private struct DecodedBody: View {
    let decoded: IdentifierDecode.Decoded

    @Environment(\.aturiTheme) private var theme
    @Environment(\.openURL) private var openURL

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(decoded.summary)
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(decoded.facts.enumerated()), id: \.offset) { index, fact in
                    if index > 0 {
                        Divider()
                    }
                    DecodeFactRow(
                        fact: fact,
                        meaning: decoded.kind == .jwt ? IdentifierDecode.claimMeaning(fact.label) : nil
                    )
                }
            }

            if !decoded.notes.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(decoded.notes, id: \.self) { note in
                        Label {
                            Text(note)
                                .font(AturiFont.footnote)
                                .foregroundStyle(theme.textPrimary)
                                .fixedSize(horizontal: false, vertical: true)
                        } icon: {
                            Image(systemName: "exclamationmark.circle")
                                .foregroundStyle(theme.textTertiary)
                        }
                    }
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.surfaceSubtle, in: RoundedRectangle(cornerRadius: AturiTheme.controlRadius, style: .continuous))
            }

            ForEach(decoded.json, id: \.label) { block in
                VStack(alignment: .leading, spacing: 6) {
                    Text(block.label)
                        .aturiLabel()
                        .foregroundStyle(theme.textTertiary)
                    JSONTreeView(value: block.value)
                        .padding(10)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(theme.surfaceSubtle, in: RoundedRectangle(cornerRadius: AturiTheme.controlRadius, style: .continuous))
                }
            }

            ForEach(decoded.parts, id: \.label) { part in
                VStack(alignment: .leading, spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(part.label)
                            .aturiLabel()
                            .foregroundStyle(theme.textAccent)
                        Text(part.decoded.title)
                            .font(AturiFont.sans(.subheadline, weight: .bold))
                            .foregroundStyle(theme.textPrimary)
                    }
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(.isHeader)
                    DecodedBody(decoded: part.decoded)
                        .padding(.leading, 12)
                        .overlay(alignment: .leading) {
                            Rectangle()
                                .fill(theme.borderMedium)
                                .frame(width: 2)
                        }
                }
                .padding(.top, 4)
            }

            if !decoded.links.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(decoded.links, id: \.href) { link in
                        linkButton(link)
                    }
                }
            }
        }
    }

    /// A path on aturi.to as the app's own page; anything else opens outside.
    @ViewBuilder
    private func linkButton(_ link: IdentifierDecode.Link) -> some View {
        if let route = Self.route(for: link.href) {
            NavigationLink(value: route) {
                Label(link.label, systemImage: "arrow.right")
                    .font(AturiFont.footnote)
            }
            .buttonStyle(.aturiSecondary)
        } else if let url = URL(string: link.href.hasPrefix("/") ? Endpoints.aturiBase.absoluteString + link.href : link.href) {
            Button {
                openURL(url)
            } label: {
                Label(link.label, systemImage: "arrow.up.right")
                    .font(AturiFont.footnote)
            }
            .buttonStyle(.aturiSecondary)
            .accessibilityHint("Opens outside the app")
        }
    }

    private static func route(for href: String) -> Route? {
        guard href.hasPrefix("/") else { return nil }
        guard case .route(let route, _)? = DeepLinks.target(for: Endpoints.aturiBase.absoluteString + href) else {
            return nil
        }
        return route
    }
}

/// A label and its value, with a copy button for an identifier worth
/// copying and, for a token's claim, what the claim means.
private struct DecodeFactRow: View {
    let fact: IdentifierDecode.Fact
    let meaning: String?

    @Environment(\.aturiTheme) private var theme
    @State private var copied = false
    @State private var resetTask: Task<Void, Never>?

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(fact.label)
                    .font(AturiFont.caption)
                    .foregroundStyle(theme.textTertiary)
                Text(fact.value)
                    .font(fact.plain ? AturiFont.footnote : AturiFont.monoSmall)
                    .foregroundStyle(theme.textPrimary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                if let meaning {
                    Text(meaning)
                        .font(AturiFont.caption)
                        .foregroundStyle(theme.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .accessibilityElement(children: .combine)
            Spacer(minLength: 0)
            if fact.copy {
                Button(action: copy) {
                    Image(systemName: copied ? "checkmark" : "doc.on.doc")
                        .foregroundStyle(copied ? theme.textAccent : theme.textSecondary)
                        .padding(6)
                }
                .buttonStyle(.plain)
                .sensoryFeedback(.success, trigger: copied) { _, now in now }
                .accessibilityLabel(copied ? "Copied" : "Copy \(fact.label)")
            }
        }
        .padding(.vertical, 6)
    }

    private func copy() {
        UIPasteboard.general.string = fact.value
        copied = true
        resetTask?.cancel()
        resetTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            guard !Task.isCancelled else { return }
            copied = false
        }
    }
}
