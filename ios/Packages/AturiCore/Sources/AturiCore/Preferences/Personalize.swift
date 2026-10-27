import Foundation

// Port of src/utils/personalizeWaypoints.tsx: applying the user's groups to
// the built-in catalog. Each group becomes its own category in the picker
// output, ordered as the user arranged them; a waypoint in no group is
// hidden. Custom waypoints live in groups too, so they can sit anywhere.

public enum Personalize {
    /// Promote a custom waypoint into a `Waypoint` the picker can render
    /// directly. The synthetic URL builder expands the template and returns
    /// nil when the inputs do not satisfy its placeholders.
    public static func customToWaypoint(_ custom: CustomWaypoint) -> Waypoint {
        let description = Preferences.presence(custom.description)
            ?? custom.domain.flatMap(Preferences.presence).map { "Open on \($0)" }
            ?? "Custom waypoint"
        return Waypoint(
            id: custom.id,
            name: custom.name,
            describe: { _ in description },
            url: { handle, collection, rkey, did in
                customWaypointUrl(custom, context: CustomWaypointContext(handle: handle, did: did, collection: collection, rkey: rkey))
            },
            supportedTypes: custom.supportedTypes,
            category: "custom",
            redirectCompat: custom.redirectCompat ?? []
        )
    }

    /// Resolve a waypoint id to a renderable waypoint scoped to `type`; nil
    /// when the id is unknown or the waypoint does not support the type.
    private static func resolveWaypoint(_ id: String, customById: [String: CustomWaypoint], type: WaypointType) -> Waypoint? {
        if let custom = customById[id] {
            guard custom.supportedTypes.contains(type) else { return nil }
            return customToWaypoint(custom)
        }
        guard let builtin = WaypointCatalog.all[id], builtin.supportedTypes.contains(type) else { return nil }
        return builtin
    }

    /// The picker's category list built straight from the user's groups.
    /// Groups with nothing renderable for this type are dropped.
    public static func personalizeCategorized(_ prefs: Preferences, type: WaypointType) -> [CategorizedWaypoints] {
        let customById = Dictionary(prefs.customWaypoints.map { ($0.id, $0) }, uniquingKeysWith: { first, _ in first })
        var result: [CategorizedWaypoints] = []
        for group in prefs.waypointGroups {
            let waypoints = group.waypointIds.compactMap { resolveWaypoint($0, customById: customById, type: type) }
            guard let first = waypoints.first else { continue }
            let category = WaypointCategory(id: group.id, name: group.name, defaultWaypointId: first.id)
            result.append(CategorizedWaypoints(category: category, waypoints: waypoints))
        }
        return result
    }

    /// Strip waypoints not surfaced by any group from a recommendation
    /// bundle, keeping the source order.
    public static func personalizeRecommended(_ waypoints: [Waypoint], prefs: Preferences) -> [Waypoint] {
        var visible = Set<String>()
        for group in prefs.waypointGroups {
            visible.formUnion(group.waypointIds)
        }
        if visible.isEmpty { return [] }
        return waypoints.filter { visible.contains($0.id) }
    }
}
