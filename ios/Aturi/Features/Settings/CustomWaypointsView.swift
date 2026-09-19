import SwiftUI
import AturiCore

/// Port of `CustomTab.tsx`: the person's hand-written waypoints. A new one
/// joins the "My Waypoints" group on save so it shows in the picker at
/// once; it can be moved to other groups from Waypoint groups.
struct CustomWaypointsView: View {
    @Environment(PreferencesStore.self) private var preferences
    @Environment(\.aturiTheme) private var theme

    @State private var addingNew = false
    @State private var editing: CustomWaypoint?
    @State private var pendingDelete: CustomWaypoint?

    private var customs: [CustomWaypoint] {
        preferences.prefs.customWaypoints
    }

    private var deleteDialogShown: Binding<Bool> {
        Binding(
            get: { pendingDelete != nil },
            set: { shown in
                if !shown { pendingDelete = nil }
            }
        )
    }

    var body: some View {
        List {
            SettingsSection(
                "Custom waypoints",
                footer: "Add your own jump destinations using URL templates. Placeholders: {handle}, {did}, {actor}, {collection} and {rkey}. New custom waypoints land in your \(Preferences.customGroupName) group."
            ) {
                Button {
                    addingNew = true
                } label: {
                    Label("Add custom waypoint", systemImage: "plus")
                }
            }

            if customs.isEmpty {
                SettingsSection {
                    Text("No custom waypoints yet.")
                        .font(.footnote)
                        .foregroundStyle(theme.textTertiary)
                }
            } else {
                SettingsSection("Your waypoints") {
                    ForEach(customs) { custom in
                        row(custom)
                    }
                }
            }
        }
        .settingsList()
        .navigationTitle("Custom waypoints")
        .sheet(isPresented: $addingNew) {
            CustomWaypointForm(onSave: save)
        }
        .sheet(item: $editing) { custom in
            CustomWaypointForm(initial: custom, onSave: save)
        }
        .confirmationDialog(
            "Delete this custom waypoint?",
            isPresented: deleteDialogShown,
            titleVisibility: .visible,
            presenting: pendingDelete
        ) { custom in
            Button("Delete \(custom.name)", role: .destructive) {
                remove(custom.id)
            }
        } message: { _ in
            Text("It will be removed from any groups it is in.")
        }
    }

    private func row(_ custom: CustomWaypoint) -> some View {
        Button {
            editing = custom
        } label: {
            HStack(alignment: .center, spacing: 12) {
                WaypointMark(id: custom.id, size: 22)
                    .foregroundStyle(theme.textSecondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text(custom.name)
                        .font(AturiFont.subtitle)
                        .foregroundStyle(theme.textPrimary)
                        .lineLimit(1)
                    if let domain = custom.domain, !domain.isEmpty {
                        Text(domain)
                            .font(AturiFont.monoSmall)
                            .foregroundStyle(theme.textTertiary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    if let description = custom.description, !description.isEmpty {
                        Text(description)
                            .font(.footnote)
                            .foregroundStyle(theme.textSecondary)
                            .lineLimit(2)
                    }
                }
                Spacer(minLength: 0)
                Image(systemName: "pencil")
                    .font(.footnote.weight(.medium))
                    .foregroundStyle(theme.textTertiary)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, 2)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Edit \(custom.name)")
        .swipeActions(edge: .trailing) {
            Button(role: .destructive) {
                pendingDelete = custom
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
        .contextMenu {
            Button {
                editing = custom
            } label: {
                Label("Edit", systemImage: "pencil")
            }
            Button(role: .destructive) {
                pendingDelete = custom
            } label: {
                Label("Delete", systemImage: "trash")
            }
        }
    }

    /// Port of `CustomTab.save`. A brand-new waypoint is put in the custom
    /// group so it is visible somewhere; the group is created under its
    /// canonical id when the person removed it, so it stays stable across
    /// rebuilds of the defaults.
    private func save(_ waypoint: CustomWaypoint) {
        preferences.update { prefs in
            let exists = prefs.customWaypoints.contains { $0.id == waypoint.id }
            if exists {
                prefs.customWaypoints = prefs.customWaypoints.map { $0.id == waypoint.id ? waypoint : $0 }
                return
            }
            prefs.customWaypoints.append(waypoint)
            if !prefs.waypointGroups.contains(where: { $0.id == Preferences.customGroupId }) {
                prefs.waypointGroups.append(WaypointGroup(
                    id: Preferences.customGroupId,
                    name: Preferences.customGroupName,
                    waypointIds: []
                ))
            }
            prefs.addWaypoint(waypoint.id, toGroup: Preferences.customGroupId)
        }
    }

    private func remove(_ id: String) {
        preferences.update { prefs in
            prefs.customWaypoints.removeAll { $0.id == id }
            for index in prefs.waypointGroups.indices {
                prefs.waypointGroups[index].waypointIds.removeAll { $0 == id }
            }
        }
    }
}
