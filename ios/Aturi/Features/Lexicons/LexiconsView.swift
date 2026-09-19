import SwiftUI
import Observation
import AturiCore

/// The Lexicons tab's root (`/explore/lexicons`), port of
/// `LexiconsExplorer.tsx`: three sections behind one segmented control.
/// Trending is the ranked strip with its window and metric toggles, All is
/// the full-catalog browser and Search is the typeahead over `/search`.
/// One `LexiconsModel` backs all three, so switching sections never
/// refetches what another section already loaded.
struct LexiconsView: View {
    private enum Segment: String, CaseIterable, Identifiable {
        case trending
        case all
        case search

        var id: String { rawValue }

        var label: String {
            switch self {
            case .trending: return "Trending"
            case .all: return "All"
            case .search: return "Search"
            }
        }
    }

    @State private var model = LexiconsModel()
    @State private var segment: Segment = .trending
    @FocusState private var searchFocused: Bool

    @Environment(AppRouter.self) private var router
    @Environment(\.openURL) private var openURL
    @Environment(\.aturiTheme) private var theme

    private static let pageURL = Endpoints.aturiBase.appending(path: "explore/lexicons")

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                Picker("Section", selection: $segment) {
                    ForEach(Segment.allCases) { segment in
                        Text(segment.label).tag(segment)
                    }
                }
                .pickerStyle(.segmented)
                switch segment {
                case .trending:
                    trendingSection
                case .all:
                    browseSection
                case .search:
                    searchSection
                }
                if let freshness = model.freshnessLabel {
                    Text(freshness)
                        .aturiLabel()
                        .foregroundStyle(theme.textTertiary)
                        .multilineTextAlignment(.center)
                        .frame(maxWidth: .infinity)
                }
                MicrocosmCredit()
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(theme.bgPrimary)
        .navigationTitle("Lexicons")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                ShareLink(item: Self.pageURL) {
                    Image(systemName: "square.and.arrow.up")
                }
                .accessibilityLabel("Share")
            }
        }
        /* `load()` arms the model's refetch-on-toggle, so the pickers below
           bind straight to the model and no `onChange` reload is needed. */
        .task {
            if model.ranking.isIdle {
                model.load()
            }
        }
        .refreshable {
            await model.load().value
        }
        .onChange(of: segment) { _, next in
            if next == .search {
                searchFocused = true
            } else {
                searchFocused = false
                model.dismissSearch()
            }
        }
        .onChange(of: searchFocused) { _, focused in
            if focused {
                model.isSearchOpen = true
            }
        }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Lexicon trends", systemImage: "square.stack.3d.up")
                .aturiLabel()
                .foregroundStyle(theme.textTertiary)
            Text("Every lexicon in the Atmosphere.")
                .font(AturiFont.display)
                .foregroundStyle(theme.textPrimary)
            Text("Search any collection NSID, watch what\u{2019}s trending, and browse the full catalog of record types seen across the AT Protocol firehose.")
                .font(.body)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: Trending (TrendingLexicons.tsx)

    private var trendingSection: some View {
        @Bindable var model = model
        return VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Label(model.rankingTitle, systemImage: model.mode == .trending ? "sparkles" : "chart.bar")
                        .font(AturiFont.subtitle)
                        .foregroundStyle(theme.textPrimary)
                    Text("via UFOs")
                        .aturiLabel()
                        .foregroundStyle(theme.textTertiary)
                    Spacer(minLength: 0)
                    if model.isRankingRefreshing {
                        ProgressView()
                            .controlSize(.small)
                    }
                }
                Picker("Ranking", selection: $model.mode) {
                    ForEach(LexiconRankingMode.allCases, id: \.self) { mode in
                        Text(mode.label).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                Picker("Time window", selection: $model.window) {
                    ForEach(UFOsWindow.allCases, id: \.self) { window in
                        Text(window.label).tag(window)
                    }
                }
                .pickerStyle(.segmented)
                Picker("Metric", selection: $model.metric) {
                    ForEach(Metric.allCases, id: \.self) { metric in
                        Text(metric.label).tag(metric)
                    }
                }
                .pickerStyle(.segmented)
            }
            .padding(14)
            Divider()
            rankingContent
        }
        .cardBackground()
    }

    @ViewBuilder
    private var rankingContent: some View {
        if let message = model.rankingErrorMessage {
            ErrorPanel(message: message) {
                model.reloadRanking()
            }
            .padding(12)
        } else if let rows = model.visibleRanking {
            if rows.isEmpty {
                EmptyState(title: LexiconsModel.rankingEmptyMessage, systemImage: "sparkles")
                    .padding(12)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        if index > 0 {
                            Divider()
                        }
                        LexiconRankingRowView(
                            row: row,
                            rank: index + 1,
                            mode: model.mode,
                            metric: model.metric,
                            seriesLabel: model.rankingSeriesLabel
                        )
                    }
                    if model.showsRankingToggle {
                        Divider()
                        Button(model.rankingToggleLabel) {
                            model.expanded.toggle()
                        }
                        .buttonStyle(.aturiSecondary)
                        .padding(12)
                    }
                }
            }
        } else {
            SkeletonRows(count: model.rankingLimit)
                .padding(14)
        }
    }

    // MARK: All (BrowseAllLexicons.tsx)

    private var browseSection: some View {
        @Bindable var model = model
        return VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Text("Browse all lexicons")
                        .font(AturiFont.subtitle)
                        .foregroundStyle(theme.textPrimary)
                    Spacer(minLength: 0)
                    if model.isBrowseRefreshing {
                        ProgressView()
                            .controlSize(.small)
                    }
                }
                Picker("Browse view", selection: $model.browseView) {
                    ForEach(LexiconBrowseView.allCases, id: \.self) { view in
                        Text(view.label).tag(view)
                    }
                }
                .pickerStyle(.segmented)
                HStack(spacing: 8) {
                    Picker(model.browseOrderLabel, selection: $model.browseOrder) {
                        Text("Repos").tag(CollectionOrder.didsEstimate)
                        Text("Creates").tag(CollectionOrder.recordsCreated)
                    }
                    .pickerStyle(.segmented)
                    Toggle("One per group", isOn: $model.onePerGroup)
                        .toggleStyle(.button)
                        .font(.footnote)
                        .accessibilityHint("Shows only the top lexicon from each namespace")
                }
            }
            .padding(14)
            Divider()
            HStack {
                Text("Lexicon")
                Spacer(minLength: 0)
                Text(model.browseMetricLabel)
            }
            .aturiLabel()
            .foregroundStyle(theme.textTertiary)
            .padding(.horizontal, 14)
            .padding(.vertical, 6)
            .accessibilityHidden(true)
            Divider()
            browseContent
        }
        .cardBackground()
    }

    @ViewBuilder
    private var browseContent: some View {
        if let message = model.browseErrorMessage {
            ErrorPanel(message: message) {
                model.reloadBrowse()
            }
            .padding(12)
        } else if let rows = model.displayedBrowse {
            if rows.isEmpty {
                EmptyState(title: LexiconsModel.browseEmptyMessage, systemImage: "tray")
                    .padding(12)
            } else {
                /* The catalog can repeat an NSID across pages, so rows are
                   keyed by position, as the web keys them by `nsid-index`. */
                LazyVStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                        if index > 0 {
                            Divider()
                        }
                        browseRow(row)
                    }
                }
                if model.canLoadMoreBrowse {
                    Divider()
                    loadMoreButton
                }
                if let error = model.loadMoreError {
                    Divider()
                    ErrorPanel(message: "Couldn't reach the UFOs API: \(error)") {
                        model.loadMoreBrowse()
                    }
                    .padding(12)
                }
            }
        } else {
            SkeletonRows(count: 8)
                .padding(14)
        }
    }

    private func browseRow(_ row: NsidCount) -> some View {
        NavigationLink(value: Route.lexicon(nsid: row.nsid)) {
            HStack(spacing: 10) {
                NsidSplitText(row.nsid)
                Spacer(minLength: 8)
                LexiconCountText(value: model.browseStat(row), unit: model.browseMetricLabel.lowercased())
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .contextMenu {
            LexiconRowMenu(nsid: row.nsid)
        }
    }

    private var loadMoreButton: some View {
        Button {
            model.loadMoreBrowse()
        } label: {
            HStack(spacing: 6) {
                if model.isLoadingMore {
                    ProgressView()
                        .controlSize(.small)
                }
                Text(model.isLoadingMore ? "Loading\u{2026}" : "Load more")
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.aturiSecondary)
        .disabled(model.isLoadingMore)
        .padding(12)
    }

    // MARK: Search (LexiconSearchBox.tsx)

    private var searchTerm: String {
        model.searchQuery.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var searchSection: some View {
        @Bindable var model = model
        return VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(theme.textTertiary)
                TextField("app.bsky.feed.post, grain, smokesignal", text: $model.searchQuery)
                    .font(AturiFont.monoSmall)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .submitLabel(.search)
                    .focused($searchFocused)
                    .onSubmit(submitSearch)
                    .accessibilityLabel("Search lexicons")
                if model.isSearchPending {
                    ProgressView()
                        .controlSize(.small)
                } else if !model.searchQuery.isEmpty {
                    Button {
                        model.searchQuery = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(theme.textTertiary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear search")
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .cardBackground(cornerRadius: 10)

            if model.showsSearchDropdown {
                suggestionList
            } else if !UFOsClient.isSearchable(searchTerm) {
                EmptyState(
                    title: "Search lexicons",
                    detail: "Type a collection NSID such as app.bsky.feed.post, a namespace such as net.anisota, or a term such as grain.",
                    systemImage: "magnifyingglass"
                )
            } else if !model.isSearchPending {
                VStack(alignment: .leading, spacing: 10) {
                    EmptyState(
                        title: "No suggestions for \u{201C}\(searchTerm)\u{201D}.",
                        detail: "Search anyway to open it as a namespace or a term.",
                        systemImage: "magnifyingglass"
                    )
                    Button("Search anyway", action: submitSearch)
                        .buttonStyle(.aturiSecondary)
                }
            }
        }
    }

    private var suggestionList: some View {
        VStack(spacing: 0) {
            if model.showsNamespaceRow {
                Button(action: browseNamespace) {
                    HStack(spacing: 10) {
                        Image(systemName: "folder")
                            .font(.footnote)
                            .foregroundStyle(theme.textAccent)
                            .frame(width: 16)
                            .accessibilityHidden(true)
                        VStack(alignment: .leading, spacing: 2) {
                            Text("Browse all of \(model.namespaceRowTerm)")
                                .font(AturiFont.monoSmall)
                                .foregroundStyle(theme.textPrimary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                            Text("Every collection under this namespace")
                                .font(.caption)
                                .foregroundStyle(theme.textTertiary)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                if model.showsSuggestionList {
                    Divider()
                }
            }
            ForEach(Array(model.suggestions.enumerated()), id: \.element.nsid) { index, suggestion in
                if index > 0 {
                    Divider()
                }
                Button {
                    pick(suggestion.nsid)
                } label: {
                    HStack(spacing: 10) {
                        NsidSplitText(suggestion.nsid)
                        Spacer(minLength: 8)
                        LexiconCountText(value: suggestion.counts.creates, unit: "creates")
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityElement(children: .combine)
            }
        }
        .cardBackground()
    }

    private func submitSearch() {
        guard let destination = model.submitSearch() else { return }
        searchFocused = false
        ExploreNavigator.open(destination, router: router, openURL: openURL)
    }

    private func pick(_ nsid: String) {
        let destination = model.pickSuggestion(nsid)
        searchFocused = false
        ExploreNavigator.open(destination, router: router, openURL: openURL)
    }

    private func browseNamespace() {
        guard let destination = model.browseNamespace() else { return }
        searchFocused = false
        ExploreNavigator.open(destination, router: router, openURL: openURL)
    }
}
