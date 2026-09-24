import SwiftUI
import AturiCore

/// Port of `SectionsTab.tsx`: which sections the record page and the repo
/// page show, and in what order. Rows drag to reorder (the list's edit
/// mode, from the toolbar button) and each carries a switch; on each page
/// at least one data view must stay visible (the field table or raw JSON
/// on record pages, the profile card or identity row on repo pages), so
/// the switch of the last visible one is disabled. Reset restores a page's
/// defaults behind a confirmation.
struct SectionsSettingsView: View {
    @Environment(PreferencesStore.self) private var preferences
    @Environment(\.aturiTheme) private var theme

    /// Which page a Reset was asked for; drives the confirmation.
    @State private var resetting: ExplorePage?

    private var resetDialogShown: Binding<Bool> {
        Binding(
            get: { resetting != nil },
            set: { if !$0 { resetting = nil } }
        )
    }

    var body: some View {
        List {
            SettingsSection(
                "Record pages",
                footer: "Choose which sections appear on a record / Bluesky-post explorer page, and drag to reorder them. The rich JSON preview and raw JSON are the two data views; at least one always stays on so the record is never blank."
            ) {
                SectionListRows(page: .record) {
                    resetting = .record
                }
            }

            SettingsSection(
                "Repo & profile pages",
                footer: "Choose which sections appear on a repo / profile explorer page, and drag to reorder. The breadcrumb and the collections tabs stay fixed."
            ) {
                SectionListRows(page: .repo) {
                    resetting = .repo
                }
                SettingsToggleRow(
                    "Start \u{201C}Repo at a glance\u{201D} collapsed",
                    detail: "When shown, the stats section starts folded; tap its header to expand. No effect when hidden above.",
                    isOn: preferences.settingsBinding({ $0.repoGlanceCollapsedByDefault }, { $0.repoGlanceCollapsedByDefault = $1 })
                )
            }
        }
        .settingsList()
        .navigationTitle("Sections")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                EditButton()
            }
        }
        .confirmationDialog(
            "Reset these sections to their default order and visibility?",
            isPresented: resetDialogShown,
            titleVisibility: .visible,
            presenting: resetting
        ) { page in
            Button("Reset \(page == .record ? "record" : "repo") pages", role: .destructive) {
                preferences.update { $0.resetSections(page: page) }
            }
        }
    }
}

/// One page's rows: the "N of M shown" count with its Reset, then a
/// movable row per saved section. Rows for ids this build has no metadata
/// for are skipped, as the web skips them; `reconcile` on load keeps the
/// saved list itself tidy.
private struct SectionListRows: View {
    let page: ExplorePage
    let onReset: () -> Void

    @Environment(PreferencesStore.self) private var preferences
    @Environment(\.aturiTheme) private var theme

    private var sections: [SectionConfig] {
        preferences.prefs.sections(for: page)
    }

    private var meta: [String: SectionMeta] {
        Dictionary(uniqueKeysWithValues: ExploreSections.meta(for: page).map { ($0.id, $0) })
    }

    private var visibleGuaranteed: Int {
        ExploreSections.countVisibleGuaranteed(sections, page: page)
    }

    private var visibleCount: Int {
        sections.filter { !$0.hidden }.count
    }

    var body: some View {
        HStack {
            Text("\(visibleCount) of \(sections.count) shown")
                .font(.footnote)
                .foregroundStyle(theme.textTertiary)
            Spacer(minLength: 0)
            Button("Reset", action: onReset)
                .font(.footnote.weight(.medium))
                .buttonStyle(.borderless)
                .foregroundStyle(theme.textSecondary)
                .accessibilityLabel("Reset \(page == .record ? "record" : "repo") page sections")
        }
        ForEach(sections, id: \.id) { section in
            if let meta = meta[section.id] {
                SectionRow(
                    meta: meta,
                    hidden: section.hidden,
                    toggleDisabled: isLastGuaranteed(section),
                    onToggle: { hidden in
                        preferences.update { $0.setSectionHidden(page: page, id: section.id, hidden: hidden) }
                    }
                )
            }
        }
        .onMove(perform: move)
    }

    /// The switch of the last visible guaranteed data view is disabled
    /// rather than silently ignored, so the rule is visible.
    private func isLastGuaranteed(_ section: SectionConfig) -> Bool {
        ExploreSections.isGuaranteedDataView(page, id: section.id) && !section.hidden && visibleGuaranteed <= 1
    }

    private func move(from source: IndexSet, to destination: Int) {
        var next = sections
        next.move(fromOffsets: source, toOffset: destination)
        guard next != sections else { return }
        preferences.update { $0.setSections(page: page, sections: next) }
    }
}

/// The web's `SectionRow`: label with its content / helper tag, the
/// description, and the show switch.
private struct SectionRow: View {
    let meta: SectionMeta
    let hidden: Bool
    let toggleDisabled: Bool
    let onToggle: (Bool) -> Void

    @Environment(\.aturiTheme) private var theme

    private var shown: Binding<Bool> {
        Binding(
            get: { !hidden },
            set: { onToggle(!$0) }
        )
    }

    var body: some View {
        Toggle(isOn: shown) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text(meta.label)
                        .foregroundStyle(theme.textPrimary)
                    Chip(meta.kind == .recordData ? "content" : "helper")
                }
                Text(meta.description)
                    .font(.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .disabled(toggleDisabled)
        .padding(.vertical, 2)
        .accessibilityLabel("Show \(meta.label)")
        .accessibilityHint(toggleDisabled ? "At least one data view must stay visible" : "")
    }
}
