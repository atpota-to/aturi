import SwiftUI
import Observation
import AturiCore

/// The per-lexicon page (`/explore/lexicons/{nsid}`), port of
/// `LexiconDetail.tsx`: the header with the group and publisher, the
/// window toggle, four stat tiles with deltas against the prior window,
/// the trend chart, sibling collections and recent record samples, all
/// from the UFOs API. Any string loads; an unknown NSID shows empty states
/// rather than an error.
struct LexiconDetailView: View {
    @State private var model: LexiconDetailModel

    @Environment(AppRouter.self) private var router
    @Environment(PreferencesStore.self) private var preferences
    @Environment(\.openURL) private var openURL
    @Environment(\.aturiTheme) private var theme

    init(nsid: String) {
        _model = State(initialValue: LexiconDetailModel(nsid: nsid))
    }

    private var schemaRoute: Route? {
        Route(explorePath: model.schemaPath)
    }

    /// The site the namespace's app most likely lives at, guessed from the
    /// NSID as the web's `AppSiteLink` does.
    private var appDomain: String? {
        NSID.appDomainFor(NSID.groupPrefix(model.nsid))
    }

    private var isPinned: Bool {
        preferences.prefs.lexiconExplorerPins.contains(model.nsid)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                headerCard
                windowPicker
                statTiles
                chartCard
                siblingsCard
                samplesCard
                searchCard
                MicrocosmCredit()
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(theme.bgPrimary)
        .navigationTitle(model.nsid)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            /* Pin, as the web's lexicon pane has it: kept at the top of the
               Lexicons tab, synced with the rest of the preferences, and
               apart from the account explorer's pinned collections. */
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    preferences.update { $0.toggleLexiconExplorerPin(model.nsid) }
                } label: {
                    Image(systemName: isPinned ? "pin.fill" : "pin")
                }
                .accessibilityLabel(isPinned ? "Unpin this lexicon" : "Pin this lexicon")
            }
            if let url = Route.lexicon(nsid: model.nsid).webURL {
                ToolbarItem(placement: .topBarTrailing) {
                    ShareLink(item: url) {
                        Image(systemName: "square.and.arrow.up")
                    }
                    .accessibilityLabel("Share")
                }
            }
        }
        .task {
            if model.activity.isIdle {
                model.load()
            }
        }
        .refreshable {
            await model.load().value
        }
    }

    // MARK: Header

    private var headerCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Lexicon", systemImage: "square.stack.3d.up")
                .aturiLabel()
                .foregroundStyle(theme.textAccent)
            Text(model.nsid)
                .font(AturiFont.mono)
                .foregroundStyle(theme.textPrimary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 16) {
                HStack(spacing: 4) {
                    Text("group")
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textTertiary)
                    NavigationLink(value: Route.lexiconGroup(prefix: model.group)) {
                        Text(model.group)
                            .font(AturiFont.monoSmall)
                            .foregroundStyle(theme.textAccent)
                            .lineLimit(1)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Group \(model.group)")
                }
                HStack(spacing: 4) {
                    Text("publisher")
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textTertiary)
                    Text(model.publisher)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textSecondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            /* Side by side where they fit, stacked where they don't. */
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 8) { headerActions }
                VStack(alignment: .leading, spacing: 8) { headerActions }
            }
            CopyRow(label: "NSID", value: model.nsid)
        }
        .padding(16)
        .cardBackground()
    }

    /// The schema record, the app's site, and Watch: the web's "View
    /// schema record" and `AppSiteLink`, plus the lexicon pane's Watch,
    /// which opens the live feed narrowed to this lexicon.
    @ViewBuilder
    private var headerActions: some View {
        if let schemaRoute {
            NavigationLink(value: schemaRoute) {
                Label("View schema record", systemImage: "doc.text")
            }
            .buttonStyle(.aturiSecondary)
        }
        if let appDomain, let url = URL(string: "https://\(appDomain)") {
            Button {
                openURL(url)
            } label: {
                Label("Visit \(appDomain)", systemImage: "arrow.up.right.square")
                    .lineLimit(1)
            }
            .buttonStyle(.aturiSecondary)
            .accessibilityHint("\(appDomain), inferred from the NSID. Opens outside the app")
        }
        NavigationLink {
            LexiconLiveView(nsid: model.nsid)
        } label: {
            Label("Watch", systemImage: "dot.radiowaves.left.and.right")
        }
        .buttonStyle(.aturiSecondary)
        .accessibilityHint("New records of this lexicon as they arrive")
    }

    private var windowPicker: some View {
        @Bindable var model = model
        return HStack(spacing: 8) {
            /* Labelled, as the web's is: it governs the tiles and chart. */
            Text("Last \(model.window.label) \u{00B7} change vs the \(model.window.label) before")
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textTertiary)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if model.isActivityRefreshing {
                ProgressView()
                    .controlSize(.small)
            }
            Picker("Time window", selection: $model.window) {
                ForEach(UFOsWindow.allCases, id: \.self) { window in
                    Text(window.label).tag(window)
                }
            }
            .pickerStyle(.segmented)
            .frame(maxWidth: 200)
        }
    }

    // MARK: Stat tiles

    @ViewBuilder
    private var statTiles: some View {
        if let message = model.activityErrorMessage, model.statTiles == nil {
            ErrorPanel(message: message) {
                model.reloadActivity()
            }
        } else {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 140), spacing: 8)], spacing: 8) {
                if let tiles = model.statTiles {
                    ForEach(tiles) { tile in
                        statTile(tile)
                    }
                } else {
                    ForEach(LexiconDetailModel.metricOrder, id: \.self) { metric in
                        skeletonTile(metric)
                    }
                }
            }
        }
    }

    private func statTile(_ tile: LexiconStatTile) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(tile.label)
                .aturiLabel()
                .foregroundStyle(theme.textTertiary)
            Text(tile.valueLabel)
                .font(AturiFont.title)
                .tracking(AturiFont.titleTracking)
                .monospacedDigit()
                .foregroundStyle(theme.textPrimary)
            DeltaText(pct: tile.deltaPct, showsNew: false)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(
            "\(tile.label): \(tile.current.formatted())"
                + (tile.deltaLabel.map { ", \($0) against the prior window" } ?? "")
        )
    }

    private func skeletonTile(_ metric: Metric) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(metric.label)
                .aturiLabel()
                .foregroundStyle(theme.textTertiary)
            RoundedRectangle(cornerRadius: 4, style: .continuous)
                .fill(theme.bgTertiary)
                .frame(width: 56, height: 22)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(metric.label), loading")
    }

    // MARK: Trend chart

    private var chartCard: some View {
        @Bindable var model = model
        return VStack(alignment: .leading, spacing: 12) {
            Text(model.chartTitle)
                .aturiLabel()
                .foregroundStyle(theme.textTertiary)
                .accessibilityAddTraits(.isHeader)
            Picker("Metric", selection: $model.metric) {
                ForEach(LexiconDetailModel.metricOrder, id: \.self) { metric in
                    Text(metric.label).tag(metric)
                }
            }
            .pickerStyle(.segmented)
            chart
        }
        .padding(14)
        .cardBackground()
    }

    @ViewBuilder
    private var chart: some View {
        switch model.activity {
        case .idle, .loading:
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(theme.bgTertiary)
                .frame(maxWidth: .infinity)
                .frame(height: 120)
                .accessibilityLabel("Loading")
        case .failed(let message):
            ErrorPanel(message: model.activityErrorMessage ?? message) {
                model.reloadActivity()
            }
        case .loaded:
            if model.hasSeriesActivity {
                ActivityBars(data: model.series, label: model.chartTitle)
            } else {
                Text(LexiconDetailModel.chartEmptyMessage)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textTertiary)
                    .frame(maxWidth: .infinity, minHeight: 80, alignment: .leading)
            }
        }
    }

    // MARK: Siblings

    private var siblingsCard: some View {
        LexiconSectionCard("Collections in this group", systemImage: "arrow.triangle.branch") {
            LexiconCardBody(state: model.siblings, skeletonRows: 4, retry: { model.reloadSections() }) { siblings in
                if siblings.isEmpty {
                    Text(model.siblingsEmptyMessage)
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(14)
                } else {
                    VStack(spacing: 0) {
                        ForEach(Array(siblings.enumerated()), id: \.element.nsid) { index, sibling in
                            if index > 0 {
                                Divider()
                            }
                            siblingRow(sibling)
                        }
                        if let label = model.browseGroupLabel {
                            Divider()
                            NavigationLink(value: Route.lexiconGroup(prefix: model.groupPrefix)) {
                                Text(label)
                                    .font(AturiFont.footnote)
                                    .foregroundStyle(theme.textAccent)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(.horizontal, 14)
                                    .padding(.vertical, 10)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
        }
    }

    private func siblingRow(_ sibling: NsidCount) -> some View {
        NavigationLink(value: Route.lexicon(nsid: sibling.nsid)) {
            HStack(spacing: 10) {
                NsidSplitText(sibling.nsid)
                Spacer(minLength: 8)
                LexiconCountText(value: sibling.counts.creates, unit: "creates")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .contextMenu {
            LexiconRowMenu(nsid: sibling.nsid)
        }
    }

    // MARK: Recent records

    private var samplesCard: some View {
        LexiconSectionCard("Recent records", systemImage: "doc.text") {
            LexiconCardBody(state: model.samples, skeletonRows: 5, retry: { model.reloadSections() }) { _ in
                if let rows = model.visibleSamples, !rows.isEmpty {
                    VStack(spacing: 0) {
                        ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                            if index > 0 {
                                Divider()
                            }
                            sampleRow(row)
                        }
                    }
                } else {
                    Text(LexiconDetailModel.samplesEmptyMessage)
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(14)
                }
            }
        }
    }

    private func sampleRow(_ row: LexiconSampleRow) -> some View {
        let age = row.relativeTime()
        let content = HStack(alignment: .firstTextBaseline, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 0) {
                    Text(row.didLabel)
                        .foregroundStyle(theme.textSecondary)
                    Text(" / \(row.rkey)")
                        .foregroundStyle(theme.textTertiary)
                }
                .font(AturiFont.monoSmall)
                .lineLimit(1)
                .truncationMode(.middle)
                if !row.preview.isEmpty {
                    Text(row.preview)
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textPrimary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 8)
            Text(age)
                .font(AturiFont.monoSmall)
                .foregroundStyle(theme.textTertiary)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .contentShape(Rectangle())

        return Group {
            if let path = row.explorerPath, let route = Route(explorePath: path) {
                NavigationLink(value: route) {
                    content
                }
                .buttonStyle(.plain)
            } else {
                content
            }
        }
        .accessibilityElement(children: .combine)
    }

    // MARK: Search

    private var searchCard: some View {
        @Bindable var model = model
        return VStack(alignment: .leading, spacing: 8) {
            SectionHeader("Find another lexicon")
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(theme.textTertiary)
                TextField("Search lexicons", text: $model.search)
                    .font(AturiFont.monoSmall)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .submitLabel(.search)
                    .onSubmit(submitSearch)
                    .accessibilityLabel("Search lexicons")
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .cardBackground(cornerRadius: AturiTheme.controlRadius)
        }
    }

    private func submitSearch() {
        guard let destination = model.submitSearch() else { return }
        ExploreNavigator.open(destination, router: router, openURL: openURL)
    }
}

/// A lexicon's Watch: the live Jetstream feed narrowed to its records, the
/// phone's stand-in for the web's stream monitor opened with
/// `?collection=`.
private struct LexiconLiveView: View {
    let nsid: String

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        ScrollView {
            JetstreamView(compact: false, collections: [nsid], startsLive: true)
                .padding(16)
        }
        .background(theme.bgPrimary)
        .navigationTitle("Live")
        .navigationBarTitleDisplayMode(.inline)
    }
}
