import SwiftUI
import UIKit
import AturiCore

/// `/tools/stream`, port of `src/components/tools/StreamMonitor.tsx`: live
/// Jetstream events (commits, identity and account events) and PLC directory
/// operations in one list. The state is `StreamMonitorModel` in AturiCore.
///
/// Laid out for a phone the way the web lays itself out at phone width: the
/// head card carries each source's status and the views (presets), the list
/// fills the page, and a bar at the foot holds Play, Pause and Stop, the text
/// filter and the filters button, with the held banner above it. The filters
/// and an opened event are sheets.
///
/// The sockets run only while the page is on screen and the app is in front:
/// they open on appear, close on disappear and in the background, and
/// reconnect at the live edge on return. The list holds still while paused,
/// while an event is open, and while the top of the list is scrolled out of
/// sight, so a row can be read without it sliding away.
struct StreamToolView: View {
    let query: [String: String]

    @State private var model: StreamMonitorModel
    @State private var filtersOpen = false
    /// Where the visible part of the page starts, and where the list
    /// starts, in window coordinates: the list counts as scrolled away once
    /// its top passes under the navigation bar.
    @State private var viewportTop: CGFloat = 0
    @State private var listTop: CGFloat = 0
    @State private var scrollToTop = 0

    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.aturiTheme) private var theme

    init(query: [String: String]) {
        self.query = query
        _model = State(initialValue: StreamMonitorModel(query: query))
    }

    /// The view as the web keeps it in the address. A route's query holds
    /// one value per key, so a view with several event types, accounts or
    /// collections shares only the first of each from the toolbar; the
    /// filters sheet's link carries all of them.
    private var shareQuery: [String: String] {
        NetworkToolQuery.dictionary(model.queryItems).query
    }

    var body: some View {
        ToolFrame(slug: "stream", shareQuery: shareQuery) {
            StreamHeadForm(model: model)
        } content: {
            ScrollViewReader { proxy in
                StreamListSection(model: model, open: open)
                    .onChange(of: scrollToTop) { _, _ in
                        withAnimation(.easeOut(duration: 0.2)) {
                            proxy.scrollTo(StreamListSection.topID, anchor: .top)
                        }
                    }
            }
        }
        .background(
            GeometryReader { geometry in
                Color.clear.preference(key: StreamViewportTopKey.self, value: geometry.frame(in: .global).minY)
            }
        )
        .onPreferenceChange(StreamViewportTopKey.self) { value in
            viewportTop = value
            updateScrolledAway()
        }
        .onPreferenceChange(StreamListTopKey.self) { value in
            listTop = value
            updateScrolledAway()
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            StreamBottomBar(model: model, filtersOpen: $filtersOpen, showLatest: showLatest)
        }
        .sheet(isPresented: $filtersOpen) {
            StreamFiltersSheet(model: model)
                .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: eventOpen) {
            StreamEventSheet(model: model)
                .presentationDetents([.medium, .large])
        }
        .onAppear {
            model.setBackground(scenePhase == .background)
            model.activate()
        }
        .onDisappear {
            model.deactivate()
        }
        .onChange(of: scenePhase) { _, phase in
            model.setBackground(phase == .background)
        }
    }

    private var eventOpen: Binding<Bool> {
        Binding(
            get: { model.openId != nil },
            set: { presented in
                if !presented { model.open(nil) }
            }
        )
    }

    private func open(_ id: Int) {
        filtersOpen = false
        model.open(id)
    }

    /// The held banner's action: back to live, at the top of the list.
    private func showLatest() {
        if model.transport == .stopped {
            model.play()
        } else {
            model.showLatest()
        }
        scrollToTop += 1
    }

    private func updateScrolledAway() {
        // Before the first layout both read zero; nothing is scrolled yet.
        guard viewportTop != 0 || listTop != 0 else { return }
        model.setScrolledAway(listTop < viewportTop - 8)
    }
}

private struct StreamViewportTopKey: PreferenceKey {
    static let defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

private struct StreamListTopKey: PreferenceKey {
    static let defaultValue: CGFloat = 0

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

// MARK: - Head card

/// Under the lead: the tally and each source's status and rate, the
/// matched count and Clear, then the views.
private struct StreamHeadForm: View {
    let model: StreamMonitorModel

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .center, spacing: 10) {
                StreamTallyPill(tally: model.tally)
                VStack(alignment: .leading, spacing: 2) {
                    ForEach(model.shownSources, id: \.self) { source in
                        StreamSourceStatus(model: model, source: source)
                    }
                }
                Spacer(minLength: 4)
                VStack(alignment: .trailing, spacing: 2) {
                    Text(JetstreamModel.grouped(model.stats.matched))
                        .font(AturiFont.monoFont(.footnote, weight: .medium))
                        .monospacedDigit()
                        .foregroundStyle(theme.textPrimary)
                        .contentTransition(.numericText())
                    Text("matched")
                        .font(AturiFont.caption)
                        .foregroundStyle(theme.textTertiary)
                }
                .accessibilityElement(children: .combine)
            }
            HStack(spacing: 8) {
                SectionHeader("Views")
                Spacer(minLength: 0)
                Button {
                    model.clear()
                } label: {
                    Label("Clear", systemImage: "eraser")
                        .font(AturiFont.caption)
                }
                .buttonStyle(.plain)
                .foregroundStyle(theme.textAccent)
                .accessibilityLabel("Clear the list and counts")
            }
            StreamPresetStrip(model: model)
        }
        .padding(.top, 4)
    }
}

/// Live, Paused, Stopped or Connecting, as the web's tally beside the title.
private struct StreamTallyPill: View {
    let tally: StreamTally

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        HStack(spacing: 5) {
            switch tally {
            case .paused:
                Image(systemName: "pause.fill")
                    .font(AturiFont.caption2)
            case .stopped:
                Image(systemName: "stop.fill")
                    .font(AturiFont.caption2)
            case .live, .connecting:
                Circle()
                    .fill(tally == .live ? theme.statusLive : theme.textTertiary)
                    .frame(width: 7, height: 7)
            }
            Text(tally.rawValue)
                .font(AturiFont.sans(.caption, weight: .semibold))
        }
        .foregroundStyle(tally == .live ? theme.textAccent : theme.textSecondary)
        .padding(.horizontal, 9)
        .padding(.vertical, 5)
        .background(tally == .live ? theme.accentSoft : theme.bgTertiary, in: Capsule())
        .accessibilityElement(children: .combine)
    }
}

/// One source's dot, name and what it is doing (`SourceStatus`).
private struct StreamSourceStatus: View {
    let model: StreamMonitorModel
    let source: StreamSource

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        let open = model.connection(source) == .open
        HStack(spacing: 6) {
            Circle()
                .fill(open ? theme.statusLive : theme.textFaint)
                .frame(width: 6, height: 6)
            Text(source.shortLabel)
                .font(AturiFont.sans(.caption, weight: .medium))
                .foregroundStyle(theme.textSecondary)
            Text(model.connectionText(source))
                .font(AturiFont.monoFont(.caption))
                .monospacedDigit()
                .foregroundStyle(open ? theme.textAccent : theme.textTertiary)
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(source.label), \(model.connectionText(source))")
    }
}

/// The presets as chips; the one the filters match is lit.
private struct StreamPresetStrip: View {
    let model: StreamMonitorModel

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(StreamMonitor.presets) { preset in
                    let active = model.isPresetActive(preset)
                    Button {
                        model.applyPreset(preset)
                    } label: {
                        Chip(preset.label, style: active ? .accent : .neutral)
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint(preset.hint)
                    .accessibilityAddTraits(active ? .isSelected : [])
                }
            }
            .padding(.vertical, 2)
        }
    }
}

// MARK: - The list

private struct StreamListSection: View {
    static let topID = "stream-list-top"

    let model: StreamMonitorModel
    let open: (Int) -> Void

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        let rows = model.visibleRows
        VStack(alignment: .leading, spacing: 8) {
            if !rows.isEmpty {
                list(rows)
            }
            if model.showsSkeleton {
                SkeletonRows(count: 8)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .cardBackground()
            } else if !rows.contains(where: { $0.event != nil }) {
                Text(model.emptyMessage)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(14)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .cardBackground()
            }
            Text(model.footNote)
                .font(AturiFont.caption)
                .foregroundStyle(theme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.horizontal, 4)
        }
        .id(StreamListSection.topID)
        .background(alignment: .top) {
            GeometryReader { geometry in
                Color.clear.preference(key: StreamListTopKey.self, value: geometry.frame(in: .global).minY)
            }
        }
    }

    private func list(_ rows: [StreamRow]) -> some View {
        LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                if index > 0 {
                    Divider()
                }
                switch row {
                case .event(let event):
                    StreamEventLine(model: model, row: event, isOpen: model.openId == event.item.id) {
                        open(event.item.id)
                    }
                case .gap(let gap):
                    StreamGapLine(gap: gap)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Events, newest first")
    }
}

/// One event: its badge, the account and the time, then what it was about.
private struct StreamEventLine: View {
    let model: StreamMonitorModel
    let row: StreamEventRow
    let isOpen: Bool
    let action: () -> Void

    @Environment(\.aturiTheme) private var theme

    private var item: StreamItem { row.item }

    /// The handle once known, the short DID until then.
    private var account: String {
        if item.isResolvable, let handle = model.handles[item.did] {
            return "@" + handle
        }
        return shortDid(item.did)
    }

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    StreamKindBadge(kind: item.kind)
                    Text(account)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(account.hasPrefix("@") ? theme.textPrimary : theme.textTertiary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer(minLength: 4)
                    Text(StreamMonitor.clockTime(item.time))
                        .font(AturiFont.monoFont(.caption))
                        .monospacedDigit()
                        .foregroundStyle(theme.textTertiary)
                }
                StreamSummary(item: item)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(rowBackground)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityHint("Opens the event")
        .onAppear {
            if item.isResolvable {
                model.lookUpHandle(for: item.did)
            }
        }
        .onChange(of: model.lookupAllowed) { _, allowed in
            if allowed, item.isResolvable {
                model.lookUpHandle(for: item.did)
            }
        }
    }

    /// The open row is marked; a row that arrived while the list was calm
    /// gets the feed's arrival accent.
    private var rowBackground: Color {
        if isOpen { return theme.accentSoft }
        return row.accent ? theme.surfaceSubtle : Color.clear
    }
}

/// The "what" and "detail" of a row, which mean different things per kind
/// (`Summary`).
private struct StreamSummary: View {
    let item: StreamItem

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        switch item.kind {
        case .create, .update, .delete:
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(item.collection ?? "")
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(theme.textAccent)
                    .lineLimit(1)
                    .layoutPriority(1)
                detail
            }
        case .identity:
            if let handle = item.handle {
                Text("@" + handle)
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(theme.textPrimary)
                    .lineLimit(1)
            } else {
                muted("identity refreshed")
            }
        case .account:
            Chip(item.active == true ? "active" : (item.status ?? "inactive"), style: item.active == true ? .accent : .neutral)
        case .plcTombstone:
            muted("tombstoned")
        case .plcNew, .plcUpdate:
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                if let handle = item.handle {
                    Text("@" + handle)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textPrimary)
                        .lineLimit(1)
                } else {
                    muted("no handle")
                }
                Text(item.pds ?? "no PDS")
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(theme.textTertiary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
    }

    @ViewBuilder
    private var detail: some View {
        if let preview = item.preview {
            let compact = StreamMonitor.compactPreview(preview)
            Text(compact.text)
                .font(compact.mono ? AturiFont.monoSmall : AturiFont.footnote)
                .foregroundStyle(compact.mono ? theme.textTertiary : theme.textSecondary)
                .lineLimit(2)
        } else {
            Text(item.rkey ?? "")
                .font(AturiFont.monoSmall)
                .foregroundStyle(theme.textTertiary)
                .lineLimit(1)
        }
    }

    private func muted(_ text: String) -> some View {
        Text(text)
            .font(AturiFont.footnote)
            .italic()
            .foregroundStyle(theme.textTertiary)
    }
}

/// The event-type badge: filled for Jetstream, outlined for PLC, so the
/// two sources read apart at a glance.
private struct StreamKindBadge: View {
    let kind: StreamKind
    var label: String? = nil

    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale

    private var foreground: Color {
        switch kind {
        case .create, .plcNew: return theme.accentSoftFg
        case .delete, .plcTombstone: return theme.danger
        case .update, .identity, .account, .plcUpdate: return theme.textSecondary
        }
    }

    private var fill: Color {
        switch kind {
        case .create: return theme.accentSoft
        case .delete: return theme.danger.opacity(0.1)
        case .update, .identity, .account: return theme.bgTertiary
        case .plcNew, .plcUpdate, .plcTombstone: return Color.clear
        }
    }

    private var border: Color {
        switch kind {
        case .plcNew: return theme.accentSoftBorder
        case .plcTombstone: return theme.danger.opacity(0.45)
        case .plcUpdate: return theme.borderStrong
        case .create, .update, .delete, .identity, .account: return Color.clear
        }
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 6, style: .continuous)
        Text(label ?? kind.meta.badge)
            .font(AturiFont.sans(.caption, weight: .semibold))
            .foregroundStyle(foreground)
            .lineLimit(1)
            .fixedSize()
            .padding(.horizontal, 7)
            .padding(.vertical, 2)
            .background(fill, in: shape)
            .overlay(shape.strokeBorder(border, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
    }
}

/// Where the stream was stopped and played again.
private struct StreamGapLine: View {
    let gap: StreamGapRow

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        Label(gap.text, systemImage: "bolt.slash")
            .font(AturiFont.footnote)
            .foregroundStyle(theme.textTertiary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(theme.stripe)
    }
}

// MARK: - Bottom bar

/// The foot of the page: the held banner when the list is held or stopped,
/// then Play/Live, Pause and Stop, the text filter and the filters button
/// with a count of what is set (the web's phone toolbar).
private struct StreamBottomBar: View {
    let model: StreamMonitorModel
    @Binding var filtersOpen: Bool
    let showLatest: () -> Void

    @FocusState private var textFocused: Bool
    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale

    private var text: Binding<String> {
        Binding(
            get: { model.filters.text },
            set: { model.setText($0) }
        )
    }

    var body: some View {
        VStack(spacing: 0) {
            if let label = model.heldLabel {
                Button(action: showLatest) {
                    Label(label, systemImage: model.transport == .stopped || model.transport == .paused ? "play.fill" : "arrow.up")
                        .font(AturiFont.sans(.footnote, weight: .semibold))
                        .foregroundStyle(model.transport == .stopped ? theme.textPrimary : theme.accentSoftFg)
                        .lineLimit(1)
                        .minimumScaleFactor(0.85)
                        .frame(maxWidth: .infinity)
                        .padding(.vertical, 8)
                        .background(model.transport == .stopped ? theme.bgTertiary : theme.accentSoft)
                }
                .buttonStyle(.plain)
            }
            HStack(spacing: 8) {
                StreamTransportControl(model: model)
                HStack(spacing: 6) {
                    Image(systemName: "magnifyingglass")
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textTertiary)
                    TextField("Filter events\u{2026}", text: text)
                        .font(AturiFont.footnote)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.done)
                        .focused($textFocused)
                        .accessibilityLabel("Filter events by text")
                    if !model.filters.text.isEmpty {
                        Button {
                            model.setText("")
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .foregroundStyle(theme.textTertiary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Clear the text filter")
                    }
                }
                .padding(.horizontal, 10)
                .frame(minHeight: 36)
                .background(theme.bgPrimary, in: RoundedRectangle(cornerRadius: AturiTheme.controlRadius, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: AturiTheme.controlRadius, style: .continuous)
                        .strokeBorder(textFocused ? theme.textAccent : theme.borderStrong, lineWidth: AturiTheme.hairline(displayScale: displayScale))
                )
                filtersButton
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
        }
        .background(theme.bgSecondary)
        .overlay(alignment: .top) {
            Rectangle()
                .fill(theme.borderMedium)
                .frame(height: AturiTheme.hairline(displayScale: displayScale))
        }
    }

    private var filtersButton: some View {
        Button {
            textFocused = false
            filtersOpen = true
        } label: {
            ZStack(alignment: .topTrailing) {
                Image(systemName: "slider.horizontal.3")
                    .font(AturiFont.sans(.body, weight: .medium))
                    .foregroundStyle(theme.textPrimary)
                    .frame(width: 36, height: 36)
                if model.filterCount > 0 {
                    Text(String(model.filterCount))
                        .font(AturiFont.sans(.caption2, weight: .bold))
                        .monospacedDigit()
                        .foregroundStyle(theme.textOnAccent)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(theme.accent, in: Capsule())
                        .offset(x: 4, y: -2)
                }
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel(model.filterCount > 0 ? "Filters, \(model.filterCount) set" : "Filters")
    }
}

/// Live/Play, Pause and Stop as one segmented control. The first reads as
/// the state while it is chosen (Live) and as the way back while it is not
/// (Play). Pause has nothing to hold while stopped.
private struct StreamTransportControl: View {
    let model: StreamMonitorModel

    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: AturiTheme.controlRadius, style: .continuous)
        let live = model.transport == .live
        HStack(spacing: 0) {
            segment(selected: live, label: live ? "Live" : "Play") {
                model.play()
            } icon: {
                if live && !model.isConnecting {
                    Circle()
                        .fill(theme.statusLive)
                        .frame(width: 7, height: 7)
                } else if live {
                    ProgressView()
                        .controlSize(.mini)
                } else {
                    Image(systemName: "play.fill")
                }
            }
            .accessibilityLabel(live ? (model.isConnecting ? "Connecting" : "Live") : "Play")
            segment(selected: model.transport == .paused, label: nil) {
                model.pause()
            } icon: {
                Image(systemName: "pause.fill")
            }
            .disabled(model.transport == .stopped)
            .accessibilityLabel("Pause: stay connected and hold new events")
            segment(selected: model.transport == .stopped, label: nil) {
                model.stop()
            } icon: {
                Image(systemName: "stop.fill")
            }
            .accessibilityLabel("Stop: disconnect from both streams")
        }
        .background(theme.bgPrimary, in: shape)
        .overlay(shape.strokeBorder(theme.borderStrong, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
        .clipShape(shape)
    }

    private func segment<Icon: View>(
        selected: Bool,
        label: String?,
        action: @escaping () -> Void,
        @ViewBuilder icon: () -> Icon
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 5) {
                icon()
                    .font(AturiFont.caption)
                if let label {
                    Text(label)
                        .font(AturiFont.sans(.footnote, weight: .semibold))
                }
            }
            .foregroundStyle(selected ? theme.accentSoftFg : theme.textSecondary)
            .padding(.horizontal, 10)
            .frame(minHeight: 36)
            .background(selected ? theme.accentSoft : Color.clear)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityAddTraits(selected ? .isSelected : [])
    }
}

// MARK: - Filters sheet

/// The filters, as the web's rail: views, source, event types with their
/// counts, accounts, collections and text.
private struct StreamFiltersSheet: View {
    let model: StreamMonitorModel

    @Environment(\.dismiss) private var dismiss
    @Environment(\.aturiTheme) private var theme

    private var shareURL: URL? {
        let search = model.search
        return URL(string: Endpoints.aturiBase.absoluteString + "/tools/stream" + (search.isEmpty ? "" : "?" + search))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    section("Views") {
                        StreamPresetStrip(model: model)
                    }
                    section("Source") {
                        Picker("Source", selection: Binding(get: { model.filters.source }, set: { model.setSource($0) })) {
                            ForEach(StreamSourceChoice.allCases, id: \.self) { choice in
                                Text(choice.label).tag(choice)
                            }
                        }
                        .pickerStyle(.segmented)
                    }
                    section("Event types") {
                        StreamKindToggles(model: model)
                    }
                    section("Accounts") {
                        StreamTokenField(kind: .accounts, model: model)
                    }
                    if model.filters.source != .plc {
                        section("Collections") {
                            StreamTokenField(kind: .collections, model: model)
                        }
                    }
                    section("Contains text") {
                        StreamTextFilterField(model: model)
                    }
                    if let shareURL {
                        ShareLink(item: shareURL) {
                            Label("Share a link to this view", systemImage: "square.and.arrow.up")
                        }
                        .buttonStyle(.aturiSecondary)
                    }
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(theme.bgPrimary)
            .navigationTitle("Filters")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                if !model.search.isEmpty {
                    ToolbarItem(placement: .cancellationAction) {
                        Button("Reset") {
                            model.resetFilters()
                        }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }

    private func section<Content: View>(_ title: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader(title)
            content()
        }
    }
}

/// Each shown source's event types, with its status and each type's count
/// of events passing every other filter, so a switched-off type still says
/// how much it is holding back.
private struct StreamKindToggles: View {
    let model: StreamMonitorModel

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(model.shownSources, id: \.self) { source in
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        Text(source.label)
                            .font(AturiFont.sans(.footnote, weight: .semibold))
                            .foregroundStyle(theme.textPrimary)
                        Spacer()
                        Text(model.connectionText(source))
                            .font(AturiFont.monoFont(.caption))
                            .monospacedDigit()
                            .foregroundStyle(theme.textTertiary)
                    }
                    .padding(.horizontal, 14)
                    .padding(.vertical, 8)
                    ForEach(StreamMonitor.kinds(of: source), id: \.self) { kind in
                        Divider()
                        row(kind)
                    }
                }
                .cardBackground()
            }
        }
    }

    private func row(_ kind: StreamKind) -> some View {
        let on = model.filters.kinds.contains(kind)
        return Button {
            model.toggleKind(kind)
        } label: {
            HStack(spacing: 10) {
                Image(systemName: on ? "checkmark.square.fill" : "square")
                    .foregroundStyle(on ? theme.textAccent : theme.textTertiary)
                StreamKindBadge(kind: kind, label: kind.meta.label)
                    .opacity(on ? 1 : 0.55)
                Spacer(minLength: 4)
                Text(StreamMonitor.formatCount(model.stats.count(kind)))
                    .font(AturiFont.monoSmall)
                    .monospacedDigit()
                    .foregroundStyle(theme.textTertiary)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 9)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(kind.meta.label), \(StreamMonitor.formatCount(model.stats.count(kind))) events")
        .accessibilityHint(kind.meta.hint)
        .accessibilityAddTraits(on ? .isSelected : [])
    }
}

/// The accounts or the collections: the ones set, a field to add one, and
/// suggestions for what is typed (`TokenField`).
private struct StreamTokenField: View {
    enum Kind {
        case accounts
        case collections
    }

    let kind: Kind
    let model: StreamMonitorModel

    @State private var text = ""
    @State private var error: String?
    @State private var suggestions: [StreamSuggestion] = []
    @FocusState private var focused: Bool
    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale

    private var placeholder: String {
        kind == .accounts ? "Handle or DID" : "NSID or app.bsky.*"
    }

    private var hint: String {
        switch kind {
        case .accounts:
            return "Handles or DIDs, for both sources. Jetstream sends only these accounts\u{2019} events."
        case .collections:
            return "NSIDs, or a namespace ending in .* (app.bsky.graph.*). Narrows Jetstream commits; identity and account events have no collection and still show."
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            tokens
            field
            if let error {
                Text(error)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if !suggestions.isEmpty {
                suggestionList
            }
            Text(hint)
                .font(AturiFont.caption)
                .foregroundStyle(theme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .task(id: text) {
            await suggest()
        }
    }

    @ViewBuilder
    private var tokens: some View {
        switch kind {
        case .accounts:
            ForEach(model.accountChips) { chip in
                tokenRow(chip.value, note: chip.note, failed: chip.state == .failed, detail: chip.value == chip.did ? nil : chip.did) {
                    model.removeAccount(chip.value)
                }
            }
        case .collections:
            ForEach(model.filters.collections, id: \.self) { collection in
                tokenRow(collection, note: nil, failed: false, detail: nil) {
                    model.removeCollection(collection)
                }
            }
        }
    }

    private func tokenRow(_ value: String, note: String?, failed: Bool, detail: String?, remove: @escaping () -> Void) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(value)
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(failed ? theme.danger : theme.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                if let note {
                    Text(note)
                        .font(AturiFont.caption)
                        .foregroundStyle(failed ? theme.danger : theme.textTertiary)
                } else if let detail {
                    Text(detail)
                        .font(AturiFont.monoFont(.caption))
                        .foregroundStyle(theme.textTertiary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            Spacer(minLength: 4)
            Button(action: remove) {
                Image(systemName: "xmark.circle.fill")
                    .foregroundStyle(theme.textTertiary)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Remove \(value)")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .cardBackground(cornerRadius: AturiTheme.controlRadius)
    }

    private var field: some View {
        let shape = RoundedRectangle(cornerRadius: AturiTheme.controlRadius, style: .continuous)
        return HStack(spacing: 8) {
            Image(systemName: kind == .accounts ? "person" : "curlybraces")
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textTertiary)
            TextField(placeholder, text: $text)
                .font(AturiFont.monoSmall)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.URL)
                .submitLabel(.done)
                .focused($focused)
                .onSubmit {
                    add(text, knownDid: nil)
                }
            Button("Add") {
                add(text, knownDid: nil)
            }
            .font(AturiFont.sans(.footnote, weight: .semibold))
            .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
        }
        .padding(.horizontal, 10)
        .frame(minHeight: 40)
        .background(theme.bgSecondary, in: shape)
        .overlay(shape.strokeBorder(focused ? theme.textAccent : theme.borderStrong, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
    }

    private var suggestionList: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(suggestions.enumerated()), id: \.element.id) { index, suggestion in
                if index > 0 {
                    Divider()
                }
                Button {
                    add(suggestion.value, knownDid: suggestion.did)
                } label: {
                    HStack(spacing: 10) {
                        if kind == .accounts {
                            AvatarView(url: suggestion.avatar, size: 26)
                        }
                        VStack(alignment: .leading, spacing: 1) {
                            Text(suggestion.title)
                                .font(kind == .accounts ? AturiFont.footnote : AturiFont.monoSmall)
                                .foregroundStyle(theme.textPrimary)
                                .lineLimit(1)
                            Text(suggestion.detail)
                                .font(AturiFont.caption)
                                .foregroundStyle(theme.textTertiary)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .cardBackground(cornerRadius: AturiTheme.controlRadius)
    }

    private func add(_ raw: String, knownDid: String?) {
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        let refusal: String?
        switch kind {
        case .accounts:
            refusal = model.addAccount(trimmed, knownDid: knownDid)
        case .collections:
            refusal = model.addCollection(trimmed)
        }
        error = refusal
        if refusal == nil {
            text = ""
            suggestions = []
        }
    }

    /// Asked a moment after typing stops, so a word typed quickly is one
    /// request rather than one per letter.
    private func suggest() async {
        let query = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else {
            suggestions = []
            return
        }
        try? await Task.sleep(nanoseconds: 250_000_000)
        guard !Task.isCancelled else { return }
        let found: [StreamSuggestion]
        switch kind {
        case .accounts:
            found = await model.suggestAccounts(query)
        case .collections:
            found = await model.suggestCollections(query)
        }
        guard !Task.isCancelled else { return }
        suggestions = found
    }
}

/// "Contains text": matched anywhere in the event's JSON. The same filter
/// as the bottom bar's field.
private struct StreamTextFilterField: View {
    let model: StreamMonitorModel

    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: AturiTheme.controlRadius, style: .continuous)
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textTertiary)
                TextField("Post text, handles, URIs, hosts", text: Binding(get: { model.filters.text }, set: { model.setText($0) }))
                    .font(AturiFont.footnote)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.done)
            }
            .padding(.horizontal, 10)
            .frame(minHeight: 40)
            .background(theme.bgSecondary, in: shape)
            .overlay(shape.strokeBorder(theme.borderStrong, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
            Text("Matched anywhere in the event\u{2019}s JSON: post text, handles, URIs, PDS hosts.")
                .font(AturiFont.caption)
                .foregroundStyle(theme.textTertiary)
        }
    }
}

// MARK: - Event sheet

/// The open event (`Inspector`): what happened and to whom, the record's
/// fields, for PLC operations what changed, the JSON, and what to do next.
/// Stays up from one event to the next, so stepping through keeps the view
/// chosen.
private struct StreamEventSheet: View {
    let model: StreamMonitorModel

    enum Detail: String, Hashable {
        case fields = "Fields"
        case changes = "Changes"
        case json = "JSON"
    }

    @State private var preferred: Detail?
    @State private var copied = false
    @Environment(\.dismiss) private var dismiss
    @Environment(\.aturiTheme) private var theme
    @Environment(AppRouter.self) private var router: AppRouter?

    var body: some View {
        NavigationStack {
            Group {
                if let item = model.openItem {
                    ScrollView {
                        content(item)
                            .padding(16)
                    }
                } else {
                    EmptyState(title: "This event is no longer listed", systemImage: "tray")
                        .padding(16)
                }
            }
            .background(theme.bgPrimary)
            .navigationTitle("Event")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItemGroup(placement: .topBarLeading) {
                    Button {
                        model.step(-1)
                    } label: {
                        Image(systemName: "chevron.up")
                    }
                    .disabled(!model.canStep(-1))
                    .accessibilityLabel("Newer event")
                    Button {
                        model.step(1)
                    } label: {
                        Image(systemName: "chevron.down")
                    }
                    .disabled(!model.canStep(1))
                    .accessibilityLabel("Older event")
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
            }
        }
    }

    private func details(for item: StreamItem) -> [Detail] {
        var views: [Detail] = []
        if item.record != nil && item.collection != nil && item.rkey != nil { views.append(.fields) }
        if item.source == .plc { views.append(.changes) }
        views.append(.json)
        return views
    }

    private func handle(for item: StreamItem) -> String? {
        item.isResolvable ? model.handles[item.did] : item.handle
    }

    /// The view chosen earlier when this event has it, else its first.
    private func shownDetail(_ views: [Detail]) -> Detail {
        if let preferred, views.contains(preferred) {
            return preferred
        }
        return views[0]
    }

    @ViewBuilder
    private func content(_ item: StreamItem) -> some View {
        let views = details(for: item)
        let shown = shownDetail(views)
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    StreamKindBadge(kind: item.kind)
                    Text(StreamMonitor.clockTime(item.time))
                        .font(AturiFont.monoSmall)
                        .monospacedDigit()
                        .foregroundStyle(theme.textTertiary)
                    Spacer(minLength: 0)
                }
                Text(handle(for: item).map { "@" + $0 } ?? shortDid(item.did))
                    .font(AturiFont.title)
                    .tracking(AturiFont.titleTracking)
                    .foregroundStyle(theme.textPrimary)
                    .lineLimit(2)
                    .minimumScaleFactor(0.7)
                CopyRow(label: "DID", value: item.did)
                if let collection = item.collection {
                    Text(collection + (item.rkey.map { " / " + $0 } ?? ""))
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textAccent)
                        .textSelection(.enabled)
                }
            }
            .task(id: item.did) {
                if item.isResolvable {
                    model.lookUpHandle(for: item.did, force: true)
                }
            }

            if views.count > 1 {
                Picker("Event view", selection: Binding(get: { shown }, set: { preferred = $0 })) {
                    ForEach(views, id: \.self) { view in
                        Text(view.rawValue).tag(view)
                    }
                }
                .pickerStyle(.segmented)
            }

            detail(shown, item: item)

            actions(item)
        }
    }

    @ViewBuilder
    private func detail(_ shown: Detail, item: StreamItem) -> some View {
        switch shown {
        case .fields:
            if let record = item.record, let uri = item.atUri {
                GenericRecordCardView(
                    record: AtRecord(uri: uri, cid: item.cid ?? "", value: record),
                    identity: IdentityBundle(did: item.did, handle: handle(for: item), pds: ""),
                    showsExplorerLink: false
                )
                .id(item.id)
            }
        case .changes:
            if let entry = item.plcEntry {
                StreamPlcChangesView(model: model, entry: entry)
                    .id(item.id)
            }
        case .json:
            JSONTreeView(value: item.data, expandedDepth: 3)
                .padding(14)
                .cardBackground()
                .id(item.id)
        }
    }

    private func actions(_ item: StreamItem) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let route = Route(explorePath: item.href) {
                Button {
                    model.open(nil)
                    router?.open(route)
                } label: {
                    Label("Open in explorer", systemImage: "arrow.up.right.square")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.aturiPrimary)
            }
            HStack(spacing: 8) {
                Button {
                    model.watchAccount(item.did)
                } label: {
                    Label("Watch account", systemImage: "eye")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.aturiSecondary)
                if let collection = item.collection {
                    Button {
                        model.watchCollection(collection)
                    } label: {
                        Label("Watch collection", systemImage: "curlybraces")
                            .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.aturiSecondary)
                }
            }
            Button {
                UIPasteboard.general.string = item.data.prettyPrinted()
                copied = true
            } label: {
                Label(copied ? "Copied" : "Copy JSON", systemImage: copied ? "checkmark" : "doc.on.doc")
                    .frame(maxWidth: .infinity)
            }
            .buttonStyle(.aturiSecondary)
            .onChange(of: item.id) { _, _ in
                copied = false
            }
        }
    }
}

/// What a PLC operation changed, read against the one before it in the
/// DID's audit log (`PlcChanges`).
private struct StreamPlcChangesView: View {
    let model: StreamMonitorModel
    let entry: PlcStreamEntry

    @State private var state: StreamPlcChangesState?
    @Environment(\.aturiTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let state {
                switch state {
                case .changes(let changes, let genesis) where !changes.isEmpty:
                    ForEach(Array(changes.enumerated()), id: \.element.id) { index, change in
                        if index > 0 {
                            Divider()
                        }
                        changeRow(change, genesis: genesis)
                    }
                default:
                    note(state.message ?? "")
                }
            } else {
                note("Reading the DID\u{2019}s log\u{2026}")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
        .task(id: entry.cid) {
            state = nil
            state = await model.plcChanges(for: entry)
        }
    }

    private func note(_ text: String) -> some View {
        Text(text)
            .font(AturiFont.footnote)
            .foregroundStyle(theme.textSecondary)
            .fixedSize(horizontal: false, vertical: true)
            .padding(14)
    }

    private func changeRow(_ change: StreamPlcChange, genesis: Bool) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(change.label)
                .font(AturiFont.caption)
                .foregroundStyle(theme.textTertiary)
            Group {
                if change.field == .rotationKeys {
                    Text("changed")
                } else if genesis {
                    Text(StreamMonitor.shortValue(change.to))
                } else {
                    Text(StreamMonitor.shortValue(change.from) + " \u{2192} " + StreamMonitor.shortValue(change.to))
                }
            }
            .font(AturiFont.monoSmall)
            .foregroundStyle(theme.textPrimary)
            .textSelection(.enabled)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .accessibilityElement(children: .combine)
    }
}
