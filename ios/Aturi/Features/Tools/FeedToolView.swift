import SwiftUI
import UIKit
import AturiCore

/// `/tools/feed`, port of `src/components/tools/FeedInspector.tsx`: looks
/// inside a custom feed. The record, the service it names, what that
/// service returns, and what the AppView makes of it. The logic is
/// `FeedInspector` and `FeedInspectorModel` in AturiCore; this draws it, one
/// section under another.
///
/// Reads `?feed=` (an at:// URI or a feed link, as the explorer's "Inspect
/// feed" passes it) and `?cursor=` for a later skeleton page.
struct FeedToolView: View {
    let query: [String: String]

    init(query: [String: String]) {
        self.query = query
    }

    @State private var model = FeedInspectorModel()
    @State private var text = ""
    @State private var started = false
    @State private var display: SkeletonDisplay = .posts

    @Environment(\.aturiTheme) private var theme
    @Environment(AppRouter.self) private var router: AppRouter?
    @Environment(\.openURL) private var openURL

    private enum SkeletonDisplay: Hashable {
        case posts
        case json
    }

    private static let examples = [
        ServicesExample(label: "Discover", value: "https://bsky.app/profile/bsky.app/feed/whats-hot"),
        ServicesExample(label: "For You", value: "at://did:plc:3guzzweuqraryl3rdkimjamk/app.bsky.feed.generator/for-you"),
        ServicesExample(label: "Science", value: "https://bsky.app/profile/did:plc:jfhpnnst6flqway4eaeqzj2a/feed/for-science"),
    ]

    var body: some View {
        ToolFrame(slug: "feed", shareQuery: ["feed": model.raw]) {
            VStack(alignment: .leading, spacing: 10) {
                ToolInputBar(
                    placeholder: "bsky.app/profile/…/feed/… or at://…",
                    text: $text,
                    buttonTitle: "Inspect",
                    isRunning: model.isRunning
                ) {
                    inspect(text)
                }
                ServicesExamples(examples: Self.examples) { value in
                    text = value
                    inspect(value)
                }
            }
        } content: {
            results
        }
        .onAppear(perform: start)
    }

    /// Run the input a link handed the tool, once.
    private func start() {
        guard !started else { return }
        started = true
        let feed = query["feed"] ?? ""
        guard !feed.isEmpty else { return }
        text = feed
        model.run(feed, cursor: query["cursor"] ?? "")
    }

    private func inspect(_ value: String) {
        display = .posts
        model.run(value.trimmingCharacters(in: .whitespacesAndNewlines))
    }

    private func open(_ route: Route) {
        LinkNavigation.open(route, router: router, openURL: openURL)
    }

    // MARK: Results

    @ViewBuilder
    private var results: some View {
        if let reason = model.input?.reason {
            ServicesInputError(message: reason)
        }
        if let verdict = model.verdict {
            ServicesVerdictCard(verdict: verdict)
            if model.feedUri != nil, model.record != nil || model.view != nil {
                feedCard
            }
            ToolSection("Checks", detail: model.isRunning ? "Checking…" : nil) {
                ServicesCheckList(checks: model.checks)
                if !model.isRunning {
                    Button("Check again") {
                        model.rerun()
                    }
                    .buttonStyle(.aturiSecondary)
                    .padding(.top, 8)
                }
            }
            if model.hasSkeleton, let skeleton = model.skeleton {
                skeletonSection(skeleton)
            } else if model.skeleton != nil, model.needsViewer {
                ToolSection("Skeleton") {
                    Text("No skeleton to show. The generator returns one only to a signed-in viewer, and this tool asks without one.")
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        if model.raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            ServicesIntro(items: [
                ServicesIntroItem(
                    term: "The record",
                    text: "A feed is an app.bsky.feed.generator record. It gives the feed its name and names the service that computes it, by DID."
                ),
                ServicesIntroItem(
                    term: "The service",
                    text: "That DID has to resolve, and its document has to say where the generator is, in a #bsky_fg service."
                ),
                ServicesIntroItem(
                    term: "The skeleton",
                    text: "The generator is asked for the feed with getFeedSkeleton. It answers with post addresses and nothing else, shown here in the order it gave them."
                ),
                ServicesIntroItem(
                    term: "The AppView",
                    text: "Bluesky has to have indexed the feed before an app can open it. Its view is read too, and the skeleton’s posts are filled in from it."
                ),
            ])
        }
    }

    private var feedCard: some View {
        ToolSection("Feed") {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .center, spacing: 12) {
                    if let avatar = model.view?.avatar, !avatar.isEmpty {
                        AvatarView(url: avatar, size: 44, squareCornerRadius: 10)
                    } else {
                        Image(systemName: "dot.radiowaves.up.forward")
                            .font(AturiFont.subtitle)
                            .foregroundStyle(theme.accentSoftFg)
                            .frame(width: 44, height: 44)
                            .background(theme.accentSoft, in: RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .accessibilityHidden(true)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text(model.name)
                            .font(AturiFont.subtitle)
                            .foregroundStyle(theme.textPrimary)
                            .fixedSize(horizontal: false, vertical: true)
                        if let creator = model.view?.creator {
                            Button {
                                open(.repo(creator.did))
                            } label: {
                                Text("by " + (creator.handle.isEmpty ? creator.did : "@" + creator.handle))
                                    .font(AturiFont.footnote)
                                    .foregroundStyle(theme.textAccent)
                            }
                            .buttonStyle(.plain)
                            .accessibilityHint("Opens the account in the explorer")
                        }
                    }
                    Spacer(minLength: 0)
                }
                if let description = model.feedDescription {
                    Text(description)
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let uri = model.feedUri {
                    CopyRow(label: "Feed URI", value: uri)
                }
                if let service = model.probe?.service {
                    CopyRow(label: "Service DID", value: service.did)
                }
                if let endpoint = model.probe?.service?.endpoint {
                    CopyRow(label: "Generator", value: endpoint)
                }
                if let likes = model.view?.likeCount {
                    ToolFactRow(label: "Likes", value: likes.formatted(), mono: false)
                }
                if let createdAt = model.createdAt {
                    ToolFactRow(label: "Created", value: String(createdAt.prefix(10)), mono: false)
                }
                if let feedback = model.acceptsInteractions {
                    ToolFactRow(label: "Takes feedback", value: feedback ? "Yes" : "No", mono: false)
                }
                if let did = model.did, let rkey = model.input?.target?.rkey {
                    Button {
                        open(.record(repo: did, collection: FeedInspector.collection, rkey: rkey))
                    } label: {
                        Label("Open the record in the Explorer", systemImage: "arrow.right.circle")
                    }
                    .buttonStyle(.aturiSecondary)
                }
            }
        }
    }

    // MARK: Skeleton

    private func skeletonSection(_ skeleton: FeedInspector.SkeletonProbe) -> some View {
        ToolSection("Skeleton", detail: model.skeletonMeta) {
            VStack(alignment: .leading, spacing: 12) {
                Picker("How to show the skeleton", selection: $display) {
                    Text("Posts").tag(SkeletonDisplay.posts)
                    Text("JSON").tag(SkeletonDisplay.json)
                }
                .pickerStyle(.segmented)

                if display == .json {
                    JSONTreeView(value: skeleton.json, expandedDepth: 3)
                } else {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array((skeleton.items ?? []).enumerated()), id: \.offset) { index, item in
                            if index > 0 {
                                Divider()
                            }
                            skeletonRow(index: index, item: item)
                        }
                    }
                }

                HStack(spacing: 8) {
                    if !model.cursor.isEmpty {
                        Button("First page") {
                            model.firstPage()
                        }
                        .buttonStyle(.aturiSecondary)
                    }
                    if skeleton.cursor != nil {
                        Button("Next page") {
                            model.nextPage()
                        }
                        .buttonStyle(.aturiSecondary)
                    }
                }
                if let cursor = skeleton.cursor {
                    ToolFactRow(label: "Cursor for the next page", value: cursor)
                }
            }
        }
    }

    private func skeletonRow(index: Int, item: FeedInspector.SkeletonItem) -> some View {
        let post = model.posts?[item.post]
        return HStack(alignment: .firstTextBaseline, spacing: 10) {
            Text("\(index + 1)")
                .font(AturiFont.monoSmall)
                .foregroundStyle(theme.textTertiary)
                .frame(minWidth: 22, alignment: .trailing)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 4) {
                if let post {
                    HStack(spacing: 6) {
                        Text(Self.authorName(post))
                            .font(AturiFont.sans(.subheadline, weight: .semibold))
                            .foregroundStyle(theme.textPrimary)
                            .lineLimit(1)
                        if !post.author.handle.isEmpty {
                            Text("@" + post.author.handle)
                                .font(AturiFont.caption)
                                .foregroundStyle(theme.textTertiary)
                                .lineLimit(1)
                        }
                    }
                    Text(post.record.text.isEmpty ? "No text: the post is an embed only." : post.record.text)
                        .font(AturiFont.footnote)
                        .foregroundStyle(post.record.text.isEmpty ? theme.textTertiary : theme.textSecondary)
                        .lineLimit(4)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text(model.posts == nil ? "Loading the post…" : "The AppView has no post at this address. It may have been deleted.")
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let route = Route(atUri: item.post) {
                    Button {
                        open(route)
                    } label: {
                        IdentifierText(item.post, lineLimit: 1, font: AturiFont.monoSmall)
                            .foregroundStyle(theme.textAccent)
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens the post in the explorer")
                } else {
                    IdentifierText(item.post, lineLimit: 1, font: AturiFont.monoSmall)
                        .foregroundStyle(theme.textTertiary)
                }
                if let context = item.feedContext {
                    Text("feedContext " + context)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textTertiary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            Spacer(minLength: 0)
            if let reason = item.reason {
                Chip(FeedInspector.reasonLabel(reason.type))
                    .accessibilityLabel(reason.repost ?? reason.type)
            }
        }
        .padding(.vertical, 8)
    }

    private static func authorName(_ post: BskyPost) -> String {
        if let name = post.author.displayName?.trimmingCharacters(in: .whitespacesAndNewlines), !name.isEmpty {
            return name
        }
        return post.author.handle.isEmpty ? "Unknown author" : post.author.handle
    }
}

// MARK: - Shared by the services tools

/* The pieces below are used by all four services tools (feed, OAuth, share,
   page). They would sit in ToolSupport.swift beside ToolCheckRow; that file
   belongs to the scaffold, so they live with the first of the four. */

/// A "Try" chip with a label of its own, for examples too long to show as
/// they are (a feed link, a client_id).
struct ServicesExample: Hashable {
    let label: String
    let value: String
}

/// "Try" and a row of labelled examples, `ToolExamples` with the web's labels.
struct ServicesExamples: View {
    let examples: [ServicesExample]
    let pick: (String) -> Void

    init(examples: [ServicesExample], pick: @escaping (String) -> Void) {
        self.examples = examples
        self.pick = pick
    }

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                Text("Try")
                    .font(AturiFont.caption)
                    .foregroundStyle(theme.textTertiary)
                ForEach(examples, id: \.self) { example in
                    Button {
                        pick(example.value)
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
}

extension ServiceCheckStatus {
    /// The scaffold's status. It has no "skipped"; a skipped step reads as a
    /// note, and its summary says why it was not run.
    var toolStatus: ToolCheckStatus {
        switch self {
        case .pass: return .pass
        case .warn: return .warn
        case .fail: return .fail
        case .info, .skip: return .info
        case .pending: return .pending
        }
    }
}

/// The verdict above a check list: the web's `ToolVerdict`.
struct ServicesVerdictCard: View {
    let verdict: ServiceVerdict

    init(verdict: ServiceVerdict) {
        self.verdict = verdict
    }

    @Environment(\.aturiTheme) private var theme

    private var tint: Color {
        switch verdict.tone {
        case .pass: return theme.textAccent
        /* The theme has no amber; ToolCheckRow uses the system orange too. */
        case .warn: return .orange
        case .fail: return theme.danger
        case .info, .pending: return theme.textSecondary
        }
    }

    private var systemImage: String {
        switch verdict.tone {
        case .pass: return "checkmark.circle.fill"
        case .warn: return "exclamationmark.triangle.fill"
        case .fail: return "xmark.octagon.fill"
        case .info, .pending: return "info.circle"
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Group {
                if verdict.tone == .pending {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Image(systemName: systemImage)
                        .font(AturiFont.subtitle)
                        .foregroundStyle(tint)
                }
            }
            .frame(width: 24)
            VStack(alignment: .leading, spacing: 4) {
                Text(verdict.title)
                    .font(AturiFont.subtitle)
                    .foregroundStyle(theme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(verdict.text)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
        .accessibilityElement(children: .combine)
    }
}

/// A check list: each step's mark, title and summary, then its evidence in
/// mono and what to change, the web's `CheckList`.
struct ServicesCheckList: View {
    let checks: [ServiceCheck]

    init(checks: [ServiceCheck]) {
        self.checks = checks
    }

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(checks.enumerated()), id: \.element.id) { index, check in
                if index > 0 {
                    Divider()
                }
                ServicesCheckRow(check: check)
            }
        }
    }
}

struct ServicesCheckRow: View {
    let check: ServiceCheck

    init(check: ServiceCheck) {
        self.check = check
    }

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            ToolCheckRow(status: check.status.toolStatus, title: check.title, detail: check.summary)
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
            }
            if !check.fix.isEmpty {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(Array(check.fix.enumerated()), id: \.offset) { _, line in
                        Label {
                            Text(line)
                                .font(AturiFont.footnote)
                                .foregroundStyle(theme.textSecondary)
                                .textSelection(.enabled)
                                .fixedSize(horizontal: false, vertical: true)
                        } icon: {
                            Image(systemName: "wrench.adjustable")
                                .font(AturiFont.caption)
                                .foregroundStyle(theme.textTertiary)
                        }
                    }
                }
                .padding(.leading, 28)
            }
        }
        .padding(.bottom, check.detail.isEmpty && check.fix.isEmpty ? 0 : 6)
    }
}

/// Why the input is not something the tool reads: the web's `ToolError`.
struct ServicesInputError: View {
    let message: String

    init(message: String) {
        self.message = message
    }

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        Label {
            Text(message)
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
        } icon: {
            Image(systemName: "exclamationmark.circle")
                .foregroundStyle(theme.danger)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
        .accessibilityElement(children: .combine)
    }
}

struct ServicesIntroItem: Hashable {
    let term: String
    let text: String
}

/// What a tool checks, numbered, before anything has been asked: the web's
/// `ToolIntro`.
struct ServicesIntro: View {
    var title: String = "What it checks"
    let items: [ServicesIntroItem]
    var note: String? = nil

    init(title: String = "What it checks", items: [ServicesIntroItem], note: String? = nil) {
        self.title = title
        self.items = items
        self.note = note
    }

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        ToolSection(title) {
            VStack(alignment: .leading, spacing: 12) {
                ForEach(Array(items.enumerated()), id: \.offset) { index, item in
                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                        Text("\(index + 1)")
                            .font(AturiFont.monoSmall)
                            .foregroundStyle(theme.textTertiary)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
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
                if let note {
                    Text(note)
                        .font(AturiFont.caption)
                        .foregroundStyle(theme.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }
}

/// A block of text to copy whole (a snippet of markup, a scope string),
/// shown in full and selectable, with a copy button under it.
struct ServicesCodeBlock: View {
    let text: String
    let label: String

    init(text: String, label: String) {
        self.text = text
        self.label = label
    }

    @Environment(\.aturiTheme) private var theme
    @State private var copied = false

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(text)
                .font(AturiFont.monoSmall)
                .foregroundStyle(theme.textPrimary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(10)
                .background(theme.bgSecondary, in: RoundedRectangle(cornerRadius: AturiTheme.controlRadius, style: .continuous))
            Button {
                UIPasteboard.general.string = text
                copied = true
            } label: {
                Label(copied ? "Copied" : "Copy \(label)", systemImage: copied ? "checkmark" : "doc.on.doc")
            }
            .buttonStyle(.aturiSecondary)
            .sensoryFeedback(.success, trigger: copied) { _, now in now }
        }
        .task(id: copied) {
            guard copied else { return }
            try? await Task.sleep(for: .seconds(1.5))
            copied = false
        }
    }
}
