import SwiftUI
import AturiCore

/// `/tools/lexicon`, port of `src/components/tools/LexiconChecker.tsx`:
/// follows an NSID from its DNS record to the schema record behind it and
/// says where the chain breaks. The logic is `LexiconPublishing` in
/// AturiCore and the walk `LexiconCheckerModel`; this draws the evidence as
/// it arrives. The NSID travels in the link as `?nsid=`, which is also how a
/// schema record's page in the explorer links here.
struct LexiconToolView: View {
    let query: [String: String]

    init(query: [String: String]) {
        self.query = query
    }

    @State private var model = LexiconCheckerModel()
    @State private var text = ""

    @Environment(\.aturiTheme) private var theme

    private static let examples = ["app.bsky.feed.post", "site.standard.document", "community.lexicon.calendar.event"]

    var body: some View {
        ToolFrame(slug: "lexicon", shareQuery: model.shareQuery) {
            VStack(alignment: .leading, spacing: 10) {
                ToolInputBar(
                    placeholder: "com.example.thing",
                    text: $text,
                    buttonTitle: "Check",
                    isRunning: model.isRunning
                ) {
                    model.check(text)
                }
                ToolExamples(examples: Self.examples) { example in
                    text = example
                    model.check(example)
                }
            }
        } content: {
            results
        }
        .task {
            // Once per page: coming back from a pushed record keeps the result.
            guard model.submitted.isEmpty, let nsid = query["nsid"], !nsid.isEmpty else { return }
            text = nsid
            model.check(nsid)
        }
    }

    @ViewBuilder
    private var results: some View {
        if let problem = model.inputProblem {
            RecordToolsError(message: problem)
        }
        if let evidence = model.evidence, let verdict = model.verdict {
            RecordToolsVerdict(status: Self.status(verdict.tone), title: verdict.title, text: verdict.text)

            ToolSection("Checks", detail: model.isRunning ? "Checking\u{2026}" : nil) {
                let checks = model.checks
                ForEach(Array(checks.enumerated()), id: \.element.id) { index, check in
                    if index > 0 {
                        Divider()
                    }
                    checkRow(check)
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

            if let schema = model.schema {
                schemaSection(schema, nsid: evidence.nsid)
            }
        }
        if model.submitted.isEmpty {
            intro
        }
    }

    /// One step: its mark, title and summary, then the evidence in mono and
    /// what to change.
    private func checkRow(_ check: LexiconPublishing.Check) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ToolCheckRow(status: Self.status(check.status), title: check.title, detail: check.summary)
            if let detail = check.detail, !detail.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(detail.enumerated()), id: \.offset) { _, line in
                        detailLine(line)
                    }
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.surfaceSubtle, in: RoundedRectangle(cornerRadius: AturiTheme.controlRadius, style: .continuous))
                .padding(.leading, 28)
            }
            if let fix = check.fix, !fix.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    Text("To fix")
                        .aturiLabel()
                        .foregroundStyle(theme.textTertiary)
                    ForEach(Array(fix.enumerated()), id: \.offset) { _, paragraph in
                        Text(paragraph)
                            .font(AturiFont.footnote)
                            .foregroundStyle(theme.textPrimary)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.leading, 28)
                .padding(.bottom, 4)
            }
        }
        .padding(.vertical, 2)
    }

    /* A line of evidence that answers the one above it starts with an
       arrow. The arrow gets its own column so a long DID or URI after it
       wraps under itself, not back under the arrow. */
    @ViewBuilder
    private func detailLine(_ line: String) -> some View {
        if line.hasPrefix("\u{2192} ") {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                Text("\u{2192}")
                Text(String(line.dropFirst(2)))
            }
            .font(AturiFont.monoSmall)
            .foregroundStyle(theme.textSecondary)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
        } else {
            Text(line)
                .font(AturiFont.monoSmall)
                .foregroundStyle(theme.textSecondary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func schemaSection(_ schema: LexiconPublishing.FoundSchema, nsid: String) -> some View {
        let authority = "_lexicon.\(LexiconPublishing.nsidAuthority(nsid).domain)"
        return ToolSection(
            "Schema record",
            detail: schema.via == .convention ? "Found by the handle convention" : "Found by the DNS record"
        ) {
            VStack(alignment: .leading, spacing: 4) {
                CopyRow(label: "NSID", value: nsid)
                CopyRow(label: "Authority", value: authority)
                NavigationLink(value: Route.repo(schema.did)) {
                    ToolFactRow(label: "Repository", value: schema.did)
                }
                .buttonStyle(.plain)
                CopyRow(label: "Record", value: schema.uri, lineLimit: 1)
                if let cid = schema.cid, !cid.isEmpty {
                    CopyRow(label: "CID", value: cid)
                }
                JSONTreeView(value: schema.value)
                    .padding(.vertical, 8)
                NavigationLink(value: Route.lexicon(nsid: nsid)) {
                    Text("Open in the lexicons explorer")
                }
                .buttonStyle(.aturiSecondary)
                NavigationLink(value: Route.record(repo: schema.did, collection: LexiconPublishing.collection, rkey: nsid)) {
                    Text("Open the record")
                }
                .buttonStyle(.aturiSecondary)
            }
        }
    }

    private var intro: some View {
        RecordToolsIntro(items: [
            (
                "The NSID names an authority",
                "Drop the last part and reverse the rest: app.bsky.feed.post is published under feed.bsky.app."
            ),
            (
                "The authority names a repository",
                "A TXT record at _lexicon.<authority> holds did=<DID>. Each authority needs its own: a record on the domain above it is not consulted."
            ),
            (
                "The repository holds the schema",
                "A record in com.atproto.lexicon.schema, keyed by the full NSID, read from that account\u{2019}s PDS."
            ),
            (
                "The schema is a lexicon document",
                "lexicon is 1, id matches the NSID, and defs holds the definitions."
            ),
        ])
    }

    private static func status(_ status: LexiconPublishing.CheckStatus) -> ToolCheckStatus {
        switch status {
        case .pass: return .pass
        case .warn: return .warn
        case .fail: return .fail
        /* A step that was not checked is a note, as the web's dimmed row is. */
        case .info, .skip: return .info
        case .pending: return .pending
        }
    }

    private static func status(_ tone: LexiconPublishing.Verdict.Tone) -> ToolCheckStatus {
        switch tone {
        case .pass: return .pass
        case .warn: return .warn
        case .fail: return .fail
        case .pending: return .pending
        }
    }
}
