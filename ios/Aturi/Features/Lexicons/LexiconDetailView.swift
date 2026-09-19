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
    @Environment(\.openURL) private var openURL
    @Environment(\.aturiTheme) private var theme

    init(nsid: String) {
        _model = State(initialValue: LexiconDetailModel(nsid: nsid))
    }

    private var schemaRoute: Route? {
        Route(explorePath: model.schemaPath)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                headerCard
                windowPicker
                statTiles
                chartCard
                if let notice = model.noActivityMessage {
                    Text(notice)
                        .font(.footnote)
                        .foregroundStyle(theme.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
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
            if let schemaRoute {
                NavigationLink(value: schemaRoute) {
                    Label("View schema record", systemImage: "doc.text")
                }
                .buttonStyle(.aturiSecondary)
            }
            CopyRow(label: "NSID", value: model.nsid)
        }
        .padding(16)
        .cardBackground()
    }

    private var windowPicker: some View {
        @Bindable var model = model
        return HStack(spacing: 8) {
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
                    .font(.footnote)
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
                        .font(.footnote)
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
                                    .font(.footnote)
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
                        .font(.footnote)
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
                        .font(.footnote)
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
            .cardBackground(cornerRadius: 10)
        }
    }

    private func submitSearch() {
        guard let destination = model.submitSearch() else { return }
        ExploreNavigator.open(destination, router: router, openURL: openURL)
    }
}
