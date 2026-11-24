import SwiftUI
import AturiCore

/// The tab bar: one `NavigationStack` per tab, each bound to its path on the
/// router so deep links and in-app pushes go through the same state.
struct RootView: View {
    @Environment(AppRouter.self) private var router

    var body: some View {
        @Bindable var router = router
        TabView(selection: tabSelection) {
            NavigationStack(path: $router.explorePath) {
                ExploreLandingView()
                    .withRouteDestinations()
            }
            .tabItem { Label(Tab.explore.title, systemImage: Tab.explore.systemImage) }
            .tag(Tab.explore)

            NavigationStack(path: $router.toolsPath) {
                ToolsView()
                    .withRouteDestinations()
            }
            .tabItem { Label(Tab.tools.title, systemImage: Tab.tools.systemImage) }
            .tag(Tab.tools)

            NavigationStack(path: $router.settingsPath) {
                SettingsView()
                    .withRouteDestinations()
            }
            .tabItem { Label(Tab.settings.title, systemImage: Tab.settings.systemImage) }
            .tag(Tab.settings)

            NavigationStack(path: $router.accountPath) {
                AccountSettingsView()
                    .withRouteDestinations()
            }
            .tabItem { Label(Tab.account.title, systemImage: Tab.account.systemImage) }
            .tag(Tab.account)
        }
    }

    /* A tap on the selected tab reaches the binding as a set to the value
       it already holds. Passing that on as a reselect lets the router pop
       the stack or scroll the root up, as UIKit's tab bar does. */
    private var tabSelection: Binding<Tab> {
        Binding(
            get: { router.selectedTab },
            set: { new in
                if new == router.selectedTab {
                    router.reselect(new)
                } else {
                    router.selectedTab = new
                }
            }
        )
    }
}

/// The one place a `Route` value becomes a screen. Every stack registers
/// the same table, so any route can be pushed on any tab, and every pushed
/// page is offered to Spotlight, Siri Suggestions and Handoff from here.
struct RouteDestinationView: View {
    let route: Route

    @Environment(AppRouter.self) private var router

    var body: some View {
        page
            .advertisesPage(route)
    }

    @ViewBuilder
    private var page: some View {
        switch route {
        case .repo(let repo, let tab):
            RepoView(repo: repo, initialTab: tab)
        case .collection(let repo, let collection):
            CollectionView(repo: repo, collection: collection)
        case .record(let repo, let collection, let rkey):
            RecordView(repo: repo, collection: collection, rkey: rkey)
        case .pds(let host, let query):
            PDSView(host: host, query: query)
        case .lexicon(let nsid):
            LexiconDetailView(nsid: nsid)
        case .lexiconGroup(let prefix):
            LexiconGroupView(prefix: prefix)
        case .lexicons:
            /* Keyed on the visit so every link builds a new browser instead
               of reusing the one SwiftUI kept at this stack position. */
            LexiconsView()
                .id(router.lexiconsVisit)
        case .preview(let components):
            PreviewView(components: components)
        case .search(let query):
            SearchResultsView(query: query)
        case .tool(let slug, let query):
            ToolPageView(slug: slug, query: query)
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
