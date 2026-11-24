import SwiftUI
import Observation
import AturiCore

/// The repo page (`/explore/{repo}`). Reads the stores here and hands them
/// to the screen's initializer, since a `@State` model cannot be built
/// from the environment.
struct RepoView: View {
    let repo: String
    /// The tab to open on: a link's `?tab=`, whose values are `RepoTab`'s
    /// raw values. Nil, or a tab this page does not have, opens Collections.
    let initialTab: String?

    @Environment(PreferencesStore.self) private var preferences
    @Environment(\.sessionStore) private var session

    init(repo: String, initialTab: String? = nil) {
        self.repo = repo
        self.initialTab = initialTab
    }

    var body: some View {
        RepoScreen(repo: repo, initialTab: initialTab, preferences: preferences, viewerDid: session.state.did)
    }
}

/// The tabs of `RepoExplorer.tsx`, in its order. The raw values are the
/// web's tab ids, the `?tab=` of its links. Graph is not ported.
private enum RepoTab: String, CaseIterable, Identifiable {
    case collections
    case labels
    case visibility
    case identity
    case audit
    case backlinks

    var id: String { rawValue }

    var label: String {
        switch self {
        case .collections: return "Collections"
        case .labels: return "Labels"
        case .visibility: return "Visibility"
        case .identity: return "Identity"
        case .audit: return "Log"
        case .backlinks: return "Backlinks"
        }
    }
}

/// Port of `RepoExplorer.tsx` with `ProfileHeader.tsx`, `AccountStats.tsx`,
/// `RepoStatusNotice.tsx` and `RelationshipStrip.tsx`: breadcrumb, the
/// inactive-repo banner, the configurable sections (relationship strip,
/// profile card, identity row and its label and visibility checks, repo at
/// a glance), the waypoint row and the tabbed collections / labels /
/// visibility / identity / log / backlinks.
private struct RepoScreen: View {
    let viewerDid: String?

    @State private var model: RepoModel
    /* The ID and Log tabs share one `IdentityModel`, and Backlinks its
       own; both are built when their tab is first selected rather than
       up front, since `RepoModel` already fetched what the stats need and
       the visitor may never open those tabs. */
    @State private var identityModel: IdentityModel?
    @State private var backlinks: BacklinksModel?
    @State private var tab: RepoTab = .collections
    /// Session override of the `repoGlanceCollapsedByDefault` preference.
    @State private var glanceCollapsed: Bool?

    @Environment(PreferencesStore.self) private var preferences
    @Environment(AppRouter.self) private var router
    @Environment(\.openURL) private var openURL
    @Environment(\.aturiTheme) private var theme

    init(repo: String, initialTab: String?, preferences: PreferencesStore, viewerDid: String?) {
        self.viewerDid = viewerDid
        _model = State(initialValue: RepoModel(input: repo, preferences: preferences, viewerDid: viewerDid))
        _tab = State(initialValue: initialTab.flatMap { RepoTab(rawValue: $0) } ?? .collections)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                ExploreBreadcrumb(identity: model.identity.value, repo: model.input)
                switch model.identity {
                case .idle, .loading:
                    SkeletonRows(count: 6)
                case .failed(let message):
                    /* Input that can never resolve gets its own headline and
                       no retry: trying again would fail the same way, and
                       the prefilled search box is the way forward. */
                    ExploreNotFoundPanel(
                        eyebrow: RecordModel.identityFailureEyebrow,
                        headline: model.isMalformedInput ? RepoModel.malformedInputHeadline : RecordModel.identityFailureHeadline,
                        message: model.notFoundMessage ?? message,
                        details: message,
                        query: model.input,
                        retry: model.isMalformedInput ? nil : { _ = model.load() }
                    )
                case .loaded(let identity):
                    loadedContent(identity)
                }
            }
            .padding(16)
        }
        .background(theme.bgPrimary)
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let url = shareURL {
                ToolbarItem(placement: .topBarTrailing) {
                    ShareLink(item: url) {
                        Image(systemName: "square.and.arrow.up")
                    }
                    .accessibilityLabel("Share")
                }
            }
        }
        .task {
            /* `.task` fires again when a pushed page pops; the state is
               still there, so only an untouched model loads. */
            if model.identity.isIdle {
                model.load()
            }
            ensureTabModels()
        }
        .refreshable {
            await model.load().value
            identityModel?.reload()
            backlinks?.reload()
            if let identity = model.identity.value {
                AccountChecksStore.shared.model(for: identity).restart()
            }
        }
        .onChange(of: viewerDid) { _, did in
            model.setViewer(did: did)
        }
        .onChange(of: model.identity) { _, _ in
            ensureTabModels()
        }
        .onChange(of: tab) { _, _ in
            ensureTabModels()
        }
    }

    private var title: String {
        if let handle = model.handle { return "@\(handle)" }
        if let did = model.did { return shortDid(did) }
        return model.input
    }

    private var shareURL: URL? {
        model.sharePath.flatMap { URL(string: Endpoints.aturiBase.absoluteString + $0) }
    }

    private var repoIdentifier: String {
        model.handle ?? model.did ?? model.input
    }

    private var isGlanceCollapsed: Bool {
        glanceCollapsed ?? preferences.prefs.repoGlanceCollapsedByDefault
    }

    private func ensureTabModels() {
        guard let identity = model.identity.value else { return }
        switch tab {
        case .identity, .audit:
            if identityModel?.did != identity.did {
                let next = IdentityModel(identity: identity)
                next.load()
                identityModel = next
            }
        case .backlinks:
            if backlinks?.target != identity.did {
                let next = BacklinksModel(target: identity.did)
                next.load()
                backlinks = next
            }
        case .collections, .labels, .visibility:
            /* The checks' model is the shared one for the DID, which the
               account card has already started. */
            break
        }
    }

    @ViewBuilder
    private func loadedContent(_ identity: IdentityBundle) -> some View {
        if let notice = model.statusNotice {
            RepoStatusBanner(notice: notice, facts: model.statusFacts)
        }
        /* The sections render in the visitor's saved order (Settings >
           Sections). The relationship strip is silent for the visitor's
           own repo and when signed out, as on the web; hidden sections
           come from the saved list, which is the source of truth the
           `hideRelationshipBar` flag is derived from on write. */
        ForEach(preferences.prefs.sections(for: .repo), id: \.id) { section in
            switch section.id {
            case "relationship":
                if !section.hidden, let viewerDid, RelationshipModel.applies(viewerDid: viewerDid, targetDid: identity.did) {
                    RelationshipStrip(
                        target: identity,
                        viewerDid: viewerDid,
                        targetCollections: model.collections.value,
                        viewerCollections: model.viewerCollections
                    ) { destination in
                        switch destination {
                        case .identityTab: tab = .identity
                        case .collectionsTab: tab = .collections
                        }
                    }
                }
            case "profile":
                profileSection(hidden: section.hidden)
            case "identity":
                if !section.hidden {
                    RepoIdentityRow(identity: identity)
                }
                /* The web's account card ends in the checks whether or not
                   the identity rows are hidden (`AccountCard`), so they
                   stay here when the row is switched off. */
                AccountChecksCard(identity: identity) { kind in
                    switch kind {
                    case .labels: tab = .labels
                    case .visibility: tab = .visibility
                    }
                }
            case "repoGlance":
                if !section.hidden {
                    glanceSection
                }
            default:
                EmptyView()
            }
        }
        WaypointOpenRow(targets: WaypointOpenTarget.targets(
            type: .profile,
            prefs: preferences.prefs,
            handle: identity.handle ?? identity.did,
            collection: nil,
            rkey: nil,
            did: identity.did
        ))
        /* The account's Tools list (`AccountToolLinks.tsx`, e56c568): the
           tools that read a whole account, opened with it filled in. */
        AccountToolLinksCard(did: identity.did)
        RepoTabBar(selection: $tab, identity: identity)
        tabContent
    }

    private func profileSection(hidden: Bool) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if !hidden {
                switch model.profile {
                case .idle, .loading:
                    SkeletonRows(count: 2)
                case .failed:
                    /* The AppView not answering is not the repo's fault;
                       the identity row below still covers the account. */
                    EmptyView()
                case .loaded(let header):
                    if let header, !header.isEmpty {
                        RepoProfileCard(header: header) {
                            router.open(.preview(AtUriComponents(identifier: header.handle ?? header.profile.did)))
                        }
                    }
                }
            }
            ExploreTextSwitch(hidden ? "Show rich preview" : "Hide rich preview") {
                preferences.update { prefs in
                    prefs.setSectionHidden(page: .repo, id: "profile", hidden: !hidden)
                }
            }
        }
    }

    private var glanceSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                withAnimation(.easeInOut(duration: 0.15)) {
                    glanceCollapsed = !isGlanceCollapsed
                }
            } label: {
                HStack(spacing: 6) {
                    Image(systemName: isGlanceCollapsed ? "chevron.right" : "chevron.down")
                        .font(AturiFont.caption)
                        .foregroundStyle(theme.textTertiary)
                    Text("Repo at a glance")
                        .font(AturiFont.subtitle)
                        .foregroundStyle(theme.textPrimary)
                }
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(.isHeader)
            .accessibilityValue(isGlanceCollapsed ? "Collapsed" : "Expanded")
            if !isGlanceCollapsed {
                RepoGlanceGrid(model: model)
            }
        }
    }

    @ViewBuilder
    private var tabContent: some View {
        switch tab {
        case .collections:
            RepoCollectionsTab(model: model, repoIdentifier: repoIdentifier)
        case .labels:
            if let identity = model.identity.value {
                RepoLabelsTab(identity: identity)
                    .id(identity.did)
            }
        case .visibility:
            if let identity = model.identity.value {
                RepoVisibilityTab(identity: identity)
                    .id(identity.did)
            }
        case .identity:
            if let identityModel {
                IdentitySection(model: identityModel)
            } else {
                SkeletonRows(count: 4)
            }
        case .audit:
            if let identityModel {
                AuditSection(model: identityModel)
            } else {
                SkeletonRows(count: 4)
            }
        case .backlinks:
            if let backlinks {
                BacklinksSection(model: backlinks)
            } else {
                SkeletonRows(count: 4)
            }
        }
    }
}

/// The banner for a repo whose host refuses reads, port of
/// `RepoStatusNotice.tsx`: the prose for the status, the reassurance that
/// the identity is untouched, and the three facts that fill in behind it.
private struct RepoStatusBanner: View {
    let notice: RepoStatusNotice
    let facts: RepoStatusFacts?

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: AturiTheme.cardRadius, style: .continuous)
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "circle.slash")
                .foregroundStyle(theme.danger)
                .padding(.top, 2)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 10) {
                Text(notice.headline)
                    .font(AturiFont.sans(.body, weight: .medium))
                    .foregroundStyle(theme.textPrimary)
                Text(notice.detail)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                Text(RepoStatusNotice.reassurance)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                if let facts {
                    LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 12, alignment: .topLeading)], alignment: .leading, spacing: 10) {
                        fact("status", value: facts.status, note: facts.hostname)
                        fact("handle", value: facts.handleLabel, note: facts.handleNote)
                        fact("last rev", value: facts.revLabel, note: facts.revNote())
                    }
                }
            }
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.danger.opacity(0.08), in: shape)
        .overlay(shape.strokeBorder(theme.danger.opacity(0.4), lineWidth: 1))
        .accessibilityElement(children: .combine)
        .accessibilityLabel(notice.accessibilityLabel)
    }

    private func fact(_ label: String, value: String, note: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .aturiLabel()
                .foregroundStyle(theme.textTertiary)
            Text(value)
                .font(AturiFont.monoSmall)
                .foregroundStyle(theme.textPrimary)
                .lineLimit(2)
                .truncationMode(.middle)
            Text(note)
                .font(AturiFont.caption2)
                .foregroundStyle(theme.textTertiary)
        }
    }
}

/// The profile card, port of `ProfileHeader.tsx`: avatar, name, pronouns,
/// the handle doubling as the website link, the bio and the three counts.
/// Also the rich preview of the `app.bsky.actor.profile/self` record.
struct RepoProfileCard: View {
    let header: RepoProfileHeader
    let onUniversalLink: () -> Void

    @Environment(\.openURL) private var openURL
    @Environment(\.aturiTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 14) {
                AvatarView(url: header.profile.avatar, size: 64)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        if let name = header.displayName {
                            Text(name)
                                .font(AturiFont.title)
                                .tracking(AturiFont.titleTracking)
                                .foregroundStyle(theme.textPrimary)
                        }
                        if let pronouns = header.pronouns {
                            Text(pronouns)
                                .font(AturiFont.footnote.italic())
                                .foregroundStyle(theme.textTertiary)
                        }
                    }
                    handleLine
                }
            }
            if let description = header.description {
                Text(description)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if header.hasStats {
                /* Big counts at large Dynamic Type no longer fit one row;
                   stacking them keeps each label whole instead of
                   wrapping "followers" mid-word. */
                ViewThatFits(in: .horizontal) {
                    HStack(spacing: 16) {
                        statItems
                    }
                    VStack(alignment: .leading, spacing: 6) {
                        statItems
                    }
                }
            }
            Divider()
            Button(action: onUniversalLink) {
                Label("Open profile in\u{2026}", systemImage: "globe")
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textAccent)
            }
            .buttonStyle(.plain)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }

    @ViewBuilder
    private var handleLine: some View {
        if let handle = header.handle {
            if let href = header.websiteHref, let url = URL(string: href) {
                /* The handle is the website link when the profile has one;
                   the trailing arrow says the tap leaves the app, since a
                   handle alone reads as an identifier. */
                Button {
                    openURL(url)
                } label: {
                    HStack(spacing: 4) {
                        Text("@\(handle)")
                            .font(AturiFont.monoSmall)
                            .foregroundStyle(theme.textAccent)
                        Image(systemName: "arrow.up.right")
                            .font(AturiFont.caption2)
                            .foregroundStyle(theme.textTertiary)
                    }
                }
                .buttonStyle(.plain)
                .accessibilityLabel("@\(handle), website \(header.websiteLabel ?? href)")
                .accessibilityHint("Opens outside the app")
            } else {
                Text("@\(handle)")
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(theme.textTertiary)
            }
        }
    }

    @ViewBuilder
    private var statItems: some View {
        if let count = header.profile.followersCount {
            stat("heart", count, "followers")
        }
        if let count = header.profile.followsCount {
            stat("person.2", count, "following")
        }
        if let count = header.profile.postsCount {
            stat("text.bubble", count, "posts")
        }
    }

    private func stat(_ systemImage: String, _ value: Int, _ label: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: systemImage)
                .font(AturiFont.caption)
                .foregroundStyle(theme.textTertiary)
            Text(value.formatted())
                .font(AturiFont.footnote)
                .monospacedDigit()
                .foregroundStyle(theme.textPrimary)
            Text(label)
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textTertiary)
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
    }
}

/// The identity row: handle, DID and PDS with copy affordances, and the
/// PDS as a link to its own page.
private struct RepoIdentityRow: View {
    let identity: IdentityBundle

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        let host = PDSServer.pdsHostname(identity.pds)
        VStack(spacing: 0) {
            if let handle = identity.handle {
                CopyRow(label: "Handle", value: handle)
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Handle")
                        .aturiLabel()
                        .foregroundStyle(theme.textTertiary)
                    Text("unknown")
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textTertiary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 6)
            }
            Divider()
            CopyRow(label: "DID", value: identity.did)
            Divider()
            CopyRow(label: "PDS", value: identity.pds)
            Divider()
            NavigationLink(value: Route.pds(host: host)) {
                HStack(spacing: 8) {
                    Image(systemName: "server.rack")
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textTertiary)
                    Text("Browse \(host)")
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textAccent)
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(AturiFont.caption2)
                        .foregroundStyle(theme.textTertiary)
                }
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 4)
        .cardBackground()
    }
}

/// "Repo at a glance", port of `AccountStats.tsx`. The counts come from
/// `RepoModel.stats`, which is nil until every input has settled, so the
/// tiles show a bar until then. The CAR export replaces the web's measured
/// size tile: the download itself is the system's job.
private struct RepoGlanceGrid: View {
    let model: RepoModel

    @Environment(\.aturiTheme) private var theme

    private static let dash = "\u{2014}"

    var body: some View {
        let stats = model.stats
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
            RepoStatTile(
                systemImage: "shippingbox",
                label: "Namespaces",
                value: stats.map { $0.namespaces.map { $0.formatted() } ?? Self.dash },
                hint: stats?.inactive.map { "Unreadable: this repo is \($0)" } ?? "Unique top-level NSID prefixes"
            )
            RepoStatTile(
                systemImage: "cylinder.split.1x2",
                label: "Lexicons",
                value: stats.map { $0.collections.map { $0.formatted() } ?? Self.dash },
                hint: stats?.inactive.map { "Unreadable: this repo is \($0)" } ?? "Distinct record types across all namespaces"
            )
            RepoStatTile(
                systemImage: "clock.arrow.circlepath",
                label: "Audit changes",
                value: stats.map { $0.auditOps.map { $0.formatted() } ?? Self.dash },
                hint: "PLC operations recorded against this DID"
            )
            RepoStatTile(
                systemImage: "link",
                label: "Backlinks",
                value: stats.map { $0.backlinks.map { $0.formatted() } ?? Self.dash },
                hint: "Records across the Atmosphere pointing at this DID"
            )
            RepoStatTile(
                systemImage: "calendar",
                label: "Created",
                value: stats.map { $0.createdDate.map { $0.formatted(.dateTime.month(.abbreviated).year()) } ?? Self.dash },
                sublabel: stats?.createdRelativeAge(),
                hint: "Earliest PLC operation timestamp"
            )
            scoreTile
            /* A relative time frozen at first render goes stale while the
               page stays open ("just now" an hour later), so the tile
               re-reads the clock once a minute. */
            TimelineView(.periodic(from: .now, by: 60)) { context in
                RepoStatTile(
                    systemImage: "waveform.path.ecg",
                    label: "Last active",
                    value: stats.map { $0.lastActiveDate.map { Formatting.relative($0, now: context.date) } ?? Self.dash },
                    sublabel: stats?.headRevFromRelay == true ? "via relay" : nil,
                    hint: stats?.lastActiveHint
                )
            }
            exportTile
        }
    }

    private var scoreTile: some View {
        let url = model.credBlueProfileURL
        switch model.credBlue {
        case .idle, .loading:
            return RepoStatTile(systemImage: "gauge.with.needle", label: "Score", value: nil, url: url)
        case .failed:
            return RepoStatTile(systemImage: "gauge.with.needle", label: "Score", value: Self.dash, sublabel: "unavailable", url: url)
        case .loaded(let score):
            guard let score else {
                return RepoStatTile(
                    systemImage: "gauge.with.needle",
                    label: "Score",
                    value: Self.dash,
                    sublabel: "not scored yet",
                    hint: "This account has not been scored yet on cred.blue",
                    url: url
                )
            }
            let bluesky = Int(score.scores.bluesky.rounded()).formatted()
            let atproto = Int(score.scores.atproto.rounded()).formatted()
            return RepoStatTile(
                systemImage: "gauge.with.needle",
                label: "Score",
                value: Int(score.scores.combined.rounded()).formatted(),
                sublabel: "bsky \(bluesky) \u{00B7} atp \(atproto)",
                hint: "cred.blue score: Bluesky \(bluesky), ATProto \(atproto)",
                url: url
            )
        }
    }

    private var exportTile: some View {
        let stats = model.stats
        let identity = model.identity.value
        let url = identity.flatMap { try? PDSClient.repoURL(pds: $0.pds, did: $0.did) }
        if let inactive = stats?.inactive {
            return RepoStatTile(
                systemImage: "externaldrive",
                label: "Repo export",
                value: Self.dash,
                hint: "No CAR export: this repo is \(inactive)"
            )
        }
        return RepoStatTile(
            systemImage: "externaldrive",
            label: "Repo export",
            value: identity == nil ? nil : "CAR",
            sublabel: url == nil ? nil : "Download",
            hint: "Downloads the full repo from its PDS",
            url: url
        )
    }
}

/// One tile of the glance grid. A nil `value` draws the loading bar; a
/// URL makes the whole tile an outbound link.
private struct RepoStatTile: View {
    let systemImage: String
    let label: String
    let value: String?
    var sublabel: String? = nil
    var hint: String? = nil
    var url: URL? = nil

    @Environment(\.openURL) private var openURL
    @Environment(\.aturiTheme) private var theme

    init(systemImage: String, label: String, value: String?, sublabel: String? = nil, hint: String? = nil, url: URL? = nil) {
        self.systemImage = systemImage
        self.label = label
        self.value = value
        self.sublabel = sublabel
        self.hint = hint
        self.url = url
    }

    var body: some View {
        if let url {
            Button {
                openURL(url)
            } label: {
                tile
            }
            .buttonStyle(.plain)
            .accessibilityHint(hint.map { "\($0). Opens outside the app" } ?? "Opens outside the app")
        } else {
            tile
                .accessibilityHint(hint ?? "")
        }
    }

    private var tile: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label(label, systemImage: systemImage)
                .aturiLabel()
                .foregroundStyle(theme.textTertiary)
                .lineLimit(1)
            if let value {
                Text(value)
                    .font(AturiFont.sans(.title3, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(theme.textPrimary)
                    .lineLimit(1)
            } else {
                SkeletonBar(width: 48, height: 14)
                    .accessibilityHidden(true)
            }
            if let sublabel {
                Text(sublabel)
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(url == nil ? theme.textTertiary : theme.textAccent)
                    .lineLimit(1)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(label), \(value ?? "loading")\(sublabel.map { ", \($0)" } ?? "")")
    }
}

/// The Collections tab, port of `CollectionsTab.tsx` with `GroupHeader.tsx`
/// and `LeafRow.tsx`: the filter, the cross-repo filter for a signed-in
/// visitor, the pinned block and the two-level grouped list with pins.
private struct RepoCollectionsTab: View {
    let model: RepoModel
    let repoIdentifier: String

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            switch model.collections {
            case .idle, .loading:
                SkeletonRows(count: 5)
            case .failed(let message):
                if let notice = model.collectionsInactiveNotice {
                    EmptyState(title: notice, systemImage: "circle.slash")
                    DisclosureGroup("Raw response") {
                        Text(message)
                            .font(AturiFont.monoSmall)
                            .foregroundStyle(theme.textSecondary)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.top, 6)
                    }
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textTertiary)
                } else {
                    ErrorPanel(message: message) {
                        model.load()
                    }
                }
            case .loaded(let all):
                if all.isEmpty {
                    EmptyState(title: model.collectionsEmptyMessage ?? "No collections on this repo.", systemImage: "tray")
                } else {
                    controls
                    if !model.pinned.isEmpty {
                        pinnedSection
                    }
                    if let message = model.collectionsEmptyMessage {
                        EmptyState(title: message, systemImage: "line.3.horizontal.decrease")
                    }
                    ForEach(model.groups, id: \.key) { group in
                        groupCard(group)
                    }
                }
            }
        }
    }

    private var controls: some View {
        @Bindable var model = model
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                ExploreFilterField("Filter collections", text: $model.filter, label: "Filter collections on this repo")
                if !model.groups.isEmpty {
                    Button {
                        model.toggleAllOpen()
                    } label: {
                        Image(systemName: model.anyOpen ? "rectangle.compress.vertical" : "rectangle.expand.vertical")
                            .font(AturiFont.footnote)
                            .foregroundStyle(theme.textSecondary)
                            .frame(width: 36, height: 36)
                            .background(theme.bgTertiary, in: RoundedRectangle(cornerRadius: AturiTheme.controlRadius, style: .continuous))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(model.anyOpen ? "Collapse all groups" : "Expand all groups")
                }
            }
            if model.showCommonFilter {
                Picker("Filter by what you have in common", selection: $model.commonFilter) {
                    ForEach(CollectionCommonFilter.allCases, id: \.self) { filter in
                        Text(filter.label).tag(filter)
                    }
                }
                .pickerStyle(.segmented)
            }
            if let count = collectionCountLabel {
                Text(count)
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(theme.textTertiary)
                    .accessibilityLabel(model.narrowed ? "\(count) shown" : count)
            }
        }
    }

    /// The count under the filter, spelled out: a bare "12/40" read as a
    /// ratio or a date rather than how many collections are listed.
    private var collectionCountLabel: String? {
        guard let total = model.collections.value?.count else { return nil }
        let noun = total == 1 ? "collection" : "collections"
        return model.narrowed ? "\(model.shownCount) of \(total) \(noun)" : "\(total) \(noun)"
    }

    private var pinnedSection: some View {
        let partition = model.pinned
        return VStack(spacing: 0) {
            HStack {
                Label("Pinned", systemImage: "pin")
                    .aturiLabel()
                    .foregroundStyle(theme.textAccent)
                Spacer(minLength: 0)
                Text("\(partition.count)")
                    .font(AturiFont.caption2)
                    .foregroundStyle(theme.textTertiary)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            ForEach(partition.groups, id: \.entry) { group in
                let key = CollectionGrouping.pinnedKey(group.entry)
                let open = model.isOpen(key)
                Divider()
                groupHeader(
                    prefix: group.prefix,
                    dim: nil,
                    count: group.items.count,
                    open: open,
                    pinned: true,
                    toggle: { model.toggle(key) },
                    togglePin: { model.toggleGroupPin(prefix: group.prefix) }
                )
                if open {
                    Divider()
                    ForEach(group.items, id: \.self) { nsid in
                        leafRow(nsid, dim: group.prefix + ".", deep: false, pinnable: false)
                    }
                }
            }
            if !partition.singles.isEmpty {
                Divider()
                ForEach(partition.singles, id: \.self) { nsid in
                    leafRow(nsid, dim: "", deep: false, pinnable: true)
                }
            }
        }
        .cardBackground()
        .overlay(RoundedRectangle(cornerRadius: AturiTheme.cardRadius, style: .continuous).strokeBorder(theme.textAccent, lineWidth: 1))
    }

    private func groupCard(_ group: CollectionGrouping.MajorGroup) -> some View {
        let open = model.isOpen(group.key)
        return VStack(spacing: 0) {
            groupHeader(
                prefix: group.key,
                dim: nil,
                count: group.totalCount,
                open: open,
                pinned: model.isGroupPinned(prefix: group.key),
                toggle: { model.toggle(group.key) },
                togglePin: { model.toggleGroupPin(prefix: group.key) }
            )
            if open {
                Divider()
                ForEach(group.directItems, id: \.self) { nsid in
                    leafRow(nsid, dim: group.key + ".", deep: false, pinnable: true)
                }
                ForEach(group.subgroups, id: \.fullKey) { sub in
                    let subOpen = model.isOpen(sub.fullKey)
                    Divider()
                    groupHeader(
                        prefix: sub.fullKey,
                        dim: group.key + ".",
                        count: sub.items.count,
                        open: subOpen,
                        pinned: model.isGroupPinned(prefix: sub.fullKey),
                        toggle: { model.toggle(sub.fullKey) },
                        togglePin: { model.toggleGroupPin(prefix: sub.fullKey) }
                    )
                    if subOpen {
                        Divider()
                        ForEach(sub.items, id: \.self) { nsid in
                            leafRow(nsid, dim: sub.fullKey + ".", deep: true, pinnable: true)
                        }
                    }
                }
            }
        }
        .cardBackground()
    }

    private func groupHeader(
        prefix: String,
        dim: String?,
        count: Int,
        open: Bool,
        pinned: Bool,
        toggle: @escaping () -> Void,
        togglePin: @escaping () -> Void
    ) -> some View {
        HStack(spacing: 0) {
            Button(action: toggle) {
                HStack(spacing: 8) {
                    Image(systemName: open ? "chevron.down" : "chevron.right")
                        .font(AturiFont.caption)
                        .foregroundStyle(theme.textTertiary)
                        .frame(width: 12)
                    dimmedText(prefix, dim: dim ?? "", tail: ".*")
                    Spacer(minLength: 6)
                    Chip("\(count)")
                }
                .padding(.leading, dim == nil ? 12 : 20)
                .padding(.trailing, 8)
                .padding(.vertical, 9)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(prefix).*, \(count) collections")
            .accessibilityValue(open ? "Expanded" : "Collapsed")
            pinButton(pinned: pinned, name: "\(prefix)\(PinnedLexicons.groupSuffix)", action: togglePin)
        }
    }

    private func leafRow(_ nsid: String, dim: String, deep: Bool, pinnable: Bool) -> some View {
        HStack(spacing: 0) {
            NavigationLink(value: Route.collection(repo: repoIdentifier, collection: nsid)) {
                HStack(spacing: 6) {
                    dimmedText(nsid, dim: dim, tail: "")
                    if model.viewerCollections?.contains(nsid) == true {
                        Label("you", systemImage: "checkmark")
                            .aturiLabel()
                            .foregroundStyle(theme.textAccent)
                            .accessibilityLabel("You have records here too")
                    }
                    Spacer(minLength: 0)
                }
                .padding(.leading, deep ? 40 : 28)
                .padding(.trailing, 8)
                .padding(.vertical, 8)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(nsid)
            if pinnable {
                pinButton(pinned: model.isPinned(nsid), name: nsid) {
                    model.togglePin(nsid)
                }
            }
        }
    }

    /// The part of an NSID a parent group already spelled is dimmed, as
    /// `dimPrefix` does on the web, so the eye lands on what differs.
    private func dimmedText(_ full: String, dim: String, tail: String) -> Text {
        let head: String
        let rest: String
        if !dim.isEmpty, full.hasPrefix(dim) {
            head = dim
            rest = String(full.dropFirst(dim.count))
        } else {
            head = ""
            rest = full
        }
        return (Text(head).foregroundStyle(theme.textTertiary)
            + Text(rest).foregroundStyle(theme.textPrimary)
            + Text(tail).foregroundStyle(theme.textTertiary))
            .font(AturiFont.monoSmall)
    }

    private func pinButton(pinned: Bool, name: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: pinned ? "pin.slash" : "pin")
                .font(AturiFont.footnote)
                .foregroundStyle(pinned ? theme.textAccent : theme.textTertiary)
                .frame(width: 40, height: 36)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(pinned ? "Unpin \(name)" : "Pin \(name)")
    }
}

// MARK: - Tab bar

/// The repo page's tabs as a row of buttons that scrolls sideways, since
/// six do not fit a segmented control on a phone. Labels and Visibility
/// carry the checks' badges, as on the web (`CheckNavBadge`).
private struct RepoTabBar: View {
    @Binding var selection: RepoTab
    let identity: IdentityBundle

    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        ScrollViewReader { proxy in
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    ForEach(RepoTab.allCases) { item in
                        tabButton(item)
                            .id(item)
                    }
                }
                .padding(.vertical, 2)
            }
            .onChange(of: selection) { _, next in
                withAnimation(.easeInOut(duration: 0.2)) {
                    proxy.scrollTo(next, anchor: .center)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Repository views")
    }

    private func tabButton(_ item: RepoTab) -> some View {
        let selected = item == selection
        return Button {
            selection = item
        } label: {
            HStack(spacing: 5) {
                Text(item.label)
                    .font(AturiFont.sans(.footnote, weight: selected ? .semibold : .medium))
                    .lineLimit(1)
                if item == .labels {
                    AccountCheckTabBadge(identity: identity, kind: .labels)
                }
                if item == .visibility {
                    AccountCheckTabBadge(identity: identity, kind: .visibility)
                }
            }
            .foregroundStyle(selected ? theme.accentSoftFg : theme.textSecondary)
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(selected ? theme.accentSoft : theme.bgSecondary, in: Capsule())
            .overlay(
                Capsule().strokeBorder(
                    selected ? theme.accentSoftRing : theme.borderMedium,
                    lineWidth: AturiTheme.hairline(displayScale: displayScale)
                )
            )
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? [.isSelected] : [])
    }
}

// MARK: - Account checks

/* Port of src/components/explore/AccountChecks.tsx and the embedded
   LabelChecker.tsx and ShadowbanChecker.tsx: the account card's Labels
   and Visibility rows, the badges on their tabs, the two tabs, and the
   author card a record page shows. Every one of them reads the account's
   shared `AccountChecksModel` (AturiCore), so they join one run of each
   check per DID, and each view that shows the work retains the model
   while it is on screen, which is what keeps an unfinished run alive. */

/// Which full view a check row opens.
enum AccountCheckKind: Hashable {
    case labels
    case visibility
}

/// The checks' tones, the web's `data-tone` on `.fx-check-pill`. The theme
/// has no amber, so a warning takes the system orange, the nearest
/// SwiftUI has to the web's.
enum AccountCheckTone: Hashable {
    case ok
    case warn
    case bad
    case plain

    func color(_ theme: AturiTheme) -> Color {
        switch self {
        case .ok: return theme.textAccent
        case .warn: return Color.orange
        case .bad: return theme.danger
        case .plain: return theme.textSecondary
        }
    }

    var systemImage: String? {
        switch self {
        case .ok: return "checkmark"
        case .warn: return "exclamationmark.triangle"
        case .bad: return "xmark"
        case .plain: return nil
        }
    }

    static func visibility(_ tone: AccountChecks.VisibilityTone) -> AccountCheckTone {
        switch tone {
        case .pending, .info: return .plain
        case .pass: return .ok
        case .warn: return .warn
        case .fail: return .bad
        }
    }

    static func verdict(_ tone: Shadowban.ShadowbanVerdict.Tone) -> AccountCheckTone {
        switch tone {
        case .pending: return .plain
        case .pass: return .ok
        case .warn: return .warn
        case .fail: return .bad
        }
    }
}

/// A few words in a tinted capsule. The words end in an ellipsis on a
/// narrow row rather than push the row past the card's edge.
struct AccountCheckPill: View {
    let text: String
    let tone: AccountCheckTone

    @Environment(\.aturiTheme) private var theme

    init(text: String, tone: AccountCheckTone) {
        self.text = text
        self.tone = tone
    }

    var body: some View {
        let color = tone.color(theme)
        HStack(spacing: 3) {
            if let image = tone.systemImage {
                Image(systemName: image)
                    .font(AturiFont.caption2.weight(.bold))
            }
            Text(text)
                .font(AturiFont.sans(.caption, weight: .semibold))
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .foregroundStyle(color)
        .padding(.horizontal, 7)
        .padding(.vertical, 3)
        .background(color.opacity(0.12), in: Capsule())
        .overlay(Capsule().strokeBorder(color.opacity(0.35), lineWidth: 1))
    }
}

/// The six visibility dots, one per account check, each filling as its
/// answer comes back. Hollow while waiting to start.
struct AccountCheckDots: View {
    let summary: AccountChecks.VisibilitySummary?
    var waiting = false

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        HStack(spacing: 3) {
            ForEach(0..<6, id: \.self) { index in
                Circle()
                    .fill(fillColor(state(index)))
                    .frame(width: 7, height: 7)
                    .overlay(Circle().strokeBorder(strokeColor(state(index)), lineWidth: 1))
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(summary?.done ?? 0) of \(summary?.dots.count ?? 6) visibility checks back")
    }

    private func state(_ index: Int) -> AccountChecks.DotState? {
        guard !waiting, let dots = summary?.dots, index < dots.count else { return nil }
        return dots[index].state
    }

    private func fillColor(_ state: AccountChecks.DotState?) -> Color {
        switch state {
        case .pass?: return theme.textAccent
        case .warn?: return Color.orange
        case .fail?: return theme.danger
        case .skip?: return theme.textTertiary.opacity(0.45)
        case .run?, nil: return Color.clear
        }
    }

    private func strokeColor(_ state: AccountChecks.DotState?) -> Color {
        switch state {
        case .run?: return theme.textSecondary
        case nil: return theme.borderMedium
        case .pass?, .warn?, .fail?, .skip?: return Color.clear
        }
    }
}

/// The account card's checks: Labels and Visibility under the identity
/// rows, each opening its tab, with Retry beside a row that failed.
///
/// The rows show the work as it happens. Labels: a placeholder while
/// Bluesky's moderation service answers, then the count climbing as the
/// scan of every labeler answers, with its progress. Visibility: six dots
/// filling as each check comes back, then a few words for what was found.
/// A result kept from earlier says how old it is. The web's Created row,
/// which now leads these on its card, is not ported: Repo at a glance
/// carries the account's age here.
struct AccountChecksCard: View {
    let open: (AccountCheckKind) -> Void

    @State private var model: AccountChecksModel

    init(identity: IdentityBundle, open: @escaping (AccountCheckKind) -> Void) {
        self.open = open
        _model = State(initialValue: AccountChecksStore.shared.model(for: identity))
    }

    var body: some View {
        AccountChecksRows(model: model, open: open)
            .padding(.horizontal, 14)
            .padding(.vertical, 4)
            .cardBackground()
    }
}

/// The two rows themselves, shared by the account card and the author card.
struct AccountChecksRows: View {
    let model: AccountChecksModel
    let open: (AccountCheckKind) -> Void

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        // Moves on every half minute, for "4 min ago" and label expiry.
        TimelineView(.periodic(from: .now, by: 30)) { context in
            VStack(spacing: 0) {
                labelsRow(model.labelState(now: context.date), now: context.date)
                Divider()
                visibilityRow(model.visibilityState(now: context.date), now: context.date)
            }
        }
        .onAppear { model.retain() }
        .onDisappear { model.release() }
    }

    // MARK: Rows

    private func row<Content: View>(
        _ title: String,
        accessibility: String,
        kind: AccountCheckKind,
        retry: (() -> Void)?,
        @ViewBuilder content: () -> Content
    ) -> some View {
        HStack(spacing: 8) {
            Button {
                open(kind)
            } label: {
                HStack(spacing: 8) {
                    Text(title)
                        .aturiLabel()
                        .foregroundStyle(theme.textTertiary)
                        .frame(width: 78, alignment: .leading)
                    HStack(spacing: 6) {
                        content()
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    Image(systemName: "chevron.right")
                        .font(AturiFont.caption2)
                        .foregroundStyle(theme.textTertiary)
                }
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(accessibility)
            .accessibilityAddTraits(.isButton)
            if let retry {
                Button("Retry", action: retry)
                    .font(AturiFont.sans(.footnote, weight: .medium))
                    .foregroundStyle(theme.textAccent)
                    .buttonStyle(.plain)
            }
        }
    }

    private func sub(_ text: String, quiet: Bool = false) -> some View {
        Text(text)
            .font(AturiFont.footnote)
            .foregroundStyle(quiet ? theme.textTertiary : theme.textSecondary)
            .lineLimit(1)
            .truncationMode(.tail)
    }

    private func labelCount(_ n: Int, tone: AccountCheckTone? = nil) -> some View {
        Text(Labels.formatCount(n))
            .font(AturiFont.sans(.subheadline, weight: .semibold))
            .monospacedDigit()
            .foregroundStyle(tone.map { $0.color(theme) } ?? theme.textPrimary)
    }

    private static func withTail(_ text: String, _ tail: String) -> String {
        tail.isEmpty ? text : "\(text) \u{00B7} \(tail)"
    }

    @ViewBuilder
    private func labelsRow(_ state: AccountChecksModel.LabelCheckState, now: Date) -> some View {
        switch state {
        case .asking:
            row("Labels", accessibility: "Labels: asking Bluesky\u{2019}s moderation service", kind: .labels, retry: nil) {
                SkeletonBar(width: 56, height: 8)
                sub("Asking Bluesky")
            }
        case .scanning(let summary, let progress):
            let percent = progress.map { Labels.scanPercent($0) } ?? 2
            let progressText: String = progress.map {
                "\(Labels.formatCount($0.checked + $0.failed)) of \(Labels.formatCount($0.total))"
            } ?? "listing\u{2026}"
            row(
                "Labels",
                accessibility: "Labels: \(summary.active) so far, asking every labeler",
                kind: .labels,
                retry: nil
            ) {
                if let first = summary.moderation.first {
                    AccountCheckPill(text: first, tone: .warn)
                }
                labelCount(summary.active)
                ProgressView(value: Double(max(2, percent)), total: 100)
                    .frame(maxWidth: 56)
                sub(progressText, quiet: true)
            }
        case .done(let summary, let progress, let stopped, let settledAt):
            let kept = AccountChecks.keptFor(settledAt, now: now)
            let tail = [stopped ? "stopped at \(Labels.formatCount(progress.checked))" : nil, kept]
                .compactMap { $0 }
                .joined(separator: " \u{00B7} ")
            let words = AccountChecks.labelSourceWords(summary)
            let accessibility = summary.active == 0
                ? "Labels: none from \(Labels.formatCount(progress.total)) labelers"
                : "Labels: \(summary.active) \(words)"
            row("Labels", accessibility: accessibility, kind: .labels, retry: nil) {
                if let first = summary.moderation.first {
                    // A label from Bluesky's own moderation service leads
                    // the row, however many others there are (plan D3).
                    let others = summary.active - 1
                    let lead = others > 0 ? "and \(others) other\(others == 1 ? "" : "s")" : "from Bluesky"
                    AccountCheckPill(text: first, tone: .warn)
                    sub(Self.withTail(lead, tail))
                } else if summary.active == 0 {
                    // Plain words rather than a zero badge, so nothing reads as a warning.
                    let none = stopped ? "None so far" : "None from \(Labels.formatCount(progress.total)) labelers"
                    sub(Self.withTail(none, tail))
                } else {
                    labelCount(summary.active)
                    sub(Self.withTail(words, tail))
                }
            }
        case .absent(let absence, let message):
            row("Labels", accessibility: "Labels: \(message)", kind: .labels, retry: nil) {
                switch absence {
                case .suspended:
                    AccountCheckPill(text: "Bluesky will not show this", tone: .bad)
                case .deactivated:
                    AccountCheckPill(text: "Deactivated", tone: .plain)
                case .missing:
                    sub("No Bluesky profile", quiet: true)
                }
            }
        case .error(let message, let summary):
            row("Labels", accessibility: "Labels: \(message)", kind: .labels, retry: { model.retryLabels() }) {
                if let summary, summary.active > 0 {
                    labelCount(summary.active)
                }
                sub(summary == nil ? "Couldn\u{2019}t ask Bluesky" : "Scan stopped")
            }
        }
    }

    @ViewBuilder
    private func visibilityRow(_ state: AccountChecksModel.VisibilityCheckState, now: Date) -> some View {
        switch state {
        case .waiting:
            row("Visibility", accessibility: "Visibility: starting", kind: .visibility, retry: nil) {
                AccountCheckDots(summary: nil, waiting: true)
                sub("Starting", quiet: true)
            }
        case .running(let summary):
            row("Visibility", accessibility: "Visibility: \(summary.short)", kind: .visibility, retry: nil) {
                AccountCheckDots(summary: summary)
                sub(summary.short)
            }
        case .done(let summary, let settledAt):
            let tone = AccountCheckTone.visibility(summary.tone)
            let kept = AccountChecks.keptFor(settledAt, now: now)
            let more: String? = summary.more > 0 ? "+\(summary.more) more" : (tone == .ok ? "on Bluesky" : nil)
            let tail = [more, kept].compactMap { $0 }.joined(separator: " \u{00B7} ")
            row("Visibility", accessibility: "Visibility: \(summary.title)", kind: .visibility, retry: nil) {
                AccountCheckPill(text: summary.short, tone: tone)
                // A finding keeps its dots, so it shows which check found it.
                if tone == .warn || tone == .bad {
                    AccountCheckDots(summary: summary)
                }
                if !tail.isEmpty {
                    sub(tail, quiet: tone != .ok)
                }
            }
        case .absent(let absence):
            let deactivated = absence == .deactivated
            row(
                "Visibility",
                accessibility: deactivated ? "Visibility: deactivated" : "Visibility: no Bluesky profile",
                kind: .visibility,
                retry: nil
            ) {
                if deactivated {
                    AccountCheckPill(text: "Deactivated", tone: .plain)
                } else {
                    sub("No Bluesky profile", quiet: true)
                }
            }
        case .error(let message):
            row("Visibility", accessibility: "Visibility: \(message)", kind: .visibility, retry: { model.recheckVisibility() }) {
                sub("Couldn\u{2019}t check")
            }
        }
    }
}

/// A check's badge beside its tab, port of `LabelBadge` and
/// `VisibilityBadge`: a spinner, a ring filling with the scan, then the
/// count (amber when Bluesky's moderation service labelled the account),
/// or the verdict's mark in its tone.
private struct AccountCheckTabBadge: View {
    let kind: AccountCheckKind

    @State private var model: AccountChecksModel

    @Environment(\.aturiTheme) private var theme

    init(identity: IdentityBundle, kind: AccountCheckKind) {
        self.kind = kind
        _model = State(initialValue: AccountChecksStore.shared.model(for: identity))
    }

    var body: some View {
        switch kind {
        case .labels:
            labelBadge(model.labelState(now: Date()))
        case .visibility:
            visibilityBadge(model.visibilityState(now: Date()))
        }
    }

    private func countText(_ n: Int, color: Color) -> some View {
        Text(Labels.formatCount(n))
            .font(AturiFont.sans(.caption2, weight: .semibold))
            .monospacedDigit()
            .foregroundStyle(color)
    }

    @ViewBuilder
    private func labelBadge(_ state: AccountChecksModel.LabelCheckState) -> some View {
        switch state {
        case .asking:
            ProgressView()
                .controlSize(.mini)
        case .scanning(let summary, let progress):
            let percent = progress.map { Labels.scanPercent($0) } ?? 2
            ZStack {
                Circle()
                    .stroke(theme.borderMedium, lineWidth: 2)
                Circle()
                    .trim(from: 0, to: CGFloat(max(2, percent)) / 100)
                    .stroke(theme.textAccent, style: StrokeStyle(lineWidth: 2, lineCap: .round))
                    .rotationEffect(.degrees(-90))
                countText(summary.active, color: theme.textPrimary)
            }
            .frame(width: 20, height: 20)
            .accessibilityLabel("\(summary.active) labels so far")
        case .done(let summary, _, _, _):
            countText(summary.active, color: summary.moderation.isEmpty ? theme.textTertiary : Color.orange)
                .accessibilityLabel("\(summary.active) labels")
        case .error(_, let summary):
            if let summary {
                countText(summary.active, color: theme.textTertiary)
            }
        case .absent:
            EmptyView()
        }
    }

    @ViewBuilder
    private func visibilityBadge(_ state: AccountChecksModel.VisibilityCheckState) -> some View {
        switch state {
        case .waiting, .running:
            ProgressView()
                .controlSize(.mini)
        case .done(let summary, _):
            let tone = AccountCheckTone.visibility(summary.tone)
            Image(systemName: tone.systemImage ?? "eye")
                .font(AturiFont.caption2.weight(.bold))
                .foregroundStyle(tone.color(theme))
                .accessibilityLabel(summary.title)
        case .error, .absent:
            EmptyView()
        }
    }
}

/// The verdict at the head of a check's tab, the tools' `ToolVerdict`.
struct AccountCheckVerdict: View {
    let title: String
    let text: String
    let tone: AccountCheckTone
    var busy = false

    @Environment(\.aturiTheme) private var theme

    /* Explicit, as the shared components here are: the views that reuse
       this one live in other files (the tools). */
    init(title: String, text: String, tone: AccountCheckTone, busy: Bool = false) {
        self.title = title
        self.text = text
        self.tone = tone
        self.busy = busy
    }

    var body: some View {
        let color = tone.color(theme)
        let shape = RoundedRectangle(cornerRadius: AturiTheme.cardRadius, style: .continuous)
        HStack(alignment: .top, spacing: 10) {
            if busy {
                ProgressView()
                    .controlSize(.small)
            } else {
                Image(systemName: tone.systemImage ?? "info.circle")
                    .font(AturiFont.sans(.subheadline, weight: .bold))
                    .foregroundStyle(color)
                    .accessibilityHidden(true)
            }
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
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(color.opacity(0.08), in: shape)
        .overlay(shape.strokeBorder(color.opacity(0.3), lineWidth: 1))
        .accessibilityElement(children: .combine)
    }
}

// MARK: Labels tab

/// The Labels tab, port of `LabelChecker.tsx` drawn embedded: the verdict
/// with what was asked, the labels by who applied them and what each
/// means, and the scan of every labeler with Stop and Scan again. It joins
/// the runs the account card started, so opening it sends nothing new.
/// Asking a particular labeler by hand belongs to the tool page and is not
/// ported.
private struct RepoLabelsTab: View {
    @State private var model: AccountChecksModel

    @Environment(\.aturiTheme) private var theme

    init(identity: IdentityBundle) {
        _model = State(initialValue: AccountChecksStore.shared.model(for: identity))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            switch model.base.status {
            case .idle, .loading:
                AccountCheckVerdict(
                    title: "Checking this account",
                    text: "Asking Bluesky\u{2019}s moderation service.",
                    tone: .plain,
                    busy: true
                )
                SkeletonRows(count: 3)
            case .error:
                ErrorPanel(message: model.base.error ?? "Something went wrong") {
                    model.retryLabels()
                }
            case .done:
                if let base = model.base.data {
                    if let unavailable = base.unavailable {
                        AccountCheckVerdict(
                            title: "Bluesky will not show this",
                            text: "The AppView answered \u{201C}\(unavailable)\u{201D}. That isn\u{2019}t a label: there is no profile here to label.",
                            tone: .warn
                        )
                    } else {
                        loaded(base, now: Date())
                    }
                }
            }
        }
        .onAppear { model.retain() }
        .onDisappear { model.release() }
    }

    private var scanning: Bool {
        model.scan.status == .loading || model.scan.status == .idle
    }

    private func coverage(progress: Labels.ScanProgress?) -> String {
        let first = "Asked Bluesky\u{2019}s moderation service. Self-labels are included."
        if scanning {
            guard let progress else { return "\(first) Listing every other labeler." }
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
    private func loaded(_ base: LabelsClient.BaseResult, now: Date) -> some View {
        let labels = model.allLabels
        let labelers = model.labelers
        let groups = Labels.groupLabels(labels, subjectDid: base.subject.did)
        let active = labels.filter { !$0.neg && !Labels.isExpired($0, now: now) }.count
        let subjectHandle = base.view?.handle
        let who = subjectHandle.map { "@\($0)" } ?? shortDid(base.subject.did)
        let sources = groups.count == 1 ? "one source" : "\(groups.count) sources"
        let howMany = active == 1 ? "One label" : "\(active) labels"
        let title = (active == 0 ? "No labels on \(who)" : "\(howMany) on \(who)") + (scanning ? " so far" : "")
        let languages = Locale.preferredLanguages
        let finished = model.scan.status == .done && model.scan.data?.stopped == false

        AccountCheckVerdict(title: title, text: coverage(progress: model.scan.data?.progress), tone: .plain, busy: scanning)

        VStack(alignment: .leading, spacing: 10) {
            SectionHeader(
                "Labels",
                detail: labels.isEmpty ? nil : "\(labels.count) from \(sources)"
            )
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
                        languages: languages,
                        now: now
                    )
                }
            }
        }

        VStack(alignment: .leading, spacing: 10) {
            SectionHeader("Labelers")
            scanCard
        }
    }

    private var scanCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Every labeler the relay lists is asked, \(Labels.labelersPerRequest) at a time.")
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                if scanning {
                    let progress = model.scan.data?.progress
                    let progressWords: String = progress.map {
                        "\(Labels.formatCount($0.checked + $0.failed)) of \(Labels.formatCount($0.total))"
                    } ?? "Listing labelers\u{2026}"
                    Button {
                        model.stopScan()
                    } label: {
                        Label("Stop", systemImage: "stop.fill")
                            .font(AturiFont.footnote)
                    }
                    .buttonStyle(.aturiSecondary)
                    ProgressView(value: Double(progress.map { Labels.scanPercent($0) } ?? 0), total: 100)
                        .accessibilityLabel("Labelers asked")
                    Text(progressWords)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textTertiary)
                        .lineLimit(1)
                } else {
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
                        let doneWords: String = "\(lead) \(Labels.formatCount(done.progress.checked)) of \(Labels.formatCount(done.progress.total))\(failed)"
                        Text(doneWords)
                            .font(AturiFont.footnote)
                            .foregroundStyle(theme.textTertiary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                }
            }
            if model.scan.status == .error, let error = model.scan.error {
                Text("The scan could not start: \(error).")
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }
}

/// The labels one labeler applied, port of `LabelGroupCard`: who it is
/// (a link to its repo), then each label.
struct RepoLabelGroupCard: View {
    let group: Labels.LabelGroup
    let labeler: LabelsClient.LabelerInfo?
    let subjectAvatar: String?
    let languages: [String]
    let now: Date

    @Environment(\.aturiTheme) private var theme

    init(group: Labels.LabelGroup, labeler: LabelsClient.LabelerInfo?, subjectAvatar: String?, languages: [String], now: Date) {
        self.group = group
        self.labeler = labeler
        self.subjectAvatar = subjectAvatar
        self.languages = languages
        self.now = now
    }

    private var name: String {
        if group.isSelf { return "Set by the account itself" }
        if let displayName = labeler?.displayName { return displayName }
        if let handle = labeler?.handle { return "@\(handle)" }
        return shortDid(group.src)
    }

    private var subtitle: String {
        if group.isSelf { return "Self-labels in its own records" }
        if let handle = labeler?.handle { return "@\(handle)" }
        if labeler != nil { return group.src }
        return "Bluesky has no labeler profile for this DID"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            NavigationLink(value: Route.repo(group.src)) {
                HStack(spacing: 10) {
                    AvatarView(url: group.isSelf ? subjectAvatar : labeler?.avatar, size: 32)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(name)
                            .font(AturiFont.sans(.subheadline, weight: .semibold))
                            .foregroundStyle(theme.textAccent)
                            .lineLimit(1)
                        Text(subtitle)
                            .font(AturiFont.caption)
                            .foregroundStyle(theme.textTertiary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    Spacer(minLength: 6)
                    Text(group.labels.count == 1 ? "1 label" : "\(group.labels.count) labels")
                        .font(AturiFont.caption)
                        .foregroundStyle(theme.textTertiary)
                }
                .padding(12)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            ForEach(Array(group.labels.enumerated()), id: \.offset) { pair in
                Divider()
                RepoLabelRow(
                    label: pair.element,
                    definitions: labeler?.definitions ?? [],
                    isSelf: group.isSelf,
                    languages: languages,
                    now: now
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }
}

/// One label and what it means, port of `LabelRow`.
private struct RepoLabelRow: View {
    let label: Labels.Label
    let definitions: [Labels.LabelDefinition]
    let isSelf: Bool
    let languages: [String]
    let now: Date

    @Environment(\.aturiTheme) private var theme

    private static func date(_ iso: String?) -> String? {
        guard let iso, let date = Formatting.isoDate(iso) else { return nil }
        return date.formatted(date: .abbreviated, time: .omitted)
    }

    private static func scopeWords(_ scope: Labels.LabelScope) -> String {
        switch scope {
        case .account: return "On the account"
        case .profile: return "On the profile record"
        case .post: return "On the post"
        case .record: return "On a record"
        }
    }

    private func facts(_ meaning: Labels.LabelMeaning, expired: Bool) -> [String] {
        var out = [Self.scopeWords(Labels.labelScope(label))]
        if let applied = Self.date(label.cts) {
            out.append("Applied \(applied)")
        }
        if let expires = Self.date(label.exp) {
            out.append(expired ? "Expired \(expires)" : "Expires \(expires)")
        }
        if let effect = Labels.labelEffect(blurs: meaning.blurs, severity: meaning.severity) {
            out.append(effect)
        }
        if let setting = meaning.defaultSetting, !setting.isEmpty {
            out.append("Subscribers get \u{201C}\(setting)\u{201D} by default")
        }
        if meaning.adultOnly {
            out.append("Adults only")
        }
        if meaning.source == .protocolDefined {
            out.append("Defined by the protocol")
        }
        return out
    }

    var body: some View {
        let meaning = Labels.describeLabel(label.val, definitions: isSelf ? [] : definitions, languages: languages)
        let expired = Labels.isExpired(label, now: now)
        let state: String? = label.neg ? "Withdrawn" : (expired ? "Expired" : (meaning.severity == "alert" ? "Alert" : nil))
        let fallback = isSelf
            ? "Not a self-label value the protocol defines, so apps ignore it."
            : "The labeler gives no description."
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(meaning.name)
                    .font(AturiFont.sans(.subheadline, weight: .medium))
                    .foregroundStyle(theme.textPrimary)
                if meaning.name != label.val {
                    Text(label.val)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textTertiary)
                        .lineLimit(1)
                }
                if let state {
                    AccountCheckPill(text: state, tone: state == "Alert" ? .warn : .plain)
                }
            }
            Text(meaning.description ?? fallback)
                .font(AturiFont.footnote)
                .foregroundStyle(meaning.description == nil ? theme.textTertiary : theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Text(facts(meaning, expired: expired).joined(separator: " \u{00B7} "))
                .font(AturiFont.caption)
                .foregroundStyle(theme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .opacity(label.neg || expired ? 0.6 : 1)
        .accessibilityElement(children: .combine)
    }
}

// MARK: Visibility tab

/// The Visibility tab, port of `ShadowbanChecker.tsx` drawn embedded: the
/// verdict, the six checks with what each found, and the account's recent
/// posts with how each came out. It joins the card's run. The web's view
/// keeps an AppView switch for itself (plan D1); this one checks Bluesky's
/// AppView only, as the card does. An account with no Bluesky profile says
/// so instead of running the check the card skipped.
private struct RepoVisibilityTab: View {
    @State private var model: AccountChecksModel

    @Environment(\.aturiTheme) private var theme

    init(identity: IdentityBundle) {
        _model = State(initialValue: AccountChecksStore.shared.model(for: identity))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            switch model.visibilityState(now: Date()) {
            case .waiting:
                AccountCheckVerdict(
                    title: "Checking on \(Shadowban.defaultAppView.name)",
                    text: "",
                    tone: .plain,
                    busy: true
                )
                SkeletonRows(count: 4)
            case .absent(let absence):
                if absence == .deactivated {
                    EmptyState(
                        title: "Deactivated",
                        detail: "Nothing for Bluesky to show or hide.",
                        systemImage: "eye.slash"
                    )
                } else {
                    EmptyState(
                        title: "No Bluesky profile",
                        detail: "Nothing for Bluesky to hide.",
                        systemImage: "eye.slash"
                    )
                }
            case .error(let message):
                ErrorPanel(message: message) {
                    model.recheckVisibility()
                }
            case .running, .done:
                if let evidence = model.visibility.data {
                    loaded(evidence)
                }
            }
        }
        .onAppear { model.retain() }
        .onDisappear { model.release() }
    }

    @ViewBuilder
    private func loaded(_ evidence: Shadowban.Evidence) -> some View {
        let now = evidence.checkedAt ?? Date()
        let checks = Shadowban.buildAccountChecks(evidence, now: now)
        let verdict = Shadowban.shadowbanVerdict(evidence, checks: checks)
        let posts = evidence.posts?.value ?? []
        let running = model.visibility.status == .loading

        AccountCheckVerdict(
            title: verdict.title,
            text: verdict.text,
            tone: AccountCheckTone.verdict(verdict.tone),
            busy: verdict.tone == .pending
        )

        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                SectionHeader("Checks")
                if running {
                    Text("Checking\u{2026}")
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textTertiary)
                } else {
                    Button("Check again") {
                        model.recheckVisibility()
                    }
                    .font(AturiFont.sans(.footnote, weight: .medium))
                    .foregroundStyle(theme.textAccent)
                    .buttonStyle(.plain)
                }
            }
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

        if !posts.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                SectionHeader("Recent posts", detail: "\(posts.count) from the PDS")
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
}

/// One of the six checks, the tools' `CheckList` row.
struct RepoVisibilityCheckRow: View {
    let check: Shadowban.ShadowbanCheck

    @Environment(\.aturiTheme) private var theme

    init(check: Shadowban.ShadowbanCheck) {
        self.check = check
    }

    private var statusWords: String {
        switch check.status {
        case .pass: return "pass"
        case .warn: return "worth a look"
        case .fail: return "something hidden"
        case .info: return "note"
        case .skip: return "not checked"
        case .pending: return "checking"
        }
    }

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            statusIcon
                .frame(width: 18)
            VStack(alignment: .leading, spacing: 3) {
                Text(check.title)
                    .font(AturiFont.sans(.subheadline, weight: .medium))
                    .foregroundStyle(theme.textPrimary)
                Text(check.summary)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                ForEach(check.detail ?? [], id: \.self) { line in
                    Text(line)
                        .font(AturiFont.caption)
                        .foregroundStyle(theme.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(check.title), \(statusWords). \(check.summary)")
    }

    @ViewBuilder
    private var statusIcon: some View {
        switch check.status {
        case .pending:
            ProgressView()
                .controlSize(.small)
        case .pass:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(theme.textAccent)
        case .warn:
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color.orange)
        case .fail:
            Image(systemName: "xmark.circle.fill")
                .foregroundStyle(theme.danger)
        case .info:
            Image(systemName: "info.circle")
                .foregroundStyle(theme.textTertiary)
        case .skip:
            Image(systemName: "minus.circle")
                .foregroundStyle(theme.textTertiary)
        }
    }
}

/// One recent post and how it came out, port of `PostRow` and
/// `PostPills`: on the AppView or not, in its thread or not, in search or
/// not. Opens the post's record page.
struct RepoVisibilityPostRow: View {
    let post: Shadowban.RepoPost
    let evidence: Shadowban.Evidence
    let now: Date

    @Environment(\.aturiTheme) private var theme

    init(post: Shadowban.RepoPost, evidence: Shadowban.Evidence, now: Date) {
        self.post = post
        self.evidence = evidence
        self.now = now
    }

    private var kind: String {
        guard let reply = post.reply else { return "Post" }
        return Shadowban.authorOf(reply.root) == Shadowban.authorOf(post.uri) ? "Reply in its own thread" : "Reply"
    }

    private var reading: Shadowban.ReplyReading? {
        guard let probe = evidence.replies?.value?.first(where: { $0.uri == post.uri }) else { return nil }
        return Shadowban.readReply(probe, author: evidence.identity?.did ?? "")
    }

    /// Post search returns the author's latest posts, so only a post the
    /// AppView returns, old enough to be searchable, can be said to be
    /// missing from it.
    private func notInSearch(_ presence: Shadowban.PostPresence) -> Bool {
        guard presence == .shown, let found = evidence.postSearch?.value, let writtenAt = post.writtenAt else { return false }
        return now.timeIntervalSince(writtenAt) >= Shadowban.searchGrace && !found.contains(post.uri)
    }

    private func presencePill(_ presence: Shadowban.PostPresence) -> AccountCheckPill {
        switch presence {
        case .shown: return AccountCheckPill(text: "On \(evidence.appview.name)", tone: .ok)
        case .missing: return AccountCheckPill(text: "Missing", tone: .bad)
        case .new: return AccountCheckPill(text: "Too new to tell", tone: .plain)
        case .pending: return AccountCheckPill(text: evidence.done ? "Not compared" : "\u{2026}", tone: .plain)
        }
    }

    /// Why a reply that is not in its thread is not, after its kind and time.
    private static func why(_ reading: Shadowban.ReplyReading?) -> String {
        guard let reading, reading.outcome != .shown else { return "" }
        return " \u{00B7} \(reading.reason)"
    }

    private static func tone(_ outcome: Shadowban.ReplyReading.Outcome) -> AccountCheckTone {
        switch outcome {
        case .shown: return .ok
        case .hidden: return .bad
        case .explained: return .warn
        case .unknown: return .plain
        }
    }

    var body: some View {
        let presence = Shadowban.postPresence(post, shown: evidence.shown, now: now)
        let text = post.text.trimmingCharacters(in: .whitespacesAndNewlines)
        let replyReading = self.reading
        let when = post.writtenAt.map { " \u{00B7} \(Formatting.relative($0))" } ?? ""
        let why = Self.why(replyReading)
        NavigationLink(value: Route.record(repo: Shadowban.authorOf(post.uri), collection: Shadowban.postCollection, rkey: post.rkey)) {
            VStack(alignment: .leading, spacing: 6) {
                Text(text.isEmpty ? "No text" : (text.count > 140 ? "\(text.prefix(140))\u{2026}" : text))
                    .font(AturiFont.footnote)
                    .foregroundStyle(text.isEmpty ? theme.textTertiary : theme.textPrimary)
                    .lineLimit(4)
                    .multilineTextAlignment(.leading)
                Text("\(kind)\(when)\(why)")
                    .font(AturiFont.caption)
                    .foregroundStyle(theme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
                HStack(spacing: 6) {
                    presencePill(presence)
                    if let replyReading {
                        AccountCheckPill(text: replyReading.label, tone: Self.tone(replyReading.outcome))
                    }
                    if notInSearch(presence) {
                        AccountCheckPill(text: "Not in search", tone: .warn)
                    }
                }
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

// MARK: Author card

/// The author of a record with the author's two checks, port of
/// `AuthorChecks`: the record page has no account card, and this is the
/// answer the card would give. The name opens the author's repo page, and
/// each row opens its own tab there. Name and avatar come from the label
/// check's first answer, which is a getProfile, so the card costs no
/// request of its own.
struct AccountChecksAuthorCard: View {
    let identity: IdentityBundle

    @State private var model: AccountChecksModel

    @Environment(AppRouter.self) private var router
    @Environment(\.aturiTheme) private var theme

    init(identity: IdentityBundle) {
        self.identity = identity
        _model = State(initialValue: AccountChecksStore.shared.model(for: identity))
    }

    var body: some View {
        let view = model.base.data?.view
        let handle = identity.handle ?? view?.handle
        let name = view?.displayName ?? (handle.map { "@\($0)" } ?? shortDid(identity.did))
        let repo = handle ?? identity.did
        VStack(alignment: .leading, spacing: 0) {
            Text("Author")
                .aturiLabel()
                .foregroundStyle(theme.textTertiary)
                .padding(.top, 12)
                .accessibilityAddTraits(.isHeader)
            NavigationLink(value: Route.repo(repo)) {
                HStack(spacing: 10) {
                    AvatarView(url: view?.avatar, size: 30)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(name)
                            .font(AturiFont.sans(.subheadline, weight: .semibold))
                            .foregroundStyle(theme.textPrimary)
                            .lineLimit(1)
                        if let handle, name != "@\(handle)" {
                            Text("@\(handle)")
                                .font(AturiFont.monoSmall)
                                .foregroundStyle(theme.textTertiary)
                                .lineLimit(1)
                        }
                    }
                    Spacer(minLength: 0)
                    Image(systemName: "chevron.right")
                        .font(AturiFont.caption2)
                        .foregroundStyle(theme.textTertiary)
                }
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            Divider()
            /* Each row opens its own tab on the author's repo page. */
            AccountChecksRows(model: model) { kind in
                switch kind {
                case .labels: router.open(.repo(repo, tab: RepoTab.labels.rawValue))
                case .visibility: router.open(.repo(repo, tab: RepoTab.visibility.rawValue))
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }
}
