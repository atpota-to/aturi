import SwiftUI
import Observation
import AturiCore

/// The Lexicons tab's root (`/explore/lexicons`), port of
/// `LexiconsExplorer.tsx`: four sections behind one segmented control.
/// Trending is the ranked strip with its window and metric toggles, New is
/// the new-lexicons list with its own window, All is the full-catalog
/// browser and Search is the typeahead over `/search`. One `LexiconsModel`
/// backs Trending, All and Search, so switching sections never refetches
/// what another section already loaded; New reads aturi.to's
/// `/api/lexicons/new` through its own `NewLexiconsModel`, fetched the
/// first time the section shows.
struct LexiconsView: View {
    private enum Segment: String, CaseIterable, Identifiable {
        case trending
        case new
        case all
        case search

        var id: String { rawValue }

        var label: String {
            switch self {
            case .trending: return "Trending"
            case .new: return "New"
            case .all: return "All"
            case .search: return "Search"
            }
        }
    }

    @State private var model = LexiconsModel()
    @State private var newModel = NewLexiconsModel()
    @State private var segment: Segment = .trending
    @FocusState private var searchFocused: Bool

    @Environment(AppRouter.self) private var router
    @Environment(PreferencesStore.self) private var preferences
    @Environment(\.openURL) private var openURL
    @Environment(\.aturiTheme) private var theme

    private static let pageURL = Endpoints.aturiBase.appending(path: "explore/lexicons")

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                pinnedSection
                Picker("Section", selection: $segment) {
                    ForEach(Segment.allCases) { segment in
                        Text(segment.label).tag(segment)
                    }
                }
                .pickerStyle(.segmented)
                switch segment {
                case .trending:
                    trendingSection
                case .new:
                    newSection
                        .task {
                            if newModel.answer.isIdle {
                                newModel.load()
                            }
                        }
                case .all:
                    browseSection
                case .search:
                    searchSection
                }
                /* Rendered from the cursor's date on a timer, so the lag keeps
                   growing while the page stays open instead of freezing at
                   whatever it was when `/meta` answered. */
                if let cursor = model.freshnessCursorDate {
                    TimelineView(.periodic(from: .now, by: 15)) { context in
                        Text(LexiconsModel.freshnessLabel(cursorDate: cursor, now: context.date))
                            .aturiLabel()
                            .foregroundStyle(theme.textTertiary)
                            .multilineTextAlignment(.center)
                            .frame(maxWidth: .infinity)
                    }
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
            let newLoad: Task<Void, Never>? = newModel.answer.isIdle ? nil : newModel.load()
            await model.load().value
            await newLoad?.value
        }
        /* The Explore landing's card links and `?list=` / `#new` links land
           here. The page may be built already or appear for the first time
           with the request, so both moments get to try. */
        .onAppear(perform: showRequestedSection)
        .onChange(of: router.requestedLexiconList) { _, _ in
            showRequestedSection()
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
                .tracking(AturiFont.displayTracking)
                .foregroundStyle(theme.textPrimary)
            Text("Search any collection NSID, watch what\u{2019}s trending, and browse the full catalog of record types seen across the AT Protocol firehose.")
                .font(AturiFont.body)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    // MARK: Pinned (LexiconRail.tsx)

    /* What the person pinned from a lexicon or a namespace page, in the
       order pinned: the web rail's Pinned list, which travels with the
       synced preferences. A namespace pin is spelled `prefix.*`. */
    @ViewBuilder
    private var pinnedSection: some View {
        let pins = preferences.prefs.lexiconExplorerPins
        if !pins.isEmpty {
            LexiconSectionCard("Pinned", systemImage: "pin") {
                VStack(spacing: 0) {
                    ForEach(Array(pins.enumerated()), id: \.element) { index, entry in
                        if index > 0 {
                            Divider()
                        }
                        pinnedRow(entry)
                    }
                }
            }
        }
    }

    private func pinnedRow(_ entry: String) -> some View {
        let isGroup = PinnedLexicons.isGroup(entry)
        let name = isGroup ? PinnedLexicons.groupPrefix(entry) : entry
        let route: Route = isGroup ? .lexiconGroup(prefix: name) : .lexicon(nsid: name)
        let display = isGroup ? "\(name).*" : name
        return NavigationLink(value: route) {
            HStack(spacing: 10) {
                Image(systemName: isGroup ? "folder" : "square.stack.3d.up")
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textTertiary)
                    .accessibilityHidden(true)
                Text(display)
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(theme.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(AturiFont.caption2)
                    .foregroundStyle(theme.textFaint)
                    .accessibilityHidden(true)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        /* The row is drawn on the card's fill, so the touch-and-hold preview
           lifts a solid card rather than floating text. The card's radius
           keeps the last row inside the card's rounded bottom corners. */
        .background(theme.bgSecondary, in: RoundedRectangle(cornerRadius: AturiTheme.cardRadius, style: .continuous))
        .contentShape(.contextMenuPreview, RoundedRectangle(cornerRadius: AturiTheme.cardRadius, style: .continuous))
        .contextMenu {
            Button(role: .destructive) {
                preferences.update { $0.toggleLexiconExplorerPin(entry) }
            } label: {
                Label("Unpin \(display)", systemImage: "pin.slash")
            }
        }
        .accessibilityLabel(isGroup ? "Namespace \(name)" : name)
        .accessibilityHint("Pinned. Touch and hold to unpin")
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

    // MARK: New (NewLexicons.tsx)

    private var newSection: some View {
        @Bindable var newModel = newModel
        return VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 8) {
                    Label(NewLexiconsModel.title, systemImage: "leaf")
                        .font(AturiFont.subtitle)
                        .foregroundStyle(theme.textPrimary)
                    Text("via UFOs")
                        .aturiLabel()
                        .foregroundStyle(theme.textTertiary)
                    Spacer(minLength: 0)
                    if newModel.isRefreshing {
                        ProgressView()
                            .controlSize(.small)
                    }
                }
                Text(NewLexiconsModel.subtitle)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Picker("Time window", selection: $newModel.window) {
                    ForEach(UFOsWindow.allCases, id: \.self) { window in
                        Text(window.label).tag(window)
                    }
                }
                .pickerStyle(.segmented)
            }
            .padding(14)
            Divider()
            newContent
            if let note = newModel.note {
                Divider()
                Text(note)
                    .font(AturiFont.caption)
                    .foregroundStyle(theme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(14)
            }
        }
        .cardBackground()
    }

    @ViewBuilder
    private var newContent: some View {
        if let message = newModel.errorMessage {
            ErrorPanel(message: message) {
                newModel.load()
            }
            .padding(12)
        } else if let rows = newModel.visible {
            if rows.isEmpty {
                EmptyState(title: NewLexiconsModel.emptyMessage, systemImage: "leaf")
                    .padding(12)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, lexicon in
                        if index > 0 {
                            Divider()
                        }
                        newLexiconRow(lexicon, rank: index + 1)
                    }
                    if newModel.showsToggle {
                        Divider()
                        Button(newModel.toggleLabel) {
                            newModel.expanded.toggle()
                        }
                        .buttonStyle(.aturiSecondary)
                        .padding(12)
                    }
                }
            }
        } else {
            SkeletonRows(count: NewLexiconsModel.resultCount)
                .padding(14)
        }
    }

    /// Rank, the NSID, then records and accounts, each with its unit
    /// beneath as the web's `Count` prints it.
    private func newLexiconRow(_ lexicon: NewLexicon, rank: Int) -> some View {
        NavigationLink(value: Route.lexicon(nsid: lexicon.nsid)) {
            HStack(spacing: 10) {
                Text("\(rank)")
                    .font(AturiFont.monoSmall)
                    .monospacedDigit()
                    .foregroundStyle(theme.textTertiary)
                    .frame(minWidth: 20, alignment: .leading)
                NsidSplitText(lexicon.nsid)
                Spacer(minLength: 8)
                newLexiconCount(lexicon.creates, unit: "records")
                newLexiconCount(lexicon.didsEstimate, unit: "accounts")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .contextMenu {
            LexiconRowMenu(nsid: lexicon.nsid)
        }
    }

    private func newLexiconCount(_ value: Int, unit: String) -> some View {
        VStack(alignment: .trailing, spacing: 1) {
            LexiconCountText(value: value, unit: unit)
            Text(unit)
                .font(AturiFont.caption2)
                .foregroundStyle(theme.textFaint)
                .accessibilityHidden(true)
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
                        .font(AturiFont.footnote)
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
                TextField("NSID, namespace or app name", text: $model.searchQuery)
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
            .cardBackground(cornerRadius: AturiTheme.controlRadius)

            if model.showsSearchDropdown {
                suggestionList
                /* A dotted term still offers "Browse all of", which does not
                   need `/search`; the failure shows beneath it. */
                if model.searchFailed {
                    searchErrorPanel
                }
            } else if !UFOsClient.isSearchable(searchTerm) {
                EmptyState(
                    title: "Search lexicons",
                    detail: "Type a collection NSID such as app.bsky.feed.post, a namespace such as net.anisota, or a term such as grain.",
                    systemImage: "magnifyingglass"
                )
            } else if !model.isSearchPending && model.suggestions.isEmpty {
                /* A failed lookup is not "no matches": it gets the API error
                   and a retry. Return in the field still submits the term. */
                if model.searchFailed {
                    searchErrorPanel
                } else {
                    EmptyState(
                        title: "No lexicons match \u{201C}\(searchTerm)\u{201D}.",
                        detail: "Try a shorter term, a namespace such as net.anisota, or a full NSID such as app.bsky.feed.post.",
                        systemImage: "magnifyingglass"
                    )
                }
            }
        }
    }

    private var searchErrorPanel: some View {
        ErrorPanel(message: "Couldn't reach the UFOs API: \(LexiconsModel.apiUnavailableMessage)") {
            model.retrySearch()
        }
    }

    private var suggestionList: some View {
        VStack(spacing: 0) {
            if model.showsNamespaceRow {
                Button(action: browseNamespace) {
                    HStack(spacing: 10) {
                        Image(systemName: "folder")
                            .font(AturiFont.footnote)
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
                                .font(AturiFont.caption)
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

    /* `router.showLexicons(list:)` has already pushed this page on a fresh
       Explore stack; this turns to the list it names. Top and Trending are
       the two modes of the Trending section. An unknown list leaves the
       page as it is. */
    private func showRequestedSection() {
        guard let list = router.consumeLexiconListRequest() else { return }
        switch list {
        case "new":
            segment = .new
        case "all":
            segment = .all
        case "top":
            segment = .trending
            model.mode = .top
        case "trending":
            segment = .trending
            model.mode = .trending
        default:
            break
        }
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
