import SwiftUI
import Observation
import AturiCore

/// The record page (`/explore/{repo}/{collection}/{rkey}`). Reads the
/// stores here and hands them to the screen's initializer, since a
/// `@State` model cannot be built from the environment.
struct RecordView: View {
    let repo: String
    let collection: String
    let rkey: String

    @Environment(PreferencesStore.self) private var preferences
    @Environment(\.sessionStore) private var session

    init(repo: String, collection: String, rkey: String) {
        self.repo = repo
        self.collection = collection
        self.rkey = rkey
    }

    var body: some View {
        RecordScreen(
            repo: repo,
            collection: collection,
            rkey: rkey,
            preferences: preferences,
            sessionState: session.state,
            writeAccess: session.writeAccess
        )
    }
}

/// Port of `RecordExplorer.tsx` with `RichRecordCard.tsx`,
/// `EngagementSidecar.tsx`, `LexiconUsageCard.tsx` and the record-page
/// half of `BacklinksTab.tsx`: the sections in the visitor's saved order,
/// each data view with its switch, and the error layout for a record that
/// would not load.
private struct RecordScreen: View {
    let sessionState: SessionState
    let writeAccess: Bool

    @State private var model: RecordModel
    @State private var showsEditor = false

    @Environment(AppRouter.self) private var router
    @Environment(\.openURL) private var openURL
    @Environment(\.aturiTheme) private var theme

    init(
        repo: String,
        collection: String,
        rkey: String,
        preferences: PreferencesStore,
        sessionState: SessionState,
        writeAccess: Bool
    ) {
        self.sessionState = sessionState
        self.writeAccess = writeAccess
        _model = State(initialValue: RecordModel(
            repo: repo,
            collection: collection,
            rkey: rkey,
            preferences: preferences,
            session: sessionState
        ))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ExploreBreadcrumb(
                    identity: model.identityBundle,
                    repo: model.repo,
                    collection: model.collection,
                    rkey: model.decodedRkey
                )
                switch model.identity {
                case .idle, .loading:
                    SkeletonRows(count: 6)
                case .failed(let message):
                    ExploreNotFoundPanel(
                        eyebrow: RecordModel.identityFailureEyebrow,
                        headline: RecordModel.identityFailureHeadline,
                        message: model.identityFailureBody ?? message
                    ) {
                        model.reload()
                    }
                case .loaded:
                    recordBody
                }
            }
            .padding(16)
        }
        .background(theme.bgPrimary)
        .navigationTitle(model.decodedRkey)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if showsEditButton {
                    Button("Edit") {
                        showsEditor = true
                    }
                }
                if let url = shareURL {
                    ShareLink(item: url) {
                        Image(systemName: "square.and.arrow.up")
                    }
                    .accessibilityLabel("Share")
                }
            }
        }
        .task {
            if model.identity.isIdle {
                model.load()
            }
        }
        .refreshable {
            await model.loadAndWait()
        }
        .onChange(of: sessionState) { _, next in
            model.session = next
        }
        .sheet(isPresented: $showsEditor) {
            if let record = model.recordValue {
                RecordEditorSheet(record: record) { _ in
                    model.reload()
                }
            }
        }
    }

    /// Only the repo's owner, holding a write scope, sees the affordance.
    private var showsEditButton: Bool {
        writeAccess && model.canEdit && model.recordValue != nil
    }

    private var shareURL: URL? {
        model.copyRow.flatMap { URL(string: $0.universalLink) }
    }

    @ViewBuilder
    private var recordBody: some View {
        switch model.record {
        case .idle, .loading:
            SkeletonRows(count: 6)
        case .failed(let message):
            if let failure = model.failure {
                RecordFailurePanel(failure: failure) {
                    model.reload()
                }
            } else {
                ErrorPanel(message: message) {
                    model.reload()
                }
            }
            BacklinksSection(model: model.backlinks, showsSummary: true)
            copyRowSection
            editChip
            if model.showsSignInPrompt {
                signInPrompt
            }
        case .loaded(let record):
            ForEach(model.sections) { section in
                sectionView(section, record: record)
            }
            WaypointOpenRow(targets: waypointTargets)
            editChip
        }
    }

    @ViewBuilder
    private func sectionView(_ section: RecordSection, record: AtRecord) -> some View {
        switch section.id {
        case "richPreview":
            VStack(alignment: .leading, spacing: 8) {
                if !section.hidden {
                    richCard
                }
                if let label = section.toggleLabel {
                    ExploreTextSwitch(label) {
                        model.toggleRichPreview()
                    }
                }
            }
        case "structuredJson":
            VStack(alignment: .leading, spacing: 8) {
                if !section.hidden {
                    JSONTreeView(value: record.value)
                        .padding(12)
                        .cardBackground()
                }
                if let label = section.toggleLabel {
                    ExploreTextSwitch(label) {
                        model.toggleStructuredJSON()
                    }
                }
            }
        case "rawJson":
            VStack(alignment: .leading, spacing: 8) {
                if !section.hidden {
                    RecordRawJSONView(record: record)
                }
                if let label = section.toggleLabel {
                    ExploreTextSwitch(label) {
                        model.toggleRawJSON()
                    }
                }
            }
        case "engagement":
            engagementSection
        case "copyRow":
            copyRowSection
        case "lexiconUsage":
            lexiconUsageSection
        case "backlinks":
            BacklinksSection(model: model.backlinks, showsSummary: true)
        case "signIn":
            signInPrompt
        default:
            EmptyView()
        }
    }

    @ViewBuilder
    private var richCard: some View {
        if let card = model.richCard {
            switch card {
            case .post(let post, parent: let parent):
                /* Inside the explorer the card's own "view in the
                   explorer" footer would point at this very page. */
                PostCardView(post: post, parent: parent, showsExplorerLink: false)
            case .margin(let type, let record):
                if let identity = model.identityBundle {
                    MarginRecordCard(type: type, record: record, identity: identity)
                }
            }
        } else if model.isPost {
            switch model.postThread {
            case .idle, .loading:
                SkeletonRows(count: 3)
            case .failed, .loaded:
                /* No live post in the AppView: no card, as on the web. */
                EmptyView()
            }
        }
    }

    @ViewBuilder
    private var engagementSection: some View {
        switch model.engagement {
        case .idle, .failed:
            EmptyView()
        case .loading:
            SkeletonRows(count: 1)
        case .loaded(let stats):
            if !stats.isEmpty {
                EngagementStrip(stats: stats)
            }
        }
    }

    @ViewBuilder
    private var lexiconUsageSection: some View {
        switch model.lexiconUsage {
        case .idle, .failed:
            EmptyView()
        case .loading:
            SkeletonRows(count: 1)
        case .loaded(let summary):
            LexiconUsageCardView(summary: summary)
        }
    }

    @ViewBuilder
    private var copyRowSection: some View {
        if let row = model.copyRow {
            VStack(spacing: 0) {
                CopyRow(label: "AT URI", value: row.atUri)
                Divider()
                CopyRow(label: "DID", value: row.did)
                if let cid = model.recordValue?.cid, !cid.isEmpty {
                    Divider()
                    CopyRow(label: "CID", value: cid)
                }
                Divider()
                CopyRow(label: "PDS", value: row.pds)
                Divider()
                CopyRow(label: "Universal link", value: row.universalLink)
                if let json = row.recordJSON {
                    Divider()
                    CopyRow(label: "JSON", value: json)
                }
                Divider()
                Button {
                    openUniversalLinkPage()
                } label: {
                    HStack(spacing: 8) {
                        Image(systemName: "globe")
                            .font(.footnote)
                            .foregroundStyle(theme.textTertiary)
                        Text(RecordModel.universalLinkPageLabel)
                            .font(.footnote)
                            .foregroundStyle(theme.textAccent)
                        Spacer(minLength: 0)
                        Image(systemName: "chevron.right")
                            .font(.caption2)
                            .foregroundStyle(theme.textTertiary)
                    }
                    .padding(.vertical, 10)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if let url = row.pdsRecordURL {
                    Divider()
                    OutboundLinkRow(
                        title: RecordModel.viewOnPdsLabel,
                        url: url.absoluteString,
                        detail: "The raw record JSON from the PDS"
                    )
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 4)
            .cardBackground()
        }
    }

    private var signInPrompt: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(RecordModel.signInPrompt)
                .font(.footnote)
                .foregroundStyle(theme.textSecondary)
            Button("Sign in") {
                /* Sign-in lives on the Settings tab's Account section. */
                router.popToRoot(.settings)
                router.select(.settings)
            }
            .buttonStyle(.aturiSecondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }

    @ViewBuilder
    private var editChip: some View {
        if showsEditButton {
            Button {
                showsEditor = true
            } label: {
                Label(RecordModel.editLabel, systemImage: "square.and.pencil")
            }
            .buttonStyle(.aturiSecondary)
        }
    }

    /// The picker groups narrowed by the model, flattened with the
    /// featured recommendation first.
    private var waypointTargets: [WaypointOpenTarget] {
        var seen = Set<String>()
        var out: [WaypointOpenTarget] = []
        for group in model.waypoints {
            for waypoint in group.waypoints where !seen.contains(waypoint.id) {
                guard let url = model.url(for: waypoint) else { continue }
                seen.insert(waypoint.id)
                out.append(WaypointOpenTarget(waypoint: waypoint, url: url))
            }
        }
        if let featuredId = model.featured?.id,
           let index = out.firstIndex(where: { $0.id == featuredId }),
           index > 0 {
            let featured = out.remove(at: index)
            out.insert(featured, at: 0)
        }
        return out
    }

    private func openUniversalLinkPage() {
        let components = AtUriComponents(
            identifier: model.handleOrDid ?? model.repo,
            collection: model.collection,
            rkey: model.decodedRkey
        )
        router.open(.preview(components))
    }
}

/// The error layout's panel, port of `RecordErrorPanel`: the parsed
/// status and code become plain language, the raw message stays behind
/// the disclosure for anyone debugging.
private struct RecordFailurePanel: View {
    let failure: RecordFailure
    let retry: () -> Void

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(failure.eyebrow, systemImage: failure.isNotFound ? "magnifyingglass" : "exclamationmark.triangle")
                .aturiLabel()
                .foregroundStyle(theme.textAccent)
            Text(failure.headline)
                .font(AturiFont.title)
                .foregroundStyle(theme.textPrimary)
            Text(failure.body)
                .font(.footnote)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if let path = failure.lexiconPath, let label = failure.lexiconLinkLabel, let route = Route(explorePath: path) {
                NavigationLink(value: route) {
                    Label(label, systemImage: "arrow.right")
                        .font(.footnote)
                        .foregroundStyle(theme.textAccent)
                }
                .buttonStyle(.plain)
            }
            if !failure.isNotFound {
                Button("Retry", action: retry)
                    .buttonStyle(.aturiSecondary)
            }
            DisclosureGroup(RecordFailure.detailsLabel) {
                Text(failure.raw)
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(theme.textSecondary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 6)
            }
            .font(.footnote)
            .foregroundStyle(theme.textTertiary)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }
}

/// The raw record as the PDS returned it (uri, cid, value), pretty
/// printed and selectable. Long lines scroll sideways rather than wrap,
/// so the indentation still reads as structure.
private struct RecordRawJSONView: View {
    let record: AtRecord

    @Environment(\.aturiTheme) private var theme

    private var json: String {
        JSONValue.object([
            "uri": .string(record.uri),
            "cid": .string(record.cid),
            "value": record.value,
        ]).prettyPrinted()
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: true) {
            Text(json)
                .font(AturiFont.monoSmall)
                .foregroundStyle(theme.textSecondary)
                .textSelection(.enabled)
                .padding(12)
        }
        .cardBackground()
        .accessibilityLabel("Raw JSON")
    }
}

/// The counts strip for non-post records, port of `EngagementSidecar.tsx`.
private struct EngagementStrip: View {
    let stats: [RecordEngagementStat]

    @Environment(\.aturiTheme) private var theme

    private func symbol(for kind: RecordEngagementKind) -> String {
        switch kind {
        case .replies: return "bubble.left"
        case .reposts: return "arrow.2.squarepath"
        case .likes: return "heart"
        case .quotes: return "quote.opening"
        case .followers: return "person.2"
        case .following: return "person.badge.plus"
        case .posts: return "text.bubble"
        }
    }

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 18) {
                ForEach(stats) { stat in
                    HStack(spacing: 5) {
                        Image(systemName: symbol(for: stat.kind))
                            .font(.caption)
                            .foregroundStyle(theme.textTertiary)
                        Text(stat.value.formatted())
                            .font(.footnote)
                            .monospacedDigit()
                            .foregroundStyle(theme.textPrimary)
                        Text(stat.label)
                            .font(.footnote)
                            .foregroundStyle(theme.textTertiary)
                    }
                    .accessibilityElement(children: .combine)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
        }
        .cardBackground()
    }
}

/// Port of `LexiconUsageCard.tsx`: seven-day creates and repos for the
/// record's lexicon with a sparkline, the whole card leading to the
/// lexicon's page.
private struct LexiconUsageCardView: View {
    let summary: LexiconUsageSummary

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        NavigationLink(value: Route.lexicon(nsid: summary.collection)) {
            VStack(alignment: .leading, spacing: 10) {
                Text(LexiconUsageSummary.heading)
                    .aturiLabel()
                    .foregroundStyle(theme.textTertiary)
                HStack(spacing: 16) {
                    stat("shippingbox", summary.createsText, "creates")
                    stat("person.2", summary.reposText, "repos")
                    Spacer(minLength: 0)
                    if summary.hasSparkline {
                        UsageSparkline(data: summary.series, label: summary.sparklineLabel)
                    }
                }
                Label(LexiconUsageSummary.linkLabel, systemImage: "arrow.up.right")
                    .font(.footnote)
                    .foregroundStyle(theme.textAccent)
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
            .cardBackground()
        }
        .buttonStyle(.plain)
        .accessibilityLabel(summary.title)
    }

    private func stat(_ systemImage: String, _ value: String, _ label: String) -> some View {
        HStack(spacing: 5) {
            Image(systemName: systemImage)
                .font(.caption)
                .foregroundStyle(theme.textTertiary)
            Text(value)
                .font(.footnote)
                .monospacedDigit()
                .foregroundStyle(theme.textPrimary)
            Text(label)
                .font(.footnote)
                .foregroundStyle(theme.textTertiary)
        }
        .accessibilityElement(children: .combine)
    }
}
