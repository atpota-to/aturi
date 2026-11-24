import SwiftUI
import AturiCore

/// `/tools/labels`, port of `src/components/tools/LabelChecker.tsx`: the
/// labels on an account or a post, who applied each one and what it means.
/// The logic is `Labels`, the requests `LabelsClient` and the two runs
/// `LabelsToolModel` (AturiCore); the label cards are the explorer's own
/// (`RepoLabelGroupCard`). The input is `?subject=` (a handle, a DID, an
/// at:// URI or a profile or post link) and `?labelers=`, labelers added
/// by hand, comma-separated.
///
/// Two runs, both automatic. The first is small and answers quickly:
/// Bluesky's own labeler, the subject's self-labels and any labelers added
/// by hand. The second, a scan of every labeler on the network, starts as
/// soon as the first is in. It is a few dozen requests, a few at a time,
/// and can be stopped part way; whatever it found by then stays.
struct LabelsToolView: View {
    let query: [String: String]

    @State private var model = LabelsToolModel()
    @State private var text = ""
    /// The subject as last submitted, for the share link and the verdict.
    @State private var raw = ""
    @State private var input: Labels.LabelInput? = nil
    @State private var added: [String] = []
    @State private var labelerDraft = ""
    @State private var labelerProblem: String? = nil
    @State private var started = false
    @State private var now = Date()

    @Environment(\.aturiTheme) private var theme

    init(query: [String: String]) {
        self.query = query
    }

    private static let examples = ["bsky.app", "atproto.com", "aturi.to"]

    private var target: Labels.LabelTarget? {
        if case .ok(let target)? = input { return target }
        return nil
    }

    private var invalidReason: String? {
        if case .invalid(let reason)? = input { return reason }
        return nil
    }

    private var shareQuery: [String: String] {
        guard target != nil else { return [:] }
        var out = ["subject": raw.trimmingCharacters(in: .whitespacesAndNewlines)]
        if !added.isEmpty {
            out["labelers"] = added.joined(separator: ",")
        }
        return out
    }

    var body: some View {
        ToolFrame(slug: "labels", shareQuery: shareQuery) {
            VStack(alignment: .leading, spacing: 10) {
                ToolInputBar(
                    placeholder: "Handle, DID, or a link to a post",
                    text: $text,
                    buttonTitle: "Check",
                    isRunning: model.base.status == .loading
                ) {
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
        .onAppear(perform: readQuery)
    }

    @ViewBuilder
    private var results: some View {
        if let reason = invalidReason {
            ToolCheckRow(status: .warn, title: reason)
                .padding(.horizontal, 14)
                .padding(.vertical, 4)
                .cardBackground()
        }
        if target != nil {
            switch model.base.status {
            case .idle:
                EmptyView()
            case .loading:
                AccountCheckVerdict(
                    title: "Checking \(raw.trimmingCharacters(in: .whitespacesAndNewlines))",
                    text: "Asking Bluesky\u{2019}s moderation service.",
                    tone: .plain,
                    busy: true
                )
                SkeletonRows(count: 3)
            case .error:
                ErrorPanel(message: model.base.error ?? "Something went wrong") {
                    model.retry()
                }
            case .done:
                if let base = model.base.data {
                    if let unavailable = base.unavailable {
                        AccountCheckVerdict(
                            title: "Bluesky will not show this",
                            text: "The AppView answered \u{201C}\(unavailable)\u{201D}. That is not a label: it means there is no \(isPost(base) ? "post" : "profile") here for labels to appear on.",
                            tone: .warn
                        )
                    } else {
                        loaded(base)
                    }
                }
            }
        }
        if input == nil {
            intro
        }
    }

    private func isPost(_ base: LabelsClient.BaseResult) -> Bool {
        if case .post = base.subject { return true }
        return false
    }

    // MARK: The answer

    private var scanning: Bool {
        model.scan.status == .loading
    }

    private func coverage(_ base: LabelsClient.BaseResult) -> String {
        let extra = base.asked.count - 1
        let others = extra > 0 ? " and \(extra == 1 ? "one labeler" : "\(extra) labelers") you added" : ""
        let first = "Asked Bluesky\u{2019}s moderation service\(others). Self-labels are included."
        if scanning {
            guard let progress = model.scan.data?.progress else { return "\(first) Listing every other labeler." }
            return "Asking every labeler: \(Labels.formatCount(progress.checked + progress.failed)) of \(Labels.formatCount(progress.total)) so far."
        }
        if model.scan.status == .done, let done = model.scan.data {
            if done.stopped {
                return "Stopped after \(Labels.formatCount(done.progress.checked)) of \(Labels.formatCount(done.progress.total)) labelers."
            }
            return "Asked all \(Labels.formatCount(done.progress.total)) labelers that publish a service record."
        }
        // The scan failed to start; the Labelers section below says why.
        return "\(first) The other labelers could not be asked."
    }

    @ViewBuilder
    private func loaded(_ base: LabelsClient.BaseResult) -> some View {
        let labels = model.allLabels
        let labelers = model.labelers
        let groups = Labels.groupLabels(labels, subjectDid: base.subject.did)
        let active = labels.filter { !$0.neg && !Labels.isExpired($0, now: now) }.count
        let who = base.view?.handle.map { "@\($0)" } ?? shortDid(base.subject.did)
        let subjectName = isPost(base) ? "this post by \(who)" : who
        let howMany = active == 1 ? "One label" : "\(active) labels"
        let found: String = active == 0 ? "No labels on \(subjectName)" : "\(howMany) on \(subjectName)"
        let title: String = scanning ? found + " so far" : found
        let sources = groups.count == 1 ? "one source" : "\(groups.count) sources"
        let finished = model.scan.status == .done && model.scan.data?.stopped == false

        AccountCheckVerdict(title: title, text: coverage(base), tone: .plain, busy: scanning)

        VStack(alignment: .leading, spacing: 8) {
            LabelsSectionHeading(title: "Labels", detail: labels.isEmpty ? nil : "\(labels.count) from \(sources)")
            if groups.isEmpty {
                EmptyState(
                    title: finished ? "No labeler has a label on this." : "None from the labelers asked so far.",
                    systemImage: "tag"
                )
            } else {
                ForEach(groups, id: \.src) { group in
                    RepoLabelGroupCard(
                        group: group,
                        labeler: labelers[group.src],
                        subjectAvatar: base.view?.avatar,
                        languages: Locale.preferredLanguages,
                        now: now
                    )
                }
            }
        }

        ToolSection("Labelers") {
            scanCard(base)
        }

        checkedSection(base, who: who)
    }

    // MARK: The scan, and labelers added by hand

    private func scanCard(_ base: LabelsClient.BaseResult) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Anyone can run a labeler, and an app only shows labels from the ones its user subscribes to. The checker asks every labeler the relay lists, \(Labels.labelersPerRequest) at a time.")
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            scanBar
            if model.scan.status == .error, let error = model.scan.error {
                Text("The scan could not start: \(error).")
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Divider()
            addedLabelers(base)
        }
    }

    @ViewBuilder
    private var scanBar: some View {
        if scanning {
            let progress = model.scan.data?.progress
            let words: String = progress.map {
                "\(Labels.formatCount($0.checked + $0.failed)) of \(Labels.formatCount($0.total))"
            } ?? "Listing labelers\u{2026}"
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 10) {
                    Button {
                        model.stopScan()
                    } label: {
                        Label("Stop", systemImage: "stop.fill")
                            .font(AturiFont.footnote)
                    }
                    .buttonStyle(.aturiSecondary)
                    Text(words)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textTertiary)
                        .lineLimit(1)
                    Spacer(minLength: 0)
                }
                ProgressView(value: Double(progress.map { Labels.scanPercent($0) } ?? 0), total: 100)
                    .tint(theme.accent)
                    .accessibilityLabel("Labelers asked")
            }
        } else {
            HStack(spacing: 10) {
                Button {
                    model.rescan()
                } label: {
                    Label("Scan again", systemImage: "arrow.clockwise")
                        .font(AturiFont.footnote)
                }
                .buttonStyle(.aturiSecondary)
                if model.scan.status == .done, let done = model.scan.data {
                    let lead = done.stopped ? "Stopped at" : "Asked"
                    let failed = done.progress.failed > 0 ? ". \(Labels.formatCount(done.progress.failed)) could not be asked" : ""
                    Text("\(lead) \(Labels.formatCount(done.progress.checked)) of \(Labels.formatCount(done.progress.total))\(failed)")
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
        }
    }

    /// What became of a labeler added by hand, the web's token states.
    private func tokenNote(_ value: String, base: LabelsClient.BaseResult) -> String? {
        guard let resolved = base.added.first(where: { $0.value == value }) else { return nil }
        guard let did = resolved.did else { return "not found" }
        if base.labelers[did] == nil { return "not a labeler" }
        return nil
    }

    private func addedLabelers(_ base: LabelsClient.BaseResult) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Ask a particular labeler")
                .aturiLabel()
                .foregroundStyle(theme.textTertiary)
            if !added.isEmpty {
                FlowingChips(values: added) { value in
                    Button {
                        removeLabeler(value)
                    } label: {
                        let note = tokenNote(value, base: base)
                        Chip(note.map { "\(value) \u{00B7} \($0)" } ?? value, systemImage: "xmark", style: note == nil ? .neutral : .danger)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Remove \(value)")
                }
            }
            if added.count < Labels.maxAddedLabelers {
                HStack(spacing: 8) {
                    TextField("Handle or DID of a labeler", text: $labelerDraft)
                        .font(AturiFont.body)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .submitLabel(.done)
                        .onSubmit(addLabeler)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 40)
                        .background(theme.bgSecondary, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(theme.borderStrong, lineWidth: 1))
                    Button("Add", action: addLabeler)
                        .buttonStyle(.aturiSecondary)
                        .disabled(labelerDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            Text(labelerProblem ?? "Handles or DIDs of labelers to ask along with Bluesky\u{2019}s.")
                .font(AturiFont.caption)
                .foregroundStyle(labelerProblem == nil ? theme.textTertiary : theme.danger)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func addLabeler() {
        let entry = labelerDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !entry.isEmpty else { return }
        guard let value = Labels.parseLabelersParam(entry).first else {
            labelerProblem = "\u{201C}\(entry)\u{201D} isn\u{2019}t a handle or DID."
            return
        }
        labelerProblem = nil
        labelerDraft = ""
        guard !added.contains(value), added.count < Labels.maxAddedLabelers else { return }
        added.append(value)
        rerun()
    }

    private func removeLabeler(_ value: String) {
        added.removeAll { $0 == value }
        rerun()
    }

    // MARK: What was checked

    private func checkedSection(_ base: LabelsClient.BaseResult, who: String) -> some View {
        let view = base.view
        let post = isPost(base)
        let subjectUri: String
        switch base.subject {
        case .post(_, let uri): subjectUri = uri
        case .account(let did): subjectUri = did
        }
        let explore: Route = Route(atUri: subjectUri) ?? .repo(base.subject.did)
        return ToolSection("Checked") {
            ToolFactRow(
                label: post ? "Author" : "Account",
                value: view?.displayName.map { "\($0) (\(who))" } ?? who,
                mono: false
            )
            CopyRow(label: "DID", value: base.subject.did)
            if post {
                CopyRow(label: "Post", value: subjectUri)
                if let postText = view?.text, !postText.isEmpty {
                    ToolFactRow(
                        label: "Text",
                        value: postText.count > 280 ? "\(postText.prefix(280))\u{2026}" : postText,
                        mono: false
                    )
                }
            }
            VStack(alignment: .leading, spacing: 8) {
                NavigationLink(value: explore) {
                    Text("Open in the Explorer")
                        .font(AturiFont.footnote)
                }
                .buttonStyle(.aturiSecondary)
                if post {
                    Button {
                        text = base.subject.did
                        submit(base.subject.did)
                    } label: {
                        Text("Check the author")
                            .font(AturiFont.footnote)
                    }
                    .buttonStyle(.aturiSecondary)
                }
            }
            .padding(.top, 8)
        }
    }

    private var intro: some View {
        ToolIntro("How it works", items: [
            (
                "Bluesky\u{2019}s own labeler",
                "Asked first, because every Bluesky user is subscribed to it. Its answer comes with the labels the account put on itself."
            ),
            (
                "Every other labeler",
                "Asked straight after. The checker lists every account with an app.bsky.labeler.service record and asks Bluesky\u{2019}s AppView which of them have labelled this."
            ),
            (
                "What each label means",
                "A label is a short value such as spam. Its name, description and what it hides come from the definitions its labeler publishes."
            ),
            (
                "What it leaves out",
                "Only labels the AppView has indexed are found, which is what Bluesky apps show. A suspension is not a label and is reported separately."
            ),
        ])
    }

    // MARK: Input

    /// The input a link handed the page, read once, and run when it is filled.
    private func readQuery() {
        guard !started else { return }
        started = true
        added = Labels.parseLabelersParam(query["labelers"] ?? "")
        let subject = query["subject"] ?? ""
        text = subject
        if !subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            submit(subject)
        }
    }

    private func submit(_ value: String) {
        raw = value
        input = Labels.parseSubjectInput(value)
        now = Date()
        rerun()
    }

    /// Check the subject in force with the labelers in force.
    private func rerun() {
        if let target = target {
            model.check(target, added: added)
        } else {
            model.clear()
        }
    }
}

/// A section's title over cards of its own, in `ToolSection`'s type.
private struct LabelsSectionHeading: View {
    let title: String
    let detail: String?

    @Environment(\.aturiTheme) private var theme

    init(title: String, detail: String?) {
        self.title = title
        self.detail = detail
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(AturiFont.sans(.subheadline, weight: .bold))
                .foregroundStyle(theme.textPrimary)
            if let detail, !detail.isEmpty {
                Text(detail)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textTertiary)
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }
}

/// Chips that wrap onto as many lines as they need.
private struct FlowingChips<Item: View>: View {
    let values: [String]
    let item: (String) -> Item

    init(values: [String], @ViewBuilder item: @escaping (String) -> Item) {
        self.values = values
        self.item = item
    }

    var body: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 6, alignment: .leading)], alignment: .leading, spacing: 6) {
            ForEach(values, id: \.self) { value in
                item(value)
            }
        }
    }
}
