import SwiftUI
import AturiCore

/// `/tools/validate`, port of `src/components/tools/RecordValidator.tsx`:
/// paste a record's JSON or give an at:// URI, fetch the schema published
/// for its type, validate, and list every issue with its path. The checking
/// is `RecordValidator` in AturiCore and the schema fetching
/// `LexiconSchemaLookup`; `RecordValidatorModel` sequences them.
///
/// An at:// URI is kept in the link (`?uri=`) like every other tool's input.
/// A pasted record is not: it can be long, and it is somebody's data.
struct ValidateToolView: View {
    let query: [String: String]

    init(query: [String: String]) {
        self.query = query
    }

    @State private var model = RecordValidatorModel()
    @State private var text = ""

    @Environment(\.aturiTheme) private var theme

    /// A record with three things wrong, so the list of problems has something to show.
    private static let brokenExample = """
    {
      "$type": "app.bsky.feed.post",
      "text": "A post with a few mistakes in it",
      "createdAt": "2026-01-31",
      "langs": "en",
      "facets": [
        {
          "index": {
            "byteStart": 2
          },
          "features": []
        }
      ]
    }
    """

    private static let examples: [(label: String, value: String)] = [
        ("A Bluesky post", "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3n22yg6lg2k2f"),
        ("A profile", "at://bsky.app/app.bsky.actor.profile/self"),
        ("A record with mistakes", brokenExample),
    ]

    var body: some View {
        ToolFrame(slug: "validate", shareQuery: model.shareQuery) {
            form
        } content: {
            results
        }
        .task {
            // Once per page: coming back from a pushed record keeps the result.
            guard model.input == nil, let uri = query["uri"], !uri.isEmpty else { return }
            text = uri
            model.submit(uri)
        }
    }

    private var form: some View {
        VStack(alignment: .leading, spacing: 10) {
            ToolTextEditor(
                placeholder: "at://did:plc:\u{2026}/app.bsky.feed.post/\u{2026}\n\nor a record as JSON, with its $type",
                text: $text,
                buttonTitle: "Validate",
                isRunning: model.isRunning,
                minHeight: 140
            ) {
                model.submit(text)
            }
            ToolExamples(examples: Self.examples.map { $0.label }) { label in
                guard let example = Self.examples.first(where: { $0.label == label }) else { return }
                text = example.value
                model.submit(example.value)
            }
        }
    }

    // MARK: Results

    @ViewBuilder
    private var results: some View {
        if let problem = model.inputProblem {
            RecordToolsError(message: problem)
        }
        switch model.state {
        case .idle:
            if model.input == nil {
                intro
            }
        case .loading:
            RecordToolsVerdict(
                status: .pending,
                title: "Checking the record",
                text: "Reading the record and the schema published for its type."
            )
            SkeletonRows(count: 3)
        case .failed(let message):
            RecordToolsError(message: message) {
                model.retry()
            }
        case .loaded(let outcome):
            outcomeView(outcome)
        }
    }

    @ViewBuilder
    private func outcomeView(_ outcome: RecordValidatorModel.Outcome) -> some View {
        let check = outcome.check
        let verdict = Self.verdict(check)
        RecordToolsVerdict(status: verdict.status, title: verdict.title, text: verdict.text)

        if !check.report.issues.isEmpty {
            ToolSection("Problems", detail: Self.problemCount(check.report)) {
                let issues = check.report.errors + check.report.warnings
                ForEach(Array(issues.enumerated()), id: \.offset) { index, issue in
                    if index > 0 {
                        Divider()
                    }
                    issueRow(issue)
                }
            }
        }

        ToolSection("Schema") {
            schemaCard(check)
        }

        ToolSection("Record") {
            VStack(alignment: .leading, spacing: 12) {
                if let uri = outcome.uri, let route = Route(atUri: uri) {
                    NavigationLink(value: route) {
                        Label("Open in the Explorer", systemImage: "arrow.right.circle")
                    }
                    .buttonStyle(.aturiSecondary)
                }
                JSONTreeView(value: outcome.record)
            }
        }
    }

    private func issueRow(_ issue: RecordValidator.Issue) -> some View {
        let isError = issue.severity == .error
        return HStack(alignment: .firstTextBaseline, spacing: 10) {
            Image(systemName: isError ? "xmark.octagon.fill" : "exclamationmark.triangle.fill")
                .foregroundStyle(isError ? theme.danger : Color.orange)
                .frame(width: 18)
                .accessibilityLabel(isError ? "Error" : "Warning")
            VStack(alignment: .leading, spacing: 2) {
                Text(issue.path.isEmpty ? "record" : issue.path)
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(theme.textPrimary)
                    .textSelection(.enabled)
                Text(issue.message)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func schemaCard(_ check: RecordValidator.Check) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            if check.schema.isFound, let authority = check.schema.authority {
                NavigationLink(value: Route.lexicon(nsid: check.schema.nsid)) {
                    ToolFactRow(label: "Lexicon", value: check.schema.nsid)
                }
                .buttonStyle(.plain)
                NavigationLink(value: Route.repo(authority.did)) {
                    ToolFactRow(label: "Published by", value: authority.did)
                }
                .buttonStyle(.plain)
                ToolFactRow(
                    label: "Found by",
                    value: authority.via == .dns
                        ? "The _lexicon DNS record on its domain"
                        : "An account at the handle its name reverses to",
                    mono: false
                )
                ToolFactRow(label: "Values checked", value: check.report.checked.formatted(), mono: false)
            }

            if check.lookups.count > 1 {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Also consulted")
                        .font(AturiFont.caption)
                        .foregroundStyle(theme.textTertiary)
                    ForEach(Array(check.lookups.dropFirst().enumerated()), id: \.offset) { _, lookup in
                        NavigationLink(value: Route.lexicon(nsid: lookup.nsid)) {
                            HStack(spacing: 8) {
                                Text(lookup.nsid)
                                    .font(AturiFont.monoSmall)
                                    .foregroundStyle(theme.textAccent)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                Spacer(minLength: 8)
                                Chip(Self.lookupWord(lookup.status), style: lookup.isFound ? .accent : .neutral)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.vertical, 6)
            }

            if check.schema.isFound && !check.report.unresolved.isEmpty {
                Text("Not found, so not checked: \(check.report.unresolved.joined(separator: ", ")).")
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.vertical, 6)
            }

            NavigationLink(value: Route.tool(slug: "lexicon", query: ["nsid": check.nsid])) {
                Text("Check how this lexicon is published")
            }
            .buttonStyle(.aturiSecondary)
            .padding(.top, 6)
        }
    }

    private var intro: some View {
        RecordToolsIntro(items: [
            (
                "The schema is the published one",
                "The $type\u{2019}s schema, found as the network finds it: the _lexicon DNS record, then the schema record in that repository."
            ),
            (
                "Every field is checked",
                "Required fields, types, string formats, byte and character limits, array sizes, blobs, and the types a union allows."
            ),
            (
                "References are followed",
                "Types from other lexicons are fetched and checked too. Anything not found is listed, not passed."
            ),
        ])
    }

    // MARK: Words

    private static func verdict(_ check: RecordValidator.Check) -> (status: ToolCheckStatus, title: String, text: String) {
        let errors = check.report.errors.count
        let warnings = check.report.warnings.count
        switch check.verdict {
        case .valid:
            return (.pass, "The record matches its schema", "Every field is of the type, and within the limits, that \(check.nsid) sets.")
        case .warnings:
            let things = warnings == 1 ? "one thing" : "\(warnings) things"
            return (
                .warn,
                "The record is valid, with \(things) to look at",
                "Nothing breaks \(check.nsid), but something in it is probably not what was meant."
            )
        case .invalid:
            let problems = errors == 1 ? "one problem" : "\(errors) problems"
            return (
                .fail,
                "The record does not match its schema: \(problems)",
                "Apps that check records against \(check.nsid) may refuse or ignore this one."
            )
        case .noSchema:
            return (
                .info,
                "No schema is published for \(check.nsid)",
                "\(RecordValidator.noSchemaReason(check.schema)) There is nothing to check the record against."
            )
        }
    }

    private static func problemCount(_ report: RecordValidator.Report) -> String {
        var parts: [String] = []
        let errors = report.errors.count
        let warnings = report.warnings.count
        if errors > 0 { parts.append(errors == 1 ? "1 error" : "\(errors) errors") }
        if warnings > 0 { parts.append(warnings == 1 ? "1 warning" : "\(warnings) warnings") }
        return parts.joined(separator: ", ")
    }

    private static func lookupWord(_ status: LexiconSchemaLookup.Answer.Status) -> String {
        switch status {
        case .found: return "Found"
        case .unpublished: return "Not published"
        case .noAuthority: return "No authority"
        case .invalid: return "Not an NSID"
        }
    }
}

// MARK: - Shared by the record and lexicon tools

/// The answer at the head of a tool's results, the web tools'
/// `ToolVerdict`: a status mark, a title and a sentence, on a tint of the
/// status's colour. The record validator, the lexicon publishing checker
/// and the post inspector all lead with one.
struct RecordToolsVerdict: View {
    let status: ToolCheckStatus
    let title: String
    let text: String

    init(status: ToolCheckStatus, title: String, text: String) {
        self.status = status
        self.title = title
        self.text = text
    }

    @Environment(\.aturiTheme) private var theme

    private var tint: Color {
        switch status {
        case .pass: return theme.textAccent
        /* The theme has no amber; the account checks use the system orange
           for a warning too. */
        case .warn: return .orange
        case .fail: return theme.danger
        case .info, .pending: return theme.textTertiary
        }
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: AturiTheme.cardRadius, style: .continuous)
        HStack(alignment: .top, spacing: 10) {
            Group {
                if status == .pending {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Image(systemName: status.systemImage)
                        .font(AturiFont.sans(.subheadline, weight: .bold))
                        .foregroundStyle(tint)
                }
            }
            .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(AturiFont.subtitle)
                    .foregroundStyle(theme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                if !text.isEmpty {
                    Text(text)
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(tint.opacity(0.08), in: shape)
        .overlay(shape.strokeBorder(tint.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

/// Input that could not be read, or a run that could not finish: the web
/// tools' `ToolError`, with Try again when there is something to retry.
struct RecordToolsError: View {
    let message: String
    var retry: (() -> Void)? = nil

    init(message: String, retry: (() -> Void)? = nil) {
        self.message = message
        self.retry = retry
    }

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Image(systemName: "exclamationmark.triangle")
                    .foregroundStyle(theme.danger)
                    .accessibilityHidden(true)
                Text(message)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textPrimary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let retry {
                Button(action: retry) {
                    Label("Try again", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.aturiSecondary)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }
}

/// What a tool does, numbered, shown before it has any input: the web
/// tools' `ToolIntro`.
struct RecordToolsIntro: View {
    var title: String = "What it checks"
    let items: [(term: String, text: String)]

    init(title: String = "What it checks", items: [(term: String, text: String)]) {
        self.title = title
        self.items = items
    }

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        ToolSection(title) {
            VStack(alignment: .leading, spacing: 14) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text("\(index + 1)")
                            .font(AturiFont.sans(.footnote, weight: .bold))
                            .foregroundStyle(theme.textAccent)
                            .frame(width: 18)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(item.term)
                                .font(AturiFont.sans(.subheadline, weight: .semibold))
                                .foregroundStyle(theme.textPrimary)
                            Text(item.text)
                                .font(AturiFont.footnote)
                                .foregroundStyle(theme.textSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .accessibilityElement(children: .combine)
                }
            }
        }
    }
}
