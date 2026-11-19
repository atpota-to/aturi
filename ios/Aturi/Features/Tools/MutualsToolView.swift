import SwiftUI
import AturiCore

/// `/tools/mutuals`, port of `src/components/tools/MutualBlocks.tsx` with
/// `MutualBlocksCharts.tsx` and `MutualBlocksSave.tsx`: an account's
/// mutuals, the accounts they block, how much they agree, and the ticked
/// ones saved as a moderation list. The logic is in AturiCore (`Mutuals`,
/// `MutualsClient`, `MutualsSave`), the state in `MutualsModel`.
///
/// On a phone the page is one column: the wall of mutuals, the distribution
/// (where the threshold is set), the ranked accounts, the lists they block,
/// and the save. The web's orbit map is left out; the ranked list says the
/// same thing in a form a narrow screen can hold.
///
/// `?account=` runs the scan and `?min=` sets the threshold, the keys the
/// web keeps in the address.
struct MutualsToolView: View {
    let query: [String: String]

    @State private var model = MutualsModel()
    @State private var input = ""
    @State private var appeared = false
    @State private var stackDepth: MutualsStackDepth?

    @Environment(AppRouter.self) private var router
    @Environment(\.sessionStore) private var session
    @Environment(\.aturiTheme) private var theme

    private var shareQuery: [String: String] {
        guard let actor = model.actor else { return [:] }
        return ["account": actor, "min": model.askedThreshold.map { String($0) } ?? ""]
    }

    var body: some View {
        ToolFrame(slug: "mutuals", shareQuery: shareQuery) {
            form
        } content: {
            content
        }
        .onAppear {
            stackDepth = MutualsStackDepth(tab: router.selectedTab, count: depth(of: router.selectedTab))
            guard !appeared else { return }
            appeared = true
            let raw = (query["account"] ?? "").trimmingCharacters(in: .whitespacesAndNewlines)
            if !raw.isEmpty {
                input = raw
                model.start(raw, min: query["min"])
            }
        }
        .onDisappear {
            /* Popped, rather than covered by a page pushed over it or left
               for another tab: the stack it was on is now shorter. A scan
               nobody will see is not worth its requests. */
            if let stackDepth, depth(of: stackDepth.tab) < stackDepth.count {
                model.cancel()
            }
        }
    }

    private func depth(of tab: Tab) -> Int {
        switch tab {
        case .explore: return router.explorePath.count
        case .links: return router.linksPath.count
        case .lexicons: return router.lexiconsPath.count
        case .tools: return router.toolsPath.count
        case .settings: return router.settingsPath.count
        }
    }

    // MARK: Form

    private var form: some View {
        VStack(alignment: .leading, spacing: 10) {
            ToolInputBar(
                placeholder: "Your handle or DID",
                text: $input,
                buttonTitle: "Find blocks",
                isRunning: model.isRunning
            ) {
                model.start(input)
            }
            if let did = session.state.did, input.isEmpty {
                Button {
                    input = did
                    model.start(did)
                } label: {
                    Chip("My account", systemImage: "person.crop.circle")
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Check my account")
            }
        }
    }

    // MARK: Content

    @ViewBuilder
    private var content: some View {
        if let reason = model.inputError {
            ErrorPanel(message: reason)
        }
        if let error = model.runError {
            ErrorPanel(message: error) {
                model.rescan()
            }
        }
        if model.phase == .resolving {
            MutualsVerdict(title: model.progressLine, text: "Resolving the account.", running: true)
            SkeletonRows(count: 4)
        }
        if model.account != nil, model.phase != .failed, model.phase != .resolving {
            scanSections
        }
        if model.raw.isEmpty {
            intro
        }
    }

    @ViewBuilder
    private var scanSections: some View {
        if model.isDone {
            MutualsVerdict(title: model.doneTitle, text: model.doneDetail, running: false)
        } else {
            runningCard
        }
        if !model.mutuals.isEmpty {
            stats
            ToolSection("Mutuals", detail: model.isDone ? nil : "\(Mutuals.count(model.progress)) of \(Mutuals.count(model.mutuals.count)) read") {
                MutualsWall(model: model)
            }
        }
        if model.highest > 0 {
            ToolSection("How many mutuals block each account", detail: "\(Mutuals.count(Mutuals.countAtLeast(model.counts, 1))) accounts") {
                MutualsDistribution(model: model)
            }
        }
        if let focus = model.focus, model.mutuals.indices.contains(focus) {
            focusBanner(model.mutuals[focus])
        }
        if model.isDone, model.highest > 0 {
            MutualsAccountsSection(model: model)
        }
        if model.isDone, !model.listSubscriptions.isEmpty {
            MutualsListsSection(model: model)
        }
        if model.isDone, model.highest > 0 {
            ToolSection("Save as a moderation list") {
                MutualsSaveCard(model: model)
            }
        }
        if model.isDone {
            Text("Being blocked by many of someone\u{2019}s mutuals is a signal, not proof of anything. People block for their own reasons, and a few friends who talk to each other can block the same account for the same one. Look before you add.")
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var runningCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            MutualsVerdict(
                title: model.progressLine,
                text: model.phase == .blocks
                    ? "Each mutual\u{2019}s block records are read from its own PDS. The results below fill in as they arrive."
                    : "Finding the accounts that follow each other with this one.",
                running: true
            )
            HStack(spacing: 10) {
                ProgressView(value: model.progressRatio)
                    .tint(theme.accent)
                    .accessibilityLabel("\(Int(model.progressRatio * 100)) percent")
                Button(model.isStopping ? "Stopping\u{2026}" : "Stop") {
                    model.stop()
                }
                .buttonStyle(.aturiSecondary)
                .disabled(model.isStopping)
            }
        }
    }

    private var stats: some View {
        let columns = [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)]
        let readSub: String
        if !model.isDone {
            readSub = "so far"
        } else {
            var parts: [String] = []
            if model.unreadableCount > 0 {
                parts.append("\(Mutuals.count(model.unreadableCount)) skipped")
            }
            if model.neverStartedCount > 0 {
                parts.append("\(Mutuals.count(model.neverStartedCount)) not reached")
            }
            readSub = parts.isEmpty ? "every one" : parts.joined(separator: ", ")
        }
        let matching = model.matching
        return LazyVGrid(columns: columns, spacing: 10) {
            MutualsStat(label: "Mutuals", value: Mutuals.count(model.mutuals.count), sub: "of \(Mutuals.count(model.follows.count)) follows")
            MutualsStat(label: "Read", value: Mutuals.count(model.mutualsRead), sub: readSub)
            MutualsStat(
                label: "Block records",
                value: Mutuals.count(model.blocksRead),
                sub: "\(Mutuals.count(Mutuals.countAtLeast(model.counts, 1))) accounts"
            )
            MutualsStat(
                label: "Blocked by \(model.threshold) or more",
                value: Mutuals.count(matching),
                sub: matching > 0 ? "up to \(Mutuals.count(model.highest)) mutuals" : "none yet"
            )
        }
    }

    private func focusBanner(_ person: MutualsPerson) -> some View {
        HStack(spacing: 10) {
            AvatarView(url: person.avatar, size: 22)
            Text("Showing only the accounts \(Mutuals.who(person)) blocks")
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textPrimary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            Button {
                model.setFocus(nil)
            } label: {
                Label("Show all", systemImage: "xmark")
            }
            .buttonStyle(.aturiSecondary)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }

    private var intro: some View {
        ToolSection("How it works") {
            VStack(alignment: .leading, spacing: 12) {
                MutualsIntroItem(term: "Find the mutuals", text: "Everyone the account follows who follows it back, from Bluesky\u{2019}s AppView.")
                MutualsIntroItem(
                    term: "Read their blocks",
                    text: "Blocks are public. Each mutual\u{2019}s app.bsky.graph.block records are read from its own PDS, every page of them, along with the moderation lists it blocks."
                )
                MutualsIntroItem(
                    term: "See where they agree",
                    text: "How many mutuals block each account, and a list ranked by agreement. Move the threshold and everything follows."
                )
                MutualsIntroItem(
                    term: "Save the ones you choose",
                    text: "Sign in and the ticked accounts become a moderation list on your account, which you can subscribe to, block, or share."
                )
            }
        }
    }
}

/// The stack a page was pushed on, and how deep it was, when it appeared.
private struct MutualsStackDepth: Equatable {
    let tab: Tab
    let count: Int
}

// MARK: - Pieces

/// The scan's heading: what it is doing, or what it found.
private struct MutualsVerdict: View {
    let title: String
    let text: String
    let running: Bool

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            Group {
                if running {
                    ProgressView()
                        .controlSize(.small)
                } else {
                    Image(systemName: "person.2")
                        .foregroundStyle(theme.textAccent)
                }
            }
            .frame(width: 20)
            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(AturiFont.sans(.subheadline, weight: .semibold))
                    .foregroundStyle(theme.textPrimary)
                    .monospacedDigit()
                    .fixedSize(horizontal: false, vertical: true)
                Text(text)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
        .accessibilityElement(children: .combine)
    }
}

private struct MutualsStat: View {
    let label: String
    let value: String
    let sub: String

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .aturiLabel()
                .foregroundStyle(theme.textTertiary)
                .lineLimit(2)
            Text(value)
                .font(AturiFont.sans(.title3, weight: .semibold))
                .monospacedDigit()
                .foregroundStyle(theme.textPrimary)
                .lineLimit(1)
                .minimumScaleFactor(0.7)
            Text(sub)
                .font(AturiFont.caption)
                .foregroundStyle(theme.textSecondary)
                .lineLimit(2)
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 92, alignment: .topLeading)
        .cardBackground()
        .accessibilityElement(children: .combine)
    }
}

private struct MutualsIntroItem: View {
    let term: String
    let text: String

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(term)
                .font(AturiFont.sans(.subheadline, weight: .semibold))
                .foregroundStyle(theme.textPrimary)
            Text(text)
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .combine)
    }
}

/// Every mutual, in the order they were found, marked as it is read: a face
/// each while they fit, a dot each past that, shaded by how many accounts it
/// blocks. Choosing one shows only the accounts it blocks. Port of
/// `MutualWall` in `MutualBlocksCharts.tsx`.
private struct MutualsWall: View {
    let model: MutualsModel

    /// Past this many mutuals the wall is drawn in dots rather than faces.
    private static let facesUpTo = 160

    @Environment(\.aturiTheme) private var theme

    private var faces: Bool {
        model.mutuals.count <= Self.facesUpTo
    }

    var body: some View {
        let most = model.states.map(\.blocks).max() ?? 0
        let columns = [GridItem(.adaptive(minimum: faces ? 32 : 14), spacing: 4)]
        VStack(alignment: .leading, spacing: 10) {
            LazyVGrid(columns: columns, alignment: .leading, spacing: 4) {
                ForEach(Array(model.mutuals.enumerated()), id: \.element.did) { index, person in
                    tile(index: index, person: person, most: most)
                }
            }
            Text(note)
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
            if model.isDone, model.unreadableCount > 0 {
                Text("\(Mutuals.count(model.unreadableCount)) \(model.unreadableCount == 1 ? "mutual" : "mutuals") could not be read, marked with a red ring. Press and hold one to see why.")
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if model.isDone {
                Button {
                    model.rescan()
                } label: {
                    Label("Scan again", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.aturiSecondary)
            }
        }
    }

    private var note: String {
        let lead = faces
            ? "One face per mutual, in the order they were found. "
            : "One dot per mutual, more strongly coloured the more accounts it blocks. "
        return lead + "Choose one to see only the accounts it blocks."
    }

    private func tile(index: Int, person: MutualsPerson, most: Int) -> some View {
        let state = model.states.indices.contains(index) ? model.states[index] : .queued
        let focused = model.focus == index
        let title = state.title(for: person)
        return Button {
            model.setFocus(focused ? nil : index)
        } label: {
            mark(state: state, person: person, most: most, focused: focused)
        }
        .buttonStyle(.plain)
        .disabled(!state.isDone || state.blocks == 0)
        .contextMenu {
            Text(title)
        }
        .accessibilityLabel(title)
        .accessibilityAddTraits(focused ? .isSelected : [])
    }

    @ViewBuilder
    private func mark(state: MutualsReadState, person: MutualsPerson, most: Int, focused: Bool) -> some View {
        let ring: Color = focused ? theme.textAccent : (state.isUnreadable ? theme.danger : Color.clear)
        let dimmed = state.isQueued || state.isStopped
        if faces {
            AvatarView(url: person.avatar, size: 28)
                .opacity(dimmed ? 0.35 : 1)
                .overlay(Circle().strokeBorder(ring, lineWidth: 2))
                .overlay(alignment: .bottomTrailing) {
                    if state.isReading {
                        Circle()
                            .fill(theme.statusLive)
                            .frame(width: 8, height: 8)
                    }
                }
                .frame(width: 32, height: 32)
        } else {
            Circle()
                .fill(dotColor(state: state, most: most))
                .overlay(Circle().strokeBorder(ring, lineWidth: 1.5))
                .frame(width: 12, height: 12)
                .frame(width: 14, height: 14)
        }
    }

    private func dotColor(state: MutualsReadState, most: Int) -> Color {
        switch state {
        case .queued:
            return theme.borderSubtle
        case .reading:
            return theme.statusLive.opacity(0.6)
        case .skipped:
            return theme.borderMedium
        case .done(let blocks, _):
            let level = Self.level(blocks, most)
            return level == 0 ? theme.borderStrong : theme.accent.opacity(0.25 + 0.1875 * Double(level))
        }
    }

    /// How dark a finished mutual's dot is: its blocks against the most anyone has.
    private static func level(_ blocks: Int, _ most: Int) -> Int {
        if blocks == 0 || most == 0 { return 0 }
        let ratio = log(Double(blocks) + 1) / log(Double(most) + 1)
        return min(4, 1 + Int((ratio * 3.999).rounded(.down)))
    }
}

/// How many accounts are blocked by each number of mutuals, as columns,
/// with the threshold set on it. The counts fall away steeply, thousands
/// blocked by one and a handful by many, so the height is on a log scale.
/// Columns at or past the threshold are filled; choosing a column moves the
/// threshold to it, as does the stepper underneath. Port of `Distribution`
/// in `MutualBlocksCharts.tsx`.
private struct MutualsDistribution: View {
    let model: MutualsModel

    private static let plotHeight: CGFloat = 120

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        let bins = model.bins
        let tallest = bins.map(\.count).max() ?? 0
        let threshold = model.threshold
        let top = max(threshold, model.highest, 1)
        VStack(alignment: .leading, spacing: 10) {
            Text(model.summary)
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            HStack(alignment: .bottom, spacing: 2) {
                ForEach(bins) { bin in
                    column(bin, tallest: tallest, threshold: threshold)
                }
            }
            .frame(height: Self.plotHeight)
            HStack {
                Text("1")
                Spacer()
                Text("Mutuals blocking the account")
                Spacer()
                Text(Mutuals.count(model.highest))
            }
            .font(AturiFont.caption)
            .foregroundStyle(theme.textTertiary)
            .accessibilityHidden(true)
            Stepper(
                value: Binding(get: { threshold }, set: { model.setThreshold($0) }),
                in: 1...top
            ) {
                Text("Blocked by at least \(Mutuals.count(threshold))")
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textPrimary)
                    .monospacedDigit()
            }
        }
    }

    private func column(_ bin: Mutuals.Bin, tallest: Int, threshold: Int) -> some View {
        let on = bin.to >= threshold
        let height = Self.plotHeight * Self.scale(bin.count, tallest)
        return Button {
            model.setThreshold(bin.from)
        } label: {
            VStack(spacing: 0) {
                Spacer(minLength: 0)
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(on ? theme.accent : theme.borderStrong)
                    .frame(height: bin.count > 0 ? max(2, height) : 0)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(Self.sentence(bin)). Set the threshold to \(bin.from).")
    }

    private static func scale(_ count: Int, _ tallest: Int) -> CGFloat {
        guard count > 0, tallest > 0 else { return 0 }
        return CGFloat(log10(Double(count) + 1) / log10(Double(tallest) + 1))
    }

    private static func sentence(_ bin: Mutuals.Bin) -> String {
        let accounts = bin.count == 1 ? "1 account is" : "\(Mutuals.count(bin.count)) accounts are"
        if bin.from == bin.to {
            return "\(accounts) blocked by exactly \(Mutuals.count(bin.from)) \(bin.from == 1 ? "mutual" : "mutuals")"
        }
        return "\(accounts) blocked by \(Mutuals.count(bin.from))\u{2013}\(Mutuals.count(bin.to)) mutuals"
    }
}

/// The ranked accounts, with who blocks each and a tick for the list.
private struct MutualsAccountsSection: View {
    let model: MutualsModel

    @Environment(AppRouter.self) private var router
    @Environment(\.aturiTheme) private var theme

    var body: some View {
        let shown = model.shownCandidates
        ToolSection("Accounts", detail: "\(Mutuals.count(model.selected.count)) of \(Mutuals.count(model.ranked.count)) ticked for the list") {
            if !shown.isEmpty, !model.described {
                SkeletonRows(count: 6)
            } else if shown.isEmpty {
                Text("No account is blocked by that many mutuals. Lower the threshold above.")
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                list
            }
        }
    }

    @ViewBuilder
    private var list: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Button("Tick all") {
                    model.tickAll(true)
                }
                .buttonStyle(.aturiSecondary)
                Button("Untick all") {
                    model.tickAll(false)
                }
                .buttonStyle(.aturiSecondary)
                if !model.ticks.isEmpty {
                    Button("Back to the defaults") {
                        model.resetTicks()
                    }
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textAccent)
                }
            }
            Text("Accounts \(model.name) follows and mutuals start unticked.")
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.bottom, 8)
        let rows = model.rows
        LazyVStack(alignment: .leading, spacing: 0) {
            ForEach(Array(rows.enumerated()), id: \.element.did) { index, candidate in
                if index > 0 {
                    Divider()
                }
                MutualsCandidateRow(model: model, candidate: candidate)
            }
        }
        let present = model.present.count
        if present > rows.count {
            HStack {
                Button("Show \(Mutuals.count(min(MutualsModel.pageSize, present - rows.count))) more") {
                    model.showMore()
                }
                .buttonStyle(.aturiSecondary)
                Spacer(minLength: 8)
                Text("\(Mutuals.count(rows.count)) of \(Mutuals.count(present)) shown")
                    .font(AturiFont.footnote)
                    .monospacedDigit()
                    .foregroundStyle(theme.textTertiary)
            }
            .padding(.top, 10)
        }
        let gone = model.goneCount
        if gone > 0 {
            Text("\(Mutuals.count(gone)) \(gone == 1 ? "account that no longer exists is" : "accounts that no longer exist are") left out: deleted, deactivated or taken down since they were blocked.")
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.top, 8)
        }
    }
}

/// One ranked account: its tick, who it is, what the scanned account has to
/// do with it, and how many mutuals block it, opening to which ones.
private struct MutualsCandidateRow: View {
    let model: MutualsModel
    let candidate: Mutuals.Candidate

    /// Blockers shown by face before the rest are counted.
    private static let rowFaces = 5

    @Environment(AppRouter.self) private var router
    @Environment(\.aturiTheme) private var theme

    var body: some View {
        let profile = model.profiles[candidate.did]
        let flags = model.flags(candidate.did)
        let ticked = model.isTicked(candidate.did)
        let expanded = model.expanded == candidate.did
        let people = model.mutuals
        let blockers: [MutualsPerson] = candidate.blockers.compactMap { index -> MutualsPerson? in
            people.indices.contains(index) ? people[index] : nil
        }
        let read = model.mutualsRead
        let who = profile.map { Mutuals.who($0) } ?? candidate.did
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .top, spacing: 10) {
                Button {
                    model.tick(candidate.did, !ticked)
                } label: {
                    Image(systemName: ticked ? "checkmark.square.fill" : "square")
                        .font(.title3)
                        .foregroundStyle(ticked ? theme.textAccent : theme.textTertiary)
                        .frame(width: 28, height: 28)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Put \(who) on the list")
                .accessibilityValue(ticked ? "Ticked" : "Not ticked")
                AvatarView(url: profile?.avatar, size: 36)
                VStack(alignment: .leading, spacing: 3) {
                    Button {
                        router.open(.repo(candidate.did))
                    } label: {
                        Text(title(profile))
                            .font(AturiFont.sans(.subheadline, weight: .semibold))
                            .foregroundStyle(theme.textPrimary)
                            .multilineTextAlignment(.leading)
                            .lineLimit(2)
                    }
                    .buttonStyle(.plain)
                    if let sub = subtitle(profile) {
                        Text(sub)
                            .font(profile == nil ? AturiFont.monoSmall : AturiFont.footnote)
                            .foregroundStyle(theme.textSecondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    chips(flags)
                }
                Spacer(minLength: 4)
                VStack(alignment: .trailing, spacing: 4) {
                    Text("\(Mutuals.count(candidate.blockers.count)) / \(Mutuals.count(read))")
                        .font(AturiFont.caption)
                        .monospacedDigit()
                        .foregroundStyle(theme.textSecondary)
                    ProgressView(value: read > 0 ? min(1, Double(candidate.blockers.count) / Double(read)) : 0)
                        .tint(theme.accent)
                        .frame(width: 56)
                        .accessibilityHidden(true)
                    Button {
                        model.toggleExpanded(candidate.did)
                    } label: {
                        HStack(spacing: -6) {
                            ForEach(blockers.prefix(Self.rowFaces)) { person in
                                AvatarView(url: person.avatar, size: 18)
                            }
                            Image(systemName: expanded ? "chevron.up" : "chevron.down")
                                .font(.caption2)
                                .foregroundStyle(theme.textTertiary)
                                .padding(.leading, 8)
                        }
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Blocked by \(blockers.count) mutuals. \(expanded ? "Hide" : "Show") them.")
                }
            }
            if expanded {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(blockers) { person in
                        Button {
                            router.open(.repo(person.did))
                        } label: {
                            HStack(spacing: 6) {
                                AvatarView(url: person.avatar, size: 18)
                                Text(Mutuals.who(person))
                                    .font(AturiFont.footnote)
                                    .foregroundStyle(theme.textAccent)
                                    .lineLimit(1)
                            }
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.leading, 38)
            }
        }
        .padding(.vertical, 10)
        .opacity(ticked ? 1 : 0.7)
    }

    private func title(_ profile: MutualsPerson?) -> String {
        if let profile {
            return profile.displayName ?? Mutuals.who(profile)
        }
        return model.missingProfiles.contains(candidate.did) ? "Account not found" : candidate.did
    }

    private func subtitle(_ profile: MutualsPerson?) -> String? {
        guard let profile else { return candidate.did }
        return profile.displayName != nil ? Mutuals.who(profile) : nil
    }

    @ViewBuilder
    private func chips(_ flags: Mutuals.CandidateFlags) -> some View {
        if flags.mutual || flags.followed || flags.blocked {
            HStack(spacing: 6) {
                if flags.mutual {
                    Chip("Mutual", systemImage: "person.2.fill")
                } else if flags.followed {
                    Chip("Followed", systemImage: "person.fill.checkmark")
                }
                if flags.blocked {
                    Chip("Already blocked", systemImage: "nosign")
                }
            }
        }
    }
}

/// The moderation lists the mutuals block wholesale.
private struct MutualsListsSection: View {
    let model: MutualsModel

    @Environment(AppRouter.self) private var router
    @Environment(\.openURL) private var openURL
    @Environment(\.aturiTheme) private var theme

    var body: some View {
        let subscriptions = model.listSubscriptions
        let count = subscriptions.count
        ToolSection("Block lists your mutuals use", detail: "\(Mutuals.count(count)) \(count == 1 ? "list" : "lists")") {
            Text("Moderation lists your mutuals block wholesale. Their members are not counted above; each list would take a request per hundred members to open.")
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
                .padding(.bottom, 8)
            ForEach(Array(subscriptions.prefix(MutualsModel.listsShown))) { subscription in
                row(subscription)
            }
        }
    }

    private func row(_ subscription: Mutuals.ListSubscription) -> some View {
        let description = model.lists[subscription.uri]
        var info: MutualsListInfo?
        if case .available(let available)? = description {
            info = available
        }
        let subscribers = subscription.subscribers.count
        let title: String
        if let info {
            title = info.name
        } else if description == nil {
            title = "Loading\u{2026}"
        } else {
            title = "List not available"
        }
        return HStack(alignment: .top, spacing: 10) {
            AvatarView(url: info?.avatar, size: 32, squareCornerRadius: 6)
            VStack(alignment: .leading, spacing: 3) {
                Button {
                    router.open(atUri: subscription.uri)
                } label: {
                    Text(title)
                        .font(AturiFont.sans(.subheadline, weight: .semibold))
                        .foregroundStyle(theme.textPrimary)
                        .multilineTextAlignment(.leading)
                }
                .buttonStyle(.plain)
                if let info {
                    Text(byline(info))
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .lineLimit(2)
                } else {
                    Text(subscription.uri)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textTertiary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 6) {
                Chip("\(Mutuals.count(subscribers)) \(subscribers == 1 ? "mutual" : "mutuals")")
                if info != nil, let url = Mutuals.bskyListUrl(subscription.uri).flatMap({ URL(string: $0) }) {
                    Button {
                        openURL(url)
                    } label: {
                        Image(systemName: "arrow.up.forward.square")
                    }
                    .buttonStyle(.plain)
                    .foregroundStyle(theme.textAccent)
                    .accessibilityLabel("Open \(title) in Bluesky, to subscribe to it")
                }
            }
        }
        .padding(.vertical, 8)
    }

    private func byline(_ info: MutualsListInfo) -> String {
        var text = "by \(Mutuals.who(info.creator))"
        if let members = info.memberCount {
            text += " \u{00B7} \(Mutuals.count(members)) \(members == 1 ? "account" : "accounts")"
        }
        return text
    }
}

/// Save the ticked accounts as a moderation list on the signed-in account,
/// port of `MutualBlocksSave.tsx`. The list is written by the person's own
/// session, into their own repository; signing in happens in a sheet over
/// the page, so the scan stays as it is.
private struct MutualsSaveCard: View {
    let model: MutualsModel

    @State private var showsSignIn = false

    @Environment(AppRouter.self) private var router
    @Environment(\.sessionStore) private var session
    @Environment(\.openURL) private var openURL
    @Environment(\.aturiTheme) private var theme

    var body: some View {
        Group {
            if let did = session.state.did {
                if let saving = model.saving {
                    progress(saving)
                } else {
                    form(did: did)
                }
            } else {
                signedOut
            }
        }
        .sheet(isPresented: $showsSignIn) {
            SignInSheet(defaultInput: model.account?.handle ?? model.account?.did ?? "")
        }
    }

    private var signedOut: some View {
        let count = model.selected.count
        return VStack(alignment: .leading, spacing: 10) {
            Text("Sign in to save the \(Mutuals.count(count)) ticked \(count == 1 ? "account" : "accounts") as a moderation list on your account. Allow Create when asked which permissions to grant.")
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                showsSignIn = true
            } label: {
                Label("Sign in", systemImage: "person.crop.circle.badge.plus")
            }
            .buttonStyle(.aturiPrimary)
        }
    }

    /// The writes go through the session: one `createRecord` per member,
    /// since the session layer has no batched create yet. Pacing, Stop and
    /// "add the remaining" work the same either way.
    private func writer(did: String) -> MutualsListWriter {
        let session = self.session
        return MutualsListWriter(
            did: did,
            batchSize: 1,
            createRecord: { collection, record in
                try await session.createRecord(collection: collection, rkey: nil, value: record)
            },
            createListItems: { records in
                for record in records {
                    _ = try await session.createRecord(collection: Mutuals.listItemCollection, rkey: nil, value: record)
                }
            }
        )
    }

    private func form(did: String) -> some View {
        let selected = model.selected.count
        let points = model.savePoints
        let allowed = model.scopeAllows(session.state.session?.scope)
        let ready = selected > 0 && model.listNameProblem == nil && model.listDescriptionProblem == nil && allowed != false
        let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
        return VStack(alignment: .leading, spacing: 10) {
            if did != model.account?.did {
                Text("The list will be made on the account you are signed in with, not the one that was scanned.")
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("Name")
                    .font(AturiFont.caption)
                    .foregroundStyle(theme.textTertiary)
                TextField("Name", text: Binding(get: { model.listName }, set: { model.listName = $0 }))
                    .font(AturiFont.body)
                    .padding(.horizontal, 12)
                    .frame(minHeight: 44)
                    .background(theme.bgSecondary, in: shape)
                    .overlay(shape.strokeBorder(theme.borderStrong, lineWidth: 1))
                if let problem = model.listNameProblem {
                    problemText(problem)
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text("Description")
                    .font(AturiFont.caption)
                    .foregroundStyle(theme.textTertiary)
                TextEditor(text: Binding(get: { model.listDescription }, set: { model.editedDescription = $0 }))
                    .font(AturiFont.footnote)
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 88)
                    .padding(6)
                    .background(theme.bgSecondary, in: shape)
                    .overlay(shape.strokeBorder(theme.borderStrong, lineWidth: 1))
                if let problem = model.listDescriptionProblem {
                    problemText(problem)
                }
            }
            Toggle(isOn: Binding(get: { model.blockAfterSaving }, set: { model.blockAfterSaving = $0 })) {
                Text("Block everyone on it once it is made")
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textPrimary)
            }
            .tint(theme.accent)
            if allowed == false {
                ErrorPanel(message: "This sign-in did not grant permission to create records, so the list cannot be written. Sign out and sign in again with Create ticked.")
            }
            Text(pointsNote(selected: selected, points: points))
                .font(AturiFont.footnote)
                .monospacedDigit()
                .foregroundStyle(theme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
            Button {
                model.save(with: writer(did: did))
            } label: {
                Label("Create list", systemImage: "list.bullet.rectangle.portrait")
            }
            .buttonStyle(.aturiPrimary)
            .disabled(!ready)
        }
    }

    private func pointsNote(selected: Int, points: Int) -> String {
        guard selected > 0 else { return "Tick at least one account above." }
        var text = "\(Mutuals.count(selected)) \(selected == 1 ? "account" : "accounts"), \(Mutuals.count(points)) write points."
        if Double(points) > Double(WriteThrottle.hourlyPointBudget) * 0.9 {
            text += " Your PDS allows \(Mutuals.count(WriteThrottle.hourlyPointBudget)) an hour, so this pauses partway and carries on by itself while this page stays open."
        }
        return text
    }

    private func problemText(_ text: String) -> some View {
        Text(text)
            .font(AturiFont.footnote)
            .foregroundStyle(theme.danger)
            .fixedSize(horizontal: false, vertical: true)
    }

    // MARK: After a save has started

    private func progress(_ saving: MutualsSaving) -> some View {
        let name = model.listName.trimmingCharacters(in: .whitespacesAndNewlines)
        let listUrl = saving.listUri.flatMap { Mutuals.bskyListUrl($0) }.flatMap { URL(string: $0) }
        return VStack(alignment: .leading, spacing: 10) {
            if saving.running {
                running(saving, name: name)
            } else if saving.finished, let outcome = saving.outcome {
                ToolCheckRow(status: .pass, title: "Your list is live", detail: finishedText(outcome, saving: saving, name: name))
            } else {
                ToolCheckRow(
                    status: .warn,
                    title: saving.listUri == nil ? "The list was not made" : "The list is not finished",
                    detail: unfinishedText(saving)
                )
            }
            if !saving.running {
                actions(saving, listUrl: listUrl)
            }
        }
    }

    private func running(_ saving: MutualsSaving, name: String) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            ToolCheckRow(
                status: .pending,
                title: saving.listUri == nil ? "Creating \u{201C}\(name)\u{201D}" : "Adding accounts to \u{201C}\(name)\u{201D}",
                detail: waitingText(saving.progress)
            )
            if let progress = saving.progress {
                HStack(spacing: 10) {
                    ProgressView(value: progress.total > 0 ? Double(progress.done) / Double(progress.total) : 0)
                        .tint(theme.accent)
                    Text("\(Mutuals.count(progress.done)) / \(Mutuals.count(progress.total))")
                        .font(AturiFont.monoSmall)
                        .monospacedDigit()
                        .foregroundStyle(theme.textSecondary)
                    Button("Stop") {
                        model.stopSaving()
                    }
                    .buttonStyle(.aturiSecondary)
                    .accessibilityHint("Stops after the account being written")
                }
            }
        }
    }

    private func waitingText(_ progress: MutualsAddProgress?) -> String {
        if let seconds = progress?.waitingSeconds {
            return "Waiting \(seconds)s for your PDS\u{2019}s write budget, then carrying on. Keep this page open."
        }
        return "Writing to your repository, one record at a time."
    }

    private func finishedText(_ outcome: MutualsAddOutcome, saving: MutualsSaving, name: String) -> String {
        var text = "\(Mutuals.count(outcome.added)) \(outcome.added == 1 ? "account" : "accounts") on \u{201C}\(name)\u{201D}."
        if saving.blocked {
            text += " You are blocking everyone on it."
        } else if let blockError = saving.blockError {
            text += " Blocking it failed (\(blockError)); subscribe to it in Bluesky instead."
        } else {
            text += " Subscribe to it in Bluesky to mute or block everyone on it."
        }
        return text
    }

    private func unfinishedText(_ saving: MutualsSaving) -> String {
        var text: String
        if let error = saving.error {
            text = "The list could not be created: \(error)"
        } else if let outcome = saving.outcome {
            switch outcome.endedBy {
            case .rateLimit?:
                text = "Your PDS\u{2019}s write limit was reached after \(Mutuals.count(outcome.added))."
            case .stop?:
                text = "Stopped after \(Mutuals.count(outcome.added))."
            case .error?, nil:
                let reason = outcome.error.map { ": \($0)" } ?? "."
                text = "\(Mutuals.count(outcome.added)) added before a write failed\(reason)"
            }
        } else {
            text = "Nothing was written."
        }
        if let remaining = saving.outcome?.remaining.count, remaining > 0 {
            text += " \(Mutuals.count(remaining)) still to add."
        }
        return text
    }

    @ViewBuilder
    private func actions(_ saving: MutualsSaving, listUrl: URL?) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if let listUrl {
                Button {
                    openURL(listUrl)
                } label: {
                    Label("Open in Bluesky", systemImage: "arrow.up.forward.square")
                }
                .buttonStyle(.aturiSecondary)
            }
            if let uri = saving.listUri {
                Button {
                    router.open(atUri: uri)
                } label: {
                    Label("Open in the Explorer", systemImage: "list.bullet.rectangle")
                }
                .buttonStyle(.aturiSecondary)
            }
            if saving.finished, let listUrl, let share = shareURL(listUrl) {
                Button {
                    openURL(share)
                } label: {
                    Label("Share it", systemImage: "square.and.arrow.up")
                }
                .buttonStyle(.aturiSecondary)
            }
            if saving.listUri != nil, let remaining = saving.outcome?.remaining, !remaining.isEmpty, let did = session.state.did {
                Button("Add the remaining \(Mutuals.count(remaining.count))") {
                    model.addRemaining(with: writer(did: did))
                }
                .buttonStyle(.aturiPrimary)
            }
            if saving.finished || saving.listUri == nil {
                Button("Make another list") {
                    model.resetSaving()
                }
                .buttonStyle(.aturiSecondary)
            }
        }
    }

    /// Bluesky's compose intent, with the list's link in the post.
    private func shareURL(_ listUrl: URL) -> URL? {
        var components = URLComponents(string: "https://bsky.app/intent/compose")
        components?.queryItems = [
            URLQueryItem(name: "text", value: "I made a moderation list of accounts many of my mutuals block. \(listUrl.absoluteString)"),
        ]
        return components?.url
    }
}
