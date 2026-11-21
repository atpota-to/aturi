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
/// chips, the atmospheric conditions, "This week in the Atmosphere" and the
/// live feed.
private struct ExploreLandingScreen: View {
    let sessionState: SessionState

    @State private var model: ExploreLandingModel
    @State private var conditions = AtmosphericConditionsModel()
    @State private var pulse = AtmospherePulseModel()
    @FocusState private var fieldFocused: Bool

    @Environment(AppRouter.self) private var router
    @Environment(\.openURL) private var openURL
    @Environment(\.aturiTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

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
                AtmosphericConditionsCard(model: conditions)
                AtmospherePulseSection(model: pulse)
                /* The explorer dashboard variant, as `ExploreLanding.tsx`
                   mounts it: every operation with its pill, the op and
                   collection filters and the rolling stats footer. The
                   compact strip is the homepage's. */
                JetstreamView(compact: false)
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(theme.bgPrimary)
        .navigationTitle("Explore")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            /* The web header carries the session menu on every page; the
               landing is where a visitor arrives, so this is the one place
               outside Settings that offers sign-in and shows who is signed
               in. */
            ToolbarItem(placement: .topBarTrailing) {
                SessionBadge()
            }
        }
        .task {
            if pulse.top.isIdle {
                pulse.load()
            }
        }
        .refreshable {
            model.history.reload()
            let reading = conditions.load()
            await pulse.load().value
            await reading.value
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
            Label("Atmosphere explorer", systemImage: "binoculars")
                .aturiLabel()
                .foregroundStyle(theme.textTertiary)
            Text("Browse any repository")
                .font(AturiFont.display)
                .tracking(AturiFont.displayTracking)
                .foregroundStyle(theme.textPrimary)
            /* The web's intro, less "all from the browser". */
            Text("Every account in the Atmosphere keeps its records in a public PDS. Browse collections, inspect identity history, follow backlinks, and edit your own records.")
                .font(AturiFont.body)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var searchArea: some View {
        @Bindable var model = model
        let fieldShape = RoundedRectangle(cornerRadius: 10, style: .continuous)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .foregroundStyle(fieldFocused ? theme.textAccent : theme.textTertiary)
                    TextField("Handle, DID, at:// URI or URL", text: $model.query)
                        .font(AturiFont.body)
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
                    } else {
                        pasteAndGo
                    }
                }
                .padding(.horizontal, 12)
                .frame(minHeight: 48)
                /* The web's search field (globals.css): 10pt corners on the
                   strong edge, turning to the text accent with a 3pt soft
                   halo while focused. */
                .background(theme.bgSecondary, in: fieldShape)
                .overlay(fieldShape.strokeBorder(fieldFocused ? theme.textAccent : theme.borderStrong, lineWidth: 1))
                .background(
                    RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .fill(theme.accentSoft)
                        .padding(-3)
                        .opacity(fieldFocused ? 1 : 0)
                )
                .animation(AturiMotion.animation(.easeOut(duration: AturiMotion.quick), reduceMotion: reduceMotion), value: fieldFocused)

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
                                .font(AturiFont.footnote)
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
                    .font(AturiFont.footnote)
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
                        .font(AturiFont.caption2)
                }
                Text(repo)
                    .font(AturiFont.monoSmall)
            }
            .foregroundStyle(accented ? theme.accentSoftFg : theme.textAccent)
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(accented ? theme.accentSoft : theme.bgSecondary, in: Capsule())
            .overlay(
                Capsule()
                    .strokeBorder(accented ? theme.accentSoftBorder : theme.borderMedium, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    /// The web's Paste and go (5be4163), shown while the field is empty.
    /// The system paste button reads the clipboard without iOS's "allow
    /// paste" prompt. A pasted link or identifier goes straight through;
    /// text with spaces in it stays in the field to be edited.
    private var pasteAndGo: some View {
        PasteButton(payloadType: String.self) { strings in
            guard let text = strings.first?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return }
            Task { @MainActor in
                model.query = text
                if !text.contains(where: \.isWhitespace) {
                    submit()
                }
            }
        }
        .labelStyle(.iconOnly)
        .buttonBorderShape(.capsule)
        .controlSize(.small)
        .accessibilityLabel("Paste and go")
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

/// "Atmospheric conditions", port of `AtmosphericConditions.tsx` (6d89186,
/// slimmed in 3152ca8): the last minute of the whole firehose from
/// atpota.to's weather station in four stats, two to a row as the web lays
/// them out on a phone, with the reading's time and the way out to the full
/// report in the header.
///
/// A new reading every minute, and only while someone can see it: the
/// `.task(id:)` restarts when the card appears and when the scene changes
/// phase, asks for a reading if the last one is a minute old, then once a
/// minute while the scene stays active. SwiftUI cancels it when the scene
/// leaves `.active` or the landing is covered (a pushed page, another tab),
/// as the web stops asking for a hidden tab. A refresh that fails keeps the
/// last reading, whose time says how old it is.
private struct AtmosphericConditionsCard: View {
    let model: AtmosphericConditionsModel

    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.openURL) private var openURL
    @Environment(\.aturiTheme) private var theme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.dynamicTypeSize) private var dynamicTypeSize

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            if model.isDown {
                Text(AtmosphericConditionsModel.downMessage)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(14)
            } else if dynamicTypeSize.isAccessibilitySize {
                /* Accessibility sizes leave no room for two columns. */
                VStack(spacing: 0) {
                    ForEach(Array(model.stats.enumerated()), id: \.element.id) { index, stat in
                        if index > 0 {
                            Divider()
                        }
                        statCell(stat, order: index)
                    }
                }
            } else {
                VStack(spacing: 0) {
                    statRow(model.rightNow, model.againstUsual, firstOrder: 0)
                    Divider()
                    statRow(model.diversity, model.hosting, firstOrder: 2)
                }
            }
        }
        .cardBackground()
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            model.refreshIfStale()
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(AtmosphericConditionsModel.refreshInterval))
                guard !Task.isCancelled else { return }
                model.refreshIfStale()
            }
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(AtmosphericConditionsModel.title)
                    .font(AturiFont.subtitle)
                    .foregroundStyle(theme.textPrimary)
                Text(AtmosphericConditionsModel.subtitle)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                if let measuredAt = model.measuredAt {
                    updatedLabel(measuredAt)
                }
                Spacer(minLength: 0)
                Button {
                    openURL(AtpotatoWeather.weatherReportURL)
                } label: {
                    HStack(spacing: 3) {
                        Text(AtmosphericConditionsModel.reportLinkLabel)
                        Image(systemName: "arrow.up.right")
                            .imageScale(.small)
                    }
                    .font(AturiFont.sans(.footnote, weight: .semibold))
                    .foregroundStyle(theme.textAccent)
                }
                .buttonStyle(.plain)
                .accessibilityHint("Opens outside the app")
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    /// "Updated 7:17 PM" in the device's own clock format, behind the live
    /// dot. The dot holds still and bounces once when a new reading lands;
    /// a refresh that failed keeps the old time, so it stays still.
    private func updatedLabel(_ measuredAt: Date) -> some View {
        HStack(spacing: 5) {
            Image(systemName: "circle.fill")
                .font(AturiFont.caption2)
                .imageScale(.small)
                .foregroundStyle(theme.statusLive)
                .symbolEffect(.bounce, options: .nonRepeating, value: reduceMotion ? "" : (model.reading?.measuredAt ?? ""))
                .accessibilityHidden(true)
            Text("Updated \(measuredAt, format: .dateTime.hour().minute())")
                .font(AturiFont.caption)
                .monospacedDigit()
                .foregroundStyle(theme.textTertiary)
        }
    }

    /// Two stats side by side with a hairline between, the row as tall as
    /// the taller of them.
    private func statRow(_ leading: AtmosphericStat, _ trailing: AtmosphericStat, firstOrder: Int) -> some View {
        HStack(alignment: .top, spacing: 0) {
            statCell(leading, order: firstOrder)
            Divider()
            statCell(trailing, order: firstOrder + 1)
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    /// One stat: the label, then the figure with its level and the line
    /// under it, or skeleton bars until the first load lands. When it does,
    /// each stat's figures rise into place 70ms after the one before, as
    /// the web's `Stat` does; Reduce Motion drops the rise.
    private func statCell(_ stat: AtmosphericStat, order: Int) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(stat.label)
                .font(AturiFont.sans(.caption, weight: .semibold))
                .foregroundStyle(theme.textTertiary)
            if model.hasLoaded {
                VStack(alignment: .leading, spacing: 4) {
                    valueLine(stat)
                    Text(stat.note)
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .transition(AnyTransition.opacity.combined(with: AnyTransition.offset(y: 4)))
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    SkeletonBar(width: 72, height: 22, cornerRadius: 6)
                    SkeletonBar(width: 120, height: 10)
                }
                .padding(.top, 2)
                .accessibilityHidden(true)
            }
        }
        .padding(.horizontal, 14)
        .padding(.top, 12)
        .padding(.bottom, 14)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .animation(
            AturiMotion.animation(AturiMotion.soft(AturiMotion.panel).delay(Double(order) * 0.07), reduceMotion: reduceMotion),
            value: model.hasLoaded
        )
        .accessibilityElement(children: .combine)
    }

    /// The figure, a dash when its part is missing, with its level beside
    /// it. Figures roll to each new reading; the condition is a word.
    private func valueLine(_ stat: AtmosphericStat) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(stat.value ?? "\u{2013}")
                .font(AturiFont.sans(.title2, weight: .bold))
                .tracking(-0.4)
                .monospacedDigit()
                .foregroundStyle(stat.value == nil ? theme.textTertiary : theme.textPrimary)
                .contentTransition(.numericText())
                .animation(AturiMotion.animation(AturiMotion.soft(AturiMotion.arrive), reduceMotion: reduceMotion), value: stat.value)
            if stat.value != nil, let level = stat.level {
                Text(level)
                    .font(AturiFont.sans(.footnote, weight: .semibold))
                    .foregroundStyle(theme.textAccent)
                    .lineLimit(1)
                    .minimumScaleFactor(0.8)
            }
        }
    }
}

/// "This week in the Atmosphere", port of `AtmospherePulse.tsx`: one metric
/// and one window control over three cards, Most active (a log-scaled bar
/// and the change against the window before), Rising ("prior → now") and
/// New this week. Each card's foot leads to the Lexicons tab, where the
/// full strip and its sparklines live. The web lays the cards side by side;
/// a phone stacks them.
private struct AtmospherePulseSection: View {
    let model: AtmospherePulseModel

    @Environment(AppRouter.self) private var router
    @Environment(\.aturiTheme) private var theme

    var body: some View {
        @Bindable var model = model
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                Text(model.heading)
                    .font(AturiFont.title)
                    .tracking(AturiFont.titleTracking)
                    .foregroundStyle(theme.textPrimary)
                Text(model.headingDetail)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            Picker("Metric", selection: $model.metric) {
                ForEach(Metric.allCases, id: \.self) { metric in
                    Text(metric.label).tag(metric)
                }
            }
            .pickerStyle(.segmented)
            Picker("Time window", selection: $model.window) {
                ForEach(UFOsWindow.allCases, id: \.self) { window in
                    Text(AtmospherePulseModel.windowLabel(window)).tag(window)
                }
            }
            .pickerStyle(.segmented)

            pulseCard(title: "Most active", subtitle: model.topSubtitle) {
                cardBody(rows: model.visibleTop, error: model.topErrorMessage, empty: AtmospherePulseModel.rankingEmptyMessage) { rows in
                    let max = rows.map(\.value).max() ?? 1
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        if index > 0 { Divider() }
                        activeRow(row, rank: index + 1, max: max)
                    }
                }
            } foot: {
                cardFoot(
                    toggle: model.showsTopToggle ? (model.topToggleLabel, { self.model.topExpanded.toggle() }) : nil,
                    linkLabel: "All lexicons"
                )
            }

            pulseCard(title: "Rising", subtitle: model.risingSubtitle) {
                cardBody(rows: model.visibleRising, error: model.risingErrorMessage, empty: AtmospherePulseModel.rankingEmptyMessage) { rows in
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                        if index > 0 { Divider() }
                        risingRow(row, rank: index + 1)
                    }
                }
            } foot: {
                cardFoot(
                    toggle: model.showsRisingToggle ? (model.risingToggleLabel, { self.model.risingExpanded.toggle() }) : nil,
                    linkLabel: "All rising lexicons"
                )
            }

            pulseCard(title: model.newTitle, subtitle: model.newSubtitle) {
                cardBody(rows: model.visibleNew, error: model.newErrorMessage, empty: AtmospherePulseModel.newEmptyMessage) { rows in
                    ForEach(Array(rows.enumerated()), id: \.element.id) { index, lexicon in
                        if index > 0 { Divider() }
                        newRow(lexicon, rank: index + 1)
                    }
                }
            } foot: {
                cardFoot(
                    toggle: model.showsNewToggle ? (model.newToggleLabel, { self.model.newExpanded.toggle() }) : nil,
                    linkLabel: "All new lexicons",
                    opensNewLexicons: true
                )
            }

            MicrocosmCredit()
        }
    }

    // MARK: Card frame

    private func pulseCard<Content: View, Foot: View>(
        title: String,
        subtitle: String,
        @ViewBuilder content: () -> Content,
        @ViewBuilder foot: () -> Foot
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(AturiFont.subtitle)
                    .foregroundStyle(theme.textPrimary)
                Text(subtitle)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            Divider()
            content()
            Divider()
            foot()
        }
        .cardBackground()
    }

    /// The previous rows stay up while a toggle refetches; the skeleton is
    /// for the first load only.
    @ViewBuilder
    private func cardBody<Row, Rows: View>(
        rows: [Row]?,
        error: String?,
        empty: String,
        @ViewBuilder content: @escaping ([Row]) -> Rows
    ) -> some View {
        if let error {
            ErrorPanel(message: error) {
                model.load()
            }
            .padding(12)
        } else if let rows {
            if rows.isEmpty {
                Text(empty)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(14)
            } else {
                VStack(spacing: 0) {
                    content(rows)
                }
            }
        } else {
            SkeletonRows(count: 5)
                .padding(14)
        }
    }

    /// `opensNewLexicons` is the web's `/explore/lexicons#new`: the Lexicons
    /// tab at its root with the New section showing.
    private func cardFoot(toggle: (String, () -> Void)?, linkLabel: String, opensNewLexicons: Bool = false) -> some View {
        HStack(spacing: 12) {
            if let toggle {
                Button(toggle.0, action: toggle.1)
                    .font(AturiFont.sans(.footnote, weight: .semibold))
                    .buttonStyle(.plain)
                    .foregroundStyle(theme.textSecondary)
            }
            Spacer(minLength: 0)
            Button {
                if opensNewLexicons {
                    router.showNewLexicons()
                } else {
                    router.select(.lexicons)
                }
            } label: {
                Text(linkLabel)
                    .font(AturiFont.sans(.footnote, weight: .semibold))
                    .foregroundStyle(theme.textAccent)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens the Lexicons tab")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    // MARK: Rows

    private func rankText(_ rank: Int) -> some View {
        Text("\(rank)")
            .font(AturiFont.monoSmall)
            .monospacedDigit()
            .foregroundStyle(theme.textTertiary)
            .frame(minWidth: 20, alignment: .leading)
    }

    /// Rank, the NSID over its log-scaled bar, the full count and the
    /// change against the window before.
    private func activeRow(_ row: LexiconRankingRow, rank: Int, max: Int) -> some View {
        NavigationLink(value: Route.lexicon(nsid: row.nsid)) {
            HStack(spacing: 10) {
                rankText(rank)
                VStack(alignment: .leading, spacing: 5) {
                    NsidSplitText(row.nsid)
                    Capsule()
                        .fill(theme.bgTertiary)
                        .frame(height: 3)
                        .overlay(alignment: .leading) {
                            GeometryReader { geometry in
                                Capsule()
                                    .fill(theme.accent)
                                    .frame(width: geometry.size.width * AtmospherePulseModel.barFraction(row.value, max: max))
                            }
                        }
                        .accessibilityHidden(true)
                }
                Spacer(minLength: 6)
                VStack(alignment: .trailing, spacing: 3) {
                    Text(row.value.formatted())
                        .font(AturiFont.monoSmall)
                        .monospacedDigit()
                        .foregroundStyle(theme.textPrimary)
                        .contentTransition(.numericText(value: Double(row.value)))
                    DeltaText(pct: row.deltaPct)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu { LexiconRowMenu(nsid: row.nsid) }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(rank), \(row.nsid), \(row.value.formatted()) \(model.metricUnit)\(row.deltaLabel.map { ", \($0)" } ?? "")")
    }

    /// Rank, the NSID, and "prior → now".
    private func risingRow(_ row: LexiconRankingRow, rank: Int) -> some View {
        let prior = row.prior ?? 0
        return NavigationLink(value: Route.lexicon(nsid: row.nsid)) {
            HStack(spacing: 10) {
                rankText(rank)
                NsidSplitText(row.nsid)
                Spacer(minLength: 6)
                HStack(spacing: 4) {
                    Text("\(prior.formatted()) \u{2192}")
                        .foregroundStyle(theme.textTertiary)
                    Text(row.value.formatted())
                        .fontWeight(.semibold)
                        .foregroundStyle(theme.textPrimary)
                }
                .font(AturiFont.monoSmall)
                .monospacedDigit()
                .lineLimit(1)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu { LexiconRowMenu(nsid: row.nsid) }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(rank), \(row.nsid), \(prior.formatted()) to \(row.value.formatted()) \(model.metricUnit)")
    }

    /// Rank, the NSID and how many accounts wrote it.
    private func newRow(_ lexicon: NewLexicon, rank: Int) -> some View {
        NavigationLink(value: Route.lexicon(nsid: lexicon.nsid)) {
            HStack(spacing: 10) {
                rankText(rank)
                NsidSplitText(lexicon.nsid)
                Spacer(minLength: 6)
                Text(lexicon.didsEstimate.formatted())
                    .font(AturiFont.monoSmall)
                    .monospacedDigit()
                    .foregroundStyle(theme.textPrimary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .contextMenu { LexiconRowMenu(nsid: lexicon.nsid) }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(rank), \(lexicon.nsid), \(lexicon.didsEstimate.formatted()) accounts, \(lexicon.creates.formatted()) records")
    }
}
