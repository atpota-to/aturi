import SwiftUI
import Observation
import AturiCore

/// The live Jetstream feed, port of `JetstreamFeed.tsx`. Compact is the
/// landing strip: a short, calm list of creates with the throughput and a
/// pause button. Full is the explorer dashboard: every operation with its
/// pill, an op filter, a collection filter and the rolling stats footer.
///
/// The socket runs only while the section is on screen and the scene is
/// active: `.task(id:)` starts it on appear and again when the scene
/// returns to the foreground, and it stops when the scene backgrounds or
/// the view goes away, the way the web closes the socket for a hidden
/// tab. Pausing keeps the socket and the counters running and only stops
/// rows from surfacing.
struct JetstreamView: View {
    let compact: Bool

    @State private var model: JetstreamModel
    @State private var collectionFilter = ""

    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale

    /// The landing strip keeps a handful of rows so the page under it does
    /// not crawl; the dashboard keeps the web's `maxVisible` (20). The
    /// model's 200-row window is for a screen of its own; embedded in a
    /// scrolling page, a list that long buries everything beneath it.
    private static let compactRows = 8
    private static let dashboardRows = 20

    init(compact: Bool) {
        self.compact = compact
        _model = State(initialValue: JetstreamModel(
            ops: compact ? [.create] : JetstreamOperation.allCases,
            maxRows: compact ? JetstreamView.compactRows : JetstreamView.dashboardRows
        ))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            if !compact {
                filters
                Divider()
            }
            rows
            if !compact {
                Divider()
                statsFooter
            }
        }
        .cardBackground()
        .task(id: scenePhase) {
            switch scenePhase {
            case .active:
                model.start()
            case .background:
                model.stop()
            default:
                break
            }
        }
        .onDisappear {
            model.stop()
        }
    }

    // MARK: Header

    private var statusText: String {
        if !model.isRunning { return "Off" }
        return model.isPaused ? "Paused" : "Live"
    }

    private var header: some View {
        HStack(spacing: 10) {
            Image(systemName: "waveform.path.ecg")
                .font(.footnote)
                .foregroundStyle(model.isPaused || !model.isRunning ? theme.textTertiary : theme.textAccent)
                .accessibilityHidden(true)
            Text(JetstreamModel.title)
                .aturiLabel()
                .foregroundStyle(theme.textTertiary)
                .lineLimit(1)
            Spacer(minLength: 4)
            if let rate = model.rateLabel {
                Text(rate)
                    .font(AturiFont.monoSmall)
                    .monospacedDigit()
                    .foregroundStyle(theme.textTertiary)
                    .accessibilityLabel("\(model.eventsPerSecond.formatted()) events per second")
            }
            Chip(statusText, style: model.isRunning && !model.isPaused ? .accent : .neutral)
            Button {
                model.togglePaused()
            } label: {
                Label(model.pauseButtonLabel, systemImage: model.isPaused ? "play.fill" : "pause.fill")
                    .font(.caption.weight(.medium))
                    .foregroundStyle(theme.textPrimary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(theme.bgTertiary, in: Capsule())
                    .overlay(Capsule().strokeBorder(theme.borderSubtle, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(model.isPaused ? "Resume the feed" : "Pause the feed")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    // MARK: Filters (full mode)

    private var opsSummary: String {
        if model.ops.count == JetstreamOperation.allCases.count { return "All operations" }
        return model.ops.map(opLabel).joined(separator: ", ")
    }

    private func opLabel(_ op: JetstreamOperation) -> String {
        switch op {
        case .create: return "Creates"
        case .update: return "Updates"
        case .delete: return "Deletes"
        }
    }

    /// One toggle per operation. An empty list means creates only on the
    /// model, which would silently re-enable a toggle the person just
    /// turned off, so the last remaining operation cannot be removed.
    private func opBinding(_ op: JetstreamOperation) -> Binding<Bool> {
        Binding(
            get: { model.ops.contains(op) },
            set: { on in
                var next = model.ops
                if on {
                    if !next.contains(op) {
                        next.append(op)
                    }
                } else {
                    next.removeAll { $0 == op }
                    if next.isEmpty { return }
                }
                model.setOps(JetstreamOperation.allCases.filter { next.contains($0) })
            }
        )
    }

    private var filters: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Menu {
                    ForEach(JetstreamOperation.allCases, id: \.self) { op in
                        Toggle(isOn: opBinding(op)) {
                            Text(opLabel(op))
                        }
                    }
                } label: {
                    Label(opsSummary, systemImage: "line.3.horizontal.decrease.circle")
                        .font(.footnote)
                        .lineLimit(1)
                }
                .accessibilityLabel("Operations, \(opsSummary)")
                Spacer(minLength: 0)
                if !model.collections.isEmpty {
                    Text(model.collections.joined(separator: ", "))
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textTertiary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .accessibilityLabel("Filtered to \(model.collections.joined(separator: ", "))")
                }
            }
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .font(.footnote)
                    .foregroundStyle(theme.textTertiary)
                TextField("Collection, e.g. app.bsky.feed.post or app.bsky.*", text: $collectionFilter)
                    .font(AturiFont.monoSmall)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .submitLabel(.done)
                    .onSubmit(applyCollectionFilter)
                    .accessibilityLabel("Filter by collection")
                    .accessibilityHint("Applies when submitted")
                if !collectionFilter.isEmpty || !model.collections.isEmpty {
                    Button {
                        collectionFilter = ""
                        model.setCollections([])
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(theme.textTertiary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear collection filter")
                }
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .background(theme.bgTertiary, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 10)
    }

    /// Commas and whitespace both separate NSIDs; a trailing `*` on any
    /// entry is passed through for the model's namespace match.
    private func applyCollectionFilter() {
        let parts = collectionFilter
            .split(whereSeparator: { $0 == "," || $0.isWhitespace })
            .map { String($0) }
            .filter { !$0.isEmpty }
        model.setCollections(parts)
    }

    // MARK: Rows

    @ViewBuilder
    private var rows: some View {
        if model.showsSkeleton {
            SkeletonRows(count: compact ? 5 : 8)
                .padding(14)
        } else {
            /* Rows only re-render when a flush lands, so a paused list would
               freeze its ages; the timeline ticks them along regardless. */
            TimelineView(.periodic(from: .now, by: 30)) { context in
                LazyVStack(spacing: 0) {
                    ForEach(Array(model.rows.enumerated()), id: \.element.id) { index, row in
                        if index > 0 {
                            Divider()
                        }
                        JetstreamRowView(row: row, showsOp: !compact, now: context.date)
                    }
                }
            }
        }
    }

    // MARK: Stats footer (full mode)

    private var statsFooter: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 16) {
                ForEach(model.statItems) { item in
                    statItem(item.value, item.label, hint: item.hint)
                }
                statItem(model.stats.creates.formatted(), "creates", hint: "Creates seen since the feed loaded")
                statItem(model.stats.updates.formatted(), "updates", hint: "Updates seen since the feed loaded")
                statItem(model.stats.deletes.formatted(), "deletes", hint: "Deletes seen since the feed loaded")
                statItem(model.eventsPerMinute.formatted(), "/min", hint: "Arrivals over the last minute")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 8)
        }
    }

    private func statItem(_ value: String, _ label: String, hint: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text(value)
                .font(AturiFont.monoSmall)
                .monospacedDigit()
                .foregroundStyle(theme.textPrimary)
            Text(label)
                .font(AturiFont.monoSmall)
                .foregroundStyle(theme.textTertiary)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(value) \(label)")
        .accessibilityHint(hint)
    }
}

/// One feed row: the op pill, the collection tail over the DID, a
/// one-line preview and the age. Tapping opens the record page when the
/// commit forms a valid AT URI; a delete of an odd rkey renders plain.
private struct JetstreamRowView: View {
    let row: JetstreamRow
    let showsOp: Bool
    let now: Date

    @Environment(\.aturiTheme) private var theme

    private var age: String {
        Formatting.relative(row.time, now: now)
    }

    private var accessibilityLabel: String {
        var label = "\(row.opTitle) in \(row.collection) by \(row.didLabel)"
        if !row.preview.isEmpty {
            label += ", \(row.preview)"
        }
        return label + ", \(age)"
    }

    var body: some View {
        if let path = row.explorerPath, let route = Route(explorePath: path) {
            NavigationLink(value: route) {
                content
            }
            .buttonStyle(.plain)
        } else {
            content
        }
    }

    private var content: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            if showsOp {
                opPill
            }
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 6) {
                    Text(row.collectionTail)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textAccent)
                        .lineLimit(1)
                    Text(row.didLabel)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textTertiary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                if !row.preview.isEmpty {
                    Text(row.preview)
                        .font(.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .lineLimit(1)
                }
            }
            Spacer(minLength: 4)
            Text(age)
                .font(AturiFont.monoSmall)
                .foregroundStyle(theme.textTertiary)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 7)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityLabel)
    }

    /// `+` create, `~` update, `x` delete: creates in the accent so a wall
    /// of them reads green and the rarer updates and deletes stand out
    /// without shouting.
    private var opPill: some View {
        Text(row.opSymbol)
            .font(AturiFont.monoSmall)
            .foregroundStyle(row.op == .create ? theme.textAccent : theme.textPrimary)
            .frame(width: 18, height: 18)
            .background(
                row.op == .create ? theme.accent.opacity(0.18) : theme.bgTertiary,
                in: RoundedRectangle(cornerRadius: 4, style: .continuous)
            )
            .accessibilityLabel(row.opTitle)
    }
}
