import SwiftUI
import AturiCore

/// The tab bar: four `NavigationStack`s, each bound to its path on the
/// router so deep links and in-app pushes go through the same state.
struct RootView: View {
    @Environment(AppRouter.self) private var router

    var body: some View {
        @Bindable var router = router
        TabView(selection: $router.selectedTab) {
            NavigationStack(path: $router.explorePath) {
                ExploreLandingView()
                    .withRouteDestinations()
            }
            .tabItem { Label(Tab.explore.title, systemImage: Tab.explore.systemImage) }
            .tag(Tab.explore)

            NavigationStack(path: $router.linksPath) {
                LinksView()
                    .withRouteDestinations()
            }
            .tabItem { Label(Tab.links.title, systemImage: Tab.links.systemImage) }
            .tag(Tab.links)

            NavigationStack(path: $router.lexiconsPath) {
                LexiconsView()
                    .withRouteDestinations()
            }
            .tabItem { Label(Tab.lexicons.title, systemImage: Tab.lexicons.systemImage) }
            .tag(Tab.lexicons)

            NavigationStack(path: $router.settingsPath) {
                SettingsView()
                    .withRouteDestinations()
            }
            .tabItem { Label(Tab.settings.title, systemImage: Tab.settings.systemImage) }
            .tag(Tab.settings)
        }
    }
}

/// The one place a `Route` value becomes a screen. Every stack registers
/// the same table, so any route can be pushed on any tab.
struct RouteDestinationView: View {
    let route: Route

    var body: some View {
        switch route {
        case .repo(let repo):
            RepoView(repo: repo)
        case .collection(let repo, let collection):
            CollectionView(repo: repo, collection: collection)
        case .record(let repo, let collection, let rkey):
            RecordView(repo: repo, collection: collection, rkey: rkey)
        case .pds(let host):
            PDSView(host: host)
        case .lexicon(let nsid):
            LexiconDetailView(nsid: nsid)
        case .lexiconGroup(let prefix):
            LexiconGroupView(prefix: prefix)
        case .preview(let components):
            PreviewView(components: components)
        case .search(let query):
            SearchResultsView(query: query)
        }
    }
}

extension View {
    /// Registers the `Route` destination table on a stack's root view.
    func withRouteDestinations() -> some View {
        navigationDestination(for: Route.self) { route in
            RouteDestinationView(route: route)
        }
    }
}
