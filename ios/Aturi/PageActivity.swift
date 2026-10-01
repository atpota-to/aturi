import SwiftUI
import AturiCore

/// The page on screen, advertised to the system as an `NSUserActivity` so
/// it can come back three ways: Spotlight lists the pages you have opened,
/// Siri Suggestions can offer the ones you return to, and Handoff continues
/// the page on another of your devices, in Aturi where it is installed and
/// on aturi.to in a browser where it is not. The activity's aturi.to URL is
/// the whole address, so continuing one goes through `DeepLinks` like any
/// universal link. It stays on the device and among the person's own
/// devices (nothing is offered to Apple's public index), and clearing Recent
/// on the Links tab deletes it again.
enum PageActivity {
    /// Listed under `NSUserActivityTypes` in Info.plist (project.yml): the
    /// system only hands an app back the activity types it declares.
    static let activityType = "to.aturi.app.page"
}

extension Route {
    /// What Spotlight and Siri show for the page. Nil for search results,
    /// which are a lookup rather than a page to come back to.
    var activityTitle: String? {
        switch self {
        case .repo(let repo):
            return repo
        case .collection(let repo, let collection):
            return "\(collection) · \(repo)"
        case .record(let repo, let collection, let rkey):
            return "\(collection)/\(rkey) · \(repo)"
        case .pds(let host):
            return "\(host) (PDS)"
        case .lexicon(let nsid):
            return nsid
        case .lexiconGroup(let prefix):
            return "\(prefix).*"
        case .preview(let components):
            let who = components.identifier.hasPrefix("did:") ? components.identifier : "@\(components.identifier)"
            guard let collection = components.collection, components.rkey != nil else { return who }
            switch collection {
            case "app.bsky.feed.post": return "Post by \(who)"
            case "app.bsky.graph.list": return "List by \(who)"
            default: return "\(collection) by \(who)"
            }
        case .search:
            return nil
        }
    }

    /// The identifiers on the page, so a Spotlight search for a handle, an
    /// NSID or a record key finds it.
    var activityKeywords: Set<String> {
        switch self {
        case .repo(let repo):
            return [repo]
        case .collection(let repo, let collection):
            return [repo, collection]
        case .record(let repo, let collection, let rkey):
            return [repo, collection, rkey]
        case .pds(let host):
            return [host]
        case .lexicon(let nsid):
            return [nsid]
        case .lexiconGroup(let prefix):
            return [prefix]
        case .preview(let components):
            return Set([components.identifier, components.collection, components.rkey].compactMap { $0 })
        case .search:
            return []
        }
    }
}

/* A stack keeps the pages under the top one alive, and the other tabs keep
   theirs, so each page only advertises while it is actually on screen:
   whatever was on screen last is what Handoff and Spotlight get. */
private struct PageActivityModifier: ViewModifier {
    let route: Route

    @State private var isVisible = false

    private var isAdvertised: Bool {
        isVisible && route.webURL != nil && route.activityTitle != nil
    }

    func body(content: Content) -> some View {
        content
            .onAppear { isVisible = true }
            .onDisappear { isVisible = false }
            .userActivity(PageActivity.activityType, isActive: isAdvertised) { activity in
                describe(activity)
            }
    }

    private func describe(_ activity: NSUserActivity) {
        guard let url = route.webURL, let title = route.activityTitle else { return }
        activity.title = title
        activity.webpageURL = url
        activity.keywords = route.activityKeywords
        activity.persistentIdentifier = url.absoluteString
        activity.isEligibleForSearch = true
        activity.isEligibleForPrediction = true
        activity.isEligibleForHandoff = true
    }
}

extension View {
    /// Advertise `route` as the page on screen (see `PageActivity`).
    func advertisesPage(_ route: Route) -> some View {
        modifier(PageActivityModifier(route: route))
    }
}
