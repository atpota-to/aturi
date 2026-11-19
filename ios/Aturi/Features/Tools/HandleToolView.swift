import SwiftUI
import AturiCore

/// `/tools/handle`, port of `src/components/tools/HandleDebugger.tsx`:
/// checks a handle in both directions and says which step fails. The
/// reading of the evidence is `HandleDebug` and the run `HandleDebugModel`
/// (AturiCore); this draws it. The input is the web's `?handle=`.
///
/// The web asks its own server for the DNS record and the well-known file,
/// which a browser cannot read; the app asks dns.google and the handle's
/// host itself, then the DID document, the PDS and Bluesky's AppView, as
/// the web page does.
struct HandleToolView: View {
    let query: [String: String]

    @State private var model = HandleDebugModel()
    @State private var text = ""
    @State private var started = false

    private static let slug = "handle"
    private static let examples = ["bsky.app", "atproto.com", "aturi.to"]

    var body: some View {
        ToolFrame(slug: Self.slug, shareQuery: shareQuery) {
            VStack(alignment: .leading, spacing: 10) {
                ToolInputBar(
                    placeholder: "alice.example.com",
                    text: $text,
                    buttonTitle: "Check",
                    isRunning: model.isRunning
                ) {
                    run(text)
                }
                ToolExamples(examples: Self.examples) { example in
                    text = example
                    run(example)
                }
            }
        } content: {
            results
        }
        .onAppear(perform: start)
    }

    /// `?handle=` once a valid handle is being checked, as the web shares it.
    private var shareQuery: [String: String] {
        guard let handle = model.handle else { return [:] }
        return ["handle": handle]
    }

    /// The link's input, run once when the page first appears.
    private func start() {
        guard !started else { return }
        started = true
        if let handle = query["handle"], !handle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            text = handle
            run(handle)
        }
    }

    private func run(_ value: String) {
        model.check(value)
    }

    @ViewBuilder
    private var results: some View {
        if let reason = model.input?.reason {
            HandleNotice(text: reason)
        }
        if let evidence = model.evidence, let verdict = model.verdict {
            HandleVerdictCard(verdict: verdict)
            checksSection(evidence)
            if let did = verdict.did {
                identitySection(handle: evidence.handle, did: did)
            }
        }
        if model.input == nil {
            intro
        }
    }

    private func checksSection(_ evidence: HandleDebug.Evidence) -> some View {
        let checks = model.checks
        return ToolSection("Checks", detail: model.isRunning ? "Checking…" : nil) {
            ForEach(Array(checks.enumerated()), id: \.element.id) { index, check in
                if index > 0 {
                    Divider()
                }
                HandleCheckView(check: check)
            }
            if !model.isRunning {
                Button("Check again") {
                    model.checkAgain()
                }
                .buttonStyle(.aturiSecondary)
                .padding(.top, 10)
                .accessibilityHint("Runs every check for \(evidence.handle) again")
            }
        }
    }

    private func identitySection(handle: String, did: String) -> some View {
        ToolSection("Identity") {
            CopyRow(label: "Handle", value: handle)
            Divider()
            CopyRow(label: "DID", value: did)
            if let endpoint = model.pdsEndpoint {
                let host = PDSServer.pdsHostname(endpoint)
                Divider()
                NavigationLink(value: Route.pds(host: host)) {
                    HandleLinkRow(label: "PDS", value: host, systemImage: "server.rack")
                }
                .buttonStyle(.plain)
            }
            Divider()
            NavigationLink(value: Route.repo(did)) {
                HandleLinkRow(label: nil, value: "Open in the Explorer", systemImage: "magnifyingglass")
            }
            .buttonStyle(.plain)
        }
    }

    private var intro: some View {
        ToolSection("What it checks") {
            HandleIntroStep(number: 1, term: "The domain names a DID", text: "A TXT record at _atproto.<handle>, or a text file at /.well-known/atproto-did. Either is enough; both are read.")
            HandleIntroStep(number: 2, term: "The DID claims the domain", text: "The DID document has to list at://<handle> first under alsoKnownAs. Without it, apps show handle.invalid.")
            HandleIntroStep(number: 3, term: "The account is reachable", text: "Its PDS answers for the repository, reports it active, and agrees about the handle.")
            HandleIntroStep(number: 4, term: "Bluesky has caught up", text: "The AppView keeps its own copy of each handle, which can lag behind a change.")
        }
    }
}

// MARK: - Pieces

/// Why the input was refused, the web's `ToolError`.
private struct HandleNotice: View {
    let text: String

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        Label {
            Text(text)
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: "exclamationmark.triangle")
                .foregroundStyle(theme.danger)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }
}

/// The one-line answer above the list, the web's `ToolVerdict`.
private struct HandleVerdictCard: View {
    let verdict: HandleDebug.Verdict

    @Environment(\.aturiTheme) private var theme

    private var tint: Color {
        switch verdict.tone {
        case .pass: return theme.textAccent
        /* The theme has no amber; the check rows use the system orange for
           a warning too. */
        case .warn: return .orange
        case .fail: return theme.danger
        case .pending: return theme.textTertiary
        }
    }

    private var systemImage: String {
        switch verdict.tone {
        case .pass: return "checkmark.circle.fill"
        case .warn: return "exclamationmark.triangle.fill"
        case .fail: return "xmark.octagon.fill"
        case .pending: return "circle.dotted"
        }
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 12) {
            Group {
                if verdict.tone == .pending {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Image(systemName: systemImage)
                        .font(AturiFont.sans(.title3, weight: .semibold))
                        .foregroundStyle(tint)
                }
            }
            .frame(width: 24)
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(verdict.title)
                    .font(AturiFont.subtitle)
                    .foregroundStyle(theme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(verdict.text)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.updatesFrequently)
    }
}

/// One step: the shared check row with the step's evidence and what to
/// change beneath it, as the web's check list shows them.
private struct HandleCheckView: View {
    let check: HandleDebug.Check

    @Environment(\.aturiTheme) private var theme

    /* The shared row has no "skipped"; a step that could not run reads as
       a note, and its summary says why it was not run. */
    private var status: ToolCheckStatus {
        switch check.status {
        case .pass: return .pass
        case .warn: return .warn
        case .fail: return .fail
        case .info, .skip: return .info
        case .pending: return .pending
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ToolCheckRow(status: status, title: check.title, detail: check.summary)
            if !check.detail.isEmpty {
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(Array(check.detail.enumerated()), id: \.offset) { _, line in
                        Text(line)
                            .font(AturiFont.monoSmall)
                            .foregroundStyle(theme.textTertiary)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.leading, 28)
                .accessibilityElement(children: .combine)
                .accessibilityLabel("Evidence: " + check.detail.joined(separator: ", "))
            }
            if !check.fix.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("How to fix")
                        .aturiLabel()
                        .foregroundStyle(theme.textTertiary)
                    ForEach(Array(check.fix.enumerated()), id: \.offset) { _, paragraph in
                        Text(paragraph)
                            .font(AturiFont.footnote)
                            .foregroundStyle(theme.textSecondary)
                            .textSelection(.enabled)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.surfaceSubtle, in: RoundedRectangle(cornerRadius: AturiTheme.controlRadius, style: .continuous))
                .padding(.leading, 28)
                .accessibilityElement(children: .combine)
            }
        }
        .padding(.bottom, 6)
    }
}

/// A row that pushes another page: an optional label over its value.
private struct HandleLinkRow: View {
    let label: String?
    let value: String
    let systemImage: String

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: systemImage)
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textTertiary)
                .frame(width: 18)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                if let label {
                    Text(label)
                        .font(AturiFont.caption)
                        .foregroundStyle(theme.textTertiary)
                }
                Text(value)
                    .font(label == nil ? AturiFont.footnote : AturiFont.monoSmall)
                    .foregroundStyle(theme.textAccent)
                    .lineLimit(2)
                    .truncationMode(.middle)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right")
                .font(AturiFont.caption2)
                .foregroundStyle(theme.textTertiary)
                .accessibilityHidden(true)
        }
        .padding(.vertical, 10)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// One numbered line of "What it checks", the web's `ToolIntro`.
private struct HandleIntroStep: View {
    let number: Int
    let term: String
    let text: String

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(number)")
                .font(AturiFont.sans(.caption, weight: .bold))
                .foregroundStyle(theme.accentSoftFg)
                .frame(width: 22, height: 22)
                .background(theme.accentSoft, in: Circle())
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(term)
                    .font(AturiFont.sans(.subheadline, weight: .semibold))
                    .foregroundStyle(theme.textPrimary)
                Text(text)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}
