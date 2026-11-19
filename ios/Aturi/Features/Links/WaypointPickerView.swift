import SwiftUI
import UIKit
import AturiCore

/// The waypoint picker: every client that can open the page, arranged the
/// way the person set up their groups, in the layout they chose. Port of
/// `WaypointPicker.tsx` with `CategoryCard.tsx`, `CompactWaypointGroup.tsx`,
/// `WaypointLayoutToggle.tsx`, `NewWaypointsBanner.tsx`, `ShareButton.tsx`
/// and the notice half of `AutoRedirectGate.tsx`.
///
/// Self-contained on purpose: everything is derived from the resolved
/// identity and the `PreferencesStore` in the environment, so the share
/// extension can show the same picker from a resolved link alone.
struct WaypointPickerView: View {
    let type: WaypointType
    let handle: String
    let collection: String?
    let rkey: String?
    let did: String?
    let displayName: String?
    /// Collection NSIDs found in the target repo. Waypoints whose
    /// `expectedCollections` match none of them are hidden; nil (scan failed
    /// or not run, as on record pages) leaves every waypoint visible. An
    /// empty array is a real answer: a repo with no records.
    let repoCollections: [String]?
    /// Whether the page was reached through a universal link. The countdown
    /// itself belongs to the page (it has to stay on screen and stop on any
    /// scroll); here it only changes how a live auto-redirect preference is
    /// worded, since in-app navigation never follows it.
    let openedFromLink: Bool

    @Environment(PreferencesStore.self) private var preferences
    @Environment(AppRouter.self) private var router: AppRouter?
    @Environment(\.aturiTheme) private var theme
    @Environment(\.openURL) private var openURL
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    /// Groups folded on this page. Everything starts open, as the web's
    /// smart expansion opens every group holding a compatible waypoint,
    /// which is every group that survives the filter below.
    @State private var collapsedGroups: Set<String> = []
    /// The compact layouts' "Show fewer apps": every group shows until the
    /// visitor folds the list to its first, as on the web.
    @State private var showAllGroups = true

    init(
        type: WaypointType,
        handle: String,
        collection: String? = nil,
        rkey: String? = nil,
        did: String? = nil,
        displayName: String? = nil,
        repoCollections: [String]? = nil,
        openedFromLink: Bool = false
    ) {
        self.type = type
        self.handle = handle
        self.collection = collection
        self.rkey = rkey
        self.did = did
        self.displayName = displayName
        self.repoCollections = repoCollections
        self.openedFromLink = openedFromLink
    }

    // MARK: Derived state

    private var prefs: Preferences {
        preferences.prefs
    }

    private var display: String {
        if let displayName, !displayName.isEmpty {
            return displayName
        }
        return "@\(handle)"
    }

    /// nil means "no opinion": nothing gets hidden. An empty array is a real
    /// answer, so only nil short-circuits.
    private var repoCollectionSet: Set<String>? {
        repoCollections.map(Set.init)
    }

    /// Keep a waypoint unless the repo scan positively confirmed it has no
    /// records for it: `present` and `unknown` pass, only `absent` is dropped.
    private func isActiveForRepo(_ waypoint: Waypoint) -> Bool {
        WaypointCatalog.activity(of: waypoint, repoCollections: repoCollectionSet) != .absent
    }

    private func entry(for waypoint: Waypoint) -> WaypointPickerEntry? {
        guard isActiveForRepo(waypoint),
              let url = waypoint.url(handle: handle, collection: collection, rkey: rkey, did: did)
        else { return nil }
        return WaypointPickerEntry(waypoint: waypoint, url: url)
    }

    /* Duplicate ids within one group can only come from a hand-edited
       preferences record, but `ForEach` keys on the id, so they are dropped
       rather than trusted. */
    private func entries(for waypoints: [Waypoint]) -> [WaypointPickerEntry] {
        var seen = Set<String>()
        return waypoints.compactMap { waypoint -> WaypointPickerEntry? in
            guard seen.insert(waypoint.id).inserted else { return nil }
            return entry(for: waypoint)
        }
    }

    /// The person's groups, in their order, narrowed to waypoints that are
    /// active for the repo and can build a URL. Groups left empty by the
    /// filter are dropped, as the classic layout drops them on the web.
    private var groups: [WaypointPickerGroup] {
        Personalize.personalizeCategorized(prefs, type: type).compactMap { group -> WaypointPickerGroup? in
            let renderable = entries(for: group.waypoints)
            guard !renderable.isEmpty else { return nil }
            return WaypointPickerGroup(category: group.category, entries: renderable)
        }
    }

    /// The "Recommended for ..." row: the catalog's recommendation for the
    /// collection, narrowed to waypoints the person surfaces in some group.
    private var recommended: (label: String, entries: [WaypointPickerEntry]) {
        let raw = WaypointCatalog.recommended(for: type, collection: collection)
        let visible = Personalize.personalizeRecommended(raw.waypoints, prefs: prefs)
        return (raw.label, entries(for: visible))
    }

    private var hasWaypoints: Bool {
        !groups.isEmpty || !recommended.entries.isEmpty
    }

    private var layout: WaypointLayout {
        prefs.waypointLayout
    }

    private var layoutBinding: Binding<WaypointLayout> {
        Binding(
            get: { preferences.prefs.waypointLayout },
            set: { value in
                guard value != preferences.prefs.waypointLayout else { return }
                preferences.update { $0.setWaypointLayout(value) }
            }
        )
    }

    /// Built-ins that shipped since the person last acknowledged the catalog.
    private var newWaypoints: [Waypoint] {
        prefs.newBuiltinWaypointIds.compactMap { WaypointCatalog.all[$0] }
    }

    /// Where the auto-redirect preference would send this page, or nil for
    /// "just show the picker". The same pure decision the model makes.
    private var autoRedirectTarget: AutoRedirectTarget? {
        let context = AutoRedirectContext(type: type, handle: handle, did: did, collection: collection, rkey: rkey)
        return resolveAutoRedirect(prefs, context: context, selfHost: LinkResolverModel.selfHost)
    }

    /// `getContextText`: the heading, "Open @alice.test's post in…".
    private var contextText: String {
        switch type {
        case .post: return "Open \(display)\u{2019}s post in\u{2026}"
        case .profile: return "Open \(display)\u{2019}s profile in\u{2026}"
        case .list: return "Open \(display)\u{2019}s list in\u{2026}"
        case .record: return "Open this record from \(display) in\u{2026}"
        case .unknown: return "Open content from \(display) in\u{2026}"
        }
    }

    /// `getSubheadText`: what every option has in common.
    private var subheadText: String {
        switch type {
        case .post: return "Pick an app. They all show the same post."
        case .profile: return "Pick an app. They all show the same account."
        case .list: return "Pick an app. They all show the same list."
        case .record, .unknown: return "Pick an app. They all read the same record."
        }
    }

    /// The aturi.to universal link for this page.
    private var shareLink: String {
        generateAturiLink(AtUriComponents(identifier: handle, collection: collection, rkey: rkey))
    }

    // MARK: Body

    var body: some View {
        VStack(alignment: .leading, spacing: 20) {
            if !newWaypoints.isEmpty {
                NewWaypointsBanner(waypoints: newWaypoints, onAdd: addNewWaypoints, onDismiss: dismissNewWaypoints)
            }
            header
            autoRedirectNotice
            if hasWaypoints {
                recommendedRows
                layoutBar
                if layout == .classic {
                    classicList
                } else {
                    compactList
                }
            } else {
                EmptyState(title: "No waypoints yet", detail: LinkResolverModel.noWaypointsMessage, systemImage: "signpost.right")
            }
            aboutCard
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            /* The web's heading since its link-page rebuild (72e3ac2): who
               and what, then what every option has in common. */
            Text(contextText)
                .font(AturiFont.display)
                .tracking(AturiFont.displayTracking)
                .foregroundStyle(theme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Text(subheadText)
                .font(AturiFont.body)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
        .accessibilityAddTraits(.isHeader)
    }

    /* A live auto-redirect preference for this page, said where the
       choice is made: the web's notice for a redirect it held back
       (`SuppressedNotice` in `AutoRedirectGate.tsx`), with the favourite
       one tap away. On iOS the countdown belongs to the page; in-app
       navigation never follows the preference at all. */
    @ViewBuilder
    private var autoRedirectNotice: some View {
        if let target = autoRedirectTarget {
            let name = LinkResolverModel.waypointName(target.waypointId, customWaypoints: prefs.customWaypoints)
            let family = WaypointCatalog.compatFamilies[target.family]?.name ?? target.family.rawValue
            VStack(alignment: .leading, spacing: 10) {
                Text(openedFromLink
                     ? "Auto-redirect is on for \(family)."
                     : "Auto-redirect is on for \(family). You were not sent to \(name) because this page was opened from inside the app.")
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Button {
                    open(target.url)
                } label: {
                    HStack(spacing: 8) {
                        WaypointMark(id: target.waypointId, size: 18)
                        Text("Open in \(name)")
                    }
                }
                .buttonStyle(.aturiSecondary)
                .accessibilityHint("Opens outside the app")
                if router != nil {
                    Button("Change the setting") {
                        router?.openSettings(.redirects)
                    }
                    .font(AturiFont.footnote)
                    .buttonStyle(.plain)
                    .foregroundStyle(theme.textAccent)
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .cardBackground()
        }
    }

    /* Every recommendation as a large row above the layout switch, the
       first filled and the rest outlined, each with its own copy button:
       the web's hero rows since its link-page rebuild (72e3ac2). The same
       rows lead every layout, so no layout repeats them as a group. */
    @ViewBuilder
    private var recommendedRows: some View {
        let rows = recommended
        if !rows.entries.isEmpty {
            let primaryId = rows.entries.first?.id
            VStack(spacing: 12) {
                ForEach(rows.entries) { entry in
                    PickerHeroRow(entry: entry, collection: collection, isPrimary: entry.id == primaryId)
                }
            }
            .accessibilityElement(children: .contain)
            .accessibilityLabel(rows.label.isEmpty ? "Recommended" : rows.label)
        }
    }

    /* The layout switch sits above the list rather than only in settings so
       the change is visible where it happens; the choice is saved to
       preferences and follows the account. */
    private var layoutBar: some View {
        HStack(spacing: 12) {
            Text("Layout")
                .aturiLabel()
                .foregroundStyle(theme.textTertiary)
            Spacer(minLength: 0)
            WaypointLayoutToggle(layout: layoutBinding)
        }
    }

    // MARK: Lists

    /* Every group the person arranged, as rows or tiles, then the web's
       "See all N apps" disclosure, which folds the list to its first group
       and counts every distinct app across them while folded. */
    private var compactList: some View {
        let all = groups
        let visible = showAllGroups ? all : Array(all.prefix(1))
        let appCount = Set(all.flatMap { group in group.entries.map(\.id) }).count
        return VStack(alignment: .leading, spacing: 20) {
            ForEach(visible) { group in
                PickerCompactGroup(label: group.category.name, entries: group.entries, layout: layout, collection: collection)
            }
            if all.count > 1 {
                seeAllButton(appCount: appCount)
            }
        }
    }

    private func seeAllButton(appCount: Int) -> some View {
        Button {
            withAnimation(AturiMotion.animation(AturiMotion.soft(AturiMotion.panel), reduceMotion: reduceMotion)) {
                showAllGroups.toggle()
            }
        } label: {
            HStack(spacing: 4) {
                Text(showAllGroups ? "Show fewer apps" : "See all \(appCount) apps")
                Image(systemName: showAllGroups ? "chevron.up" : "chevron.down")
                    .font(AturiFont.sans(.footnote, weight: .semibold))
            }
            .font(AturiFont.sans(.subheadline, weight: .semibold))
            .foregroundStyle(theme.textAccent)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity)
    }

    /* The recommended rows above the switch lead this layout too, so the
       groups follow the switch directly, as Cards does on the web since it
       stopped repeating the recommendation as a titled block below it. */
    private var classicList: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(groups) { group in
                PickerClassicGroup(
                    category: group.category,
                    entries: group.entries,
                    collection: collection,
                    isExpanded: !collapsedGroups.contains(group.id)
                ) {
                    toggleGroup(group.id)
                }
            }
        }
    }

    // MARK: About

    private var aboutCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("What is aturi.to?")
                .font(AturiFont.subtitle)
                .foregroundStyle(theme.textAccent)
            Text("Tour the Atmosphere.")
                .font(AturiFont.body)
                .foregroundStyle(theme.textPrimary)
            Text("Switch between clients, share universal links, and explore any account's PDS data.")
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                if let url = URL(string: shareLink) {
                    ShareLink(item: url) {
                        Label("Share this page", systemImage: "square.and.arrow.up")
                    }
                    .buttonStyle(.aturiSecondary)
                }
                CopyLinkButton(url: shareLink, name: "aturi.to", showsText: true)
            }
            .padding(.top, 4)
            IdentifierText(shareLink, font: AturiFont.monoSmall)
                .foregroundStyle(theme.textTertiary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }

    // MARK: Actions

    private func open(_ string: String) {
        LinkNavigation.openWaypoint(string, router: router, openURL: openURL)
    }

    private func toggleGroup(_ id: String) {
        withAnimation(.easeInOut(duration: 0.2)) {
            if collapsedGroups.contains(id) {
                collapsedGroups.remove(id)
            } else {
                collapsedGroups.insert(id)
            }
        }
    }

    /// The banner's "Add": into their default groups, and marked known.
    private func addNewWaypoints() {
        let ids = prefs.newBuiltinWaypointIds
        guard !ids.isEmpty else { return }
        preferences.update { $0.addWaypointsToDefaultGroups(ids) }
    }

    /// The banner's dismiss: marked known, not added.
    private func dismissNewWaypoints() {
        let ids = prefs.newBuiltinWaypointIds
        guard !ids.isEmpty else { return }
        preferences.update { _ = $0.markWaypointsKnown(ids) }
    }
}

/// The web's remember-my-choice bar (`fn-lp-remember` in
/// `WaypointPicker.tsx`): whether auto-redirect is on, and the way to the
/// Redirects screen where it is set. Opening links straight in a favourite
/// app is that existing preference, so the bar states it rather than
/// setting anything itself. The preview page pins it to the bottom edge
/// while the picker is on screen; the auto-redirect countdown takes the
/// same place while it runs.
struct WaypointRememberBar: View {
    @Environment(PreferencesStore.self) private var preferences
    @Environment(AppRouter.self) private var router: AppRouter?
    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale

    private var isOn: Bool {
        preferences.prefs.autoRedirect
    }

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 1) {
                Text(isOn ? "Auto-redirect is on" : "Remember my choice")
                    .font(AturiFont.sans(.subheadline, weight: .bold))
                    .foregroundStyle(theme.textPrimary)
                Text(isOn
                     ? "Links like this open in your favorite app right away."
                     : "Pick a favorite app and links like this open there right away.")
                    .font(AturiFont.caption)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: .infinity, minHeight: 40, alignment: .leading)
            .accessibilityElement(children: .combine)
            if let router {
                Button(isOn ? "Change" : "Set up") {
                    router.openSettings(.redirects)
                }
                .buttonStyle(.aturiSecondary)
                .accessibilityHint("Opens the Redirects settings")
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 14)
        // Full-bleed on the card colour, as the bar is at phone width.
        .background(theme.bgSecondary)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(theme.borderMedium)
                .frame(height: AturiTheme.hairline(displayScale: displayScale))
        }
    }
}

/// A waypoint that can open the page, with its URL built.
private struct WaypointPickerEntry: Identifiable, Hashable {
    let waypoint: Waypoint
    let url: String

    var id: String { waypoint.id }

    /// The host the link lands on, minus a leading `www.`; the dense list's
    /// right-hand column. A custom template can expand to something
    /// Foundation cannot parse, which reads as no host rather than failing.
    var host: String {
        guard let host = URLComponents(string: url)?.host?.lowercased() else { return "" }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }
}

private struct WaypointPickerGroup: Identifiable {
    let category: WaypointCategory
    let entries: [WaypointPickerEntry]

    var id: String { category.id }
}

/// Dismissable notice for built-in waypoints that shipped since the person
/// last acknowledged the catalog, with a one-tap add into their default
/// groups. Port of `NewWaypointsBanner.tsx`.
private struct NewWaypointsBanner: View {
    let waypoints: [Waypoint]
    let onAdd: () -> Void
    let onDismiss: () -> Void

    @Environment(\.aturiTheme) private var theme

    private var summary: String {
        let names = waypoints.map(\.name)
        if names.count == 1 {
            return "\(names[0]) is a new waypoint"
        }
        if names.count <= 3 {
            return "New waypoints: \(names.joined(separator: ", "))"
        }
        return "\(names.prefix(2).joined(separator: ", ")) and \(names.count - 2) more new waypoints"
    }

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            HStack(spacing: -6) {
                ForEach(Array(waypoints.prefix(3))) { waypoint in
                    WaypointMark(id: waypoint.id, size: 18)
                        .padding(4)
                        .background(theme.bgTertiary, in: Circle())
                }
            }
            .foregroundStyle(theme.textPrimary)
            Text(summary)
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            Button(waypoints.count == 1 ? "Add it" : "Add all", action: onAdd)
                .font(AturiFont.sans(.footnote, weight: .medium))
                .buttonStyle(.plain)
                .foregroundStyle(theme.textAccent)
            Button(action: onDismiss) {
                Image(systemName: "xmark")
                    .font(AturiFont.sans(.footnote, weight: .medium))
                    .foregroundStyle(theme.textTertiary)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Dismiss new waypoints notification")
        }
        .padding(12)
        .cardBackground()
    }
}

/// Switches the picker between its three layouts. Writes straight to
/// preferences, so the choice is instant locally and rides the existing
/// debounced PDS sync to the account's other devices.
private struct WaypointLayoutToggle: View {
    @Binding var layout: WaypointLayout

    var body: some View {
        Picker("Waypoint layout", selection: $layout) {
            ForEach(WaypointLayout.allCases, id: \.self) { option in
                Image(systemName: Self.symbol(for: option))
                    .accessibilityLabel("\(Self.label(for: option)) layout, \(Self.hint(for: option))")
                    .tag(option)
            }
        }
        .pickerStyle(.segmented)
        .frame(maxWidth: 200)
    }

    /// The labels describe the shape rather than the stored value, so
    /// `dense` reads as "Compact".
    private static func label(for layout: WaypointLayout) -> String {
        switch layout {
        case .dense: return "Compact"
        case .grid: return "Grid"
        case .classic: return "Cards"
        }
    }

    private static func hint(for layout: WaypointLayout) -> String {
        switch layout {
        case .dense: return "one line per waypoint"
        case .grid: return "icon tiles, names only"
        case .classic: return "full cards with descriptions"
        }
    }

    private static func symbol(for layout: WaypointLayout) -> String {
        switch layout {
        case .dense: return "list.bullet"
        case .grid: return "square.grid.2x2"
        case .classic: return "rectangle.grid.1x2"
        }
    }
}

/// One group in either compact layout: its name as the tab on a drawer,
/// then rows (dense) or tiles (grid) in the drawer. Both drop the
/// description the classic cards carry; dense trades it for the host, grid
/// for nothing, so the full text is kept as the accessibility hint. Port of
/// `CompactWaypointGroup.tsx`.
private struct PickerCompactGroup: View {
    let label: String
    let entries: [WaypointPickerEntry]
    let layout: WaypointLayout
    let collection: String?

    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            /* The tab stands on the drawer's top edge: drawn over the box
               and nudged down one hairline, so its painted-out bottom edge
               covers the box's border where the two meet. */
            PickerDrawerTab(label: label, count: entries.count)
                .padding(.horizontal, AturiTheme.cardRadius)
                .offset(y: AturiTheme.hairline(displayScale: displayScale))
                .zIndex(1)

            if layout == .grid {
                LazyVGrid(columns: [GridItem(.adaptive(minimum: 84), spacing: 8)], spacing: 8) {
                    ForEach(entries) { entry in
                        PickerTile(entry: entry, collection: collection)
                    }
                }
                .padding(8)
                .cardBackground()
            } else {
                VStack(spacing: 0) {
                    ForEach(entries) { entry in
                        PickerDenseRow(entry: entry, collection: collection)
                        if entry.id != entries.last?.id {
                            Divider()
                                .overlay(theme.borderSubtle)
                        }
                    }
                }
                .cardBackground()
            }
        }
    }
}

/// A group's name as the tab on its drawer (`.waypoint-group-label` in
/// link.css): a small folder tab in the drawer's own colour with the
/// group's count beside the name, its bottom border painted out so tab and
/// drawer read as one piece.
private struct PickerDrawerTab: View {
    let label: String
    let count: Int

    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        let hairline = AturiTheme.hairline(displayScale: displayScale)
        let shape = UnevenRoundedRectangle(
            topLeadingRadius: AturiTheme.controlRadius,
            topTrailingRadius: AturiTheme.controlRadius,
            style: .continuous
        )
        return HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label)
                .font(AturiFont.sans(.footnote, weight: .bold))
                .foregroundStyle(theme.textSecondary)
                .lineLimit(1)
            // The count is read, so it takes the tertiary text, not faint.
            Text("\(count)")
                .font(AturiFont.sans(.footnote, weight: .medium))
                .foregroundStyle(theme.textTertiary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
        .background(theme.bgSecondary, in: shape)
        .overlay(shape.strokeBorder(theme.borderMedium, lineWidth: hairline))
        .overlay(alignment: .bottom) {
            Rectangle()
                .fill(theme.bgSecondary)
                .frame(height: hairline)
                .padding(.horizontal, hairline)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(label), \(count) apps")
        .accessibilityAddTraits(.isHeader)
    }
}

/// One line per waypoint: mark, name, host, copy.
private struct PickerDenseRow: View {
    let entry: WaypointPickerEntry
    let collection: String?

    @Environment(\.aturiTheme) private var theme
    @Environment(AppRouter.self) private var router: AppRouter?
    @Environment(\.openURL) private var openURL

    var body: some View {
        HStack(spacing: 4) {
            Button {
                LinkNavigation.openWaypoint(entry.url, router: router, openURL: openURL)
            } label: {
                HStack(spacing: 10) {
                    WaypointMark(id: entry.id, size: 18)
                        .foregroundStyle(theme.textPrimary)
                    Text(entry.waypoint.name)
                        .font(AturiFont.body)
                        .foregroundStyle(theme.textPrimary)
                        .lineLimit(1)
                    Spacer(minLength: 8)
                    Text(entry.host)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textTertiary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open in \(entry.waypoint.name)")
            .accessibilityHint(entry.waypoint.describe(collection: collection))

            CopyLinkButton(url: entry.url, name: entry.waypoint.name)
                .padding(.trailing, 6)
        }
    }
}

/// An icon tile: mark and name only; copy lives in the context menu. The
/// tiles sit on the page colour inside their drawer, each with a subtle
/// hairline, as on the web.
private struct PickerTile: View {
    let entry: WaypointPickerEntry
    let collection: String?

    @Environment(\.aturiTheme) private var theme
    @Environment(AppRouter.self) private var router: AppRouter?
    @Environment(\.openURL) private var openURL
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: AturiTheme.cardRadius, style: .continuous)
        return Button {
            LinkNavigation.openWaypoint(entry.url, router: router, openURL: openURL)
        } label: {
            VStack(spacing: 6) {
                WaypointMark(id: entry.id, size: 26)
                    .foregroundStyle(theme.textPrimary)
                Text(entry.waypoint.name)
                    .font(AturiFont.sans(.caption, weight: .semibold))
                    .foregroundStyle(theme.textPrimary)
                    .lineLimit(2)
                    .multilineTextAlignment(.center)
            }
            .padding(.vertical, 12)
            .padding(.horizontal, 6)
            .frame(maxWidth: .infinity, minHeight: 80)
            .background(theme.bgPrimary, in: shape)
            .overlay(shape.strokeBorder(theme.borderSubtle, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Open in \(entry.waypoint.name)")
        .accessibilityHint(entry.waypoint.describe(collection: collection))
        .contextMenu {
            Button {
                UIPasteboard.general.string = entry.url
            } label: {
                Label("Copy link", systemImage: "doc.on.doc")
            }
        }
    }
}

/// A collapsible group in the classic layout: the header with a "+N more"
/// count while folded, the group's default waypoint alone when folded and
/// every card when open. Port of `CategoryCard.tsx`.
private struct PickerClassicGroup: View {
    let category: WaypointCategory
    let entries: [WaypointPickerEntry]
    let collection: String?
    let isExpanded: Bool
    let toggle: () -> Void

    @Environment(\.aturiTheme) private var theme

    /// The card shown while folded: the group's default when it can render
    /// this page, else the first that can.
    private var lead: WaypointPickerEntry? {
        entries.first { $0.id == category.defaultWaypointId } ?? entries.first
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button(action: toggle) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(category.name)
                            .font(AturiFont.subtitle)
                            .foregroundStyle(theme.textPrimary)
                        if let description = category.description, !description.isEmpty {
                            Text(description)
                                .font(AturiFont.footnote)
                                .foregroundStyle(theme.textSecondary)
                        }
                    }
                    Spacer(minLength: 0)
                    if !isExpanded, entries.count > 1 {
                        Text("+\(entries.count - 1) more")
                            .font(AturiFont.caption)
                            .foregroundStyle(theme.textTertiary)
                    }
                    Image(systemName: isExpanded ? "chevron.up" : "chevron.down")
                        .font(AturiFont.sans(.footnote, weight: .medium))
                        .foregroundStyle(theme.textTertiary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(isExpanded ? "Collapse \(category.name)" : "Expand \(category.name)")

            if isExpanded {
                ForEach(entries) { entry in
                    PickerWaypointCard(entry: entry, collection: collection)
                }
            } else if let lead {
                PickerWaypointCard(entry: lead, collection: collection)
            }
        }
    }
}

/// The full card: mark, name, description, copy and open. Tapping anywhere
/// but the copy button opens the client.
private struct PickerWaypointCard: View {
    let entry: WaypointPickerEntry
    let collection: String?

    @Environment(\.aturiTheme) private var theme
    @Environment(AppRouter.self) private var router: AppRouter?
    @Environment(\.openURL) private var openURL

    var body: some View {
        HStack(spacing: 4) {
            Button {
                LinkNavigation.openWaypoint(entry.url, router: router, openURL: openURL)
            } label: {
                HStack(spacing: 12) {
                    WaypointMark(id: entry.id, size: 28)
                        .foregroundStyle(theme.textPrimary)
                    VStack(alignment: .leading, spacing: 3) {
                        Text(entry.waypoint.name)
                            .font(AturiFont.sans(.body, weight: .semibold))
                            .foregroundStyle(theme.textPrimary)
                            .lineLimit(1)
                        Text(entry.waypoint.describe(collection: collection))
                            .font(AturiFont.footnote)
                            .foregroundStyle(theme.textSecondary)
                            .lineLimit(3)
                            .multilineTextAlignment(.leading)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 8)
                    Image(systemName: "arrow.up.right")
                        .font(AturiFont.sans(.footnote, weight: .medium))
                        .foregroundStyle(theme.textTertiary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open in \(entry.waypoint.name)")
            .accessibilityHint("Opens outside the app")

            CopyLinkButton(url: entry.url, name: entry.waypoint.name)
        }
        .padding(14)
        .cardBackground()
    }
}

/// One recommended app as a large row above the layout switch, the web's
/// `.fn-lp-hero`: the first filled with the accent, the rest outlined on
/// the card colour, each labelled Recommended. The copy button sits beside
/// the open button rather than inside it, so neither swallows the other's
/// tap.
private struct PickerHeroRow: View {
    let entry: WaypointPickerEntry
    let collection: String?
    let isPrimary: Bool

    @Environment(\.aturiTheme) private var theme
    @Environment(AppRouter.self) private var router: AppRouter?
    @Environment(\.openURL) private var openURL
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: AturiTheme.cardRadius, style: .continuous)
        return HStack(spacing: 0) {
            Button {
                LinkNavigation.openWaypoint(entry.url, router: router, openURL: openURL)
            } label: {
                HStack(spacing: 12) {
                    WaypointMark(id: entry.id, size: 20)
                        .foregroundStyle(isPrimary ? theme.textOnAccent : theme.textAccent)
                    VStack(alignment: .leading, spacing: 1) {
                        Text(entry.waypoint.name)
                            .font(AturiFont.sans(.subheadline, weight: .bold))
                            .foregroundStyle(isPrimary ? theme.textOnAccent : theme.textPrimary)
                            .lineLimit(1)
                        Text("Recommended")
                            .font(AturiFont.caption)
                            .foregroundStyle(isPrimary ? theme.textOnAccent.opacity(0.9) : theme.textTertiary)
                    }
                    Spacer(minLength: 8)
                    // The web's arrow, leaning toward the app it opens.
                    Image(systemName: "arrow.right")
                        .font(AturiFont.sans(.subheadline, weight: .semibold))
                        .foregroundStyle(isPrimary ? theme.textOnAccent : theme.textTertiary)
                }
                .padding(.leading, 16)
                .padding(.trailing, 4)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, minHeight: 56, alignment: .leading)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Open in \(entry.waypoint.name), recommended")
            .accessibilityHint(entry.waypoint.describe(collection: collection))

            CopyLinkButton(url: entry.url, name: entry.waypoint.name, onAccent: isPrimary, side: 44)
                .padding(.trailing, 4)
        }
        .background(isPrimary ? theme.accent : theme.bgSecondary, in: shape)
        .overlay(shape.strokeBorder(isPrimary ? theme.accent : theme.borderStrong, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
    }
}

/// Copies a waypoint link and shows a check for the web's two seconds.
/// The icon form sits beside a row or card; the text form is the about
/// card's "Copy link".
private struct CopyLinkButton: View {
    let url: String
    let name: String
    var showsText = false
    /// The icon form on the accent fill (the first recommended row): drawn
    /// in the on-accent colour rather than the tertiary text.
    var onAccent = false
    /// The icon form's square tap target.
    var side: CGFloat = 36

    @Environment(\.aturiTheme) private var theme
    @State private var copied = false
    @State private var resetTask: Task<Void, Never>?

    /// Matches the web's `setTimeout(..., 2000)`.
    private static let feedbackDuration: Double = 2

    private var iconColor: Color {
        if onAccent {
            return theme.textOnAccent.opacity(copied ? 1 : 0.8)
        }
        return copied ? theme.textAccent : theme.textTertiary
    }

    var body: some View {
        if showsText {
            Button(action: copy) {
                Label(copied ? "Copied" : "Copy link", systemImage: copied ? "checkmark" : "doc.on.doc")
            }
            .buttonStyle(.aturiSecondary)
            .accessibilityLabel(copied ? "Copied" : "Copy \(name) link")
        } else {
            Button(action: copy) {
                Image(systemName: copied ? "checkmark" : "doc.on.doc")
                    .font(AturiFont.body)
                    .foregroundStyle(iconColor)
                    .frame(width: side, height: side)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(copied ? "Copied" : "Copy \(name) link")
        }
    }

    private func copy() {
        UIPasteboard.general.string = url
        withAnimation(.easeInOut(duration: 0.15)) {
            copied = true
        }
        resetTask?.cancel()
        resetTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(Self.feedbackDuration))
            guard !Task.isCancelled else { return }
            withAnimation(.easeInOut(duration: 0.15)) {
                copied = false
            }
        }
    }
}
