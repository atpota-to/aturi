import SwiftUI
import AturiCore

/// `/tools/shadowban`, port of `src/components/tools/ShadowbanChecker.tsx`:
/// an account's repository on its PDS compared with what an AppView shows
/// of it, and what the AppView leaves out. A post that was entered is
/// checked on its own, and its author in full. The logic is `Shadowban`,
/// the requests `ShadowbanClient` and the run `ShadowbanToolModel`
/// (AturiCore); the check rows and post rows are the explorer's own
/// (`RepoVisibilityCheckRow`, `RepoVisibilityPostRow`). The input is
/// `?subject=` and `?appview=` (a listed AppView's id, or any host; empty
/// for Bluesky's).
struct ShadowbanToolView: View {
    let query: [String: String]

    @State private var model = ShadowbanToolModel()
    @State private var text = ""
    /// The subject as last submitted, for the share link.
    @State private var raw = ""
    @State private var input: Shadowban.ShadowbanInput? = nil
    /// The `appview` parameter: empty for Bluesky's.
    @State private var appviewParam = ""
    @State private var typingHost = false
    @State private var hostDraft = ""
    @State private var started = false

    @Environment(\.aturiTheme) private var theme

    init(query: [String: String]) {
        self.query = query
    }

    private static let examples = ["bsky.app", "atproto.com", "aturi.to"]

    private var target: Shadowban.ShadowbanTarget? {
        if case .ok(let target)? = input { return target }
        return nil
    }

    private var invalidReason: String? {
        if case .invalid(let reason)? = input { return reason }
        return nil
    }

    private var choice: Shadowban.AppViewChoice {
        Shadowban.readAppViewParam(appviewParam)
    }

    private var appview: Shadowban.AppView? {
        if case .ok(let appview) = choice { return appview }
        return nil
    }

    private var appviewProblem: String? {
        if case .invalid(let reason) = choice { return reason }
        return nil
    }

    private var shareQuery: [String: String] {
        guard target != nil else { return [:] }
        var out = ["subject": raw.trimmingCharacters(in: .whitespacesAndNewlines)]
        if let appview = appview, appview.param != Shadowban.defaultAppView.param {
            out["appview"] = appview.param
        }
        return out
    }

    var body: some View {
        ToolFrame(slug: "shadowban", shareQuery: shareQuery) {
            VStack(alignment: .leading, spacing: 10) {
                ToolInputBar(
                    placeholder: "Handle, DID, or a link to a post",
                    text: $text,
                    buttonTitle: "Check",
                    isRunning: model.run.status == .loading
                ) {
                    submit(text)
                }
                ToolExamples(examples: Self.examples) { example in
                    text = example
                    submit(example)
                }
                appviewPicker
            }
        } content: {
            results
        }
        .onAppear(perform: readQuery)
    }

    // MARK: Which AppView

    /// The listed AppViews as chips, and any other by host. "Other" only
    /// opens the field; nothing changes until a host is submitted.
    private var appviewPicker: some View {
        let current = appview
        let custom = (current.map { !$0.listed } ?? false) || appviewProblem != nil
        let open = typingHost || custom
        return VStack(alignment: .leading, spacing: 8) {
            Text("AppView")
                .aturiLabel()
                .foregroundStyle(theme.textTertiary)
            HStack(spacing: 6) {
                ForEach(Shadowban.appViews, id: \.param) { listed in
                    let mine = !open && current?.param == listed.param
                    Button {
                        typingHost = false
                        setAppView(listed.param)
                    } label: {
                        Chip(listed.name, style: mine ? .accent : .neutral)
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(mine ? .isSelected : [])
                    .accessibilityHint(listed.origin.replacingOccurrences(of: "https://", with: ""))
                }
                Button {
                    if !typingHost {
                        hostDraft = current.map { $0.listed ? "" : $0.param } ?? hostDraft
                    }
                    typingHost = true
                } label: {
                    Chip("Other", style: open ? .accent : .neutral)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(open ? .isSelected : [])
            }
            if open {
                HStack(spacing: 8) {
                    TextField("appview.example.com", text: $hostDraft)
                        .font(AturiFont.body)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .submitLabel(.done)
                        .onSubmit(useHost)
                        .padding(.horizontal, 12)
                        .frame(minHeight: 40)
                        .background(theme.bgSecondary, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).strokeBorder(theme.borderStrong, lineWidth: 1))
                        .accessibilityLabel("AppView host")
                    Button("Use", action: useHost)
                        .buttonStyle(.aturiSecondary)
                        .disabled(hostDraft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            if let problem = appviewProblem {
                Text(problem)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func useHost() {
        let host = hostDraft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !host.isEmpty else { return }
        // A listed AppView's host selects its chip; any other keeps the field open.
        typingHost = false
        setAppView(host)
    }

    /// Kept in its canonical form, so a typed host for a listed AppView
    /// reads as that AppView, and Bluesky as nothing.
    private func setAppView(_ param: String) {
        let value: String
        if case .ok(let read) = Shadowban.readAppViewParam(param) {
            value = read.param
        } else {
            value = param
        }
        appviewParam = value == Shadowban.defaultAppView.param ? "" : value
        rerun()
    }

    // MARK: The answer

    @ViewBuilder
    private var results: some View {
        if let reason = invalidReason {
            ToolCheckRow(status: .warn, title: reason)
                .padding(.horizontal, 14)
                .padding(.vertical, 4)
                .cardBackground()
        }
        if model.run.status == .error {
            ErrorPanel(message: model.run.error ?? "Something went wrong") {
                model.recheck()
            }
        } else if let target = target, let appview = appview {
            let evidence = model.run.data ?? Shadowban.Evidence(target: target, appview: appview)
            loaded(evidence)
        }
        if input == nil {
            intro
        }
    }

    private func postUri(_ evidence: Shadowban.Evidence) -> String? {
        guard case .post(let actor, let rkey) = evidence.target else { return nil }
        return "at://\(evidence.identity?.did ?? actor)/\(Shadowban.postCollection)/\(rkey)"
    }

    @ViewBuilder
    private func loaded(_ evidence: Shadowban.Evidence) -> some View {
        let now = evidence.checkedAt ?? Date()
        let postChecks = Shadowban.buildPostChecks(evidence, now: now)
        let accountChecks = Shadowban.buildAccountChecks(evidence, now: now)
        let verdict = Shadowban.shadowbanVerdict(evidence, checks: postChecks + accountChecks)
        let posts = evidence.posts?.value ?? []
        let uri = postUri(evidence)

        AccountCheckVerdict(
            title: verdict.title,
            text: verdict.text,
            tone: AccountCheckTone.verdict(verdict.tone),
            busy: verdict.tone == .pending
        )

        if let uri {
            VStack(alignment: .leading, spacing: 8) {
                heading("This post")
                ShadowbanTargetPost(evidence: evidence, uri: uri, now: now)
                checkList(postChecks)
            }
        }

        VStack(alignment: .leading, spacing: 8) {
            if uri == nil {
                heading("Checks")
            } else {
                heading("Account checks", showsAgain: false)
            }
            checkList(accountChecks)
        }

        if let identity = evidence.identity {
            accountSection(identity, evidence: evidence)
        }

        if !posts.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Recent posts")
                        .font(AturiFont.sans(.subheadline, weight: .bold))
                        .foregroundStyle(theme.textPrimary)
                    Text("\(posts.count) from the PDS")
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textTertiary)
                }
                .accessibilityElement(children: .combine)
                .accessibilityAddTraits(.isHeader)
                VStack(spacing: 0) {
                    ForEach(Array(posts.enumerated()), id: \.offset) { pair in
                        if pair.offset > 0 {
                            Divider()
                        }
                        RepoVisibilityPostRow(post: pair.element, evidence: evidence, now: now)
                    }
                }
                .cardBackground()
            }
        }
    }

    /// A section's title, with "Check again" (or "Checking…") beside it.
    private func heading(_ title: String, showsAgain: Bool = true) -> some View {
        HStack(alignment: .firstTextBaseline) {
            Text(title)
                .font(AturiFont.sans(.subheadline, weight: .bold))
                .foregroundStyle(theme.textPrimary)
                .accessibilityAddTraits(.isHeader)
            Spacer(minLength: 8)
            if showsAgain {
                if model.run.status == .loading {
                    Text("Checking\u{2026}")
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textTertiary)
                } else {
                    Button("Check again") {
                        model.recheck()
                    }
                    .font(AturiFont.sans(.footnote, weight: .medium))
                    .foregroundStyle(theme.textAccent)
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private func checkList(_ checks: [Shadowban.ShadowbanCheck]) -> some View {
        VStack(spacing: 0) {
            ForEach(Array(checks.enumerated()), id: \.offset) { pair in
                if pair.offset > 0 {
                    Divider()
                }
                RepoVisibilityCheckRow(check: pair.element)
            }
        }
        .cardBackground()
    }

    private func accountSection(_ identity: Shadowban.Identity, evidence: Shadowban.Evidence) -> some View {
        let profile = evidence.profile?.found
        let handle = profile?.handle ?? identity.handle
        let who = handle.map { "@\($0)" } ?? shortDid(identity.did)
        let pdsHost = identity.pds
            .replacingOccurrences(of: "https://", with: "")
            .replacingOccurrences(of: "http://", with: "")
        let appviewHost = evidence.appview.origin
            .replacingOccurrences(of: "https://", with: "")
            .replacingOccurrences(of: "http://", with: "")
        return ToolSection("Account") {
            ToolFactRow(label: "Account", value: profile?.displayName.map { "\($0) (\(who))" } ?? who, mono: false)
            CopyRow(label: "DID", value: identity.did)
            NavigationLink(value: Route.pds(host: pdsHost)) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("PDS")
                        .font(AturiFont.caption)
                        .foregroundStyle(theme.textTertiary)
                    Text(pdsHost)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textAccent)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 6)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            ToolFactRow(label: "AppView", value: appviewHost)
            VStack(alignment: .leading, spacing: 8) {
                NavigationLink(value: Route.repo(identity.did)) {
                    Text("Open the account in the Explorer")
                        .font(AturiFont.footnote)
                }
                .buttonStyle(.aturiSecondary)
                NavigationLink(value: Route.tool(slug: "labels", query: ["subject": identity.did])) {
                    Text("Check the account\u{2019}s labels")
                        .font(AturiFont.footnote)
                }
                .buttonStyle(.aturiSecondary)
            }
            .padding(.top, 8)
        }
    }

    private var intro: some View {
        ToolSection("How it works") {
            VStack(alignment: .leading, spacing: 12) {
                ShadowbanIntroItem(
                    term: "Posts on the PDS",
                    text: "The account\u{2019}s 25 latest posts, read from its PDS. AppViews can\u{2019}t change this copy."
                )
                ShadowbanIntroItem(
                    term: "Posts on the AppView",
                    text: "Each of those posts from the AppView. One the PDS has and the AppView won\u{2019}t return is hidden. A linked post is checked too."
                )
                ShadowbanIntroItem(
                    term: "Replies in threads",
                    text: "Each recent reply under its parent. Bluesky\u{2019}s \u{201C}needs review\u{201D} shows as a reply that opens alone but is missing from the thread. Blocks and reply limits are ruled out first."
                )
                ShadowbanIntroItem(
                    term: "Search",
                    text: "The account by handle and its posts by author. Found by typeahead but not by full search means it is left out of search."
                )
            }
        }
    }

    // MARK: Input

    /// The input a link handed the page, read once, and run when it is filled.
    private func readQuery() {
        guard !started else { return }
        started = true
        appviewParam = query["appview"] ?? ""
        let subject = query["subject"] ?? ""
        text = subject
        if !subject.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            submit(subject)
        }
    }

    private func submit(_ value: String) {
        raw = value
        input = Shadowban.parseShadowbanInput(value)
        rerun()
    }

    /// Check the subject in force on the AppView in force.
    private func rerun() {
        if let target = target, let appview = appview {
            model.check(target, appview: appview)
        } else {
            model.clear()
        }
    }
}

// MARK: - The post asked about

/// The post that was asked about: its full text, how it came out, and its
/// address. Port of `TargetPost` and the `PostPills` it draws.
private struct ShadowbanTargetPost: View {
    let evidence: Shadowban.Evidence
    let uri: String
    let now: Date

    @Environment(\.aturiTheme) private var theme

    init(evidence: Shadowban.Evidence, uri: String, now: Date) {
        self.evidence = evidence
        self.uri = uri
        self.now = now
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            switch evidence.post {
            case nil:
                Text("Reading the post from the PDS\u{2026}")
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
            case .failed?:
                missing("The post couldn\u{2019}t be read from the PDS.")
            case .ok(let maybe)?:
                if let record = maybe {
                    foundPost(record)
                } else {
                    missing("There\u{2019}s no post at this address on the PDS.")
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }

    @ViewBuilder
    private func missing(_ words: String) -> some View {
        Text(words)
            .font(AturiFont.footnote)
            .foregroundStyle(theme.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
        CopyRow(label: "Post", value: uri)
    }

    private static func kind(_ post: Shadowban.RepoPost) -> String {
        guard let reply = post.reply else { return "Post" }
        return Shadowban.authorOf(reply.root) == Shadowban.authorOf(post.uri) ? "Reply in its own thread" : "Reply"
    }

    private static func tone(_ outcome: Shadowban.ReplyReading.Outcome) -> AccountCheckTone {
        switch outcome {
        case .shown: return .ok
        case .hidden: return .bad
        case .explained: return .warn
        case .unknown: return .plain
        }
    }

    private func presencePill(_ presence: Shadowban.PostPresence) -> AccountCheckPill {
        switch presence {
        case .shown: return AccountCheckPill(text: "On \(evidence.appview.name)", tone: .ok)
        case .missing: return AccountCheckPill(text: "Missing", tone: .bad)
        case .new: return AccountCheckPill(text: "Too new to tell", tone: .plain)
        case .pending: return AccountCheckPill(text: evidence.done ? "Not compared" : "\u{2026}", tone: .plain)
        }
    }

    /// Post search returns the author's latest posts, so only a post among
    /// the recent ones, shown by the AppView and old enough to be indexed,
    /// can be said to be missing from it.
    private func notInSearch(_ post: Shadowban.RepoPost, presence: Shadowban.PostPresence) -> Bool {
        let recent = evidence.posts?.value?.contains { $0.uri == post.uri } ?? false
        guard recent, presence == .shown, let searched = evidence.postSearch?.value, let writtenAt = post.writtenAt else {
            return false
        }
        return now.timeIntervalSince(writtenAt) >= Shadowban.searchGrace && !searched.contains(post.uri)
    }

    @ViewBuilder
    private func foundPost(_ record: Shadowban.RepoPost) -> some View {
        let text = record.text.trimmingCharacters(in: .whitespacesAndNewlines)
        let presence = Shadowban.postPresence(record, shown: evidence.postShown, now: now)
        let reading = evidence.postThread?.value.map { Shadowban.readReply($0, author: evidence.identity?.did ?? "") }
        let when = record.writtenAt.map { " \u{00B7} \(Formatting.relative($0))" } ?? ""
        Text(text.isEmpty ? "No text" : text)
            .font(AturiFont.body)
            .foregroundStyle(text.isEmpty ? theme.textTertiary : theme.textPrimary)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
        Text("\(Self.kind(record))\(when)")
            .font(AturiFont.caption)
            .foregroundStyle(theme.textTertiary)
        HStack(spacing: 6) {
            presencePill(presence)
            if let reading {
                AccountCheckPill(text: reading.label, tone: Self.tone(reading.outcome))
                    .accessibilityHint(reading.reason)
            }
            if notInSearch(record, presence: presence) {
                AccountCheckPill(text: "Not in search", tone: .warn)
            }
        }
        CopyRow(label: "Post", value: record.uri)
        VStack(alignment: .leading, spacing: 8) {
            NavigationLink(value: Route.record(repo: Shadowban.authorOf(record.uri), collection: Shadowban.postCollection, rkey: record.rkey)) {
                Text("Open the post in the Explorer")
                    .font(AturiFont.footnote)
            }
            .buttonStyle(.aturiSecondary)
            NavigationLink(value: Route.tool(slug: "labels", query: ["subject": uri])) {
                Text("Check the post\u{2019}s labels")
                    .font(AturiFont.footnote)
            }
            .buttonStyle(.aturiSecondary)
        }
    }
}

/// A term and its explanation, the web's `ToolIntro` row.
private struct ShadowbanIntroItem: View {
    let term: String
    let text: String

    @Environment(\.aturiTheme) private var theme

    init(term: String, text: String) {
        self.term = term
        self.text = text
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(term)
                .font(AturiFont.sans(.subheadline, weight: .semibold))
                .foregroundStyle(theme.textPrimary)
            Text(text)
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}
