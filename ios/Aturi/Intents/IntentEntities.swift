import AppIntents
import AturiCore

/// A client a link can be opened in: a built-in waypoint or one of the
/// person's custom waypoints. The parameter type of "Get Client Link".
struct WaypointEntity: AppEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Client", synonyms: ["Waypoint", "App"])
    static let defaultQuery = WaypointEntityQuery()

    /// The waypoint id: a catalog id, or `custom:<id>`.
    let id: String
    let name: String
    let host: String?
    let category: String
    let isCustom: Bool

    init(listing: WaypointListing) {
        id = listing.id
        name = listing.name
        host = listing.host
        category = listing.category
        isCustom = listing.isCustom
    }

    /* Built-ins show their brand mark from the asset catalog's `Waypoints`
       folder (`WaypointMark.assetNamespace`, spelled out here because that
       view is main-actor isolated and this getter is not), which renders
       itself the way `WaypointMark` does. Custom waypoints have no mark and
       get the globe the picker gives them. */
    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: "\(name)",
            subtitle: "\(host ?? category)",
            image: isCustom
                ? DisplayRepresentation.Image(systemName: "globe")
                : DisplayRepresentation.Image(named: "Waypoints/\(id)")
        )
    }
}

/// Every built-in client in catalog order, then the custom waypoints, as
/// `WaypointDirectory` lists them; searchable by name, host or id.
struct WaypointEntityQuery: EntityStringQuery {
    func entities(for identifiers: [WaypointEntity.ID]) async throws -> [WaypointEntity] {
        let customs = await IntentLinks.customWaypoints()
        return WaypointDirectory.listings(ids: identifiers, customWaypoints: customs).map(WaypointEntity.init(listing:))
    }

    func entities(matching string: String) async throws -> [WaypointEntity] {
        let customs = await IntentLinks.customWaypoints()
        return WaypointDirectory.listings(matching: string, customWaypoints: customs).map(WaypointEntity.init(listing:))
    }

    func suggestedEntities() async throws -> [WaypointEntity] {
        let customs = await IntentLinks.customWaypoints()
        return WaypointDirectory.listings(customWaypoints: customs).map(WaypointEntity.init(listing:))
    }
}

/// An account's Bluesky profile, as the public AppView reports it. What
/// "Get Profile" returns; each property can be picked out in Shortcuts.
struct ProfileEntity: AppEntity {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Atmosphere Profile", synonyms: ["Profile", "Account"])
    static let defaultQuery = ProfileEntityQuery()

    /// The account's DID, which outlives any handle.
    let id: String

    @Property(title: "Handle")
    var handle: String

    @Property(title: "DID")
    var did: String

    @Property(title: "Display Name")
    var displayName: String?

    @Property(title: "Description")
    var bio: String?

    @Property(title: "Avatar")
    var avatar: URL?

    @Property(title: "Banner")
    var banner: URL?

    @Property(title: "Followers")
    var followersCount: Int?

    @Property(title: "Following")
    var followsCount: Int?

    @Property(title: "Posts")
    var postsCount: Int?

    @Property(title: "Aturi Link")
    var aturiLink: URL?

    init(profile: BskyProfile) {
        id = profile.did
        handle = profile.handle
        did = profile.did
        displayName = profile.displayName.flatMap { $0.isEmpty ? nil : $0 }
        bio = profile.description.flatMap { $0.isEmpty ? nil : $0 }
        avatar = profile.avatar.flatMap(URL.init(string:))
        banner = profile.banner.flatMap(URL.init(string:))
        followersCount = profile.followersCount
        followsCount = profile.followsCount
        postsCount = profile.postsCount
        /* The AppView reports `handle.invalid` when it cannot verify a
           handle (and nothing at all if none came back); a link built on
           either would lead nowhere, so it falls back to the DID. */
        let linkIdentifier = profile.handle != "handle.invalid" && isValidHandle(profile.handle) ? profile.handle : profile.did
        aturiLink = URL(string: generateAturiLink(AtUriComponents(identifier: linkIdentifier)))
    }

    /* The avatar is a remote image, and a display image can only come from
       the bundle or a local file, so the row gets a person symbol. */
    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: "\(displayName ?? handle)",
            subtitle: "@\(handle)",
            image: DisplayRepresentation.Image(systemName: "person.crop.circle")
        )
    }
}

/// Looks profiles up again by DID when Shortcuts hands one back.
struct ProfileEntityQuery: EntityQuery {
    func entities(for identifiers: [ProfileEntity.ID]) async throws -> [ProfileEntity] {
        let profiles = await AppViewClient().getProfiles(identifiers)
        return identifiers.compactMap { profiles[$0] }.map(ProfileEntity.init(profile:))
    }

    /* Profiles are only ever produced by "Get Profile", never picked from a
       list, so there is nothing to suggest. */
    func suggestedEntities() async throws -> [ProfileEntity] {
        []
    }
}
