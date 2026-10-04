import SwiftUI
import Observation
import AturiCore

/// The PDS page (`/explore/pds/{host}`), port of `PdsExplorer.tsx`: the
/// server's description and version, then the repos it hosts, paged, each
/// row's handle filling in behind the DID.
struct PDSView: View {
    @State private var model: PDSModel

    @Environment(\.aturiTheme) private var theme

    init(host: String) {
        _model = State(initialValue: PDSModel(host: host))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                header
                reposSection
            }
            .padding(16)
        }
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

    private var shareURL: URL? {
        URL(string: Endpoints.aturiBase.absoluteString + model.sharePath)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Personal Data Server", systemImage: "server.rack")
                .aturiLabel()
                .foregroundStyle(theme.textTertiary)
            Text(model.host)
                .font(.system(.title2, design: .monospaced, weight: .light))
                .foregroundStyle(theme.textPrimary)
                .lineLimit(2)
                .truncationMode(.middle)
                .textSelection(.enabled)
            if let message = model.serverErrorMessage {
                Text(message)
                    .font(.footnote.italic())
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            switch model.server {
            case .idle, .loading:
                SkeletonRows(count: 2)
            case .failed, .loaded:
                serverCells
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }

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
                }
            }
            if let domains = info?.availableUserDomains, !domains.isEmpty {
                Divider()
                cell("Available domains") {
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
                cell("Invite required") {
                    Text(invite ? "Yes" : "No")
                        .font(.footnote)
                        .foregroundStyle(theme.textPrimary)
                }
            }
            if let privacy = info?.links?.privacyPolicy, !privacy.isEmpty {
                Divider()
                OutboundLinkRow(title: "Privacy policy", url: privacy, systemImage: "arrow.up.right")
            }
            if let terms = info?.links?.termsOfService, !terms.isEmpty {
                Divider()
                OutboundLinkRow(title: "Terms of service", url: terms, systemImage: "arrow.up.right")
            }
            if let email = info?.contact?.email, !email.isEmpty {
                Divider()
                OutboundLinkRow(title: "Contact", url: "mailto:\(email)", detail: email, systemImage: "envelope")
            }
        }
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

    private var reposSection: some View {
        @Bindable var model = model
        return VStack(alignment: .leading, spacing: 10) {
            SectionHeader("Repos on this PDS", detail: model.loadedLabel)
            ExploreFilterField("Search repos", text: $model.filter, label: "Search repos on this PDS")
            if let error = model.reposError {
                ErrorPanel(message: error) {
                    if model.repos.isEmpty {
                        model.load()
                    } else {
                        model.loadMore()
                    }
                }
            }
            if model.showsSkeleton {
                SkeletonRows(count: 6)
            } else if let message = model.emptyMessage {
                EmptyState(title: message, systemImage: "tray")
            } else if let message = model.noMatchMessage {
                EmptyState(title: message, systemImage: "line.3.horizontal.decrease")
            } else if !model.visibleRows.isEmpty {
                LazyVStack(spacing: 0) {
                    ForEach(model.visibleRows) { row in
                        NavigationLink(value: Route.repo(row.handle ?? row.did)) {
                            repoRow(row)
                        }
                        .buttonStyle(.plain)
                        Divider()
                    }
                }
                .cardBackground()
            }
            if model.canLoadMore {
                Button(model.isLoadingRepos ? "Loading\u{2026}" : "Load more") {
                    model.loadMore()
                }
                .buttonStyle(.aturiSecondary)
                .disabled(model.isLoadingRepos)
            }
        }
    }

    private func repoRow(_ row: PDSRepoRow) -> some View {
        HStack(alignment: .top, spacing: 10) {
            VStack(alignment: .leading, spacing: 2) {
                Text(row.label)
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(theme.textPrimary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                if !row.secondaryLabel.isEmpty {
                    Text(row.secondaryLabel)
                        .font(.caption2)
                        .foregroundStyle(theme.textTertiary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                if let updated = row.updatedLabel() {
                    Text(updated)
                        .font(.caption2)
                        .foregroundStyle(theme.textTertiary)
                        .accessibilityLabel(row.revTitle ?? updated)
                }
            }
            Spacer(minLength: 0)
            if let badge = row.statusBadge {
                Chip(badge, style: .danger)
                    .accessibilityLabel("Repo status: \(badge)")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}
