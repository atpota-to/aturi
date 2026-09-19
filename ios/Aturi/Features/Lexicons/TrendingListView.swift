import SwiftUI
import Observation
import AturiCore

/// The compact Trending / Top strip for the Explore landing: the ranked
/// rows and the mode toggle, with the window and metric left at their
/// defaults and a link into the Lexicons tab for the full controls. Only
/// the ranking half of `LexiconsModel` is driven, since `load()` would
/// also pull the 200-row catalog the tab needs.
struct TrendingListView: View {
    let limit: Int

    @State private var model: LexiconsModel

    @Environment(AppRouter.self) private var router
    @Environment(\.aturiTheme) private var theme

    init(limit: Int = 5) {
        self.limit = max(1, limit)
        let model = LexiconsModel()
        /* The strip fetches `rankingLimit` rows; a caller asking for more
           than the collapsed count needs the expanded pool from the first
           fetch, and setting the flag before it costs no extra request. */
        model.expanded = limit > LexiconsModel.resultCount
        _model = State(initialValue: model)
    }

    private var shownRows: [LexiconRankingRow]? {
        model.visibleRanking.map { Array($0.prefix(limit)) }
    }

    var body: some View {
        @Bindable var model = model
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Label(model.rankingTitle, systemImage: model.mode == .trending ? "sparkles" : "chart.bar")
                    .font(AturiFont.subtitle)
                    .foregroundStyle(theme.textPrimary)
                    .lineLimit(1)
                Spacer(minLength: 4)
                if model.isRankingRefreshing {
                    ProgressView()
                        .controlSize(.small)
                }
                Picker("Ranking", selection: $model.mode) {
                    ForEach(LexiconRankingMode.allCases, id: \.self) { mode in
                        Text(mode.label).tag(mode)
                    }
                }
                .pickerStyle(.segmented)
                .frame(maxWidth: 160)
            }
            .padding(14)
            Divider()
            content
            Divider()
            Button {
                router.select(.lexicons)
            } label: {
                HStack(spacing: 4) {
                    Text("Explore all lexicons")
                    Image(systemName: "arrow.up.right")
                        .font(.caption2)
                }
                .font(.footnote)
                .foregroundStyle(theme.textAccent)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens the Lexicons tab")
        }
        .cardBackground()
        .task {
            if model.ranking.isIdle {
                model.reloadRanking()
            }
        }
        /* `load()` never runs here, so the model's own refetch-on-toggle
           stays disarmed; the strip refetches for its one toggle itself. */
        .onChange(of: model.mode) { _, _ in
            model.reloadRanking()
        }
    }

    @ViewBuilder
    private var content: some View {
        if let message = model.rankingErrorMessage {
            ErrorPanel(message: message) {
                model.reloadRanking()
            }
            .padding(12)
        } else if let rows = shownRows {
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
                }
            }
        } else {
            SkeletonRows(count: min(limit, 6))
                .padding(14)
        }
    }
}
