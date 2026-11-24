import SwiftUI
import Observation
import AturiCore

/// The PDS page (`/explore/pds/{host}`), port of `PdsExplorer.tsx`'s
/// classic page in one column: the server's facts (with the workbench
/// overview's, such as where its accounts sign in and its sign-up rules),
/// what the relays know of it, and the accounts it hosts. The accounts are
/// found by handle, display name or DID, narrowed by status and last
/// commit, put in any of the web's orders and drawn a few hundred at a
/// time; each row opens the account's repository. The logic is `PDSModel`
/// and `PDSExplorer` in AturiCore.
struct PDSView: View {
    @State private var model: PDSModel

    @Environment(\.aturiTheme) private var theme

    /// `query` is a link's accounts filters and order (`?status=`,
    /// `?commit=`, `?sort=`, `?dir=`), read as the web's PDS page reads its
    /// address, so a filtered, sorted list sent as a link opens as sent.
    init(host: String, query: [String: String] = [:]) {
        let model = PDSModel(host: host)
        if !query.isEmpty,
           let location = PDSExplorer.parse(path: "/explore/pds/" + URIEncoding.encodeComponent(host), query: query) {
            model.status = location.status
            model.commit = location.commit
            model.setOrder(location.sort, desc: location.desc)
        }
        _model = State(initialValue: model)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                // What the relays know of this host, once it has answered
                // as a PDS: a name that is not one would only collect four
                // "not known"s.
                if model.server.value != nil {
                    relaysSection
                }
                accountsSection
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(theme.bgPrimary)
        .navigationTitle(model.host)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let url = shareURL {
                ToolbarItem(placement: .topBarTrailing) {
                    ShareLink(item: url) {
                        Image(systemName: "square.and.arrow.up")
                    }
                    .accessibilityLabel("Share")
                }
            }
        }
        .task {
            if model.server.isIdle {
                model.load()
            }
        }
        .refreshable {
            await model.load().value
        }
    }

    /// The page with the list's filters and order, as the web writes them.
    private var shareURL: URL? {
        URL(string: Endpoints.aturiBase.absoluteString + model.sharePath)
    }

    // MARK: The server

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Personal Data Server", systemImage: "server.rack")
                .aturiLabel()
                .foregroundStyle(theme.textTertiary)
            Text(model.host)
                .font(AturiFont.monoFont(.title2))
                .foregroundStyle(theme.textPrimary)
                .lineLimit(2)
                .truncationMode(.middle)
                .textSelection(.enabled)
            if let message = model.serverErrorMessage {
                Text(message)
                    .font(AturiFont.footnote.italic())
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            switch model.server {
            case .idle, .loading:
                SkeletonRows(count: 2)
            case .failed, .loaded:
                serverCells
            }
            NavigationLink(value: Route.tool(slug: "relay", query: [RelayCheckModel.queryKey: model.hostname])) {
                Label("Relay crawl check", systemImage: "antenna.radiowaves.left.and.right")
            }
            .buttonStyle(.aturiSecondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }

    /// The overview's facts (`ServerCard` in `explore/pds/PdsOverview.tsx`).
    private var serverCells: some View {
        let info = model.server.value
        return VStack(alignment: .leading, spacing: 0) {
            CopyRow(label: "Endpoint", value: model.pdsBase)
            if let did = info?.did, !did.isEmpty {
                Divider()
                CopyRow(label: "Server DID", value: did)
            }
            if let version = model.version {
                Divider()
                cell("Version") {
                    Text(version)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textPrimary)
                        .textSelection(.enabled)
                }
            }
            if !model.signIn.isEmpty {
                Divider()
                cell("Sign-in") {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(model.signIn, id: \.self) { place in
                            signInLine(place)
                        }
                    }
                }
            }
            if let domains = info?.availableUserDomains, !domains.isEmpty {
                Divider()
                cell("New handles") {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(domains, id: \.self) { domain in
                                Chip(domain, style: .accent)
                            }
                        }
                    }
                }
            }
            if let invite = info?.inviteCodeRequired {
                Divider()
                cell("Invite code") {
                    factText(invite ? "Required to sign up" : "Not required")
                }
            }
            if let phone = info?.phoneVerificationRequired {
                Divider()
                cell("Phone check") {
                    factText(phone ? "Required to sign up" : "Not required")
                }
            }
            if let email = info?.contact?.email, !email.isEmpty {
                Divider()
                OutboundLinkRow(title: "Contact", url: "mailto:\(email)", detail: email, systemImage: "envelope")
            }
            if let privacy = info?.links?.privacyPolicy, PDSExplorer.isWebLink(privacy) {
                Divider()
                OutboundLinkRow(title: "Privacy policy", url: privacy, systemImage: "arrow.up.right")
            }
            if let terms = info?.links?.termsOfService, PDSExplorer.isWebLink(terms) {
                Divider()
                OutboundLinkRow(title: "Terms of service", url: terms, systemImage: "arrow.up.right")
            }
        }
    }

    /// Where accounts sign in: here, or through another host, which has a
    /// PDS page of its own.
    @ViewBuilder
    private func signInLine(_ place: PDSExplorer.SignIn) -> some View {
        switch place {
        case .onThisPDS:
            factText("On this PDS")
        case .through(let host):
            NavigationLink(value: Route.pds(host: host)) {
                HStack(spacing: 4) {
                    Text("Through")
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textPrimary)
                    Text(host)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textAccent)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
            }
            .buttonStyle(.plain)
            .accessibilityHint("Accounts here sign in at \(host)")
        }
    }

    private func factText(_ text: String) -> some View {
        Text(text)
            .font(AturiFont.footnote)
            .foregroundStyle(theme.textPrimary)
    }

    private func cell<Content: View>(_ label: String, @ViewBuilder content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(label)
                .aturiLabel()
                .foregroundStyle(theme.textTertiary)
            content()
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 6)
    }

    // MARK: The relays

    private var relaysSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                SectionHeader("Relays", detail: relaysDetail)
                Button {
                    _ = model.relays.rerun()
                } label: {
                    Text(model.relays.isLoading ? "Asking\u{2026}" : "Ask again")
                        .font(AturiFont.caption)
                }
                .disabled(model.relays.isLoading)
            }
            RelayStatusRows(results: model.relays.results, compact: true)
                .padding(.horizontal, 12)
                .frame(maxWidth: .infinity, alignment: .leading)
                .cardBackground()
        }
    }

    /// How many accounts the relays count on the host, the overview's
    /// "Hosted" figure; nil until one has counted any.
    private var relaysDetail: String? {
        guard let count = model.relays.accountCount else { return nil }
        return "\(count.formatted()) \(count == 1 ? "account" : "accounts"), per the relays"
    }

    // MARK: The accounts

    private var accountsSection: some View {
        @Bindable var bindable = model
        let listing = model.listing
        let now = Date()
        return VStack(alignment: .leading, spacing: 10) {
            SectionHeader("Accounts on this PDS", detail: model.countLabel(listing))
            if let message = model.firstPageFailedMessage {
                VStack(alignment: .leading, spacing: 10) {
                    EmptyState(title: message, detail: model.reposError, systemImage: "exclamationmark.triangle")
                    Button("Try again") {
                        _ = model.load()
                    }
                    .buttonStyle(.aturiSecondary)
                }
            } else if let message = model.emptyMessage {
                EmptyState(title: message, systemImage: "tray")
            } else {
                ExploreFilterField("Find a handle, name or DID", text: $bindable.filter, label: "Find an account on this PDS")
                filterBar(model.facets)
                if model.showsSkeleton {
                    SkeletonRows(count: 8)
                } else if let message = model.noMatchText(listing) {
                    EmptyState(title: message, systemImage: "line.3.horizontal.decrease")
                } else if !listing.drawn.isEmpty {
                    accountRows(listing, now: now)
                }
                if listing.hasMoreToDraw {
                    Button("Show \(listing.nextDraw(step: PDSModel.drawStep)) more") {
                        model.showMore()
                    }
                    .buttonStyle(.aturiSecondary)
                }
                if listing.total > 0 {
                    footer
                }
            }
        }
    }

    private func accountRows(_ listing: PDSAccountListing, now: Date) -> some View {
        let lastId = listing.drawn.last?.id
        return LazyVStack(spacing: 0) {
            ForEach(listing.drawn) { row in
                NavigationLink(value: Route.repo(row.handle ?? row.did)) {
                    accountRow(row, now: now)
                }
                .buttonStyle(.plain)
                if row.id != lastId {
                    Divider()
                }
            }
        }
        .cardBackground()
    }

    /// One account: avatar, handle (or its DID while there is none),
    /// display name, DID, status and last commit.
    private func accountRow(_ row: PDSRepoRow, now: Date) -> some View {
        HStack(alignment: .top, spacing: 10) {
            avatar(row)
            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text(row.label)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(row.handle == nil ? theme.textSecondary : theme.textPrimary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                    Spacer(minLength: 4)
                    Text(row.commitLabel(now: now) ?? "\u{2014}")
                        .font(AturiFont.caption2)
                        .foregroundStyle(row.isDormant(now: now) ? theme.textFaint : theme.textTertiary)
                        .accessibilityLabel(row.commitTitle)
                }
                if let name = row.displayName {
                    Text(name)
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .lineLimit(1)
                }
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    if row.handle != nil {
                        Text(row.did)
                            .font(AturiFont.monoFont(.caption2))
                            .foregroundStyle(theme.textTertiary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                    Spacer(minLength: 4)
                    standingMark(row)
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }

    /// The avatar, or the handle's initial on the accent while there is
    /// none (`AccountAvatar` in `explore/pds/parts.tsx`).
    @ViewBuilder
    private func avatar(_ row: PDSRepoRow) -> some View {
        if let url = row.avatar {
            AvatarView(url: url, size: 32)
        } else {
            ZStack {
                Circle()
                    .fill(theme.accentSoft)
                Text(row.initial)
                    .font(AturiFont.sans(.footnote, weight: .semibold))
                    .foregroundStyle(theme.accentSoftFg)
            }
            .frame(width: 32, height: 32)
            .accessibilityHidden(true)
        }
    }

    /// How the account stands, in words with a dot in its tone; quiet for
    /// active (`StatusMark` in `explore/pds/parts.tsx`). The tone is never
    /// the only thing that says it.
    private func standingMark(_ row: PDSRepoRow) -> some View {
        let tone = row.standingTone
        let quiet = tone == .good
        return HStack(spacing: 4) {
            Circle()
                .fill(toneColor(tone))
                .frame(width: 6, height: 6)
            Text(row.standingLabel)
                .font(AturiFont.sans(.caption2, weight: quiet ? .regular : .semibold))
                .foregroundStyle(quiet ? theme.textTertiary : toneColor(tone))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Status: \(row.standingLabel)")
        .accessibilityHint(row.standingMeaning)
    }

    private func toneColor(_ tone: PDSExplorer.StatusTone) -> Color {
        switch tone {
        case .good: return theme.textAccent
        /* The theme has no amber; the tool rows use the system orange for
           a warning too. */
        case .warn: return .orange
        case .bad: return theme.danger
        case .quiet: return theme.textTertiary
        }
    }

    private var footer: some View {
        HStack(alignment: .center, spacing: 10) {
            Text(model.footerLabel)
                .font(AturiFont.caption)
                .foregroundStyle(theme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
            if model.canLoadMore {
                Button(model.isLoadingRepos ? "Loading\u{2026}" : "Load more") {
                    _ = model.loadMore()
                }
                .buttonStyle(.aturiSecondary)
                .disabled(model.isLoadingRepos)
            }
        }
    }

    // MARK: Filters and order

    private func filterBar(_ facets: PDSExplorer.Facets) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                statusMenu(facets)
                commitMenu(facets)
                orderMenu
            }
            .padding(.vertical, 2)
        }
    }

    /// All, active and inactive, then each inactive status the listing
    /// holds, each with how many it would show (the rail's Status list).
    private func statusMenu(_ facets: PDSExplorer.Facets) -> some View {
        let choices = model.statusChoices(facets)
        let groups = choices.filter { !$0.isStatus }
        let statuses = choices.filter { $0.isStatus }
        return Menu {
            Section {
                ForEach(groups) { choice in
                    menuItem(countedTitle(choice.label, choice.count), selected: choice.value == model.status) {
                        model.status = choice.value
                    }
                }
            }
            if !statuses.isEmpty {
                Section {
                    ForEach(statuses) { choice in
                        menuItem(countedTitle(choice.label, choice.count), selected: choice.value == model.status) {
                            model.status = choice.value
                        }
                    }
                }
            }
        } label: {
            filterChip("Status", value: model.statusTitle, active: model.status != "all")
        }
        .accessibilityLabel("Status: \(model.statusTitle)")
    }

    /// Any time, then each window, each with how many it holds. The
    /// windows include one another.
    private func commitMenu(_ facets: PDSExplorer.Facets) -> some View {
        let choices = model.commitChoices(facets)
        return Menu {
            ForEach(choices) { choice in
                menuItem(countedTitle(choice.label, choice.count), selected: choice.window == model.commit) {
                    model.commit = choice.window
                }
            }
        } label: {
            filterChip("Last commit", value: model.commitTitle, active: model.commit != nil)
        }
        .accessibilityLabel("Last commit: \(model.commitTitle)")
    }

    private var orderMenu: some View {
        Menu {
            ForEach(PDSExplorer.sortChoices) { choice in
                menuItem(choice.label, selected: choice.sort == model.sort && choice.desc == model.desc) {
                    model.setOrder(choice)
                }
            }
        } label: {
            filterChip("Order", value: model.sortTitle, active: model.sort != .listed || model.desc)
        }
        .accessibilityLabel("Order: \(model.sortTitle)")
    }

    private func countedTitle(_ label: String, _ count: Int) -> String {
        "\(label) \u{00B7} \(count.formatted())"
    }

    private func menuItem(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            if selected {
                Label(title, systemImage: "checkmark")
            } else {
                Text(title)
            }
        }
    }

    private func filterChip(_ name: String, value: String, active: Bool) -> some View {
        HStack(spacing: 4) {
            Text(name)
                .foregroundStyle(theme.textTertiary)
            Text(value)
                .foregroundStyle(active ? theme.accentSoftFg : theme.textPrimary)
            Image(systemName: "chevron.down")
                .font(AturiFont.caption2)
                .foregroundStyle(theme.textTertiary)
        }
        .font(AturiFont.sans(.caption, weight: .medium))
        .lineLimit(1)
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(active ? theme.accentSoft : theme.bgSecondary, in: Capsule())
        .overlay(Capsule().strokeBorder(active ? theme.accentSoftRing : theme.borderMedium, lineWidth: 1))
        .contentShape(Capsule())
    }
}
