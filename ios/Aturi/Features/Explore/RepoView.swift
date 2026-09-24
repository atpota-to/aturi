import SwiftUI
import Observation
import AturiCore

/// The repo page (`/explore/{repo}`). Reads the stores here and hands them
/// to the screen's initializer, since a `@State` model cannot be built
/// from the environment.
struct RepoView: View {
    let repo: String

    @Environment(PreferencesStore.self) private var preferences
    @Environment(\.sessionStore) private var session

    init(repo: String) {
        self.repo = repo
    }

    var body: some View {
        RepoScreen(repo: repo, preferences: preferences, viewerDid: session.state.did)
    }
}

/// The four tabs of `RepoExplorer.tsx`, in its order.
private enum RepoTab: String, CaseIterable, Identifiable {
    case collections
    case identity
    case audit
    case backlinks

    var id: String { rawValue }

    var label: String {
        switch self {
        case .collections: return "Lexicons"
        case .identity: return "ID"
        case .audit: return "Log"
        case .backlinks: return "Backlinks"
        }
    }
}

/// Port of `RepoExplorer.tsx` with `ProfileHeader.tsx`, `AccountStats.tsx`,
/// `RepoStatusNotice.tsx` and `RelationshipStrip.tsx`: breadcrumb, the
/// inactive-repo banner, the configurable sections (relationship strip,
/// profile card, identity row, repo at a glance), the waypoint row and the
/// tabbed lexicons / ID / log / backlinks.
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

    init(repo: String, preferences: PreferencesStore, viewerDid: String?) {
        self.viewerDid = viewerDid
        _model = State(initialValue: RepoModel(input: repo, preferences: preferences, viewerDid: viewerDid))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                ExploreBreadcrumb(identity: model.identity.value, repo: model.input)
                switch model.identity {
                case .idle, .loading:
                    SkeletonRows(count: 6)
                case .failed(let message):
                    ExploreNotFoundPanel(
                        eyebrow: RecordModel.identityFailureEyebrow,
                        headline: RecordModel.identityFailureHeadline,
                        message: model.notFoundMessage ?? message
                    ) {
                        model.load()
                    }
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
        case .collections:
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
        Picker("Section", selection: $tab) {
            ForEach(RepoTab.allCases) { tab in
                Text(tab.label).tag(tab)
            }
        }
        .pickerStyle(.segmented)
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
                        .font(.caption)
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
        let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "circle.slash")
                .foregroundStyle(theme.danger)
                .padding(.top, 2)
                .accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 10) {
                Text(notice.headline)
                    .font(.body.weight(.medium))
                    .foregroundStyle(theme.textPrimary)
                Text(notice.detail)
                    .font(.footnote)
                    .foregroundStyle(theme.textSecondary)
                Text(RepoStatusNotice.reassurance)
                    .font(.footnote)
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
                .font(.caption2)
                .foregroundStyle(theme.textTertiary)
        }
    }
}

/// The profile card, port of `ProfileHeader.tsx`: avatar, name, pronouns,
/// the handle doubling as the website link, the bio and the three counts.
private struct RepoProfileCard: View {
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
                                .foregroundStyle(theme.textPrimary)
                        }
                        if let pronouns = header.pronouns {
                            Text(pronouns)
                                .font(.footnote.italic())
                                .foregroundStyle(theme.textTertiary)
                        }
                    }
                    handleLine
                }
            }
            if let description = header.description {
                Text(description)
                    .font(.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if header.hasStats {
                HStack(spacing: 16) {
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
            }
            Divider()
            Button(action: onUniversalLink) {
                Label("View the universal link page", systemImage: "globe")
                    .font(.footnote)
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
                            .font(.caption2)
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

    private func stat(_ systemImage: String, _ value: Int, _ label: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: systemImage)
                .font(.caption)
                .foregroundStyle(theme.textTertiary)
            Text(value.formatted())
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
                        .font(.footnote)
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
                        .font(.footnote)
                        .foregroundStyle(theme.textTertiary)
                    Text("Browse \(host)")
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
            RepoStatTile(
                systemImage: "waveform.path.ecg",
                label: "Last active",
                value: stats.map { $0.lastActiveDate.map { Formatting.relative($0) } ?? Self.dash },
                sublabel: stats?.headRevFromRelay == true ? "via relay" : nil,
                hint: stats?.lastActiveHint
            )
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
                    .font(.system(.title3, design: .serif))
                    .monospacedDigit()
                    .foregroundStyle(theme.textPrimary)
                    .lineLimit(1)
            } else {
                RoundedRectangle(cornerRadius: 3, style: .continuous)
                    .fill(theme.bgTertiary)
                    .frame(width: 48, height: 14)
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

/// The Lexicons tab, port of `CollectionsTab.tsx` with `GroupHeader.tsx`
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
                    .font(.footnote)
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
                ExploreFilterField("Filter lexicons", text: $model.filter, label: "Filter lexicons on this repo")
                if !model.groups.isEmpty {
                    Button {
                        model.toggleAllOpen()
                    } label: {
                        Image(systemName: model.anyOpen ? "rectangle.compress.vertical" : "rectangle.expand.vertical")
                            .font(.footnote)
                            .foregroundStyle(theme.textSecondary)
                            .frame(width: 36, height: 36)
                            .background(theme.bgTertiary, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
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
            if let status = model.collectionsStatusLabel {
                Text(status)
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(theme.textTertiary)
                    .accessibilityLabel("\(status) collections shown")
            }
        }
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
                    .font(.caption2)
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
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).strokeBorder(theme.textAccent, lineWidth: 1))
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
                        .font(.caption)
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
                .font(.footnote)
                .foregroundStyle(pinned ? theme.textAccent : theme.textTertiary)
                .frame(width: 40, height: 36)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(pinned ? "Unpin \(name)" : "Pin \(name)")
    }
}
