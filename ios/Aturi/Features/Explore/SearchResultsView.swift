import SwiftUI
import AturiCore

/// `Route.search`: a free-text query routed the way the landing's box
/// routes it (`resolveSearchPathAsync`, so an unrecognised URL gets to
/// declare its record through AT Tags). The resolved page is pushed as
/// soon as it is known; this screen stays underneath as the record of
/// what was looked up, and says so when nothing routes.
struct SearchResultsView: View {
    let query: String

    private enum Outcome: Equatable {
        case resolving
        case destination(SearchDestination)
        case nothing
    }

    @State private var outcome: Outcome = .resolving
    /* `.task` fires again when the pushed page is popped; the automatic
       push happens once, or the visitor could never get back past here. */
    @State private var hasPushed = false

    @Environment(AppRouter.self) private var router
    @Environment(SearchHistoryStore.self) private var searchHistory
    @Environment(\.openURL) private var openURL
    @Environment(\.aturiTheme) private var theme

    init(query: String) {
        self.query = query
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                SectionHeader("Looked up")
                IdentifierText(query, lineLimit: 3)
                    .foregroundStyle(theme.textPrimary)
                switch outcome {
                case .resolving:
                    SkeletonRows(count: 2)
                case .destination(let destination):
                    resolved(destination)
                case .nothing:
                    EmptyState(
                        title: "Nothing to open",
                        detail: "That did not read as a handle, DID, AT URI or a link the explorer knows.",
                        systemImage: "questionmark.circle"
                    )
                }
            }
            .padding(16)
        }
        .background(theme.bgPrimary)
        .navigationTitle("Search")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: query) {
            guard !hasPushed else { return }
            await resolve(push: true)
        }
        .refreshable {
            await resolve(push: false)
        }
    }

    @ViewBuilder
    private func resolved(_ destination: SearchDestination) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Resolved to")
                .aturiLabel()
                .foregroundStyle(theme.textTertiary)
            IdentifierText(destination.explorePath, lineLimit: 3, font: AturiFont.monoSmall)
                .foregroundStyle(theme.textSecondary)
            Button("Open") {
                ExploreNavigator.open(destination, router: router, openURL: openURL)
            }
            .buttonStyle(.aturiPrimary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }

    private func resolve(push: Bool) async {
        outcome = .resolving
        guard let path = await SearchRouting.resolveSearchPathAsync(query) else {
            outcome = .nothing
            return
        }
        let destination = SearchDestination(explorePath: path)
        searchHistory.recordQueryVisit(query, path: path)
        outcome = .destination(destination)
        if push, !hasPushed {
            hasPushed = true
            ExploreNavigator.open(destination, router: router, openURL: openURL)
        }
    }
}
