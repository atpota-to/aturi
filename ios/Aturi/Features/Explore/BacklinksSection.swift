import SwiftUI
import AturiCore

/// Inbound links, port of `BacklinksTab.tsx` and `BacklinkRows.tsx`. Used
/// as a repo tab (target = DID) and, with `showsSummary`, as the record
/// page's featured card with the big count in its header. Either way the
/// links open on what they mean: a tile per relationship on the tab (a chip
/// in the card), and under the open one a single list of the records behind
/// it from every source, latest first. App chips narrow the list to one
/// app; "N sources behind…" lists the raw collection + path pairs, and each
/// narrows the list to itself.
struct BacklinksSection: View {
    let model: BacklinksModel
    var showsSummary: Bool = false

    @State private var showsSources = false

    @Environment(\.openURL) private var openURL
    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale

    init(model: BacklinksModel, showsSummary: Bool = false) {
        self.model = model
        self.showsSummary = showsSummary
    }

    var body: some View {
        Group {
            if showsSummary {
                VStack(alignment: .leading, spacing: 0) {
                    summaryHeader
                    /* With nothing linking in, the header's "no records
                       reference this yet" says it all, as on the web. */
                    if !model.isEmpty {
                        Divider()
                        cardBody
                            .padding(12)
                    }
                }
                .cardBackground()
            } else {
                tabBody
            }
        }
        .onAppear {
            /* A list a `cancel()` cut off is dropped; asking again on
               appear starts it afresh. A no-op for a list already there. */
            model.loadActiveList()
        }
    }

    private var hairline: CGFloat {
        AturiTheme.hairline(displayScale: displayScale)
    }

    // MARK: Card and tab

    private var summaryHeader: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(model.countText)
                    .font(AturiFont.sans(.title, weight: .bold))
                    .foregroundStyle(theme.textAccent)
                    .monospacedDigit()
                Text("backlinks")
                    .font(AturiFont.body)
                    .foregroundStyle(theme.textPrimary)
                Spacer(minLength: 0)
                HStack(spacing: 3) {
                    Text("via")
                        .font(AturiFont.caption2)
                        .foregroundStyle(theme.textTertiary)
                    Button("Microcosm") {
                        openURL(BacklinksModel.microcosmURL)
                    }
                    .font(AturiFont.caption2)
                    .buttonStyle(.plain)
                    .foregroundStyle(theme.textAccent)
                    .accessibilityHint("Opens outside the app")
                }
            }
            Text(model.summaryText)
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textTertiary)
        }
        .padding(14)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private var cardBody: some View {
        switch model.sources {
        case .idle, .loading:
            SkeletonRows(count: 3)
        case .failed:
            unavailable
        case .loaded(let sources):
            if !sources.isEmpty {
                relationships(tiles: false)
            }
        }
    }

    @ViewBuilder
    private var tabBody: some View {
        switch model.sources {
        case .idle, .loading:
            SkeletonRows(count: 4)
        case .failed:
            unavailable
        case .loaded(let sources):
            if sources.isEmpty {
                EmptyState(title: BacklinksModel.emptyMessage, systemImage: "link")
            } else {
                VStack(alignment: .leading, spacing: 16) {
                    relationships(tiles: true)
                    credit
                }
            }
        }
    }

    private var unavailable: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(BacklinksModel.unavailableMessage)
                .font(AturiFont.footnote.italic())
                .foregroundStyle(theme.textSecondary)
            HStack(spacing: 12) {
                Button("Retry") {
                    model.reload()
                }
                .buttonStyle(.aturiSecondary)
                Button("constellation") {
                    openURL(BacklinksModel.constellationURL)
                }
                .font(AturiFont.footnote)
                .buttonStyle(.plain)
                .foregroundStyle(theme.textAccent)
                .accessibilityHint("Opens outside the app")
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }

    /// The tab's credit line under the list; the card credits Microcosm in
    /// its header.
    private var credit: some View {
        HStack(spacing: 4) {
            Text("Links indexed by")
            Button("Constellation") {
                openURL(BacklinksModel.constellationURL)
            }
            .buttonStyle(.plain)
            .foregroundStyle(theme.textAccent)
            .accessibilityHint("Opens outside the app")
            Text("via")
            Button("Microcosm") {
                openURL(BacklinksModel.microcosmURL)
            }
            .buttonStyle(.plain)
            .foregroundStyle(theme.textAccent)
            .accessibilityHint("Opens outside the app")
        }
        .font(AturiFont.caption)
        .foregroundStyle(theme.textTertiary)
    }

    // MARK: Relationships

    /// Tiles where the panel has the page's width, chips in the record card.
    private func relationships(tiles: Bool) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            if tiles {
                relationTiles
            } else {
                relationChips
            }
            if let group = model.selectedGroup {
                detail(group)
            }
        }
    }

    private var relationTiles: some View {
        LazyVGrid(columns: [GridItem(.adaptive(minimum: 150), spacing: 10)], spacing: 10) {
            ForEach(model.groups) { group in
                relationTile(group)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Kinds of backlink")
    }

    /// One relationship's tile, sized like the "Repo at a glance" tiles:
    /// links in full, then accounts (or sources) and how many apps.
    private func relationTile(_ group: BacklinkGroup) -> some View {
        let selected = model.isSelected(group)
        let shape = RoundedRectangle(cornerRadius: AturiTheme.cardRadius, style: .continuous)
        return Button {
            withAnimation(.easeInOut(duration: 0.15)) {
                model.select(relation: group.key)
            }
        } label: {
            VStack(alignment: .leading, spacing: 6) {
                Label(group.label, systemImage: Self.symbol(for: group.key))
                    .aturiLabel()
                    .foregroundStyle(selected ? theme.accentSoftFg : theme.textTertiary)
                    .lineLimit(1)
                Text(group.countText)
                    .font(AturiFont.sans(.title3, weight: .medium))
                    .monospacedDigit()
                    .foregroundStyle(theme.textPrimary)
                    .lineLimit(1)
                Text(group.subtitle)
                    .font(AturiFont.caption)
                    .foregroundStyle(theme.textTertiary)
                    .lineLimit(1)
            }
            .padding(12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(selected ? theme.accentSoft : theme.bgSecondary, in: shape)
            .overlay(shape.strokeBorder(selected ? theme.accentSoftRing : theme.borderMedium, lineWidth: hairline))
            .contentShape(shape)
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(group.label), \(group.countText) links, \(group.subtitle)")
        .accessibilityHint(group.hint)
        .accessibilityAddTraits(selected ? AccessibilityTraits.isSelected : AccessibilityTraits())
    }

    private var relationChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(model.groups) { group in
                    let selected = model.isSelected(group)
                    Button {
                        withAnimation(.easeInOut(duration: 0.15)) {
                            model.select(relation: group.key)
                        }
                    } label: {
                        BacklinkChip(
                            title: "\(group.label) \(group.compactCountText)",
                            systemImage: Self.symbol(for: group.key),
                            selected: selected
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint(group.about)
                    .accessibilityAddTraits(selected ? AccessibilityTraits.isSelected : AccessibilityTraits())
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Kinds of backlink")
    }

    /// The open relationship: its heading, the app filter, the narrowed
    /// source, the merged list and the sources behind it.
    private func detail(_ group: BacklinkGroup) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(group.label)
                    .font(AturiFont.subtitle)
                    .foregroundStyle(theme.textPrimary)
                    .accessibilityAddTraits(.isHeader)
                if !group.about.isEmpty {
                    Text(group.about)
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if model.showsAppFilter {
                appFilter(group)
            }
            if let narrowed = model.narrowedSource {
                narrowBar(narrowed, group: group)
            }
            linkList
            sourcesDisclosure(group)
        }
    }

    private func appFilter(_ group: BacklinkGroup) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                Button {
                    model.showAll()
                } label: {
                    BacklinkChip(title: "All \(group.compactCountText)", selected: model.isShowingAll)
                }
                .buttonStyle(.plain)
                .accessibilityAddTraits(model.isShowingAll ? AccessibilityTraits.isSelected : AccessibilityTraits())
                ForEach(group.apps, id: \.app.key) { entry in
                    let selected = model.narrowedApp == entry.app.key
                    Button {
                        model.narrow(toApp: entry.app.key)
                    } label: {
                        BacklinkChip(
                            title: "\(entry.app.name) \(BacklinksModel.compactCount(entry.count))",
                            app: entry.app,
                            selected: selected
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityAddTraits(selected ? AccessibilityTraits.isSelected : AccessibilityTraits())
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Filter by app")
    }

    private func narrowBar(_ source: BacklinkSource, group: BacklinkGroup) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("Only")
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                Text(BacklinksModel.sourceText(source))
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(theme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Button(group.showAllLabel) {
                model.showAll()
            }
            .buttonStyle(.aturiSecondary)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.surfaceSubtle, in: RoundedRectangle(cornerRadius: AturiTheme.controlRadius, style: .continuous))
    }

    // MARK: The list

    @ViewBuilder
    private var linkList: some View {
        let rows = model.rows
        if rows.isEmpty {
            if model.isListLoading {
                SkeletonRows(count: 3)
            } else {
                Text(model.listEmptyMessage)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .padding(.vertical, 4)
            }
        } else {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(rows) { row in
                    rowLink(row)
                    if row.id != rows.last?.id {
                        Divider()
                            .overlay(theme.borderSubtle)
                    }
                }
            }
            listFooter
        }
    }

    /// Show more while sources have more, and how many of the total are
    /// showing.
    private var listFooter: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let list = model.activeList, list.canLoadMore {
                Button(list.isLoading ? BacklinksModel.loadingMessage : BacklinksModel.loadMoreLabel) {
                    model.loadMore()
                }
                .font(AturiFont.footnote)
                .buttonStyle(.plain)
                .foregroundStyle(theme.textAccent)
                .disabled(list.isLoading)
            }
            if let footer = model.footerText {
                Text(footer)
                    .font(AturiFont.caption)
                    .monospacedDigit()
                    .foregroundStyle(theme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.top, 8)
    }

    @ViewBuilder
    private func rowLink(_ row: BacklinkRow) -> some View {
        if let route = Route(atUri: row.uri) {
            NavigationLink(value: route) {
                rowContent(row)
            }
            .buttonStyle(.plain)
        } else {
            rowContent(row)
        }
    }

    /// One linking record: avatar, who wrote it, what it says, and when.
    private func rowContent(_ row: BacklinkRow) -> some View {
        HStack(alignment: .top, spacing: 10) {
            AvatarView(url: row.avatar, size: 28)
            VStack(alignment: .leading, spacing: 3) {
                nameLine(row)
                if let context = row.context {
                    contextLine(context)
                }
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 4) {
                if let date = row.date {
                    RelativeDateText(date: date)
                        .font(AturiFont.caption)
                        .monospacedDigit()
                        .foregroundStyle(theme.textTertiary)
                }
                if let app = row.app {
                    BacklinkAppMark(app: app, size: 14)
                }
            }
        }
        .padding(.vertical, 8)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    private func nameLine(_ row: BacklinkRow) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            Text(row.title)
                .font(row.titleIsIdentifier ? AturiFont.monoSmall : AturiFont.sans(.subheadline, weight: .semibold))
                .foregroundStyle(row.isPending ? theme.textTertiary : theme.textPrimary)
                .lineLimit(1)
                .truncationMode(.middle)
            if let handle = row.handle {
                Text(handle)
                    .font(AturiFont.caption)
                    .foregroundStyle(theme.textTertiary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            } else if row.hasNoProfile {
                Text("no profile")
                    .font(AturiFont.caption)
                    .foregroundStyle(theme.textTertiary)
                    .lineLimit(1)
            }
            if let selfLabel = row.selfLabel {
                Chip(selfLabel, style: .accent)
                    .fixedSize()
            }
            if let links = row.linksLabel {
                Chip(links)
                    .fixedSize()
                    .accessibilityHint("This record links here more than once")
            }
        }
    }

    private func contextLine(_ context: RecordContext) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 6) {
            if let kind = context.kind {
                Text(kind)
                    .font(AturiFont.sans(.caption2, weight: .semibold))
                    .textCase(.uppercase)
                    .foregroundStyle(theme.textTertiary)
                    .fixedSize()
            }
            Text(context.text)
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textSecondary)
                .lineLimit(3)
                .multilineTextAlignment(.leading)
        }
    }

    // MARK: Sources

    /// The collection + path pairs behind a relationship, folded away by
    /// default. Each one narrows the list to itself, which is how a reader
    /// gets back to a single Constellation source.
    private func sourcesDisclosure(_ group: BacklinkGroup) -> some View {
        DisclosureGroup(isExpanded: $showsSources) {
            VStack(alignment: .leading, spacing: 2) {
                ForEach(model.sourceRows) { row in
                    sourceButton(row)
                }
            }
            .padding(.top, 6)
        } label: {
            Text(group.sourcesTitle)
                .font(AturiFont.sans(.footnote, weight: .medium))
                .foregroundStyle(theme.textSecondary)
        }
        .tint(theme.textTertiary)
    }

    private func sourceButton(_ row: BacklinkSourceRow) -> some View {
        Button {
            withAnimation(.easeInOut(duration: 0.15)) {
                model.toggleSource(row.source.source)
            }
        } label: {
            HStack(alignment: .top, spacing: 8) {
                BacklinkAppMark(app: row.app, size: 14)
                    .padding(.top, 2)
                VStack(alignment: .leading, spacing: 1) {
                    Text(row.source.collection)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(row.isNarrowed ? theme.textAccent : theme.textPrimary)
                    Text(row.pathLabel)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textTertiary)
                }
                .multilineTextAlignment(.leading)
                Spacer(minLength: 8)
                Text(BacklinksModel.compactCount(row.source.count))
                    .font(AturiFont.monoFont(.footnote, weight: .semibold))
                    .monospacedDigit()
                    .foregroundStyle(theme.textPrimary)
            }
            .padding(.vertical, 6)
            .padding(.horizontal, 8)
            .background(row.isNarrowed ? theme.accentSoft : Color.clear, in: RoundedRectangle(cornerRadius: AturiTheme.controlRadius, style: .continuous))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(row.source.collection) \(row.source.path), \(row.source.count) links")
        .accessibilityHint(row.isNarrowed ? "Shows every source again" : "Shows only this source")
        .accessibilityAddTraits(row.isNarrowed ? AccessibilityTraits.isSelected : AccessibilityTraits())
    }

    // MARK: Symbols

    /// The glyph beside each relationship, after the web's lucide icons.
    /// Keys are shared where an account's and a record's relationships
    /// share a name (`mention`, `other`).
    private static func symbol(for key: String) -> String {
        switch key {
        case "follow": return "person.badge.plus"
        case "mention": return "at"
        case "list": return "list.bullet"
        case "block": return "nosign"
        case "verify": return "checkmark.seal"
        case "endorse": return "hand.thumbsup"
        case "embed": return "square.stack.3d.up"
        case "reply": return "bubble.left"
        case "thread": return "bubble.left.and.bubble.right"
        case "quote": return "quote.bubble"
        case "repost": return "arrow.2.squarepath"
        case "like": return "heart"
        case "item": return "folder"
        case "subscribe": return "dot.radiowaves.left.and.right"
        case "via": return "signpost.right"
        default: return "link"
        }
    }
}

/// A selectable capsule for the relationship and app filters: the shared
/// `Chip`'s neutral and accent looks, with room for an app's mark.
private struct BacklinkChip: View {
    let title: String
    var systemImage: String? = nil
    var app: BacklinkApp? = nil
    let selected: Bool

    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale

    init(title: String, systemImage: String? = nil, app: BacklinkApp? = nil, selected: Bool) {
        self.title = title
        self.systemImage = systemImage
        self.app = app
        self.selected = selected
    }

    var body: some View {
        HStack(spacing: 4) {
            if let app {
                BacklinkAppMark(app: app, size: 12)
            } else if let systemImage {
                Image(systemName: systemImage)
                    .font(AturiFont.caption2)
            }
            Text(title)
                .font(AturiFont.sans(.caption, weight: selected ? .semibold : .medium))
                .lineLimit(1)
        }
        .foregroundStyle(selected ? theme.accentSoftFg : theme.textSecondary)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(selected ? theme.accentSoft : theme.bgSecondary, in: Capsule())
        .overlay(Capsule().strokeBorder(selected ? theme.accentSoftRing : theme.borderMedium, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
        .contentShape(Capsule())
    }
}

/// An app's waypoint mark, or a monogram of its name for an app the
/// catalogue has no mark for. `AppMark` in BacklinkRows.tsx.
private struct BacklinkAppMark: View {
    let app: BacklinkApp
    var size: CGFloat = 14

    @Environment(\.aturiTheme) private var theme

    init(app: BacklinkApp, size: CGFloat = 14) {
        self.app = app
        self.size = size
    }

    var body: some View {
        if let waypoint = app.waypoint {
            WaypointMark(id: waypoint, size: size)
        } else {
            Text(String(app.name.prefix(1)).uppercased())
                .font(.system(size: size * 0.7, weight: .semibold))
                .foregroundStyle(theme.textSecondary)
                .frame(width: size, height: size)
                .background(theme.bgTertiary, in: RoundedRectangle(cornerRadius: size * 0.25, style: .continuous))
                .accessibilityHidden(true)
        }
    }
}
