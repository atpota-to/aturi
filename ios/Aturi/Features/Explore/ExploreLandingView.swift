import SwiftUI
import Observation
import AturiCore

/// The Explore tab's root. Reads the app's stores here and hands them to
/// the screen's initializer, since a `@State` model cannot be built from
/// the environment.
struct ExploreLandingView: View {
    @Environment(SearchHistoryStore.self) private var searchHistory
    @Environment(\.sessionStore) private var session

    var body: some View {
        ExploreLandingScreen(history: searchHistory, sessionState: session.state)
    }
}

/// Port of `ExploreLanding.tsx` + `SearchBox.tsx` + `SearchRecommendations.tsx`:
/// the headline, the search box with its typeahead and history, the "Try:"
/// chips, the trending strip and the live feed.
private struct ExploreLandingScreen: View {
    let sessionState: SessionState

    @State private var model: ExploreLandingModel
    @State private var lexicons = LexiconsModel()
    @FocusState private var fieldFocused: Bool

    @Environment(AppRouter.self) private var router
    @Environment(\.openURL) private var openURL
    @Environment(\.aturiTheme) private var theme

    init(history: SearchHistoryStore, sessionState: SessionState) {
        self.sessionState = sessionState
        _model = State(initialValue: ExploreLandingModel(history: history, session: sessionState))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                header
                searchArea
                exampleChips
                LandingTrendingSection(model: lexicons)
                Button {
                    router.select(.lexicons)
                } label: {
                    Label("Explore all lexicons", systemImage: "arrow.up.right")
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textAccent)
                }
                .buttonStyle(.plain)
                JetstreamView(compact: true)
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(theme.bgPrimary)
        .navigationTitle("Explore")
        .navigationBarTitleDisplayMode(.inline)
        .task {
            if lexicons.ranking.isIdle {
                lexicons.reloadRanking()
            }
        }
        .refreshable {
            model.history.reload()
            await lexicons.reloadRanking().value
        }
        .onChange(of: sessionState) { _, next in
            model.session = next
        }
        .onChange(of: fieldFocused) { _, focused in
            if focused {
                model.focus()
            } else {
                model.dismissSuggestions()
            }
        }
        /* Free-text history entries know no avatar; the model backfills
           them from the AppView while the rows are on screen. */
        .task(id: model.showsRecommendations) {
            guard model.showsRecommendations else { return }
            await model.enrichRecommendationAvatars()
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Atmosphere data explorer", systemImage: "binoculars")
                .aturiLabel()
                .foregroundStyle(theme.textTertiary)
            Text("Browse any repository.")
                .font(AturiFont.display)
                .foregroundStyle(theme.textPrimary)
            Text("Every account in the Atmosphere keeps its records in a public PDS. Browse collections, inspect identity history and follow backlinks.")
                .font(.body)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var searchArea: some View {
        @Bindable var model = model
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(theme.textTertiary)
                    TextField("handle, DID, at:// URI, or URL", text: $model.query)
                        .font(AturiFont.monoSmall)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .keyboardType(.URL)
                        .submitLabel(.search)
                        .focused($fieldFocused)
                        .onSubmit(submit)
                        .accessibilityLabel("Search the Atmosphere")
                    if model.isTypeaheadPending {
                        ProgressView()
                            .controlSize(.small)
                    } else if !model.query.isEmpty {
                        Button {
                            model.query = ""
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

                Button(model.isResolving ? "Looking\u{2026}" : "Look up", action: submit)
                    .buttonStyle(.aturiSecondary)
                    .disabled(model.isResolving)
            }

            if model.showsSuggestionList {
                suggestionList
            } else if model.showsRecommendations {
                recommendations
            }
        }
    }

    private var suggestionList: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(model.suggestions.enumerated()), id: \.element.did) { index, actor in
                if index > 0 {
                    Divider()
                }
                Button {
                    pick(actor: actor)
                } label: {
                    HStack(spacing: 10) {
                        AvatarView(url: actor.avatar, size: 28)
                        VStack(alignment: .leading, spacing: 2) {
                            if let name = actor.displayName?.trimmingCharacters(in: .whitespaces), !name.isEmpty {
                                Text(name)
                                    .font(AturiFont.subtitle)
                                    .foregroundStyle(theme.textPrimary)
                                    .lineLimit(1)
                            }
                            Text("@\(actor.handle)")
                                .font(AturiFont.monoSmall)
                                .foregroundStyle(theme.textTertiary)
                                .lineLimit(1)
                                .truncationMode(.middle)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(actor.displayName.map { "\($0), @\(actor.handle)" } ?? "@\(actor.handle)")
            }
        }
        .cardBackground()
    }

    private var recommendations: some View {
        VStack(alignment: .leading, spacing: 0) {
            if !model.recents.isEmpty {
                recommendationSection("Recent", systemImage: "clock", entries: model.recents)
            }
            if !model.frequent.isEmpty {
                if !model.recents.isEmpty {
                    Divider()
                }
                recommendationSection("Frequent", systemImage: "chart.line.uptrend.xyaxis", entries: model.frequent)
            }
        }
        .cardBackground()
    }

    private func recommendationSection(_ title: String, systemImage: String, entries: [SearchHistoryEntry]) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Label(title, systemImage: systemImage)
                .aturiLabel()
                .foregroundStyle(theme.textTertiary)
                .padding(.horizontal, 12)
                .padding(.top, 10)
                .padding(.bottom, 4)
                .accessibilityAddTraits(.isHeader)
            ForEach(entries) { entry in
                Button {
                    pick(entry: entry)
                } label: {
                    HStack(spacing: 10) {
                        if let avatar = entry.avatar, !avatar.isEmpty {
                            AvatarView(url: avatar, size: 24)
                        } else {
                            Image(systemName: entry.path.hasPrefix("/explore/pds/") ? "server.rack" : "person")
                                .font(.footnote)
                                .foregroundStyle(theme.textTertiary)
                                .frame(width: 24, height: 24)
                                .background(theme.bgTertiary, in: Circle())
                                .accessibilityHidden(true)
                        }
                        VStack(alignment: .leading, spacing: 2) {
                            Text(entry.label)
                                .font(AturiFont.subtitle)
                                .foregroundStyle(theme.textPrimary)
                                .lineLimit(1)
                            if let sublabel = entry.sublabel, sublabel != entry.label {
                                Text(sublabel)
                                    .font(AturiFont.monoSmall)
                                    .foregroundStyle(theme.textTertiary)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                            }
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 7)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var exampleChips: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                Text("Try:")
                    .font(.footnote)
                    .foregroundStyle(theme.textTertiary)
                if let mine = model.myRepo {
                    exampleChip(mine, systemImage: "person", accented: true)
                        .accessibilityLabel("Your repo, \(mine)")
                }
                ForEach(model.otherExampleRepos, id: \.self) { repo in
                    exampleChip(repo, systemImage: nil, accented: false)
                }
            }
            .padding(.vertical, 2)
        }
    }

    private func exampleChip(_ repo: String, systemImage: String?, accented: Bool) -> some View {
        NavigationLink(value: Route.repo(repo)) {
            HStack(spacing: 4) {
                if let systemImage {
                    Image(systemName: systemImage)
                        .font(.caption2)
                }
                Text(repo)
                    .font(AturiFont.monoSmall)
            }
            .foregroundStyle(theme.textAccent)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(theme.bgTertiary, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .strokeBorder(accented ? theme.textAccent : theme.borderSubtle, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    private func submit() {
        fieldFocused = false
        Task { @MainActor in
            guard let destination = await model.submit() else { return }
            ExploreNavigator.open(destination, router: router, openURL: openURL)
        }
    }

    private func pick(actor: ActorTypeaheadResult) {
        let destination = model.pick(actor: actor)
        fieldFocused = false
        ExploreNavigator.open(destination, router: router, openURL: openURL)
    }

    private func pick(entry: SearchHistoryEntry) {
        let destination = model.pick(entry: entry)
        fieldFocused = false
        ExploreNavigator.open(destination, router: router, openURL: openURL)
    }
}

/// The compact Trending / Top strip on the landing (`TrendingLexicons.tsx`).
/// Only the ranking half of `LexiconsModel` is driven here: `load()` would
/// also pull the 200-row catalog the Lexicons tab needs, so the strip calls
/// `reloadRanking()` itself and refetches on its own toggle changes.
private struct LandingTrendingSection: View {
    let model: LexiconsModel

    @Environment(AppRouter.self) private var router
    @Environment(\.openURL) private var openURL
    @Environment(\.aturiTheme) private var theme

    var body: some View {
        @Bindable var model = model
        VStack(alignment: .leading, spacing: 0) {
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
                Picker("View mode", selection: $model.mode) {
                    ForEach(LexiconRankingMode.allCases, id: \.self) { mode in
                        Text(mode.label).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                HStack(spacing: 8) {
                    Picker("Time window", selection: $model.window) {
                        ForEach(UFOsWindow.allCases, id: \.self) { window in
                            Text(window.label).tag(window)
                        }
                    }
                    .pickerStyle(.segmented)
                    Menu {
                        Picker("Metric", selection: $model.metric) {
                            ForEach(Metric.allCases, id: \.self) { metric in
                                Text(metric.label).tag(metric)
                            }
                        }
                    } label: {
                        Label(model.metric.label, systemImage: "slider.horizontal.3")
                            .font(.footnote)
                            .lineLimit(1)
                    }
                    .accessibilityLabel("Metric, \(model.metric.label)")
                }
            }
            .padding(14)
            Divider()
            content
            Divider()
            HStack(spacing: 4) {
                Text("Data from")
                    .font(.caption2)
                    .foregroundStyle(theme.textTertiary)
                Button("Microcosm") {
                    if let url = URL(string: "https://www.microcosm.blue") {
                        openURL(url)
                    }
                }
                .font(.caption2)
                .buttonStyle(.plain)
                .foregroundStyle(theme.textAccent)
                .accessibilityHint("Opens outside the app")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
        }
        .cardBackground()
        .onChange(of: model.mode) { _, _ in model.reloadRanking() }
        .onChange(of: model.window) { _, _ in model.reloadRanking() }
        .onChange(of: model.metric) { _, _ in model.reloadRanking() }
        .onChange(of: model.expanded) { _, _ in model.reloadRanking() }
    }

    @ViewBuilder
    private var content: some View {
        if let message = model.rankingErrorMessage {
            ErrorPanel(message: "Could not reach the UFOs API: \(message)") {
                model.reloadRanking()
            }
            .padding(12)
        } else if let rows = model.visibleRanking {
            if rows.isEmpty {
                EmptyState(title: LexiconsModel.rankingEmptyMessage)
                    .padding(12)
            } else {
                VStack(spacing: 0) {
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        if index > 0 {
                            Divider()
                        }
                        rankingRow(row, rank: index + 1)
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
            SkeletonRows(count: 6)
                .padding(14)
        }
    }

    private func rankingRow(_ row: LexiconRankingRow, rank: Int) -> some View {
        NavigationLink(value: Route.lexicon(nsid: row.nsid)) {
            HStack(spacing: 10) {
                Text(rank < 10 ? "0\(rank)" : "\(rank)")
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(theme.textTertiary)
                VStack(alignment: .leading, spacing: 1) {
                    Text(row.namespaceHead)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textPrimary)
                        .lineLimit(1)
                    if !row.namespaceTail.isEmpty {
                        Text(row.namespaceTail)
                            .font(AturiFont.monoSmall)
                            .foregroundStyle(theme.textSecondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
                Spacer(minLength: 4)
                UsageSparkline(data: row.series, label: model.rankingSeriesLabel)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(row.valueLabel)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textTertiary)
                    if let delta = row.deltaLabel {
                        Text(delta)
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(delta.hasPrefix("-") ? theme.danger : theme.textAccent)
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(rank), \(row.nsid), \(row.valueLabel) \(model.metric.label)\(row.deltaLabel.map { ", \($0)" } ?? "")")
    }
}
