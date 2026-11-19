import SwiftUI
import UIKit
import AturiCore

/// `/tools/relay`, port of `src/components/tools/RelayCheck.tsx`: asks each
/// relay what it knows about a PDS host, and the host about itself, so a
/// PDS that is down reads apart from one that is up but has never been
/// crawled. The input is the web's `?host=`, a hostname or a handle or DID
/// whose PDS to look up. The logic is `RelayCheck` and `RelayCheckModel`
/// in AturiCore; the rows are `RelayStatusRows` below, which the PDS page
/// draws too, as the web's PDS page draws `RelayStatusRows`.
struct RelayToolView: View {
    let query: [String: String]

    init(query: [String: String]) {
        self.query = query
    }

    @State private var model = RelayCheckModel()
    @State private var text = ""
    @State private var started = false

    @Environment(\.aturiTheme) private var theme

    private static let examples = ["blacksky.app", "eurosky.social", "@bsky.app"]

    var body: some View {
        ToolFrame(slug: "relay", shareQuery: model.shareQuery) {
            VStack(alignment: .leading, spacing: 10) {
                ToolInputBar(placeholder: "pds.example.com", text: $text, isRunning: model.isBusy) {
                    submit(text)
                }
                ToolExamples(examples: Self.examples) { example in
                    text = example
                    submit(example)
                }
            }
        } content: {
            results
        }
        .onAppear(perform: start)
    }

    /// A link that handed the tool a host runs it at once, as the web's
    /// page does when its address carries one.
    private func start() {
        guard !started else { return }
        started = true
        let host = query[RelayCheckModel.queryKey] ?? ""
        guard !host.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        text = host
        submit(host)
    }

    private func submit(_ value: String) {
        _ = model.run(value)
    }

    // MARK: Results

    @ViewBuilder
    private var results: some View {
        if let reason = model.invalidReason {
            RelayNotice(text: reason)
        }
        if let error = model.error {
            RelayNotice(text: error) {
                _ = model.rerun()
            }
        }
        if model.isFindingHost {
            RelayVerdictCard(
                tone: .pending,
                title: "Finding the PDS",
                text: "Working out whether this is a PDS hostname or an account."
            )
        }
        if let target = model.target, let verdict = model.verdict {
            RelayVerdictCard(tone: verdict.tone, title: verdict.title, text: verdict.text)
            relaysSection
            if verdict.explainCrawl {
                crawlSection
            }
            hostSection(target)
        }
        if model.showsIntro {
            intro
        }
    }

    private var relaysSection: some View {
        ToolSection("Relays", detail: model.relays.isLoading ? "Asking\u{2026}" : nil) {
            RelayStatusRows(results: model.relays.results)
            Divider()
                .padding(.vertical, 6)
            Text("Account counts differ between relays: each counts the accounts it has seen itself, and the host may have more. The sequence number is how far through the host’s events a relay last recorded reading.")
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                _ = model.relays.rerun()
            } label: {
                Label("Ask again", systemImage: "arrow.clockwise")
            }
            .buttonStyle(.aturiSecondary)
            .disabled(model.relays.isLoading)
            .padding(.top, 10)
        }
    }

    private var crawlSection: some View {
        ToolSection("Asking to be crawled") {
            VStack(alignment: .leading, spacing: 10) {
                Text("A relay starts reading a PDS when the PDS asks it to, with `com.atproto.sync.requestCrawl`. The reference PDS sends this itself to every relay in its `PDS_CRAWLERS` setting, so check that setting first. To ask by hand, send the request from anywhere:")
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                if let command = model.crawlCommand {
                    RelayCommandBlock(command: command)
                }
                Text("This page does not send it. The relay connects back to the hostname in the request, so the PDS has to be reachable over https at that name.")
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func hostSection(_ target: RelayCheckModel.Target) -> some View {
        ToolSection("The host") {
            ToolFactRow(label: "Hostname", value: target.host)
            ToolFactRow(label: "Answers as a PDS", value: answersLabel(target.pds), mono: false)
            if let did = target.pds?.did, !did.isEmpty {
                ToolFactRow(label: "Server DID", value: did)
            }
            if let version = target.pds?.version, !version.isEmpty {
                ToolFactRow(label: "Version", value: version)
            }
            if let account = target.account {
                NavigationLink(value: Route.repo(account.did)) {
                    HStack(alignment: .center, spacing: 8) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Looked up from")
                                .font(AturiFont.caption)
                                .foregroundStyle(theme.textTertiary)
                            Text(account.label)
                                .font(AturiFont.monoSmall)
                                .foregroundStyle(theme.textAccent)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right")
                            .font(AturiFont.caption)
                            .foregroundStyle(theme.textTertiary)
                    }
                    .padding(.vertical, 6)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
            if target.pds?.reachable == true {
                NavigationLink(value: Route.pds(host: target.host)) {
                    Label("Open this PDS in the Explorer", systemImage: "server.rack")
                }
                .buttonStyle(.aturiSecondary)
                .padding(.top, 8)
            }
        }
    }

    private func answersLabel(_ probe: RelayCheck.Probe?) -> String {
        guard let probe else { return "Asking\u{2026}" }
        return probe.reachable ? "Yes" : "No. It did not answer describeServer."
    }

    private var intro: some View {
        ToolSection("How it works") {
            VStack(alignment: .leading, spacing: 12) {
                step(1, "A PDS asks to be crawled", Text("It sends `com.atproto.sync.requestCrawl` to a relay with its own hostname. Until it does, the relay does not know it exists."))
                step(2, "The relay subscribes to it", Text("It connects to the host’s event stream and passes on every record written there. Apps read from relays, not from each PDS."))
                step(3, "Each relay reports what it knows", Text("`com.atproto.sync.getHostStatus` returns a status, the number of accounts the relay has seen on the host, and how far it has read. \(RelayCheck.relays.count) relays are asked."))
                step(4, "The host is asked too", Text("So a PDS that is down reads apart from one that is up but has never been crawled."))
            }
        }
    }

    private func step(_ number: Int, _ term: String, _ text: Text) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text(verbatim: String(number))
                .font(AturiFont.monoSmall)
                .foregroundStyle(theme.textAccent)
                .frame(width: 18, alignment: .leading)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(term)
                    .font(AturiFont.sans(.subheadline, weight: .semibold))
                    .foregroundStyle(theme.textPrimary)
                text
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Relay rows

/// What each relay says about one host, port of `RelayStatusRows` in
/// `src/components/tools/RelayStatusList.tsx`. Draws no card of its own.
///
/// `compact` is a shorter row a relay, for a page where the relays are a
/// detail rather than the subject (the PDS page): the status and the
/// account count stay, and what the status means moves to VoiceOver's
/// hint, where the web moves it to the row's tooltip.
struct RelayStatusRows: View {
    let results: [RelayCheck.RelayResult]
    var compact: Bool = false

    @Environment(\.aturiTheme) private var theme

    init(results: [RelayCheck.RelayResult], compact: Bool = false) {
        self.results = results
        self.compact = compact
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(results) { result in
                if result.id != results.first?.id {
                    Divider()
                }
                row(result)
            }
        }
    }

    private func row(_ result: RelayCheck.RelayResult) -> some View {
        let reading = RelayCheck.readRow(result.answer)
        return HStack(alignment: .top, spacing: 10) {
            mark(reading.mark)
                .frame(width: 18)
                .padding(.top, 1)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Text(result.relay.operatorName)
                        .font(AturiFont.sans(.subheadline, weight: .semibold))
                        .foregroundStyle(theme.textPrimary)
                    Text(result.relay.region)
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textTertiary)
                }
                Text(result.relay.host)
                    .font(AturiFont.monoFont(.caption))
                    .foregroundStyle(theme.textTertiary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                if !compact {
                    Text(reading.meaning)
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 8)
            VStack(alignment: .trailing, spacing: 4) {
                Chip(reading.pill, style: chipStyle(reading.pillTone))
                if let accounts = reading.accounts {
                    figure(accounts)
                }
                if !compact, let sequence = reading.sequence {
                    figure(sequence)
                }
            }
        }
        .padding(.vertical, 9)
        .accessibilityElement(children: .combine)
        .accessibilityHint(compact ? reading.meaning : "")
    }

    @ViewBuilder
    private func mark(_ mark: RelayCheck.RowMark) -> some View {
        switch mark {
        case .pending:
            ProgressView()
                .controlSize(.mini)
                .accessibilityLabel("Asking")
        case .skip:
            Image(systemName: "minus.circle")
                .foregroundStyle(theme.textTertiary)
                .accessibilityLabel("No answer")
        case .pass:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(theme.textAccent)
                .accessibilityLabel("Passed")
        case .warn:
            /* The theme has no amber; the tool rows use the system orange
               for a warning too (ToolCheckRow). */
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.orange)
                .accessibilityLabel("Warning")
        case .fail:
            Image(systemName: "xmark.octagon.fill")
                .foregroundStyle(theme.danger)
                .accessibilityLabel("Failed")
        }
    }

    private func chipStyle(_ tone: RelayCheck.PillTone) -> Chip.Style {
        switch tone {
        case .pass: return .accent
        case .fail: return .danger
        case .warn, .outline, .plain: return .neutral
        }
    }

    private func figure(_ text: String) -> some View {
        Text(text)
            .font(AturiFont.caption2)
            .foregroundStyle(theme.textTertiary)
            .lineLimit(1)
    }
}

// MARK: - Pieces

/// The verdict at the head of the results, the web's `ToolVerdict`: a mark
/// in the verdict's tone, the title, and a sentence.
private struct RelayVerdictCard: View {
    let tone: RelayCheck.VerdictTone
    let title: String
    let text: String

    @Environment(\.aturiTheme) private var theme

    private var tint: Color {
        switch tone {
        case .pass: return theme.textAccent
        case .warn: return .orange
        case .fail: return theme.danger
        case .pending: return theme.textTertiary
        }
    }

    private var systemImage: String {
        switch tone {
        case .pass: return "checkmark.circle.fill"
        case .warn: return "exclamationmark.triangle.fill"
        case .fail: return "xmark.octagon.fill"
        case .pending: return "circle.dotted"
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Group {
                if tone == .pending {
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
                Text(title)
                    .font(AturiFont.subtitle)
                    .foregroundStyle(theme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(text)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
        .overlay(
            RoundedRectangle(cornerRadius: AturiTheme.cardRadius, style: .continuous)
                .strokeBorder(tint.opacity(0.45), lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}

/// What could not be run, the web's `ToolError`, with a retry when there
/// is one.
private struct RelayNotice: View {
    let text: String
    var retry: (() -> Void)? = nil

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(text, systemImage: "exclamationmark.triangle")
                .font(AturiFont.footnote)
                .foregroundStyle(theme.danger)
                .fixedSize(horizontal: false, vertical: true)
            if let retry {
                Button {
                    retry()
                } label: {
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

/// The crawl request, the web's `ToolCode`: fixed-width, scrolling sideways
/// rather than wrapping, with a button to copy it.
private struct RelayCommandBlock: View {
    let command: String

    @State private var copied = false
    @State private var resetTask: Task<Void, Never>? = nil
    @Environment(\.aturiTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            ScrollView(.horizontal, showsIndicators: false) {
                Text(command)
                    .font(AturiFont.monoFont(.caption))
                    .foregroundStyle(theme.textPrimary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: true, vertical: true)
                    .padding(10)
            }
            .background(theme.surfaceSubtle, in: RoundedRectangle(cornerRadius: AturiTheme.controlRadius, style: .continuous))
            Button(action: copy) {
                Label(copied ? "Copied" : "Copy command", systemImage: copied ? "checkmark" : "doc.on.doc")
            }
            .buttonStyle(.aturiSecondary)
            .sensoryFeedback(.success, trigger: copied) { _, now in now }
        }
    }

    private func copy() {
        UIPasteboard.general.string = command
        copied = true
        resetTask?.cancel()
        resetTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            guard !Task.isCancelled else { return }
            copied = false
        }
    }
}
