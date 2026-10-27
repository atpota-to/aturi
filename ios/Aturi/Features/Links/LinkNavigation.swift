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
