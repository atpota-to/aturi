import SwiftUI
import AturiCore

/// `/tools/post`, port of `src/components/tools/PostInspector.tsx`: opens a
/// post's record and reads it for what an app does not show: its facets
/// against its text by UTF-8 byte range, its embed, who may reply and quote
/// (the threadgate and postgate beside it), its labels and its three
/// timestamps. The logic is `PostInspector` in AturiCore and the fetching
/// `PostInspectorModel` (the record from Slingshot or its own PDS, the
/// AppView's view, the two gate records); this draws them. The post travels
/// in the link as `?post=`, which is also how a post's page in the explorer
/// links here.
///
/// The web's facet table becomes one card per facet: a five-column table
/// does not fit a phone.
struct PostToolView: View {
    let query: [String: String]

    init(query: [String: String]) {
        self.query = query
    }

    @State private var model = PostInspectorModel()
    @State private var text = ""

    @Environment(\.aturiTheme) private var theme

    private static let examples: [(label: String, value: String)] = [
        ("Mentions and a link", "https://bsky.app/profile/atproto.com/post/3mzebbdw64s27"),
        ("Hidden replies", "https://bsky.app/profile/atproto.com/post/3mxuffv57ks2g"),
        ("A reply with a quote", "https://bsky.app/profile/bsky.app/post/3mzg7ufzqwc2u"),
    ]

    var body: some View {
        ToolFrame(slug: "post", shareQuery: model.shareQuery) {
            VStack(alignment: .leading, spacing: 10) {
                ToolInputBar(
                    placeholder: "bsky.app/profile/\u{2026}/post/\u{2026} or at://\u{2026}",
                    text: $text,
                    buttonTitle: "Inspect",
                    isRunning: model.isRunning
                ) {
                    model.inspect(text)
                }
                ToolExamples(examples: Self.examples.map { $0.label }) { label in
                    guard let example = Self.examples.first(where: { $0.label == label }) else { return }
                    text = example.value
                    model.inspect(example.value)
                }
            }
        } content: {
            results
        }
        .task {
            // Once per page: coming back from a pushed page keeps the result.
            guard model.submitted.isEmpty, let post = query["post"], !post.isEmpty else { return }
            text = post
            model.inspect(post)
        }
    }

    // MARK: Results

    @ViewBuilder
    private var results: some View {
        if let problem = model.inputProblem {
            RecordToolsError(message: problem)
        }
        if let failure = model.failure {
            RecordToolsError(message: failure) {
                model.rerun()
            }
        }
        if model.isRunning && model.evidence == nil {
            RecordToolsVerdict(status: .pending, title: "Reading the record", text: "Fetching the post from its repository.")
        }
        if let evidence = model.evidence, let verdict = model.verdict {
            RecordToolsVerdict(status: Self.status(verdict.tone), title: verdict.title, text: verdict.text)
            textSection(evidence)
            facetsSection(evidence)
            findingsSection
            if let post = model.post {
                countsSection(post)
            }
            ToolSection("Record") {
                JSONTreeView(value: .object(evidence.record))
            }
        }
        if model.submitted.isEmpty {
            intro
        }
    }

    private func textSection(_ evidence: PostInspector.Evidence) -> some View {
        let text = evidence.text
        let measure = PostInspector.measureText(text)
        let did = evidence.uri.dropFirst("at://".count).split(separator: "/").first.map(String.init) ?? ""
        let author = model.post?.author
        var name = did
        var handleText = did
        if let author {
            if !author.handle.isEmpty {
                name = author.handle
                handleText = "@" + author.handle
            }
            if let displayName = author.displayName, !displayName.trimmingCharacters(in: .whitespaces).isEmpty {
                name = displayName
            }
        }
        return ToolSection("Text", detail: "\(measure.graphemes.formatted()) of \(PostInspector.Limits.graphemes) graphemes") {
            VStack(alignment: .leading, spacing: 12) {
                HStack(spacing: 10) {
                    AvatarView(url: author?.avatar, size: 36)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(name)
                            .font(AturiFont.sans(.subheadline, weight: .semibold))
                            .foregroundStyle(theme.textPrimary)
                            .lineLimit(1)
                        if !did.isEmpty {
                            NavigationLink(value: Route.repo(did)) {
                                Text(handleText)
                                    .font(AturiFont.footnote)
                                    .foregroundStyle(theme.textAccent)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
                .accessibilityElement(children: .combine)

                if text.isEmpty {
                    Text("The text is empty.")
                        .font(AturiFont.body)
                        .italic()
                        .foregroundStyle(theme.textTertiary)
                } else {
                    markedText(text, readings: model.readings)
                        .font(AturiFont.body)
                        .foregroundStyle(theme.textPrimary)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }

                VStack(alignment: .leading, spacing: 0) {
                    ToolFactRow(
                        label: "Graphemes",
                        value: "\(measure.graphemes.formatted()) of \(PostInspector.Limits.graphemes)",
                        mono: false
                    )
                    ToolFactRow(
                        label: "UTF-8 bytes",
                        value: "\(measure.bytes.formatted()) of \(PostInspector.Limits.bytes.formatted())",
                        mono: false
                    )
                    ToolFactRow(label: "UTF-16 code units", value: measure.utf16.formatted(), mono: false)
                    CopyRow(label: "Post URI", value: evidence.uri)
                }

                if let route = Route(atUri: evidence.uri) {
                    NavigationLink(value: route) {
                        Label("Open the record in the Explorer", systemImage: "arrow.right.circle")
                    }
                    .buttonStyle(.aturiSecondary)
                }
            }
        }
    }

    /// The post's text with each facet's stretch marked and numbered. A
    /// range that can be cut but covers the wrong text is still drawn, since
    /// seeing where it lands is the point; it is marked in the danger colour.
    private func markedText(_ text: String, readings: [PostInspector.FacetReading]) -> Text {
        let broken = Set(readings.filter { $0.isBroken }.map { $0.position })
        var result = Text(verbatim: "")
        for segment in PostInspector.segmentText(text, readings) {
            if let facet = segment.facet {
                let color = broken.contains(facet) ? theme.danger : theme.textAccent
                let marked: Text = Text(verbatim: segment.text)
                    .foregroundStyle(color)
                    .underline(true, color: color)
                let number: Text = Text(verbatim: "\(facet + 1)")
                    .font(AturiFont.caption2)
                    .baselineOffset(6)
                    .foregroundStyle(color)
                result = result + marked + number
            } else {
                result = result + Text(verbatim: segment.text)
            }
        }
        return result
    }

    private func facetsSection(_ evidence: PostInspector.Evidence) -> some View {
        let readings = model.readings
        let finding = model.findings.first { $0.id == .facets }
        let count = readings.isEmpty ? "None" : (readings.count == 1 ? "1 facet" : "\(readings.count) facets")
        return ToolSection("Facets", detail: count) {
            VStack(alignment: .leading, spacing: 10) {
                if let finding {
                    ToolCheckRow(status: Self.status(finding.status), title: finding.summary)
                }
                ForEach(readings) { reading in
                    Divider()
                    facetRow(reading, text: evidence.text)
                }
            }
        }
    }

    private func facetRow(_ reading: PostInspector.FacetReading, text: String) -> some View {
        let broken = reading.isBroken
        let verdict = broken ? "Does not fit" : (reading.problems.isEmpty ? "Fits" : "Look at")
        let style: Chip.Style = broken ? .danger : (reading.problems.isEmpty ? .accent : .neutral)
        var range = "no range"
        if let start = reading.byteStart, let end = reading.byteEnd {
            range = "bytes \(start) to \(end)"
        }
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("Facet \(reading.position + 1)")
                    .font(AturiFont.sans(.subheadline, weight: .semibold))
                    .foregroundStyle(theme.textPrimary)
                Text(range)
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(theme.textTertiary)
                Spacer(minLength: 8)
                Chip(verdict, style: style)
            }
            .accessibilityElement(children: .combine)

            covers(reading, text: text)

            if reading.features.isEmpty {
                Text("No feature")
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textTertiary)
            }
            ForEach(Array(reading.features.enumerated()), id: \.offset) { _, feature in
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Chip(feature.word)
                    featureTarget(feature)
                }
            }

            ForEach(Array(reading.problems.enumerated()), id: \.offset) { _, problem in
                Text(problem.message)
                    .font(AturiFont.footnote)
                    .foregroundStyle(problem.level == .error ? theme.danger : theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 2)
    }

    @ViewBuilder
    private func covers(_ reading: PostInspector.FacetReading, text: String) -> some View {
        if let covered = reading.covered {
            Text(verbatim: "\u{201C}\(covered)\u{201D}")
                .font(AturiFont.body)
                .foregroundStyle(theme.textPrimary)
                .textSelection(.enabled)
        } else if let start = reading.byteStart, let end = reading.byteEnd, start < end {
            let decoded = PostInspector.decodeBytes(text, start, end)
            Text(verbatim: decoded.isEmpty ? "nothing" : "\u{201C}\(decoded)\u{201D}")
                .font(AturiFont.body)
                .foregroundStyle(theme.danger)
                .strikethrough(true, color: theme.danger)
                .accessibilityLabel("Broken range, covering \(decoded.isEmpty ? "nothing" : decoded)")
        } else {
            Text("Covers nothing")
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textTertiary)
        }
    }

    @ViewBuilder
    private func featureTarget(_ feature: PostInspector.FacetFeature) -> some View {
        switch feature {
        case .mention(let did):
            if did.hasPrefix("did:") {
                NavigationLink(value: Route.repo(did)) {
                    Text(did)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textAccent)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .buttonStyle(.plain)
            } else {
                featureText(did.isEmpty ? "no DID" : did)
            }
        case .link(let uri):
            if Self.isWebLink(uri), let url = URL(string: uri) {
                Link(destination: url) {
                    Text(uri)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textAccent)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .accessibilityHint("Opens outside the app")
            } else {
                featureText(uri.isEmpty ? "no uri" : uri)
            }
        case .tag(let tag):
            featureText("#\(tag)")
        case .unknown(let type):
            featureText(type)
        }
    }

    private func featureText(_ value: String) -> some View {
        Text(verbatim: value)
            .font(AturiFont.monoSmall)
            .foregroundStyle(theme.textSecondary)
            .lineLimit(2)
            .textSelection(.enabled)
    }

    private var findingsSection: some View {
        let findings = model.findings.filter { $0.id != .facets }
        return ToolSection("What the record says", detail: model.isRunning ? "Checking\u{2026}" : nil) {
            VStack(alignment: .leading, spacing: 4) {
                ForEach(Array(findings.enumerated()), id: \.element.id) { index, finding in
                    if index > 0 {
                        Divider()
                    }
                    findingRow(finding)
                }
                if !model.isRunning {
                    Button {
                        model.rerun()
                    } label: {
                        Label("Check again", systemImage: "arrow.clockwise")
                    }
                    .buttonStyle(.aturiSecondary)
                    .padding(.top, 10)
                }
            }
        }
    }

    private func findingRow(_ finding: PostInspector.Finding) -> some View {
        // The three counts are already set out in the text's own card.
        let detail = finding.id == .length ? [] : (finding.detail ?? [])
        return VStack(alignment: .leading, spacing: 4) {
            ToolCheckRow(status: Self.status(finding.status), title: finding.title, detail: finding.summary)
            if !detail.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(detail.enumerated()), id: \.offset) { _, line in
                        Text(verbatim: line)
                            .font(AturiFont.monoSmall)
                            .foregroundStyle(theme.textSecondary)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.leading, 28)
                .padding(.bottom, 4)
            }
        }
    }

    private func countsSection(_ post: BskyPost) -> some View {
        ToolSection("On Bluesky", detail: "Counts from the AppView") {
            VStack(spacing: 12) {
                HStack(spacing: 12) {
                    stat("Likes", post.likeCount)
                    stat("Reposts", post.repostCount)
                }
                HStack(spacing: 12) {
                    stat("Replies", post.replyCount)
                    stat("Quotes", post.quoteCount)
                }
            }
        }
    }

    private func stat(_ label: String, _ value: Int?) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(AturiFont.caption)
                .foregroundStyle(theme.textTertiary)
            Text((value ?? 0).formatted())
                .font(AturiFont.sans(.title3, weight: .bold))
                .foregroundStyle(theme.textPrimary)
                .monospacedDigit()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }

    private var intro: some View {
        RecordToolsIntro(title: "What it reads", items: [
            (
                "Facets against the text",
                "Each link, mention and tag\u{2019}s byteStart and byteEnd, in UTF-8 bytes, checked against the text. Offsets in the wrong unit are named."
            ),
            (
                "Three ways of counting",
                "Length in graphemes, UTF-8 bytes and UTF-16 code units, against the lexicon\u{2019}s limits."
            ),
            (
                "When it was written",
                "createdAt, which the client sets, against the record key\u{2019}s time and when Bluesky indexed it."
            ),
            (
                "The rules beside it",
                "Reply and quote rules, stored as separate records under the same key, plus the embed, languages, tags and labels."
            ),
        ])
    }

    // MARK: Words

    private static func isWebLink(_ uri: String) -> Bool {
        let lowered = uri.lowercased()
        return lowered.hasPrefix("http://") || lowered.hasPrefix("https://")
    }

    private static func status(_ status: PostInspector.FindingStatus) -> ToolCheckStatus {
        switch status {
        case .pass: return .pass
        case .warn: return .warn
        case .fail: return .fail
        case .info: return .info
        case .pending: return .pending
        }
    }

    private static func status(_ tone: PostInspector.Verdict.Tone) -> ToolCheckStatus {
        switch tone {
        case .pass: return .pass
        case .warn: return .warn
        case .fail: return .fail
        case .pending: return .pending
        }
    }
}
