import SwiftUI
import UIKit
import AturiCore

/// `/tools/resolve`, port of `src/components/tools/BulkResolver.tsx`:
/// resolves a pasted list of handles and DIDs into a table. The parsing and
/// the export are `BulkResolve` and the run `BulkResolveModel` (AturiCore);
/// this draws the rows as they come in. The input is the web's `?list=`,
/// comma-joined, kept only while it fits in a link.
///
/// The web's five-column table is a list of cards here, one per identity,
/// so it fits a phone; its CSV download is the share sheet, handed the CSV
/// text.
struct ResolveToolView: View {
    let query: [String: String]

    /* Explicit, as the app's shared views are: `ToolPageView` builds this
       from another file, and the private state below has to stay out of a
       generated initializer's reach. */
    init(query: [String: String]) {
        self.query = query
    }

    @State private var model = BulkResolveModel()
    @State private var text = ""
    @State private var started = false

    @Environment(\.aturiTheme) private var theme

    private static let slug = "resolve"

    private static let examples: [(label: String, value: String)] = [
        (label: "Three handles", value: "bsky.app\natproto.com\njay.bsky.team"),
        (
            label: "A mixed list",
            value: "@bsky.app\ndid:plc:oky5czdrnfjpqslsw2a5iclo\nhttps://bsky.app/profile/atproto.com\nat://pfrazee.com\nnobody.example-missing.net\nnot_a_handle"
        ),
    ]

    var body: some View {
        ToolFrame(slug: Self.slug, shareQuery: shareQuery) {
            VStack(alignment: .leading, spacing: 10) {
                ToolTextEditor(
                    placeholder: "alice.example.com\ndid:plc:…\nhttps://bsky.app/profile/bob.example.com",
                    text: $text,
                    buttonTitle: "Resolve",
                    isRunning: model.isRunning,
                    minHeight: 140
                ) {
                    submit(text)
                }
                examplesRow
            }
        } content: {
            if model.entries.isEmpty {
                intro
            } else {
                identitiesSection
            }
        }
        .onAppear(perform: start)
    }

    /// `?list=` while the list fits in a link; nothing to share otherwise.
    private var shareQuery: [String: String] {
        guard let list = model.queryList else { return [:] }
        return ["list": list]
    }

    private func start() {
        guard !started else { return }
        started = true
        if let list = query["list"], !list.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            submit(list)
        }
    }

    private func submit(_ value: String) {
        model.submit(value)
        // The editor shows the list as it was read: one entry per line.
        text = model.entries.isEmpty ? value : model.editorText
    }

    /// The web's labelled examples. Their values run to several lines, so
    /// the chip carries the label rather than the value.
    private var examplesRow: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                Text("Try")
                    .font(AturiFont.caption)
                    .foregroundStyle(theme.textTertiary)
                ForEach(Self.examples, id: \.label) { example in
                    Button {
                        submit(example.value)
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

    // MARK: Results

    private var meta: String {
        let counts = model.counts
        if model.isRunning {
            return "\(counts.settled.formatted()) of \(counts.total.formatted()) done"
        }
        var parts = ["\(counts.resolved.formatted()) resolved"]
        if counts.flagged > 0 { parts.append("\(counts.flagged.formatted()) flagged") }
        if counts.failed > 0 { parts.append("\(counts.failed.formatted()) not resolved") }
        return parts.joined(separator: " · ")
    }

    private var note: String {
        var parts: [String] = []
        if model.isTooLongToShare { parts.append("Too long to share as a link.") }
        let duplicates = model.list.duplicates
        if duplicates > 0 {
            parts.append("\(duplicates.formatted()) \(duplicates == 1 ? "duplicate" : "duplicates") left out.")
        }
        let dropped = model.list.dropped
        if dropped > 0 {
            parts.append("Only the first \(BulkResolve.maxIdentifiers) are resolved; \(dropped.formatted()) left out.")
        }
        return parts.joined(separator: " ")
    }

    private var identitiesSection: some View {
        let counts = model.counts
        let rows = model.rows
        return ToolSection("Identities", detail: meta) {
            VStack(alignment: .leading, spacing: 12) {
                if model.isRunning {
                    ProgressView(value: Double(counts.settled), total: Double(max(counts.total, 1)))
                        .tint(theme.accent)
                        .accessibilityLabel("Identifiers resolved")
                        .accessibilityValue("\(counts.settled) of \(counts.total)")
                } else if !note.isEmpty {
                    Text(note)
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                exportButtons
                LazyVStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        if index > 0 {
                            Divider()
                        }
                        ResolveRowView(row: row)
                    }
                }
                MicrocosmCredit()
            }
        }
    }

    /* Wrapped rather than scrolled sideways, so the last button drops to a
       second line on a narrow phone instead of being cut off at the edge. */
    private var exportButtons: some View {
        SettingsWrapLayout(spacing: 8) {
            ResolveCopyButton(title: "Copy CSV", value: model.csv)
            ResolveCopyButton(title: "Copy JSON", value: model.json)
            ShareLink(item: model.csv, subject: Text("identities.csv")) {
                Label("Download CSV", systemImage: "square.and.arrow.down")
                    .font(AturiFont.footnote)
            }
            .buttonStyle(.aturiSecondary)
            .disabled(model.isRunning)
        }
        .padding(.vertical, 1)
    }

    private var intro: some View {
        ToolIntro("What it does", items: [
            (
                "Reads the list",
                "Handles, DIDs, at:// URIs or profile links, one per line or comma-separated, up to \(BulkResolve.maxIdentifiers)."
            ),
            (
                "Resolves each one",
                "Each to its DID, handle and PDS. A handle counts only when its DID points back."
            ),
            (
                "Flags what is off",
                "Handles that don\u{2019}t resolve, DIDs with no handle, handles now on another account, and anything that isn\u{2019}t an identifier."
            ),
        ])
    }
}

// MARK: - Pieces

/// One identity: what was typed and how it came out, then the DID, handle
/// and PDS it resolved to, each a way into the explorer. A row of the web's
/// table, stacked.
private struct ResolveRowView: View {
    let row: BulkResolve.Row

    @Environment(\.aturiTheme) private var theme

    private var status: BulkResolve.RowStatus {
        BulkResolve.rowStatus(row)
    }

    private var chip: Chip {
        switch status.tone {
        case .pass?:
            return Chip(status.label, systemImage: "checkmark", style: .accent)
        case .warn?:
            return Chip(status.label, systemImage: "exclamationmark.triangle")
        case .fail?:
            return Chip(status.label, systemImage: "xmark", style: .danger)
        case nil:
            return Chip(status.label, systemImage: "circle.dotted")
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(row.input)
                    .font(AturiFont.monoFont(.footnote, weight: .medium))
                    .foregroundStyle(theme.textPrimary)
                    /* One line: a DID has no break points, so a second line
                       splits it mid-identifier; the middle is what is cut. */
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
                Spacer(minLength: 0)
                chip
            }
            if let note = status.note, !note.isEmpty {
                Text(note)
                    .font(AturiFont.caption)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let did = row.did {
                NavigationLink(value: Route.repo(did)) {
                    ResolveValueLine(label: "DID", value: did, linked: true)
                }
                .buttonStyle(.plain)
            }
            if let handle = row.handle {
                ResolveValueLine(label: "Handle", value: "@\(handle)", linked: false)
            }
            if let host = BulkResolve.pdsHost(row.pds) {
                NavigationLink(value: Route.pds(host: host)) {
                    ResolveValueLine(label: "PDS", value: host, linked: true)
                }
                .buttonStyle(.plain)
            }
            if row.state == .unresolved, row.kind == .handle {
                NavigationLink(value: Route.tool(slug: "handle", query: ["handle": row.value])) {
                    Label("Debug", systemImage: "stethoscope")
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textAccent)
                }
                .buttonStyle(.plain)
                .accessibilityHint("Opens the handle debugger for \(row.value)")
            }
        }
        .padding(.vertical, 10)
    }
}

/// A label and a mono value on one line, the value in the accent when it
/// opens a page.
private struct ResolveValueLine: View {
    let label: String
    let value: String
    let linked: Bool

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label)
                .font(AturiFont.caption)
                .foregroundStyle(theme.textTertiary)
                .frame(width: 52, alignment: .leading)
            Text(value)
                .font(AturiFont.monoSmall)
                .foregroundStyle(linked ? theme.textAccent : theme.textPrimary)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 0)
            if linked {
                Image(systemName: "chevron.right")
                    .font(AturiFont.caption2)
                    .foregroundStyle(theme.textTertiary)
                    .accessibilityHidden(true)
            }
        }
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}

/// Puts a whole export on the clipboard, and says so for a moment.
private struct ResolveCopyButton: View {
    let title: String
    let value: String

    @State private var copied = false
    @State private var resetTask: Task<Void, Never>?

    var body: some View {
        Button(action: copy) {
            Label(copied ? "Copied" : title, systemImage: copied ? "checkmark" : "doc.on.doc")
                .font(AturiFont.footnote)
        }
        .buttonStyle(.aturiSecondary)
        .sensoryFeedback(.success, trigger: copied) { _, now in now }
    }

    private func copy() {
        UIPasteboard.general.string = value
        copied = true
        resetTask?.cancel()
        resetTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            guard !Task.isCancelled else { return }
            copied = false
        }
    }
}
