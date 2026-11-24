import SwiftUI
import AturiCore

/// Where a tap on a card goes. Inside the app the router pushes the route
/// on the stack the person is looking at; a host without a router (the
/// share extension, a preview) opens the aturi.to page for the same route
/// instead, so nothing here is a dead end.
enum LinkNavigation {
    /* The router pushes one and the same route for a pasted link, a tapped
       card and an incoming universal link, so the preview page cannot tell
       which door it came through. Every in-app push of a preview passes
       here and leaves a note; a preview that appears with no note behind it
       arrived from outside the app, the one case where auto-redirect may
       count down. The note is consumed by the page it was left for. */
    @MainActor private static var pendingInAppPreview: AtUriComponents?

    @MainActor
    static func open(_ route: Route, router: AppRouter?, openURL: OpenURLAction) {
        if let router {
            if case .preview(let components) = route {
                noteInAppPreview(components)
            }
            router.open(route)
        } else if let url = route.webURL {
            openURL(url)
        }
    }

    /// Record that the app itself is about to push the preview page for
    /// `components`. Callers that push through the router directly (the
    /// Links tab's input) call this first.
    @MainActor
    static func noteInAppPreview(_ components: AtUriComponents) {
        pendingInAppPreview = components
    }

    /// Whether the preview for `components` was pushed from inside the app.
    /// Clears the note either way so it cannot outlive the page it was for.
    @MainActor
    static func consumeInAppPreview(_ components: AtUriComponents) -> Bool {
        defer { pendingInAppPreview = nil }
        return pendingInAppPreview == components
    }

    /* The other half: the router leaves this note when it places a preview
       for a link from outside (a universal link, the share sheet, a
       Shortcuts action). A preview with neither note was pushed by a card
       on some page, which is in-app too. Only a preview with this note and
       no in-app one may count down to an auto-redirect. */
    @MainActor private static var pendingIncomingPreview: AtUriComponents?

    /// Record that the router is about to push the preview for
    /// `components` for a link that came from outside the app.
    @MainActor
    static func noteIncomingPreview(_ components: AtUriComponents) {
        pendingIncomingPreview = components
    }

    /// Whether the preview for `components` is for a link from outside the
    /// app. Clears the note either way.
    @MainActor
    static func consumeIncomingPreview(_ components: AtUriComponents) -> Bool {
        defer { pendingIncomingPreview = nil }
        return pendingIncomingPreview == components
    }

    /// Open a waypoint's link. The `aturi` and `aturiExplore` waypoints
    /// point back at aturi.to, and iOS hands an app's own universal links
    /// to Safari when the app opens them itself, so those two used to leave
    /// the app for pages it has. The web keeps them on the site
    /// (`SELF_WAYPOINTS` in `openInApps.ts`); here they push the matching
    /// page. Every other client, and any aturi.to page the app has no
    /// screen for, opens as before.
    @MainActor
    static func openWaypoint(_ string: String, router: AppRouter?, openURL: OpenURLAction) {
        guard let url = URL(string: string) else { return }
        if let router,
           let host = url.host?.lowercased(), host == Endpoints.aturiHost || host == "www." + Endpoints.aturiHost,
           case .route(let route, _)? = DeepLinks.target(for: url) {
            open(route, router: router, openURL: openURL)
            return
        }
        openURL(url)
    }

    /* `?stay=1` on an incoming link: the web's one-off escape hatch from
       auto-redirect (`hasStayParam`), documented on the Redirects screen.
       The router notes it for the preview it is about to push, and that
       page shows the picker without counting down. */
    @MainActor private static var pendingStay: AtUriComponents?

    @MainActor
    static func noteStay(_ components: AtUriComponents) {
        pendingStay = components
    }

    /// Whether the incoming link for `components` asked to stay. Clears the
    /// note either way.
    @MainActor
    static func consumeStay(_ components: AtUriComponents) -> Bool {
        defer { pendingStay = nil }
        return pendingStay == components
    }

    /// The universal-link page for a record's AT URI: the same page the
    /// web's `/profile/{did}/post/{rkey}` links reach. Nil for a repo-level
    /// URI or anything that is not an AT URI.
    static func previewRoute(recordUri uri: String) -> Route? {
        guard let parsed = AtUri(parsing: uri), let collection = parsed.collection, let rkey = parsed.rkey,
              !collection.isEmpty, !rkey.isEmpty
        else { return nil }
        return .preview(AtUriComponents(identifier: parsed.repo, collection: collection, rkey: rkey))
    }

    /// The universal-link profile page for an account.
    static func previewRoute(actor: String) -> Route {
        .preview(AtUriComponents(identifier: actor))
    }
}
