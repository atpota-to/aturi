import SwiftUI
import AturiCore

/// Where a tap on a card goes. Inside the app the router pushes the route
/// on the stack the person is looking at; a host without a router (the
/// share extension, a preview) opens the aturi.to page for the same route
/// instead, so nothing here is a dead end.
enum LinkNavigation {
    static func open(_ route: Route, router: AppRouter?, openURL: OpenURLAction) {
        if let router {
            router.open(route)
        } else if let url = route.webURL {
            openURL(url)
        }
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
