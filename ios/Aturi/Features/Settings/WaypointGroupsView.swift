import SwiftUI
import AturiCore

/// Port of `WaypointGroupsManager.tsx` and the group half of
/// `WaypointsTab.tsx`. Groups are edited in one flat list: a header row per
/// group followed by its waypoints, so a single `.onMove` covers every
/// drag the web allows (groups among themselves, waypoints within a group
/// and, unlike the web, straight into another group). A waypoint may sit
/// in several groups; one in no group is hidden from the picker.
struct WaypointGroupsView: View {
    @Environment(PreferencesStore.self) private var preferences
    @Environment(\.aturiTheme) private var theme

    @State private var addingTo: WaypointGroup?
    @State private var renamingId: String?
    @State private var renameDraft = ""
    @State private var showsRename = false
    @State private var deletingGroup: WaypointGroup?
    @State private var confirmReset = false

    private var prefs: Preferences {
        preferences.prefs
    }

    private var groups: [WaypointGroup] {
        prefs.waypointGroups
    }

    private var newWaypoints: [Waypoint] {
        prefs.newBuiltinWaypointIds.compactMap { WaypointCatalog.all[$0] }
    }

    /// The list's rows. Collapsed groups contribute only their header, and
    /// a duplicate id inside one group (a hand-edited record) is dropped
    /// because the rows are keyed on it.
    private var rows: [GroupRow] {
        var out: [GroupRow] = []
        for group in groups {
            out.append(.header(group))
            guard group.collapsed != true else { continue }
            var seen = Set<String>()
            for id in group.waypointIds where seen.insert(id).inserted {
                out.append(.waypoint(groupId: group.id, waypointId: id))
            }
        }
        return out
    }

    private var summary: String {
        if groups.isEmpty {
            return "No groups yet. Create one to start surfacing waypoints."
        }
        var visible = Set<String>()
        for group in groups {
            visible.formUnion(group.waypointIds)
        }
        let total = WaypointCatalog.count + prefs.customWaypoints.count
        let hidden = max(0, total - visible.count)
        var parts = [
            "\(groups.count) \(groups.count == 1 ? "group" : "groups")",
            "\(visible.count) visible",
        ]
        if hidden > 0 {
            parts.append("\(hidden) hidden")
        }
        return parts.joined(separator: ", ")
    }

    private var deleteDialogShown: Binding<Bool> {
        Binding(
            get: { deletingGroup != nil },
            set: { shown in
                if !shown { deletingGroup = nil }
            }
        )
    }

    var body: some View {
        List {
            if !newWaypoints.isEmpty {
                SettingsSection {
                    NewWaypointsNotice(
                        waypoints: newWaypoints,
                        onAdd: {
                            let ids = prefs.newBuiltinWaypointIds
                            preferences.update { $0.addWaypointsToDefaultGroups(ids) }
                        },
                        onDismiss: {
                            let ids = prefs.newBuiltinWaypointIds
                            preferences.update { $0.markWaypointsKnown(ids) }
                        }
                    )
                }
            }

            SettingsSection(
                "Groups",
                footer: "Drag rows to reorder groups, or to move a waypoint within or between groups. Use the plus on a group to add waypoints from the catalog. The same waypoint can live in several groups; anything in no group is hidden from the picker."
            ) {
                Text(summary)
                    .font(.footnote)
                    .foregroundStyle(theme.textTertiary)
                ForEach(rows) { row in
                    rowView(row)
                }
                .onMove(perform: move)
                .onDelete(perform: delete)
            }

            if groups.isEmpty {
                SettingsSection {
                    Button {
                        addGroup()
                    } label: {
                        Label("Create your first group", systemImage: "plus")
                    }
                }
            }
        }
        .settingsList()
        .navigationTitle("Waypoint groups")
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                EditButton()
                Menu {
                    Button {
                        addGroup()
                    } label: {
                        Label("New group", systemImage: "plus")
                    }
                    Button(role: .destructive) {
                        confirmReset = true
                    } label: {
                        Label("Restore default groups", systemImage: "arrow.counterclockwise")
                    }
                } label: {
                    Image(systemName: "ellipsis.circle")
                }
                .accessibilityLabel("More")
            }
        }
        .sheet(item: $addingTo) { group in
            WaypointCatalogSheet(group: group)
        }
        .alert("Rename group", isPresented: $showsRename) {
            TextField("Group name", text: $renameDraft)
            Button("Rename") {
                commitRename()
            }
            Button("Cancel", role: .cancel) {
                renamingId = nil
            }
        }
        .confirmationDialog(
            "Delete this group?",
            isPresented: deleteDialogShown,
            titleVisibility: .visible,
            presenting: deletingGroup
        ) { group in
            Button("Delete \(group.name)", role: .destructive) {
                preferences.update { $0.removeGroup(id: group.id) }
            }
        } message: { _ in
            Text("Waypoints inside stay available in any other groups they belong to.")
        }
        .confirmationDialog(
            "Restore the default groups?",
            isPresented: $confirmReset,
            titleVisibility: .visible
        ) {
            Button("Restore defaults", role: .destructive) {
                restoreDefaults()
            }
        } message: {
            Text("This discards any groups you have created. Custom waypoints are kept.")
        }
    }

    @ViewBuilder
    private func rowView(_ row: GroupRow) -> some View {
        switch row {
        case .header(let group):
            GroupHeaderRow(
                group: group,
                onToggleCollapsed: {
                    let collapsed = group.collapsed ?? false
                    preferences.update { $0.setGroupCollapsed(id: group.id, collapsed: !collapsed) }
                },
                onRename: {
                    beginRename(group)
                },
                onAdd: {
                    addingTo = group
                },
                onDelete: {
                    deletingGroup = group
                }
            )
            .deleteDisabled(true)
        case .waypoint(let groupId, let waypointId):
            GroupWaypointRow(
                waypointId: waypointId,
                name: displayName(waypointId),
                isCustom: waypointId.hasPrefix("custom:"),
                isMoved: isMoved(waypointId, groupId: groupId),
                onRemove: {
                    preferences.update { $0.removeWaypoint(waypointId, fromGroup: groupId) }
                }
            )
        }
    }

    // MARK: Lookups

    private func displayName(_ id: String) -> String {
        if let builtin = WaypointCatalog.all[id] {
            return builtin.name
        }
        if let custom = prefs.customWaypoints.first(where: { $0.id == id }) {
            return custom.name
        }
        return id
    }

    /// A built-in living outside the category it ships in, flagged the way
    /// the web tags such rows "moved".
    private func isMoved(_ id: String, groupId: String) -> Bool {
        guard let builtin = WaypointCatalog.all[id] else { return false }
        return builtin.category != groupId
    }

    // MARK: Edits

    private func move(from source: IndexSet, to destination: Int) {
        var flat = rows
        guard let first = source.first, first < flat.count else { return }
        let moved = flat[first]
        flat.move(fromOffsets: source, toOffset: destination)
        switch moved {
        case .header:
            reorderGroups(flat: flat)
        case .waypoint:
            rebuildMembership(flat: flat)
        }
    }

    /// A header moved: the groups take the order the headers now have and
    /// keep their members, wherever the member rows ended up on screen.
    private func reorderGroups(flat: [GroupRow]) {
        let headerOrder = flat.compactMap { row -> String? in
            if case .header(let group) = row { return group.id }
            return nil
        }
        let reordered = headerOrder.compactMap { id in groups.first { $0.id == id } }
        guard reordered.count == groups.count else { return }
        preferences.update { $0.setWaypointGroups(reordered) }
    }

    /// A waypoint moved: every expanded group takes the rows now sitting
    /// under its header. A collapsed group shows no rows, so anything
    /// dropped under its header goes to its front and the rest stays.
    private func rebuildMembership(flat: [GroupRow]) {
        var visibleOrder: [String: [String]] = [:]
        var current: String? = groups.first?.id
        for row in flat {
            switch row {
            case .header(let group):
                current = group.id
                if visibleOrder[group.id] == nil {
                    visibleOrder[group.id] = []
                }
            case .waypoint(_, let waypointId):
                guard let current else { continue }
                visibleOrder[current, default: []].append(waypointId)
            }
        }
        var updated = groups
        for index in updated.indices {
            let group = updated[index]
            let landed = visibleOrder[group.id] ?? []
            let ordered = group.collapsed == true ? landed + group.waypointIds : landed
            var ids: [String] = []
            var seen = Set<String>()
            for id in ordered where seen.insert(id).inserted {
                ids.append(id)
            }
            updated[index].waypointIds = ids
        }
        preferences.update { $0.setWaypointGroups(updated) }
    }

    private func delete(at offsets: IndexSet) {
        let flat = rows
        var removals: [(groupId: String, waypointId: String)] = []
        for offset in offsets where offset < flat.count {
            if case .waypoint(let groupId, let waypointId) = flat[offset] {
                removals.append((groupId, waypointId))
            }
        }
        guard !removals.isEmpty else { return }
        preferences.update { prefs in
            for removal in removals {
                prefs.removeWaypoint(removal.waypointId, fromGroup: removal.groupId)
            }
        }
    }

    /// New groups open the rename prompt straight away: "New group" is a
    /// placeholder, not a name anyone wants to keep.
    private func addGroup() {
        var newId = ""
        preferences.update { prefs in
            newId = prefs.addGroup(named: "New group")
        }
        renamingId = newId
        renameDraft = "New group"
        showsRename = true
    }

    private func beginRename(_ group: WaypointGroup) {
        renamingId = group.id
        renameDraft = group.name
        showsRename = true
    }

    private func commitRename() {
        guard let renamingId else { return }
        let name = renameDraft
        preferences.update { $0.renameGroup(id: renamingId, name: name) }
        self.renamingId = nil
    }

    private func restoreDefaults() {
        preferences.update { prefs in
            let customs = prefs.customWaypoints
            prefs.setWaypointGroups(Preferences.defaultWaypointGroups(customWaypoints: customs))
        }
    }
}

/// One row of the flat list. Ids are prefixed so a group and a waypoint
/// can never collide, and a waypoint in two groups is two rows.
private enum GroupRow: Identifiable, Hashable {
    case header(WaypointGroup)
    case waypoint(groupId: String, waypointId: String)

    var id: String {
        switch self {
        case .header(let group):
            return "h:\(group.id)"
        case .waypoint(let groupId, let waypointId):
            return "w:\(groupId):\(waypointId)"
        }
    }
}

private struct GroupHeaderRow: View {
    let group: WaypointGroup
    let onToggleCollapsed: () -> Void
    let onRename: () -> Void
    let onAdd: () -> Void
    let onDelete: () -> Void

    @Environment(\.aturiTheme) private var theme

    private var collapsed: Bool {
        group.collapsed ?? false
    }

    private var countText: String {
        let count = group.waypointIds.count
        return count == 1 ? "1 waypoint" : "\(count) waypoints"
    }

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            Button(action: onToggleCollapsed) {
                Image(systemName: "chevron.down")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(theme.textTertiary)
                    .rotationEffect(.degrees(collapsed ? -90 : 0))
                    .frame(width: 22, height: 22)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(collapsed ? "Expand \(group.name)" : "Collapse \(group.name)")

            Button(action: onRename) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(group.name)
                        .font(AturiFont.subtitle)
                        .foregroundStyle(theme.textPrimary)
                        .lineLimit(1)
                    Text(countText)
                        .font(.caption)
                        .foregroundStyle(theme.textTertiary)
                }
            }
            .buttonStyle(.plain)
            .accessibilityHint("Renames the group")

            Spacer(minLength: 0)

            Button(action: onAdd) {
                Image(systemName: "plus.circle")
                    .font(.body)
                    .foregroundStyle(theme.textAccent)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Add waypoint to \(group.name)")

            Menu {
                Button(action: onRename) {
                    Label("Rename", systemImage: "pencil")
                }
                Button(role: .destructive, action: onDelete) {
                    Label("Delete group", systemImage: "trash")
                }
            } label: {
                Image(systemName: "ellipsis.circle")
                    .font(.body)
                    .foregroundStyle(theme.textSecondary)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .accessibilityLabel("Options for \(group.name)")
        }
        .padding(.vertical, 4)
    }
}

private struct GroupWaypointRow: View {
    let waypointId: String
    let name: String
    let isCustom: Bool
    let isMoved: Bool
    let onRemove: () -> Void

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        HStack(alignment: .center, spacing: 10) {
            WaypointMark(id: waypointId, size: 20)
                .foregroundStyle(theme.textPrimary)
            Text(name)
                .font(AturiFont.body)
                .foregroundStyle(theme.textPrimary)
                .lineLimit(1)
            if isCustom {
                Chip("custom", style: .accent)
            }
            if isMoved {
                Chip("moved")
            }
            Spacer(minLength: 0)
            Button(action: onRemove) {
                Image(systemName: "xmark")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(theme.textTertiary)
                    .frame(width: 28, height: 28)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove \(name) from group")
        }
        .padding(.leading, 16)
    }
}

/// The web's `NewWaypointsBanner`: built-ins that shipped since the person
/// last looked, with a one-tap add into their default groups.
private struct NewWaypointsNotice: View {
    let waypoints: [Waypoint]
    let onAdd: () -> Void
    let onDismiss: () -> Void

    @Environment(\.aturiTheme) private var theme

    private var summary: String {
        let names = waypoints.map(\.name)
        if names.count == 1 {
            return "\(names[0]) is a new waypoint. Add it to your groups to see it in the picker."
        }
        if names.count <= 3 {
            return "New waypoints: \(names.joined(separator: ", ")). Add them to your groups to see them in the picker."
        }
        return "\(names.prefix(2).joined(separator: ", ")) and \(names.count - 2) more new waypoints. Add them to your groups to see them in the picker."
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                HStack(spacing: -6) {
                    ForEach(Array(waypoints.prefix(3))) { waypoint in
                        WaypointMark(id: waypoint.id, size: 18)
                            .padding(4)
                            .background(theme.bgTertiary, in: Circle())
                    }
                }
                .foregroundStyle(theme.textPrimary)
                Text(summary)
                    .font(.footnote)
                    .foregroundStyle(theme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 12) {
                Button("Add to groups", action: onAdd)
                    .buttonStyle(.aturiSecondary)
                Button("Dismiss", action: onDismiss)
                    .buttonStyle(.plain)
                    .font(.footnote)
                    .foregroundStyle(theme.textSecondary)
            }
        }
        .padding(.vertical, 4)
    }
}

/// The catalog, custom waypoints first, with a search box; tapping a row
/// adds it to the group. Membership is read live so a row flips to "Added"
/// as soon as the store has it.
private struct WaypointCatalogSheet: View {
    let group: WaypointGroup

    @Environment(PreferencesStore.self) private var preferences
    @Environment(\.dismiss) private var dismiss
    @Environment(\.aturiTheme) private var theme
    @State private var query = ""

    private struct Candidate: Identifiable {
        let id: String
        let name: String
        let detail: String?
        let isCustom: Bool
    }

    private var candidates: [Candidate] {
        let customs = preferences.prefs.customWaypoints.map {
            Candidate(id: $0.id, name: $0.name, detail: $0.domain, isCustom: true)
        }
        let builtins = WaypointCatalog.ordered.map {
            Candidate(id: $0.id, name: $0.name, detail: WaypointCatalog.host(of: $0.id), isCustom: false)
        }
        let all = customs + builtins
        let needle = query.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !needle.isEmpty else { return all }
        return all.filter { $0.name.lowercased().contains(needle) || $0.id.lowercased().contains(needle) }
    }

    private var memberIds: Set<String> {
        Set(preferences.prefs.waypointGroups.first { $0.id == group.id }?.waypointIds ?? [])
    }

    var body: some View {
        NavigationStack {
            List {
                if candidates.isEmpty {
                    SettingsSection {
                        Text("No matches.")
                            .font(.footnote)
                            .foregroundStyle(theme.textTertiary)
                    }
                } else {
                    SettingsSection {
                        ForEach(candidates) { candidate in
                            candidateRow(candidate, added: memberIds.contains(candidate.id))
                        }
                    }
                }
            }
            .settingsList()
            .navigationTitle("Add to \(group.name)")
            .searchable(text: $query, prompt: "Search waypoints")
            .toolbar {
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }

    private func candidateRow(_ candidate: Candidate, added: Bool) -> some View {
        Button {
            guard !added else { return }
            preferences.update { $0.addWaypoint(candidate.id, toGroup: group.id) }
        } label: {
            HStack(alignment: .center, spacing: 10) {
                WaypointMark(id: candidate.id, size: 20)
                    .foregroundStyle(theme.textPrimary)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(spacing: 6) {
                        Text(candidate.name)
                            .font(AturiFont.body)
                            .foregroundStyle(theme.textPrimary)
                            .lineLimit(1)
                        if candidate.isCustom {
                            Chip("custom", style: .accent)
                        }
                    }
                    if let detail = candidate.detail, !detail.isEmpty {
                        Text(detail)
                            .font(AturiFont.monoSmall)
                            .foregroundStyle(theme.textTertiary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
                Spacer(minLength: 0)
                if added {
                    Label("Added", systemImage: "checkmark")
                        .font(.footnote)
                        .foregroundStyle(theme.textTertiary)
                } else {
                    Image(systemName: "plus.circle")
                        .font(.body)
                        .foregroundStyle(theme.textAccent)
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(added ? "\(candidate.name), already in group" : "Add \(candidate.name)")
    }
}
