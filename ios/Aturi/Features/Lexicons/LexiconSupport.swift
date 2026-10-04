import SwiftUI
import UIKit
import AturiCore

/// The NSID cell of every lexicon row: the top-2-segment namespace stacked
/// over the remainder, so `app.bsky.feed.post` stays readable at phone
/// width instead of ellipsizing. Port of `NsidLabel` in TrendingLexicons.tsx.
struct NsidSplitText: View {
    let nsid: String

    @Environment(\.aturiTheme) private var theme

    init(_ nsid: String) {
        self.nsid = nsid
    }

    private var parts: (head: String, tail: String) {
        NSID.splitNsid(nsid)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 1) {
            Text(parts.head)
                .font(AturiFont.monoSmall)
                .foregroundStyle(theme.textPrimary)
                .lineLimit(1)
                .truncationMode(.middle)
            if !parts.tail.isEmpty {
                Text(parts.tail)
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(theme.textSecondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(nsid)
    }
}

/// The percent change against the prior window: an arrow and the signed
/// figure, accent for growth and danger for decline. A row without prior
/// data reads "new" where the web's `DeltaPill` does; the stat tiles pass
/// `showsNew: false` because they show nothing there instead.
struct DeltaText: View {
    let pct: Double?
    var showsNew: Bool = true

    @Environment(\.aturiTheme) private var theme

    init(pct: Double?, showsNew: Bool = true) {
        self.pct = pct
        self.showsNew = showsNew
    }

    var body: some View {
        if let pct, pct.isFinite {
            pill(pct)
        } else if showsNew {
            Text("new")
                .font(AturiFont.monoSmall)
                .foregroundStyle(theme.textTertiary)
        }
    }

    private func pill(_ pct: Double) -> some View {
        let positive = pct >= 0
        let figure = UFOsFormat.formatPct(pct)
        return HStack(spacing: 2) {
            Image(systemName: positive ? "arrow.up.right" : "arrow.down.right")
                .font(.caption2)
                .accessibilityHidden(true)
            Text(figure)
                .font(.caption2.weight(.medium).monospacedDigit())
        }
        .foregroundStyle(positive ? theme.textAccent : theme.danger)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(positive ? "Up" : "Down") \(figure) against the prior window")
    }
}

/// A compact count (`1.2k`) with the exact figure for VoiceOver.
struct LexiconCountText: View {
    let value: Int
    let unit: String

    @Environment(\.aturiTheme) private var theme

    init(value: Int, unit: String) {
        self.value = value
        self.unit = unit
    }

    var body: some View {
        Text(UFOsFormat.formatCount(value))
            .font(AturiFont.monoSmall)
            .monospacedDigit()
            .foregroundStyle(theme.textTertiary)
            .lineLimit(1)
            .accessibilityLabel("\(value.formatted()) \(unit)")
    }
}

/// A bar chart of timeseries buckets, one bar per bucket, drawn with
/// `Canvas` so it costs a single pass and needs no charting framework.
/// Bars scale to the tallest bucket; an empty bucket keeps its slot so the
/// window's shape stays honest, and a bucket with any activity gets at
/// least a sliver so it does not vanish next to a spike.
struct ActivityBars: View {
    let data: [Int]
    let label: String
    var height: CGFloat = 120

    @Environment(\.aturiTheme) private var theme

    init(data: [Int], label: String, height: CGFloat = 120) {
        self.data = data
        self.label = label
        self.height = height
    }

    private var summary: String {
        let peak = data.max() ?? 0
        let total = data.reduce(0, +)
        return "\(data.count) buckets, peak \(peak.formatted()), total \(total.formatted())"
    }

    var body: some View {
        let accent = theme.accent
        let baseline = theme.borderSubtle
        Canvas { context, size in
            context.fill(
                Path(CGRect(x: 0, y: size.height - 1, width: size.width, height: 1)),
                with: .color(baseline)
            )
            let count = data.count
            guard count > 0 else { return }
            let maxValue = CGFloat(max(data.max() ?? 0, 1))
            let gap: CGFloat = count > 40 ? 1 : 2
            let slot = size.width / CGFloat(count)
            let barWidth = max(slot - gap, 1)
            for (index, value) in data.enumerated() where value > 0 {
                let barHeight = max(size.height * CGFloat(value) / maxValue, 2)
                let rect = CGRect(
                    x: CGFloat(index) * slot,
                    y: size.height - barHeight,
                    width: barWidth,
                    height: barHeight
                )
                context.fill(Path(roundedRect: rect, cornerRadius: 1), with: .color(accent))
            }
        }
        .frame(maxWidth: .infinity)
        .frame(height: height)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue(summary)
    }
}

/// The "Data from microcosm.blue" line every UFOs-backed screen ends with.
struct MicrocosmCredit: View {
    @Environment(\.openURL) private var openURL
    @Environment(\.aturiTheme) private var theme

    private static let site = URL(string: "https://www.microcosm.blue")

    var body: some View {
        HStack(spacing: 4) {
            Text("Data from")
                .aturiLabel()
                .foregroundStyle(theme.textTertiary)
            Button("microcosm.blue") {
                if let url = Self.site {
                    openURL(url)
                }
            }
            .aturiLabel()
            .buttonStyle(.plain)
            .foregroundStyle(theme.textAccent)
            .accessibilityHint("Opens outside the app")
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }
}

/// A card with the web's small-caps section heading: an accent icon, the
/// title, a hairline, then the caller's rows flush against the edges.
struct LexiconSectionCard<Content: View>: View {
    let title: String
    let systemImage: String
    let content: Content

    @Environment(\.aturiTheme) private var theme

    init(_ title: String, systemImage: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.systemImage = systemImage
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Image(systemName: systemImage)
                    .font(.caption)
                    .foregroundStyle(theme.textAccent)
                    .accessibilityHidden(true)
                Text(title)
                    .aturiLabel()
                    .foregroundStyle(theme.textTertiary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            Divider()
            content
        }
        .cardBackground()
    }
}

/// The body of a section card in its three states: a padded skeleton, the
/// error panel with the UFOs wording the models use, or the rows.
struct LexiconCardBody<Value, Content: View>: View {
    let state: Loadable<Value>
    let skeletonRows: Int
    let retry: () -> Void
    let content: (Value) -> Content

    init(
        state: Loadable<Value>,
        skeletonRows: Int = 4,
        retry: @escaping () -> Void,
        @ViewBuilder content: @escaping (Value) -> Content
    ) {
        self.state = state
        self.skeletonRows = skeletonRows
        self.retry = retry
        self.content = content
    }

    var body: some View {
        switch state {
        case .idle, .loading:
            SkeletonRows(count: skeletonRows)
                .padding(14)
        case .failed(let message):
            ErrorPanel(message: "Couldn't reach the UFOs API: \(message)", retry: retry)
                .padding(12)
        case .loaded(let value):
            content(value)
        }
    }
}

/// The long-press actions of a lexicon row: its namespace group, its
/// schema record on the publisher's repo, and a copy of the NSID.
struct LexiconRowMenu: View {
    let nsid: String

    @Environment(AppRouter.self) private var router

    init(nsid: String) {
        self.nsid = nsid
    }

    private var group: String {
        NSID.namespaceKey(nsid)
    }

    var body: some View {
        Button {
            router.open(.lexiconGroup(prefix: group))
        } label: {
            Label("Browse \(group)", systemImage: "folder")
        }
        if let route = Route(explorePath: NSID.schemaPathFor(nsid)) {
            Button {
                router.open(route)
            } label: {
                Label("View schema record", systemImage: "doc.text")
            }
        }
        Button {
            UIPasteboard.general.string = nsid
        } label: {
            Label("Copy NSID", systemImage: "doc.on.doc")
        }
    }
}

/// One row of the Trending / Top strip, shared by the Lexicons tab and the
/// landing's compact list: rank, the split NSID, the sparkline, the count
/// and, in Trending, the delta. Tapping opens the lexicon's detail page.
struct LexiconRankingRowView: View {
    let row: LexiconRankingRow
    let rank: Int
    let mode: LexiconRankingMode
    let metric: Metric
    let seriesLabel: String

    @Environment(\.aturiTheme) private var theme

    init(row: LexiconRankingRow, rank: Int, mode: LexiconRankingMode, metric: Metric, seriesLabel: String) {
        self.row = row
        self.rank = rank
        self.mode = mode
        self.metric = metric
        self.seriesLabel = seriesLabel
    }

    private var rankLabel: String {
        rank < 10 ? "0\(rank)" : "\(rank)"
    }

    private var accessibilityLabel: String {
        var label = "\(rank), \(row.nsid), \(row.value.formatted()) \(metric.label.lowercased())"
        if mode == .trending {
            label += ", " + (row.deltaLabel.map { "\($0) against the prior window" } ?? "new")
        }
        return label
    }

    var body: some View {
        NavigationLink(value: Route.lexicon(nsid: row.nsid)) {
            HStack(spacing: 10) {
                Text(rankLabel)
                    .font(AturiFont.monoSmall)
                    .monospacedDigit()
                    .foregroundStyle(theme.textTertiary)
                NsidSplitText(row.nsid)
                Spacer(minLength: 4)
                UsageSparkline(data: row.series, label: seriesLabel)
                VStack(alignment: .trailing, spacing: 2) {
                    LexiconCountText(value: row.value, unit: metric.label.lowercased())
                    if mode == .trending {
                        DeltaText(pct: row.deltaPct)
                    }
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
        .accessibilityAddTraits(.isButton)
        .contextMenu {
            LexiconRowMenu(nsid: row.nsid)
        }
    }
}
