import SwiftUI
import AturiCore

/// Port of `RedirectsTab.tsx`: the master switch and one preferred client
/// per compat family. On iOS the preference never navigates on its own:
/// the picker leads with the favourite as a one-tap button, and only a
/// link that arrives from outside the app opens there by itself, after a
/// countdown that any touch cancels.
struct RedirectsSettingsView: View {
    @Environment(PreferencesStore.self) private var preferences
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
            }

            if rows.isEmpty {
                SettingsSection {
                    Text("No client families to configure yet. Waypoints are only offered here once they are visible in your picker; check Waypoint groups.")
                        .font(.footnote)
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

    private func familyPicker(_ row: FamilyRow) -> some View {
        Picker(selection: favorite(for: row)) {
            Text("Don't redirect").tag("")
            ForEach(row.destinations) { destination in
                Text(destination.name).tag(destination.id)
            }
        } label: {
            VStack(alignment: .leading, spacing: 3) {
                Text(row.name)
                    .foregroundStyle(theme.textPrimary)
                if let description = row.description, !description.isEmpty {
                    Text(description)
                        .font(.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .pickerStyle(.menu)
        .disabled(!enabled)
        .padding(.vertical, 2)
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
