import SwiftUI
import AturiCore

/// Port of `GeneralTab.tsx`'s appearance and explorer cards plus the
/// picker-layout switch from `WaypointsTab.tsx`. The colour scheme, the
/// layout and the pin settings are synced preferences; dark or light is per
/// device, as it is per browser on the web, and lives in the app group
/// suite so the share extension follows.
struct GeneralSettingsView: View {
    @Environment(PreferencesStore.self) private var preferences
    @Environment(\.sessionStore) private var session
    @Environment(\.identityResolver) private var identity
    @Environment(\.aturiTheme) private var theme
    @AppStorage(Appearance.storageKey, store: Appearance.defaults) private var appearanceRaw = Appearance.system.rawValue

    /// NSIDs on the signed-in account's own repo, the pin fields' typeahead
    /// source. Nil when signed out or until the lookup lands, in which case
    /// the fields are plain free-text inputs.
    @State private var myCollections: Set<String>?

    private var appearance: Binding<Appearance> {
        Binding(
            get: { Appearance(rawValue: appearanceRaw) ?? .system },
            set: { appearanceRaw = $0.rawValue }
        )
    }

    var body: some View {
        List {
            SettingsSection(
                "Color scheme",
                footer: "The palette the whole app is painted in. Every scheme has a dark and a light variant; the switch below picks which one you see. Saved with the rest of your settings, so it follows you to other devices when you are signed in."
            ) {
                ForEach(AturiColorScheme.allCases, id: \.self) { scheme in
                    SettingsChoiceRow(
                        scheme.label,
                        detail: scheme.hint,
                        isSelected: preferences.prefs.colorScheme == scheme
                    ) {
                        guard preferences.prefs.colorScheme != scheme else { return }
                        preferences.update { $0.colorScheme = scheme }
                    } leading: {
                        SchemeSwatch(scheme: scheme)
                    }
                }
            }

            SettingsSection(
                "Dark or light",
                footer: "Which variant of the scheme to show. Saved on this device, so you can run light here and dark on another."
            ) {
                Picker("Appearance", selection: appearance) {
                    ForEach(Appearance.allCases) { option in
                        Text(option.label).tag(option)
                    }
                }
                .pickerStyle(.segmented)
                .padding(.vertical, 4)
            }

            SettingsSection(
                "Picker layout",
                footer: "How the universal-link picker draws your waypoints. The same switch sits above the picker itself, so you can change it while looking at the result."
            ) {
                ForEach(WaypointLayout.allCases, id: \.self) { layout in
                    SettingsChoiceRow(
                        Self.layoutLabel(layout),
                        detail: Self.layoutHint(layout),
                        isSelected: preferences.prefs.waypointLayout == layout
                    ) {
                        guard preferences.prefs.waypointLayout != layout else { return }
                        preferences.update { $0.setWaypointLayout(layout) }
                    } leading: {
                        Image(systemName: Self.layoutSymbol(layout))
                            .font(.body)
                            .foregroundStyle(theme.textSecondary)
                            .frame(width: 24)
                            .accessibilityHidden(true)
                    }
                }
            }

            SettingsSection(
                "Pinned lexicons",
                footer: "Pin lexicons (or entire NSID groups like app.bsky.feed.*) from any repo\u{2019}s Lexicons tab to surface them at the top of the list. Useful for jumping straight to the records you touch most."
            ) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Show pinned section on")
                        .foregroundStyle(theme.textPrimary)
                    Picker("Pin scope", selection: preferences.settingsBinding({ $0.pinScope }, { $0.setPinScope($1) })) {
                        ForEach(PinScope.allCases, id: \.self) { scope in
                            Text(Self.scopeLabel(scope)).tag(scope)
                        }
                    }
                    .pickerStyle(.segmented)
                    Text("My repo shows the Pinned section only on your own account page. Every repo bubbles a single shared list up on every page that has a match. Separate lets you keep two different lists: one for your repo, another for everyone else\u{2019}s.")
                        .font(.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.vertical, 4)
                SettingsToggleRow(
                    "Start lexicon groups collapsed",
                    detail: "When on, every group on the explorer\u{2019}s Lexicons tab starts folded. Use the toggle next to the filter bar to flip everything at once.",
                    isOn: preferences.settingsBinding({ $0.collectionGroupsCollapsedByDefault }, { $0.collectionGroupsCollapsedByDefault = $1 })
                )
            }

            PinnedListSection(target: .mine, title: primaryPinTitle, myCollections: myCollections)
            if preferences.prefs.pinScope == .split {
                PinnedListSection(target: .others, title: "Pinned on others\u{2019} repos", myCollections: myCollections)
            }
        }
        .settingsList()
        .navigationTitle("General")
        .task(id: session.state.did) {
            myCollections = nil
            guard let did = session.state.did else { return }
            let list = await identity.fetchRepoCollections(did)
            guard !Task.isCancelled else { return }
            myCollections = list.map(Set.init)
        }
    }

    /// The primary list's heading follows the scope, as on the web.
    private var primaryPinTitle: String {
        switch preferences.prefs.pinScope {
        case .split: return "Pinned on my repo"
        case .all: return "Pinned everywhere"
        case .own: return "Pinned lexicons"
        }
    }

    private static func scopeLabel(_ scope: PinScope) -> String {
        switch scope {
        case .own: return "My repo"
        case .all: return "Every repo"
        case .split: return "Separate"
        }
    }

    private static func layoutLabel(_ layout: WaypointLayout) -> String {
        switch layout {
        case .dense: return "Compact"
        case .grid: return "Grid"
        case .classic: return "Cards"
        }
    }

    private static func layoutHint(_ layout: WaypointLayout) -> String {
        switch layout {
        case .dense: return "One line per waypoint: mark, name and the host it opens."
        case .grid: return "Icon tiles, names only."
        case .classic: return "Full-width cards with descriptions and collapsible group headers."
        }
    }

    private static func layoutSymbol(_ layout: WaypointLayout) -> String {
        switch layout {
        case .dense: return "list.bullet"
        case .grid: return "square.grid.3x3"
        case .classic: return "rectangle.grid.1x2"
        }
    }
}

/// The web's two-tone chip: the dark variant on the left, the light one on
/// the right, each showing its background with a dot of its accent, so
/// both are visible whichever one is active.
private struct SchemeSwatch: View {
    let scheme: AturiColorScheme

    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
        HStack(spacing: 0) {
            half(scheme.darkPalette)
            half(scheme.lightPalette)
        }
        .frame(width: 48, height: 30)
        .clipShape(shape)
        .overlay(shape.strokeBorder(theme.borderSubtle, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
        .accessibilityHidden(true)
    }

    private func half(_ palette: Palette) -> some View {
        ZStack {
            Color(hex: palette.bgPrimary)
            Circle()
                .fill(Color(hex: palette.accentMoss))
                .frame(width: 10, height: 10)
        }
    }
}

/// One pin list (`PinnedList` in `GeneralTab.tsx`): the add field with
/// its typeahead over the signed-in account's own NSIDs, the validation
/// copy, and the pinned entries with swipe to unpin.
private struct PinnedListSection: View {
    let target: PinTarget
    let title: String
    let myCollections: Set<String>?

    @Environment(PreferencesStore.self) private var preferences
    @Environment(\.aturiTheme) private var theme
    @State private var draft = ""
    @State private var errorMessage: String?
    @FocusState private var focused: Bool

    private static let suggestionLimit = 8

    private var list: [String] {
        target == .others ? preferences.prefs.pinnedLexiconsOthers : preferences.prefs.pinnedLexicons
    }

    /// Every NSID on the account's repo, plus group wildcards for any
    /// major or sub prefix shared by two or more collections: a one-member
    /// group is not worth offering.
    private var candidatePool: [String] {
        guard let myCollections else { return [] }
        var counts: [String: Int] = [:]
        for nsid in myCollections {
            let segments = nsid.split(separator: ".")
            if segments.count >= 2 {
                counts[segments[0...1].joined(separator: "."), default: 0] += 1
            }
            if segments.count >= 4 {
                counts[segments[0...2].joined(separator: "."), default: 0] += 1
            }
        }
        let groups = counts.filter { $0.value >= 2 }.map { $0.key + PinnedLexicons.groupSuffix }
        return Array(myCollections) + groups
    }

    /// Prefix matches first, then any substring match, capped.
    private var suggestions: [String] {
        let pool = candidatePool
        guard !pool.isEmpty else { return [] }
        let pinned = Set(list)
        let candidates = pool.filter { !pinned.contains($0) }.sorted()
        let query = draft.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        if query.isEmpty {
            return Array(candidates.prefix(Self.suggestionLimit))
        }
        let prefix = candidates.filter { $0.lowercased().hasPrefix(query) }
        let contains = candidates.filter { !$0.lowercased().hasPrefix(query) && $0.lowercased().contains(query) }
        return Array((prefix + contains).prefix(Self.suggestionLimit))
    }

    private var suggestionsOpen: Bool {
        focused && !suggestions.isEmpty
    }

    private var placeholder: String {
        myCollections == nil
            ? "app.bsky.feed.post or app.bsky.feed.*"
            : "Search, or type an NSID / group (app.bsky.feed.*)\u{2026}"
    }

    var body: some View {
        SettingsSection(
            "\(title) (\(list.count))",
            footer: list.isEmpty
                ? "Nothing pinned yet. Add an NSID or a group wildcard (e.g. app.bsky.feed.*) above, or use the pin button on rows and group headers in any repo\u{2019}s Lexicons tab."
                : nil
        ) {
            HStack(spacing: 8) {
                TextField(placeholder, text: $draft)
                    .font(AturiFont.monoSmall)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .submitLabel(.done)
                    .focused($focused)
                    .onSubmit(submit)
                    .onChange(of: draft) { _, _ in
                        errorMessage = nil
                    }
                    .accessibilityLabel("Add lexicon to \(title)")
                Button("Pin", action: submit)
                    .font(.footnote.weight(.medium))
                    .buttonStyle(.borderless)
                    .disabled(draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
            }
            if let errorMessage {
                Text(errorMessage)
                    .font(.caption)
                    .foregroundStyle(theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if suggestionsOpen {
                ForEach(suggestions, id: \.self) { nsid in
                    Button {
                        pin(nsid)
                    } label: {
                        highlighted(nsid)
                            .font(AturiFont.monoSmall)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .accessibilityLabel("Pin \(nsid)")
                }
            }
            ForEach(list, id: \.self) { nsid in
                HStack(spacing: 8) {
                    Text(nsid)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textPrimary)
                        .lineLimit(2)
                        .truncationMode(.middle)
                    Spacer(minLength: 0)
                    if PinnedLexicons.isGroup(nsid) {
                        Chip("group", style: .accent)
                    }
                }
                .accessibilityLabel(PinnedLexicons.isGroup(nsid) ? "\(nsid), group" : nsid)
            }
            .onDelete { offsets in
                let removing = offsets.map { list[$0] }
                preferences.update { prefs in
                    for nsid in removing {
                        prefs.removePinnedLexicon(nsid, target: target)
                    }
                }
            }
        }
    }

    /// The first suggestion wins a submit while the list is open, so
    /// Return on a partial NSID pins what the typeahead found.
    private func submit() {
        if suggestionsOpen, let first = suggestions.first {
            pin(first)
            return
        }
        pin(draft)
    }

    private func pin(_ input: String) {
        let value = input.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !value.isEmpty else { return }
        guard PinnedLexicons.isLikelyPinEntry(value) else {
            errorMessage = "That doesn\u{2019}t look like a valid NSID. Expected lowercase, dotted (e.g. app.bsky.feed.post), or a group wildcard (e.g. app.bsky.feed.*)."
            return
        }
        guard !list.contains(value) else {
            errorMessage = "Already pinned."
            return
        }
        preferences.update { $0.addPinnedLexicon(value, target: target) }
        draft = ""
        errorMessage = nil
    }

    /// The substring matching the draft in the accent, the web's
    /// `highlightMatch`.
    private func highlighted(_ nsid: String) -> Text {
        let query = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        /* The range is looked up on `nsid` itself: indices from a
           lowercased copy are not valid in the original string. */
        guard !query.isEmpty, let range = nsid.range(of: query, options: .caseInsensitive) else {
            return Text(nsid).foregroundStyle(theme.textPrimary)
        }
        return Text(nsid[..<range.lowerBound]).foregroundStyle(theme.textPrimary)
            + Text(nsid[range]).foregroundStyle(theme.textAccent).bold()
            + Text(nsid[range.upperBound...]).foregroundStyle(theme.textPrimary)
    }
}
