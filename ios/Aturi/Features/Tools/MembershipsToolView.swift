import SwiftUI
import AturiCore

/// `/tools/memberships`, port of `src/components/tools/Memberships.tsx`:
/// the lists an account is on and the accounts that have verified it. The
/// logic is `Memberships`, the requests `MembershipsClient` and the run
/// `MembershipsModel` (AturiCore); this runs them and draws the result. The
/// input is `?account=`, which is what the explorer links.
///
/// The first page of lists and the verifications load with the page.
/// Further pages of lists load on a button, since a well-known account is
/// on tens of thousands and each one takes two lookups to describe.
struct MembershipsToolView: View {
    let query: [String: String]

    @State private var model = MembershipsModel()
    @State private var text = ""
    @State private var input: Memberships.AccountInput? = nil
    @State private var started = false
    @State private var showAllVerifications = false

    @Environment(\.aturiTheme) private var theme

    init(query: [String: String]) {
        self.query = query
    }

    private static let examples = ["bsky.app", "atproto.com", "aturi.to"]
    /// Verifications listed before the rest are folded behind "Show all".
    private static let verificationsShown = 6

    private var shareQuery: [String: String] {
        guard let actor = input?.actor else { return [:] }
        return ["account": actor]
    }

    var body: some View {
        ToolFrame(slug: "memberships", shareQuery: shareQuery) {
            VStack(alignment: .leading, spacing: 10) {
                ToolInputBar(
                    placeholder: "Handle or DID",
                    text: $text,
                    buttonTitle: "Look up",
                    isRunning: model.isLoading
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
        .onAppear(perform: readQuery)
    }

    @ViewBuilder
    private var results: some View {
        if let reason = input?.reason {
            ToolCheckRow(status: .warn, title: reason)
                .padding(.horizontal, 14)
                .padding(.vertical, 4)
                .cardBackground()
        }
        switch model.account {
        case .idle:
            EmptyView()
        case .failed(let message):
            ErrorPanel(message: message) {
                model.retry()
            }
        case .loading:
            AccountCheckVerdict(
                title: "Looking up \(model.actor ?? "")",
                text: "Resolving the account.",
                tone: .plain,
                busy: true
            )
            SkeletonRows(count: 4)
        case .loaded(let account):
            loaded(account)
        }
        if input == nil {
            intro
        }
    }

    // MARK: The answer

    private func who(_ account: MembershipsClient.Account) -> String {
        account.handle.map { "@\($0)" } ?? shortDid(account.did)
    }

    private func standing(_ account: MembershipsClient.Account) -> String {
        if account.verified { return "Bluesky shows this account as verified." }
        if account.trustedVerifier { return "Bluesky treats this account as a trusted verifier, which can verify others." }
        if account.onBluesky { return "Bluesky does not show this account as verified." }
        return "Bluesky\u{2019}s AppView has no profile for this account, so only the records themselves are shown."
    }

    @ViewBuilder
    private func loaded(_ account: MembershipsClient.Account) -> some View {
        let settled = model.isSettled
        let name = who(account)
        let summary = Memberships.membershipSummary(lists: model.listTotal, verifications: model.verifications.value?.total)
        AccountCheckVerdict(
            title: settled ? "\(name) \(summary)" : "Looking up \(name)",
            text: settled ? standing(account) : "Asking Constellation which records point at this account.",
            tone: .plain,
            busy: !settled
        )
        verificationsSection
        listsSections
        accountSection(account, name: name)
        MicrocosmCredit()
    }

    // MARK: Verifications

    private var verificationsSection: some View {
        let total = model.verifications.value?.total ?? 0
        return ToolSection("Verifications", detail: total > 0 ? Labels.formatCount(total) : nil) {
            switch model.verifications {
            case .idle, .loading:
                SkeletonRows(count: 2)
            case .failed(let message):
                MembershipsInlineError(message: message) {
                    model.retry()
                }
            case .loaded(let list):
                if list.items.isEmpty {
                    Text("No account has published a verification of this one.")
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    let shown = showAllVerifications ? list.items : Array(list.items.prefix(Self.verificationsShown))
                    ForEach(Array(shown.enumerated()), id: \.offset) { pair in
                        if pair.offset > 0 {
                            Divider()
                        }
                        MembershipsVerificationRow(item: pair.element)
                    }
                    if list.items.count > Self.verificationsShown && !showAllVerifications {
                        Button("Show all \(Labels.formatCount(list.items.count))") {
                            showAllVerifications = true
                        }
                        .buttonStyle(.aturiSecondary)
                        .padding(.top, 10)
                    }
                }
            }
        }
    }

    // MARK: Lists

    @ViewBuilder
    private var listsSections: some View {
        switch model.lists {
        case .idle, .loading:
            ToolSection("Lists") {
                SkeletonRows(count: 4)
            }
        case .failed(let message):
            ToolSection("Lists") {
                MembershipsInlineError(message: message) {
                    model.retry()
                }
            }
        case .loaded:
            let items = model.items
            if items.isEmpty {
                ToolSection("Lists") {
                    Text("No list includes this account.")
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textSecondary)
                }
            } else {
                let groups = model.groups
                listSection("Curation lists", hint: "Lists people follow or build feeds from.", items: groups.curate)
                listSection("Moderation lists", hint: "Lists whose subscribers mute or block everyone on them.", items: groups.mod)
                listSection("Starter packs", hint: "The member list behind a starter pack.", items: groups.reference)
                listSection(
                    "Unavailable lists",
                    hint: "The list was deleted, or the account behind it is gone. The index still counts the membership.",
                    items: groups.unavailable
                )
                moreControls
            }
        }
    }

    @ViewBuilder
    private func listSection(_ title: String, hint: String, items: [Memberships.Membership]) -> some View {
        if !items.isEmpty {
            ToolSection(title, detail: "\(Labels.formatCount(items.count)) loaded. \(hint)") {
                ForEach(Array(items.enumerated()), id: \.offset) { pair in
                    if pair.offset > 0 {
                        Divider()
                    }
                    MembershipsListRow(item: pair.element)
                }
            }
        }
    }

    private var moreControls: some View {
        let loaded = model.loadedRecords
        let words: String
        if let total = model.listTotal {
            words = "\(Labels.formatCount(min(loaded, total))) of \(Labels.formatCount(total)) memberships loaded, newest first"
        } else {
            words = "\(Labels.formatCount(loaded)) memberships loaded, newest first"
        }
        return VStack(alignment: .leading, spacing: 10) {
            if model.cursor != nil {
                Button {
                    model.loadMore()
                } label: {
                    HStack(spacing: 6) {
                        if model.isLoadingMore {
                            ProgressView()
                                .controlSize(.small)
                        }
                        Text(model.isLoadingMore ? "Loading\u{2026}" : "Load \(Memberships.listPageSize) more")
                    }
                }
                .buttonStyle(.aturiSecondary)
                .disabled(model.isLoadingMore)
            }
            Text(words)
                .font(AturiFont.caption)
                .foregroundStyle(theme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
            if let error = model.moreError {
                MembershipsInlineError(message: error) {
                    model.loadMore()
                }
            }
        }
    }

    // MARK: The account

    private func accountSection(_ account: MembershipsClient.Account, name: String) -> some View {
        ToolSection("Account") {
            ToolFactRow(label: "Account", value: account.displayName.map { "\($0) (\(name))" } ?? name, mono: false)
            CopyRow(label: "DID", value: account.did)
            NavigationLink(value: Route.repo(account.did)) {
                Text("Open in the Explorer")
                    .font(AturiFont.footnote)
            }
            .buttonStyle(.aturiSecondary)
            .padding(.top, 8)
        }
    }

    private var intro: some View {
        ToolIntro("What it finds", items: [
            (
                "Lists that include the account",
                "Every app.bsky.graph.listitem record that names it, wherever it was written, with the list each one belongs to."
            ),
            (
                "What each list is for",
                "Curation lists, moderation lists and the member lists behind starter packs are shown apart, with who made each one and how many are on it."
            ),
            (
                "Who has verified it",
                "Every app.bsky.graph.verification record that names it, and whether Bluesky trusts the account that wrote it."
            ),
        ])
    }

    // MARK: Input

    /// The input a link handed the page, read once, and run when it is filled.
    private func readQuery() {
        guard !started else { return }
        started = true
        let raw = query["account"] ?? ""
        text = raw
        if !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            run(raw)
        }
    }

    private func run(_ raw: String) {
        let parsed = Memberships.parseAccountInput(raw)
        input = parsed
        if let actor = parsed.actor {
            if actor != model.actor {
                showAllVerifications = false
            }
            model.load(actor)
        } else {
            model.clear()
        }
    }
}

// MARK: - Rows

private enum MembershipsWords {
    static func date(_ iso: String?) -> String? {
        guard let iso, let date = Formatting.isoDate(iso) else { return nil }
        return date.formatted(date: .abbreviated, time: .omitted)
    }
}

/// A failure inside a section, with a way to try again.
private struct MembershipsInlineError: View {
    let message: String
    let retry: () -> Void

    @Environment(\.aturiTheme) private var theme

    init(message: String, retry: @escaping () -> Void) {
        self.message = message
        self.retry = retry
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label(message, systemImage: "exclamationmark.triangle")
                .font(AturiFont.footnote)
                .foregroundStyle(theme.danger)
                .fixedSize(horizontal: false, vertical: true)
            Button("Retry", action: retry)
                .buttonStyle(.aturiSecondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

/// One list the account is on, port of `ListRow`: the list (opening its
/// record), who made it and how many are on it, and when the account was
/// added. A list that could not be described says why instead.
private struct MembershipsListRow: View {
    let item: Memberships.Membership

    @Environment(\.aturiTheme) private var theme

    init(item: Memberships.Membership) {
        self.item = item
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            listAvatar
            VStack(alignment: .leading, spacing: 3) {
                if let list = item.list {
                    described(list)
                } else {
                    Text(item.listUri == nil ? "Membership record could not be read" : "List no longer available")
                        .font(AturiFont.sans(.subheadline, weight: .semibold))
                        .foregroundStyle(theme.textSecondary)
                    Text(item.listUri ?? item.itemUri)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textTertiary)
                        .lineLimit(2)
                        .truncationMode(.middle)
                        .textSelection(.enabled)
                }
                if let added = MembershipsWords.date(item.addedAt) {
                    Text("Added \(added)")
                        .font(AturiFont.caption)
                        .foregroundStyle(theme.textTertiary)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 8)
    }

    @ViewBuilder
    private var listAvatar: some View {
        if let avatar = item.list?.avatar {
            AvatarView(url: avatar, size: 32, squareCornerRadius: 6)
        } else {
            Image(systemName: "list.bullet")
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textTertiary)
                .frame(width: 32, height: 32)
                .background(theme.bgTertiary, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .accessibilityHidden(true)
        }
    }

    @ViewBuilder
    private func described(_ list: Memberships.ListInfo) -> some View {
        let curator = list.creator.handle.map { "@\($0)" } ?? shortDid(list.creator.did)
        let size: String? = list.memberCount.map { "\(Labels.formatCount($0)) \($0 == 1 ? "member" : "members")" }
        if let route = Route(atUri: list.uri) {
            NavigationLink(value: route) {
                Text(list.name)
                    .font(AturiFont.sans(.subheadline, weight: .semibold))
                    .foregroundStyle(theme.textAccent)
                    .multilineTextAlignment(.leading)
            }
            .buttonStyle(.plain)
        } else {
            Text(list.name)
                .font(AturiFont.sans(.subheadline, weight: .semibold))
                .foregroundStyle(theme.textPrimary)
        }
        HStack(spacing: 4) {
            Text("by")
                .foregroundStyle(theme.textTertiary)
            NavigationLink(value: Route.repo(list.creator.did)) {
                Text(curator)
                    .foregroundStyle(theme.textAccent)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .buttonStyle(.plain)
            if let size {
                Text("\u{00B7} \(size)")
                    .foregroundStyle(theme.textTertiary)
                    .lineLimit(1)
            }
        }
        .font(AturiFont.caption)
        if let description = list.description {
            Text(description)
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textSecondary)
                .lineLimit(4)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

/// How a verification stands, port of the component's `STANDING`.
private enum MembershipsStanding {
    static func word(_ standing: Memberships.VerificationStanding) -> String {
        switch standing {
        case .valid: return "Counts on Bluesky"
        case .stale: return "No longer counts"
        case .unlisted: return "Not counted"
        case .untrusted: return "Not a trusted verifier"
        }
    }

    static func title(_ standing: Memberships.VerificationStanding) -> String {
        switch standing {
        case .valid: return "From a trusted verifier, and still matches the account."
        case .stale: return "From a trusted verifier, but the name or handle it vouched for has changed since."
        case .unlisted: return "From a trusted verifier, but Bluesky does not count it for this account."
        case .untrusted: return "Anyone can write a verification record. Bluesky only shows those from verifiers it trusts."
        }
    }

    static func tone(_ standing: Memberships.VerificationStanding) -> AccountCheckTone {
        switch standing {
        case .valid: return .ok
        case .stale: return .warn
        case .unlisted, .untrusted: return .plain
        }
    }
}

/// One verification of the account, port of `VerificationRow`: who issued
/// it (opening their repo), what it vouched for, and how it stands.
private struct MembershipsVerificationRow: View {
    let item: Memberships.Verification

    @Environment(\.aturiTheme) private var theme

    init(item: Memberships.Verification) {
        self.item = item
    }

    private var name: String {
        if let displayName = item.issuer.displayName { return displayName }
        if let handle = item.issuer.handle { return "@\(handle)" }
        return shortDid(item.issuer.did)
    }

    private var vouched: String {
        var parts: [String] = []
        if let displayName = item.displayName, !displayName.isEmpty {
            parts.append("\u{201C}\(displayName)\u{201D}")
        }
        if let handle = item.handle, !handle.isEmpty {
            parts.append("@\(handle)")
        }
        let lead = parts.isEmpty ? "Verified this account" : "Verified as \(parts.joined(separator: ", "))"
        guard let when = MembershipsWords.date(item.createdAt) else { return lead }
        return "\(lead) \u{00B7} \(when)"
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            AvatarView(url: item.issuer.avatar, size: 32)
            VStack(alignment: .leading, spacing: 4) {
                NavigationLink(value: Route.repo(item.issuer.did)) {
                    Text(name)
                        .font(AturiFont.sans(.subheadline, weight: .semibold))
                        .foregroundStyle(theme.textAccent)
                        .lineLimit(1)
                }
                .buttonStyle(.plain)
                Text(vouched)
                    .font(AturiFont.caption)
                    .foregroundStyle(theme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
                AccountCheckPill(text: MembershipsStanding.word(item.standing), tone: MembershipsStanding.tone(item.standing))
                    .accessibilityHint(MembershipsStanding.title(item.standing))
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 8)
    }
}
