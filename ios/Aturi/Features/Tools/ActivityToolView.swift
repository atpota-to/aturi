import SwiftUI
import AturiCore

/// `/tools/activity`, port of `src/components/tools/ActivityCalendar.tsx`
/// and `ActivityHeatmap.tsx`: a year of one account's writes, read from the
/// timestamps in its record keys. The arithmetic is `ActivityCalendar`, the
/// reading `ActivityCalendarScan` and the run `ActivityCalendarModel`
/// (AturiCore); this starts a read, shows it filling in, and draws the
/// result. The input is `?actor=`, which is what the explorer links.
///
/// On a phone the year is a strip of 53 week columns that scrolls sideways
/// and opens on the most recent weeks; the stats sit in a two-column grid
/// under it, and the rest stacks.
struct ActivityToolView: View {
    let query: [String: String]

    @State private var model = ActivityCalendarModel()
    @State private var text = ""
    @State private var input: ActivityCalendar.ActorInput? = nil
    @State private var started = false

    init(query: [String: String]) {
        self.query = query
    }

    private static let examples = ["bsky.app", "atproto.com", "aturi.to"]

    private var shareQuery: [String: String] {
        guard let actor = input?.actor else { return [:] }
        return ["actor": actor]
    }

    var body: some View {
        ToolFrame(slug: "activity", shareQuery: shareQuery) {
            VStack(alignment: .leading, spacing: 10) {
                ToolInputBar(
                    placeholder: "alice.example.com",
                    text: $text,
                    buttonTitle: "Draw",
                    isRunning: model.isRunning
                ) {
                    run(text)
                }
                ToolExamples(examples: Self.examples) { example in
                    text = example
                    run(example)
                }
            }
        } content: {
            results
        }
        .onAppear(perform: readQuery)
    }

    @ViewBuilder
    private var results: some View {
        if let reason = input?.reason {
            ToolCheckRow(status: .warn, title: reason)
                .padding(.horizontal, 14)
                .padding(.vertical, 4)
                .cardBackground()
        }
        if model.status == .failed, let message = model.errorMessage {
            ErrorPanel(message: message) {
                model.rerun()
            }
        }
        if input?.actor != nil, model.scan == nil, model.isRunning {
            ToolSection("The last 12 months", detail: "Finding the account\u{2026}") {
                SkeletonRows(count: 3)
            }
        }
        if let scan = model.scan {
            ActivityResultsView(
                scan: scan,
                running: model.isRunning,
                stop: { model.stop() },
                more: { model.rerun() }
            )
            .id(scan.did)
        }
        if input == nil {
            intro
        }
    }

    private var intro: some View {
        ToolSection("How it works") {
            VStack(alignment: .leading, spacing: 12) {
                ActivityIntroItem(
                    term: "Record keys carry the time",
                    text: "Most keys are TIDs, which hold when the record was made. Others fall back to createdAt."
                )
                ActivityIntroItem(
                    term: "Every collection, newest first",
                    text: "Each collection is read back from its newest record to the start of the calendar. Every app counts."
                )
                ActivityIntroItem(
                    term: "A bounded number of requests",
                    text: "To spare the account\u{2019}s PDS, \(ActivityCalendarScan.concurrency) collections are read at a time, up to \(ActivityCalendarScan.pagesPerCollection) pages each. Longer ones can be read further."
                )
                ActivityIntroItem(
                    term: "What it cannot see",
                    text: "Deleted records leave no key, and edits don\u{2019}t change one."
                )
            }
        }
    }

    /// The input a link handed the page, read once, and run when it is filled.
    private func readQuery() {
        guard !started else { return }
        started = true
        let raw = query["actor"] ?? ""
        text = raw
        if !raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            run(raw)
        }
    }

    private func run(_ raw: String) {
        let parsed = ActivityCalendar.normalizeActorInput(raw)
        input = parsed
        if let actor = parsed.actor {
            model.load(actor)
        } else {
            model.clear()
        }
    }
}

/// A term and its explanation, the web's `ToolIntro` row.
private struct ActivityIntroItem: View {
    let term: String
    let text: String

    @Environment(\.aturiTheme) private var theme

    init(term: String, text: String) {
        self.term = term
        self.text = text
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(term)
                .font(AturiFont.sans(.subheadline, weight: .semibold))
                .foregroundStyle(theme.textPrimary)
            Text(text)
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
    }
}

// MARK: - Words

/// The page's ways of saying a count and a day.
private enum ActivityWords {
    /// `1,234 records`.
    static func plural(_ count: Int, _ word: String) -> String {
        "\(Labels.formatCount(count)) \(word)\(count == 1 ? "" : "s")"
    }

    static func percent(_ share: Double) -> String {
        if share > 0 && share < 0.01 { return "<1%" }
        return "\(Int((share * 100).rounded()))%"
    }

    static func date(_ key: String) -> Date? {
        ActivityCalendar.dateFromKey(key)
    }

    /// `12 Nov 2026`, in the reader's own order.
    static func shortDate(_ date: Date) -> String {
        date.formatted(.dateTime.day().month(.abbreviated).year())
    }

    static func shortDate(key: String) -> String {
        date(key).map { shortDate($0) } ?? key
    }

    /// `12 Nov`.
    static func dayMonth(key: String) -> String {
        date(key).map { $0.formatted(.dateTime.day().month(.abbreviated)) } ?? key
    }

    /// `Thursday, 12 November 2026`.
    static func dayName(_ key: String) -> String {
        date(key).map { $0.formatted(.dateTime.weekday(.wide).day().month(.wide).year()) } ?? key
    }

    static func countPhrase(_ count: Int, unit: String = "record") -> String {
        count == 0 ? "no \(unit)s" : plural(count, unit)
    }
}

// MARK: - Results

/// One account's year: the calendar, a picked day, the stats, where it was
/// written, and what is missing. Keyed by DID by its caller, so a new
/// account starts with no day picked and no filter.
private struct ActivityResultsView: View {
    let scan: ActivityCalendarScan.Snapshot
    let running: Bool
    let stop: () -> Void
    let more: () -> Void

    @State private var filter: ActivityCalendar.Filter? = nil
    @State private var groupBy: ActivityCalendar.GroupBy = .app
    @State private var selected: String? = nil

    @Environment(\.aturiTheme) private var theme

    /// Collections named in a "what is missing" list before it says "and N
    /// more". Stopping early can leave dozens unread, and the count is what
    /// matters.
    private static let gapsShown = 6

    init(scan: ActivityCalendarScan.Snapshot, running: Bool, stop: @escaping () -> Void, more: @escaping () -> Void) {
        self.scan = scan
        self.running = running
        self.stop = stop
        self.more = more
    }

    /// A PDS reports a handle it could not confirm as `handle.invalid`,
    /// which names nobody and resolves to nothing. The DID always does.
    private var handle: String? {
        guard let handle = scan.handle, !handle.isEmpty, handle != "handle.invalid" else { return nil }
        return handle
    }

    private var name: String {
        handle.map { "@\($0)" } ?? scan.did
    }

    private var repo: String {
        handle ?? scan.did
    }

    var body: some View {
        let days = ActivityCalendar.sumDays(scan.collections, filter: filter)
        let summary = ActivityCalendar.summarize(days, window: scan.window)
        let shares = ActivityCalendar.totalsBy(scan.collections, by: groupBy)
        VStack(alignment: .leading, spacing: 16) {
            calendarSection(days: days, summary: summary)
            if let selected {
                daySection(selected)
            }
            statsGrid(summary)
            sharesSection(shares)
            if !running {
                missingSection
            }
        }
    }

    // MARK: The calendar

    private func calendarSection(days: [String: Int], summary: ActivityCalendar.Summary) -> some View {
        let range = "\(ActivityWords.shortDate(key: scan.window.firstKey)) to \(ActivityWords.shortDate(key: scan.window.todayKey))"
        return ToolSection("The last 12 months", detail: range) {
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    (Text(ActivityWords.plural(summary.total, "record")).bold()
                        + Text(" on ")
                        + Text(ActivityWords.plural(summary.activeDays, "day")).bold())
                        .font(AturiFont.body)
                        .foregroundStyle(theme.textPrimary)
                    NavigationLink(value: Route.repo(repo)) {
                        Text("by \(name)")
                            .font(AturiFont.footnote)
                            .foregroundStyle(theme.textAccent)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    .buttonStyle(.plain)
                }
                if let filter {
                    Button {
                        self.filter = nil
                    } label: {
                        Chip(filter.key, systemImage: "xmark", style: .accent)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Showing \(filter.key) only. Show every app")
                }

                ActivityHeatmapGrid(
                    window: scan.window,
                    days: days,
                    label: "Records written by \(name), by day",
                    selected: $selected
                )
                legend

                if running && !scan.collections.isEmpty {
                    progress
                }

                Text("Days are in your time zone (\(TimeZone.current.identifier)). Deleted records are not counted.")
                    .font(AturiFont.caption)
                    .foregroundStyle(theme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private var legend: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Pick a day to see its records.")
                .font(AturiFont.caption)
                .foregroundStyle(theme.textSecondary)
            HStack(spacing: 3) {
                Text("Less")
                ForEach(0..<5, id: \.self) { level in
                    RoundedRectangle(cornerRadius: 2.5, style: .continuous)
                        .fill(ActivityHeatmapGrid.fill(level, theme: theme))
                        .frame(width: 10, height: 10)
                }
                Text("More")
            }
            .font(AturiFont.caption2)
            .foregroundStyle(theme.textTertiary)
            .accessibilityHidden(true)
        }
    }

    /// How many collections have been read as far as this run will take them.
    private var settled: Int {
        scan.collections.filter { $0.state == .done || $0.state == .failed || $0.state == .partial }.count
    }

    private var progress: some View {
        let total = scan.collections.count
        let done = settled
        let reading = scan.collections.filter { $0.state == .reading }.map { $0.collection }
        var words = "Reading \(done) of \(ActivityWords.plural(total, "collection"))"
        if let first = reading.first {
            words += ": \(first)"
            if reading.count > 1 {
                words += " and \(reading.count - 1) more"
            }
        }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .center, spacing: 10) {
                Text(words)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .lineLimit(2)
                    .truncationMode(.middle)
                Spacer(minLength: 0)
                Button(action: stop) {
                    Label("Stop", systemImage: "stop.fill")
                        .font(AturiFont.footnote)
                }
                .buttonStyle(.aturiSecondary)
            }
            ProgressView(value: Double(done), total: Double(max(1, total)))
                .tint(theme.accent)
                .accessibilityLabel("Collections read")
        }
        .accessibilityElement(children: .contain)
    }

    // MARK: One day

    private func daySection(_ key: String) -> some View {
        let breakdown = ActivityCalendar.dayBreakdown(scan.collections, key: key)
            .filter { ActivityCalendar.matchesFilter($0.collection, filter) }
        let total = breakdown.reduce(0) { $0 + $1.count }
        return ToolSection(ActivityWords.dayName(key)) {
            VStack(alignment: .leading, spacing: 0) {
                if breakdown.isEmpty {
                    Text(filter.map { "Nothing from \($0.key) was written on this day and still exists." }
                        ?? "Nothing written on this day still exists.")
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.vertical, 4)
                } else {
                    ForEach(breakdown, id: \.collection) { row in
                        NavigationLink(value: Route.collection(repo: repo, collection: row.collection)) {
                            HStack(spacing: 10) {
                                Text(row.collection)
                                    .font(AturiFont.monoSmall)
                                    .foregroundStyle(theme.textAccent)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                Spacer(minLength: 6)
                                Text(ActivityWords.plural(row.count, "record"))
                                    .font(AturiFont.footnote)
                                    .foregroundStyle(theme.textSecondary)
                            }
                            .padding(.vertical, 8)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        Divider()
                    }
                    Text("\(ActivityWords.plural(total, "record")) in all. Each link opens the whole collection in the Explorer, newest first.")
                        .font(AturiFont.caption)
                        .foregroundStyle(theme.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                        .padding(.top, 8)
                }
                Button("Close") {
                    selected = nil
                }
                .font(AturiFont.sans(.footnote, weight: .medium))
                .foregroundStyle(theme.textAccent)
                .buttonStyle(.plain)
                .padding(.top, 10)
            }
        }
    }

    // MARK: The stats

    private func statsGrid(_ summary: ActivityCalendar.Summary) -> some View {
        let columns = [GridItem(.flexible(), spacing: 10, alignment: .top), GridItem(.flexible(), spacing: 10, alignment: .top)]
        let streakSub: String
        if let streak = summary.longestStreak {
            streakSub = streak.days == 1
                ? ActivityWords.dayMonth(key: streak.startKey)
                : "\(ActivityWords.dayMonth(key: streak.startKey)) to \(ActivityWords.dayMonth(key: streak.endKey))"
        } else {
            streakSub = "No day has a record"
        }
        let busiestKey = summary.busiestDay?.key
        return LazyVGrid(columns: columns, alignment: .leading, spacing: 10) {
            ActivityStatTile(
                label: "Records",
                value: Labels.formatCount(summary.total),
                sub: filter.map { "in \($0.key)" } ?? "in \(ActivityWords.plural(scan.collections.count, "collection"))"
            )
            ActivityStatTile(
                label: "Active days",
                value: Labels.formatCount(summary.activeDays),
                sub: "of \(Labels.formatCount(summary.windowDays))"
            )
            ActivityStatTile(
                label: "Longest streak",
                value: summary.longestStreak.map { ActivityWords.plural($0.days, "day") } ?? "None",
                sub: streakSub
            )
            if let busiestKey, let busiest = summary.busiestDay {
                Button {
                    selected = busiestKey
                } label: {
                    ActivityStatTile(
                        label: "Most active day",
                        value: Labels.formatCount(busiest.count),
                        sub: ActivityWords.shortDate(key: busiestKey),
                        pointsAtDay: true
                    )
                }
                .buttonStyle(.plain)
                .accessibilityHint("Shows this day")
            } else {
                ActivityStatTile(label: "Most active day", value: "None", sub: "No day has a record")
            }
            ActivityStatTile(
                label: "Busiest month",
                value: summary.busiestMonth.map { Labels.formatCount($0.count) } ?? "None",
                sub: summary.busiestMonth?.label ?? "No month has a record"
            )
        }
    }

    // MARK: Where it was written

    private func sharesSection(_ shares: [ActivityCalendar.Share]) -> some View {
        let noun = groupBy == .app ? "app" : "collection"
        return ToolSection(
            "Where it was written",
            detail: "\(ActivityWords.plural(shares.count, noun)) with records this year"
        ) {
            VStack(alignment: .leading, spacing: 10) {
                Picker("Group records by", selection: $groupBy) {
                    Text("By app").tag(ActivityCalendar.GroupBy.app)
                    Text("By collection").tag(ActivityCalendar.GroupBy.collection)
                }
                .pickerStyle(.segmented)
                HStack(alignment: .firstTextBaseline) {
                    Text("Pick a row to filter the calendar.")
                        .font(AturiFont.caption)
                        .foregroundStyle(theme.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 6)
                    if filter != nil {
                        Button("Show everything") {
                            filter = nil
                        }
                        .font(AturiFont.sans(.caption, weight: .medium))
                        .foregroundStyle(theme.textAccent)
                        .buttonStyle(.plain)
                    }
                }
                if shares.isEmpty {
                    Text(running ? "Nothing counted yet." : "This account wrote nothing in the last 12 months that still exists.")
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(shares, id: \.key) { row in
                            shareRow(row)
                            Divider()
                        }
                    }
                }
            }
        }
    }

    private func toggleFilter(_ key: String) {
        if let filter, filter.by == groupBy, filter.key == key {
            self.filter = nil
        } else {
            filter = ActivityCalendar.Filter(by: groupBy, key: key)
        }
    }

    private func shareRow(_ row: ActivityCalendar.Share) -> some View {
        let active = filter?.by == groupBy && filter?.key == row.key
        return HStack(alignment: .center, spacing: 8) {
            Button {
                toggleFilter(row.key)
            } label: {
                VStack(alignment: .leading, spacing: 5) {
                    HStack(alignment: .firstTextBaseline, spacing: 8) {
                        Text(row.key)
                            .font(AturiFont.monoSmall)
                            .foregroundStyle(active ? theme.textAccent : theme.textPrimary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                        Spacer(minLength: 6)
                        Text(Labels.formatCount(row.count))
                            .font(AturiFont.monoSmall)
                            .foregroundStyle(theme.textPrimary)
                        Text(ActivityWords.percent(row.share))
                            .font(AturiFont.caption)
                            .foregroundStyle(theme.textTertiary)
                            .frame(minWidth: 36, alignment: .trailing)
                    }
                    if groupBy == .app && row.collections > 1 {
                        Text(ActivityWords.plural(row.collections, "collection"))
                            .font(AturiFont.caption)
                            .foregroundStyle(theme.textTertiary)
                    }
                    ProgressView(value: max(0.02, row.share))
                        .tint(active ? theme.textAccent : theme.accent)
                        .accessibilityHidden(true)
                }
                .padding(.vertical, 8)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(active ? .isSelected : [])
            .accessibilityLabel("\(row.key), \(ActivityWords.plural(row.count, "record")), \(ActivityWords.percent(row.share))")

            if groupBy == .collection {
                NavigationLink(value: Route.collection(repo: repo, collection: row.key)) {
                    Image(systemName: "arrow.up.right.square")
                        .foregroundStyle(theme.textTertiary)
                        .padding(6)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open \(row.key) in the Explorer")
            }
        }
    }

    // MARK: What is missing

    @ViewBuilder
    private var missingSection: some View {
        let partial = scan.collections.filter { $0.state == .partial }
        let failed = scan.collections.filter { $0.state == .failed }
        let undated = scan.collections.reduce(0) { $0 + $1.undated }
        if !partial.isEmpty || !failed.isEmpty || undated > 0 {
            ToolSection("What is missing") {
                VStack(alignment: .leading, spacing: 14) {
                    if !partial.isEmpty {
                        gapList(
                            lead: partialLead(partial.count),
                            rows: partial.map { ($0.collection, reachedWords($0)) }
                        )
                    }
                    if !failed.isEmpty {
                        gapList(
                            lead: "\(ActivityWords.plural(failed.count, "collection")) could not be read, and \(failed.count == 1 ? "is" : "are") not on the calendar.",
                            rows: failed.map { ($0.collection, $0.error ?? "the PDS did not answer") }
                        )
                    }
                    if undated > 0 {
                        let records: String = ActivityWords.plural(undated, "record")
                        let note: String = undated == 1
                            ? records + " has no time in its key and no createdAt, so it is not on the calendar."
                            : records + " have no time in their key and no createdAt, so they are not on the calendar."
                        Text(note)
                            .font(AturiFont.footnote)
                            .foregroundStyle(theme.textSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if !partial.isEmpty || !failed.isEmpty {
                        Button(againTitle(partial: partial.count, failed: failed.count), action: more)
                            .buttonStyle(.aturiSecondary)
                    }
                }
            }
        }
    }

    private func partialLead(_ count: Int) -> String {
        let lead: String
        if scan.endedBy == .stop {
            lead = "Reading was stopped with \(ActivityWords.plural(count, "collection")) unfinished. "
        } else {
            let each = Labels.formatCount(ActivityCalendarScan.pagesPerCollection * 100)
            lead = "\(ActivityWords.plural(count, "collection")) \(count == 1 ? "is" : "are") longer than one read covers (\(each) records each). "
        }
        return lead + "Days before the dates below are missing their records."
    }

    private func reachedWords(_ collection: ActivityCalendar.CollectionScan) -> String {
        if let reached = collection.reached {
            return "read back to \(ActivityWords.shortDate(reached))"
        }
        if collection.pages > 0 {
            return "\(ActivityWords.plural(collection.pages, "page")) read"
        }
        return "not read yet"
    }

    private func againTitle(partial: Int, failed: Int) -> String {
        if failed > 0 && partial == 0 { return "Try those again" }
        return scan.endedBy == .stop ? "Continue reading" : "Read further back"
    }

    private func gapList(lead: String, rows: [(String, String)]) -> some View {
        let shown = Array(rows.prefix(Self.gapsShown))
        let rest = rows.count - shown.count
        return VStack(alignment: .leading, spacing: 6) {
            Text(lead)
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            ForEach(Array(shown.enumerated()), id: \.offset) { pair in
                VStack(alignment: .leading, spacing: 1) {
                    Text(pair.element.0)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textPrimary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Text(pair.element.1)
                        .font(AturiFont.caption)
                        .foregroundStyle(theme.textTertiary)
                }
                .accessibilityElement(children: .combine)
            }
            if rest > 0 {
                Text("and \(ActivityWords.plural(rest, "more collection"))")
                    .font(AturiFont.caption)
                    .foregroundStyle(theme.textTertiary)
            }
        }
    }
}

/// One of the five figures under the calendar, the web's `fn-stat` tile.
private struct ActivityStatTile: View {
    let label: String
    let value: String
    let sub: String
    var pointsAtDay: Bool

    @Environment(\.aturiTheme) private var theme

    init(label: String, value: String, sub: String, pointsAtDay: Bool = false) {
        self.label = label
        self.value = value
        self.sub = sub
        self.pointsAtDay = pointsAtDay
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 4) {
                Text(label)
                    .aturiLabel()
                    .foregroundStyle(theme.textTertiary)
                if pointsAtDay {
                    Image(systemName: "chevron.right")
                        .font(AturiFont.caption2)
                        .foregroundStyle(theme.textTertiary)
                }
            }
            Text(value)
                .font(AturiFont.title)
                .foregroundStyle(theme.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.6)
            Text(sub)
                .font(AturiFont.caption)
                .foregroundStyle(pointsAtDay ? theme.textAccent : theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .cardBackground()
        .accessibilityElement(children: .combine)
    }
}

// MARK: - The heatmap

/// A year of days as a grid, port of `ActivityHeatmap.tsx`: one column a
/// week, Sunday at the top, each day shaded by how much was written on it.
/// The weeks scroll sideways and open on the most recent ones; the weekday
/// labels stay put beside them.
///
/// The shades are the theme's accent at four strengths, so they follow both
/// themes. Shade alone never carries a count: every day is a button whose
/// name is its date and number, and picking one again clears it.
private struct ActivityHeatmapGrid: View {
    let window: ActivityCalendar.Window
    let days: [String: Int]
    let label: String
    @Binding var selected: String?

    @Environment(\.aturiTheme) private var theme

    private static let cell: CGFloat = 13
    private static let gap: CGFloat = 3
    private static let monthRow: CGFloat = 14
    private static let weekdayLabels: [Int: String] = [1: "Mon", 3: "Wed", 5: "Fri"]

    init(window: ActivityCalendar.Window, days: [String: Int], label: String, selected: Binding<String?>) {
        self.window = window
        self.days = days
        self.label = label
        _selected = selected
    }

    static func fill(_ level: Int, theme: AturiTheme) -> Color {
        switch level {
        case 1: return theme.accent.opacity(0.3)
        case 2: return theme.accent.opacity(0.5)
        case 3: return theme.accent.opacity(0.75)
        case 4: return theme.accent
        default: return theme.bgTertiary
        }
    }

    var body: some View {
        let keys = ActivityCalendar.windowDays(window)
        let thresholds = ActivityCalendar.intensityThresholds(keys.map { days[$0] ?? 0 })
        let months = Dictionary(window.months.map { ($0.column, $0.label) }, uniquingKeysWith: { first, _ in first })
        HStack(alignment: .top, spacing: 6) {
            weekdayColumn
            ScrollViewReader { proxy in
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: Self.gap) {
                        ForEach(0..<window.weeks.count, id: \.self) { column in
                            weekColumn(window.weeks[column], month: months[column], thresholds: thresholds)
                                .id(column)
                        }
                    }
                    // Room for a month label that starts in the last column.
                    .padding(.trailing, 18)
                    .padding(.vertical, 2)
                }
                .onAppear {
                    // A phone shows a few months at a time; open on the most recent.
                    proxy.scrollTo(window.weeks.count - 1, anchor: .trailing)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(label)
    }

    private var weekdayColumn: some View {
        VStack(alignment: .trailing, spacing: Self.gap) {
            Color.clear
                .frame(width: 1, height: Self.monthRow)
            ForEach(0..<7, id: \.self) { row in
                Text(Self.weekdayLabels[row] ?? "")
                    .font(AturiFont.caption2)
                    .foregroundStyle(theme.textTertiary)
                    .frame(height: Self.cell)
            }
        }
        .accessibilityHidden(true)
    }

    private func weekColumn(_ week: [String?], month: String?, thresholds: [Int]) -> some View {
        VStack(alignment: .leading, spacing: Self.gap) {
            Text(month ?? "")
                .font(AturiFont.caption2)
                .foregroundStyle(theme.textTertiary)
                .fixedSize()
                .frame(width: Self.cell, height: Self.monthRow, alignment: .leading)
                .accessibilityHidden(true)
            ForEach(0..<7, id: \.self) { row in
                dayCell(row < week.count ? week[row] : nil, thresholds: thresholds)
            }
        }
    }

    @ViewBuilder
    private func dayCell(_ key: String?, thresholds: [Int]) -> some View {
        if let key {
            let count = days[key] ?? 0
            let level = ActivityCalendar.intensityLevel(count, thresholds: thresholds)
            let isSelected = selected == key
            let shape = RoundedRectangle(cornerRadius: 2.5, style: .continuous)
            Button {
                selected = isSelected ? nil : key
            } label: {
                shape
                    .fill(Self.fill(level, theme: theme))
                    .frame(width: Self.cell, height: Self.cell)
                    .overlay(shape.strokeBorder(isSelected ? theme.textPrimary : Color.clear, lineWidth: 1.5))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(ActivityWords.dayName(key)): \(ActivityWords.countPhrase(count))")
            .accessibilityAddTraits(isSelected ? .isSelected : [])
        } else {
            Color.clear
                .frame(width: Self.cell, height: Self.cell)
                .accessibilityHidden(true)
        }
    }
}
