import SwiftUI
import AturiCore

/// Port of `RedirectsTab.tsx`: the master switch and one preferred client
/// per compat family. On iOS the preference never navigates on its own:
/// the picker leads with the favourite as a one-tap button, and only a
/// link that arrives from outside the app opens there by itself, after a
/// countdown that any touch cancels.
///
/// A signed-in account's declared clients (the Clients screen) fill any
/// family left on "Don't redirect", unless the follow switch is off; that
/// family's empty option names the client that will be used instead.
struct RedirectsSettingsView: View {
    @Environment(PreferencesStore.self) private var preferences
    @Environment(\.sessionStore) private var sessionStore
    @Environment(\.aturiTheme) private var theme

    private var prefs: Preferences {
        preferences.prefs
    }

    private var enabled: Bool {
        prefs.autoRedirect
    }

    private var autoRedirect: Binding<Bool> {
        preferences.settingsBinding({ $0.autoRedirect }, { $0.setAutoRedirect($1) })
    }

    private var followDeclared: Binding<Bool> {
        preferences.settingsBinding({ $0.followDeclaredClients }, { $0.setFollowDeclaredClients($1) })
    }

    private var declaresAny: Bool {
        guard let declared = preferences.declaredClients else { return false }
        return WaypointCatalog.compatFamilyOrder.contains { declaredFavorite(declared, family: $0) != nil }
    }

    /// What a family's empty choice means: the declared client that fills
    /// it when there is one, else no redirect.
    private func emptyLabel(for family: RedirectCompatFamily) -> String {
        guard prefs.followDeclaredClients, let declared = preferences.declaredClients,
              let fill = declaredFavorite(declared, family: family)
        else { return "Don't redirect" }
        return "Your declared client (\(fill.client.displayName))"
    }

    var body: some View {
        let rows = FamilyRow.rows(for: prefs)
        List {
            SettingsSection(
                "Auto-redirect",
                footer: "Pick a client per kind of record. When a link opens in Aturi, the picker puts that client first as a one-tap button. A link that arrives from outside the app opens there on its own after a short countdown you can cancel."
            ) {
                SettingsToggleRow(
                    "Open links in my preferred client",
                    detail: "Off by default. Nothing is redirected until you choose a client below.",
                    isOn: autoRedirect
                )
                if sessionStore.state.isSignedIn {
                    SettingsToggleRow(
                        "Use the clients you declared",
                        detail: declaresAny
                            ? "Families you haven't picked a client for below open in the ones you published on the Clients screen."
                            : "You haven't declared any clients yet. Publish them on the Clients screen and they fill in here.",
                        isOn: followDeclared
                    )
                    .disabled(!enabled)
                }
            }

            if rows.isEmpty {
                SettingsSection {
                    Text("No client families to configure yet. Waypoints are only offered here once they are visible in your picker; check Waypoint groups.")
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textSecondary)
                }
            } else {
                SettingsSection(
                    "Preferred client",
                    footer: "A family earns a row when it has at least two clients in your groups, so there is a choice to make. Aturi's own pages are never a destination."
                ) {
                    ForEach(rows) { row in
                        familyPicker(row)
                    }
                }
            }
        }
        .settingsList()
        .navigationTitle("Redirects")
    }

    /// The family's name and description over a pill that opens the menu
    /// of clients. A bare `.menu` picker renders its value as tinted text,
    /// which does not read as something to tap; the pill does, and it
    /// carries the chosen client's mark.
    private func familyPicker(_ row: FamilyRow) -> some View {
        let selection = favorite(for: row)
        let chosen = row.destinations.first { $0.id == selection.wrappedValue }
        let empty = emptyLabel(for: row.family)
        return VStack(alignment: .leading, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(row.name)
                    .foregroundStyle(theme.textPrimary)
                if let description = row.description, !description.isEmpty {
                    Text(description)
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Menu {
                Picker(row.name, selection: selection) {
                    Text(empty).tag("")
                    ForEach(row.destinations) { destination in
                        Text(destination.name).tag(destination.id)
                    }
                }
                .pickerStyle(.inline)
            } label: {
                ClientPill(name: chosen?.name ?? empty, waypointId: chosen?.id)
            }
            .disabled(!enabled)
            .opacity(enabled ? 1 : 0.5)
            .accessibilityLabel("\(row.name) client")
            .accessibilityValue(chosen?.name ?? empty)
        }
        .padding(.vertical, 4)
    }

    /// The favourite as the picker sees it: the empty tag for none, and
    /// also for a favourite that has since left the list, so the picker
    /// never holds a selection it has no row for.
    private func favorite(for row: FamilyRow) -> Binding<String> {
        let valid = Set(row.destinations.map(\.id))
        return preferences.settingsBinding(
            { prefs in
                guard let current = prefs.favoriteByFamily[row.family], valid.contains(current) else { return "" }
                return current
            },
            { prefs, value in
                prefs.setFavorite(for: row.family, waypointId: value.isEmpty ? nil : value)
            }
        )
    }
}

/// The menu's face: the chosen client's mark and name with the up-down
/// chevrons iOS uses for pop-up buttons, in a bordered capsule.
private struct ClientPill: View {
    let name: String
    let waypointId: String?

    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        HStack(spacing: 8) {
            if let waypointId {
                WaypointMark(id: waypointId, size: 18)
                    .foregroundStyle(theme.textPrimary)
            }
            Text(name)
                .font(AturiFont.sans(.subheadline, weight: .medium))
                .foregroundStyle(theme.textPrimary)
                .lineLimit(1)
            Image(systemName: "chevron.up.chevron.down")
                .font(AturiFont.sans(.caption2, weight: .semibold))
                .foregroundStyle(theme.textTertiary)
        }
        .padding(.leading, waypointId == nil ? 14 : 10)
        .padding(.trailing, 12)
        .padding(.vertical, 8)
        .background(theme.bgSecondary, in: Capsule())
        .overlay(Capsule().strokeBorder(theme.borderMedium, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
        .contentShape(Capsule())
    }
}

/// One family worth a row, with what can be chosen in it. Port of
/// `buildFamilyRows`: a family earns a row when it has at least one
/// destination and at least two members overall, and only waypoints the
/// person has kept in a group are offered. The self-host rule drops
/// waypoints served from aturi.to, which here is a constant rather than
/// the page's own host.
private struct FamilyRow: Identifiable {
    struct Destination: Identifiable, Hashable {
        let id: String
        let name: String
    }

    let family: RedirectCompatFamily
    let name: String
    let description: String?
    let destinations: [Destination]

    var id: String { family.rawValue }

    static func rows(for prefs: Preferences) -> [FamilyRow] {
        var visible = Set<String>()
        for group in prefs.waypointGroups {
            visible.formUnion(group.waypointIds)
        }

        func name(of id: String) -> String {
            if let builtin = WaypointCatalog.all[id] { return builtin.name }
            if let custom = prefs.customWaypoints.first(where: { $0.id == id }) { return custom.name }
            return id
        }

        let allIds = WaypointCatalog.order + prefs.customWaypoints.map(\.id)
        var rows: [FamilyRow] = []
        for family in WaypointCatalog.compatFamilyOrder {
            let members = allIds.filter { id in
                visible.contains(id) && getRedirectCompatFor(id, customWaypoints: prefs.customWaypoints).contains(family)
            }
            let destinations = members
                .filter { id in
                    guard let host = WaypointCatalog.host(of: id) else { return true }
                    return host.lowercased() != Endpoints.aturiHost
                }
                .map { Destination(id: $0, name: name(of: $0)) }
            guard !destinations.isEmpty, members.count >= 2 else { continue }
            let meta = WaypointCatalog.compatFamilies[family]
            rows.append(FamilyRow(
                family: family,
                name: meta?.name ?? family.rawValue,
                description: meta?.description,
                destinations: destinations
            ))
        }
        return rows
    }
}

/// Port of `ClientsTab.tsx`: the public `to.aturi.client.declaration`
/// declaration other apps read to open this person's links in the clients
/// they use. Drafted here and written only on Publish; the form's logic is
/// `PreferredClientsDraft` in AturiCore, where it is tested. Lives beside
/// Redirects, whose favourites it starts from and whose empty families it
/// fills.
struct ClientsSettingsView: View {
    @Environment(PreferencesStore.self) private var preferences
    @Environment(\.sessionStore) private var sessionStore
    @Environment(\.aturiTheme) private var theme

    @State private var draft: PreferredClientsDraft?
    @State private var busy = false
    @State private var errorMessage: String?

    private var published: PreferredClientsRecord? {
        preferences.declaration.record
    }

    private var options: [RedirectCompatFamily: [DeclaredClientOption]] {
        PreferredClientsDraft.options(customWaypoints: preferences.prefs.customWaypoints, published: published)
    }

    var body: some View {
        List {
            if !sessionStore.state.isSignedIn {
                SettingsSection(footer: "Your preferred clients are published to your own repository, where other Atmosphere apps can read them. That needs you signed in; nothing on this screen is kept on the device.") {
                    NavigationLink(value: SettingsPage.account) {
                        SettingsRowLabel("Sign in to publish", systemImage: SettingsPage.account.systemImage)
                    }
                }
            } else if let draft {
                form(draft)
            } else if case .failed(let message) = preferences.declaration {
                SettingsSection(
                    "Couldn't read your declaration",
                    footer: "Your PDS didn't answer, so the form stays closed rather than risk publishing over a declaration it couldn't see."
                ) {
                    Text(message)
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.danger)
                }
            } else {
                SettingsSection {
                    HStack(spacing: 8) {
                        ProgressView()
                        Text("Reading your declaration...")
                            .foregroundStyle(theme.textSecondary)
                    }
                }
            }
        }
        .settingsList()
        .navigationTitle("Clients")
        .onAppear(perform: seed)
        .onChange(of: preferences.declaration) { _, state in
            // Signing out drops the draft, so the next account starts fresh
            // rather than being offered the last one's choices.
            if state == .idle { draft = nil }
            seed()
        }
    }

    /// Open the draft once the PDS has answered: from the published record,
    /// or with none, from the Redirects favourites.
    private func seed() {
        guard draft == nil, preferences.declaration.isSettled else { return }
        draft = PreferredClientsDraft(published: published, options: options, favorites: preferences.prefs.favoriteByFamily)
    }

    @ViewBuilder
    private func form(_ current: PreferredClientsDraft) -> some View {
        let options = self.options
        let next = current.preferences(options: options, published: published)
        let dirty = !PreferredClientsDraft.samePreferences(next, published?.preferences ?? [])
        let exists: Bool = {
            switch preferences.declaration {
            case .loaded, .invalid: return true
            default: return false
            }
        }()

        SettingsSection(footer: "Apps that read this open your Bluesky links and record links in your choice instead of a default or a list. Apps that can tell your device apart use the mobile and desktop choices; the rest use the one above them.") {
            Text(status(dirty: dirty))
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textSecondary)
        }

        ForEach(PreferredClients.categories, id: \.self) { category in
            let copy = Self.copy(for: category)
            let slots = current.slots[category] ?? DeclaredClientSlots()
            let choices = options[category] ?? []
            SettingsSection(copy.title, footer: copy.sub) {
                clientMenu("Everywhere", category: category, slot: \.client, choices: choices, emptyLabel: "Not declared")
                SettingsToggleRow("Different on mobile or desktop", isOn: splitBinding(category))
                if slots.split {
                    let fallback = slots.client.isEmpty ? "Not declared" : "Same as everywhere"
                    clientMenu("On mobile", category: category, slot: \.mobile, choices: choices, emptyLabel: fallback)
                    clientMenu("On desktop", category: category, slot: \.desktop, choices: choices, emptyLabel: fallback)
                }
            }
        }

        SettingsSection(footer: "Publishing writes a public record, to.aturi.client.declaration/self, to your repository. It doesn't change where Aturi sends you; that's Redirects.") {
            Button {
                publish(next)
            } label: {
                HStack(spacing: 8) {
                    if busy { ProgressView() }
                    Text("Publish")
                }
            }
            .disabled(busy || !dirty)
            if exists {
                Button("Remove declaration", role: .destructive, action: remove)
                    .disabled(busy)
            }
            if let errorMessage {
                Text(errorMessage)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.danger)
            }
        }
    }

    private func status(dirty: Bool) -> String {
        switch preferences.declaration {
        case .invalid:
            return "Your existing record couldn't be read. Publishing replaces it."
        case .loaded(let record) where !dirty:
            if let updatedAt = record.updatedAt, let date = Formatting.isoDate(updatedAt) {
                return "Published \(date.formatted(date: .abbreviated, time: .omitted))."
            }
            return "Published."
        case .loaded:
            return "Unpublished changes."
        default:
            return dirty ? "Not published yet." : "Nothing declared."
        }
    }

    private static func copy(for category: RedirectCompatFamily) -> (title: String, sub: String) {
        switch category {
        case .blueskySocial: return ("Bluesky client", "Where Bluesky posts, profiles and lists open.")
        case .atprotoExplorer: return ("Atmosphere explorer", "Where any record or repository opens, raw.")
        default: return (WaypointCatalog.compatFamilies[category]?.name ?? category.rawValue, "")
        }
    }

    private func splitBinding(_ category: RedirectCompatFamily) -> Binding<Bool> {
        Binding(
            get: { draft?.slots[category]?.split ?? false },
            set: { value in
                draft?.slots[category, default: DeclaredClientSlots()].split = value
                errorMessage = nil
            }
        )
    }

    private func slotBinding(_ category: RedirectCompatFamily, _ slot: WritableKeyPath<DeclaredClientSlots, String>) -> Binding<String> {
        Binding(
            get: { draft?.slots[category]?[keyPath: slot] ?? "" },
            set: { value in
                draft?.slots[category, default: DeclaredClientSlots()][keyPath: slot] = value
                errorMessage = nil
            }
        )
    }

    /// A row's label over the same pill menu the Redirects rows use.
    private func clientMenu(
        _ title: String,
        category: RedirectCompatFamily,
        slot: WritableKeyPath<DeclaredClientSlots, String>,
        choices: [DeclaredClientOption],
        emptyLabel: String
    ) -> some View {
        let selection = slotBinding(category, slot)
        let chosen = choices.first { $0.id == selection.wrappedValue }
        return VStack(alignment: .leading, spacing: 10) {
            Text(title)
                .foregroundStyle(theme.textPrimary)
            Menu {
                Picker(title, selection: selection) {
                    Text(emptyLabel).tag("")
                    ForEach(choices) { option in
                        Text(option.label).tag(option.id)
                    }
                }
                .pickerStyle(.inline)
            } label: {
                ClientPill(name: chosen?.label ?? emptyLabel, waypointId: chosen?.client.waypoint)
            }
            .accessibilityLabel("\(Self.copy(for: category).title), \(title)")
            .accessibilityValue(chosen?.label ?? emptyLabel)
        }
        .padding(.vertical, 4)
    }

    private func publish(_ entries: [ClientPreference]) {
        busy = true
        errorMessage = nil
        Task { @MainActor in
            do {
                try await sessionStore.publishDeclaration(entries)
            } catch {
                errorMessage = ExploreErrorText.describe(error)
            }
            busy = false
        }
    }

    private func remove() {
        busy = true
        errorMessage = nil
        Task { @MainActor in
            do {
                try await sessionStore.removeDeclaration()
                draft = PreferredClientsDraft(published: nil, options: options, favorites: [:])
            } catch {
                errorMessage = ExploreErrorText.describe(error)
            }
            busy = false
        }
    }
}
