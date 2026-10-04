import SwiftUI
import AturiCore

/// Inbound links, port of `BacklinksTab.tsx`. Used as a repo tab (target
/// = DID) and, with `showsSummary`, as the record page's featured card
/// with the big count in its header. One source opens at a time; its
/// records page in beneath it.
struct BacklinksSection: View {
    let model: BacklinksModel
    var showsSummary: Bool = false

    @Environment(\.openURL) private var openURL
    @Environment(\.aturiTheme) private var theme

    init(model: BacklinksModel, showsSummary: Bool = false) {
        self.model = model
        self.showsSummary = showsSummary
    }

    var body: some View {
        if showsSummary {
            VStack(alignment: .leading, spacing: 0) {
                summaryHeader
                Divider()
                VStack(alignment: .leading, spacing: 8) {
                    sourcesBody(emptyMessage: BacklinksModel.emptySummaryMessage)
                }
                .padding(12)
            }
            .cardBackground()
        } else {
            sourcesBody(emptyMessage: BacklinksModel.emptyMessage)
        }
    }

    private var summaryHeader: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(model.countText)
                    .font(.system(.title, design: .serif, weight: .semibold))
                    .foregroundStyle(theme.textAccent)
                    .monospacedDigit()
                Text("backlinks")
                    .font(AturiFont.body)
                    .foregroundStyle(theme.textPrimary)
                Spacer(minLength: 0)
                HStack(spacing: 3) {
                    Text("via")
                        .font(.caption2)
                        .foregroundStyle(theme.textTertiary)
                    Button("Microcosm") {
                        openURL(BacklinksModel.microcosmURL)
                    }
                    .font(.caption2)
                    .buttonStyle(.plain)
                    .foregroundStyle(theme.textAccent)
                    .accessibilityHint("Opens outside the app")
                }
            }
            Text(model.summaryText)
                .font(.footnote)
                .foregroundStyle(theme.textTertiary)
        }
        .padding(14)
        .accessibilityElement(children: .combine)
    }

    @ViewBuilder
    private func sourcesBody(emptyMessage: String) -> some View {
        switch model.sources {
        case .idle, .loading:
            SkeletonRows(count: 3)
        case .failed:
            unavailable
        case .loaded(let sources):
            if sources.isEmpty {
                EmptyState(title: emptyMessage, systemImage: "link")
            } else {
                VStack(spacing: 6) {
                    ForEach(sources, id: \.source) { source in
                        sourceCard(source)
                    }
                }
            }
        }
    }

    private var unavailable: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(BacklinksModel.unavailableMessage)
                .font(.footnote.italic())
                .foregroundStyle(theme.textSecondary)
            HStack(spacing: 12) {
                Button("Retry") {
                    model.reload()
                }
                .buttonStyle(.aturiSecondary)
                Button("constellation") {
                    openURL(BacklinksModel.constellationURL)
                }
                .font(.footnote)
                .buttonStyle(.plain)
                .foregroundStyle(theme.textAccent)
                .accessibilityHint("Opens outside the app")
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }

    private func sourceCard(_ source: BacklinkSource) -> some View {
        let isOpen = model.isOpen(source.source)
        return VStack(alignment: .leading, spacing: 0) {
            Button {
                withAnimation(.easeInOut(duration: 0.15)) {
                    model.toggle(source: source.source)
                }
            } label: {
                HStack(alignment: .top, spacing: 8) {
                    Image(systemName: isOpen ? "chevron.down" : "chevron.right")
                        .font(.caption2)
                        .foregroundStyle(theme.textTertiary)
                        .frame(width: 12)
                        .padding(.top, 4)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(source.collection)
                            .font(AturiFont.monoSmall)
                            .foregroundStyle(theme.textAccent)
                            .multilineTextAlignment(.leading)
                        Text(source.path)
                            .font(AturiFont.monoSmall)
                            .foregroundStyle(theme.textTertiary)
                            .multilineTextAlignment(.leading)
                    }
                    Spacer(minLength: 8)
                    VStack(alignment: .trailing, spacing: 2) {
                        HStack(alignment: .firstTextBaseline, spacing: 3) {
                            Text(BacklinksModel.compactCount(source.count))
                                .font(AturiFont.monoSmall.weight(.semibold))
                                .foregroundStyle(theme.textPrimary)
                            Text("backlinks")
                                .font(.caption2)
                                .foregroundStyle(theme.textTertiary)
                        }
                        if let accounts = source.distinctDids {
                            Text("\(BacklinksModel.compactCount(accounts)) accounts")
                                .font(.caption2)
                                .foregroundStyle(theme.textTertiary)
                        }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 10)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(source.collection) \(source.path), \(source.count) backlinks")
            .accessibilityValue(isOpen ? "Expanded" : "Collapsed")

            if isOpen {
                Divider()
                records(for: source.source)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
            }
        }
        .cardBackground()
    }

    @ViewBuilder
    private func records(for source: String) -> some View {
        let page = model.pages[source]
        let rows = model.rows(for: source)
        if page?.errored == true {
            Text(BacklinksModel.recordsErrorMessage)
                .font(.footnote)
                .foregroundStyle(theme.textSecondary)
        } else {
            VStack(alignment: .leading, spacing: 0) {
                if rows.isEmpty {
                    Text(page?.isLoading == true ? BacklinksModel.loadingMessage : BacklinksModel.noRecordsMessage)
                        .font(.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .padding(.vertical, 4)
                }
                ForEach(rows) { row in
                    recordRow(row)
                    Divider()
                }
                if let page, page.canLoadMore {
                    Button(page.isLoading ? BacklinksModel.loadingMessage : BacklinksModel.loadMoreLabel) {
                        model.loadMore(source: source)
                    }
                    .font(.footnote)
                    .buttonStyle(.plain)
                    .foregroundStyle(theme.textAccent)
                    .disabled(page.isLoading)
                    .padding(.top, 8)
                }
            }
        }
    }

    @ViewBuilder
    private func recordRow(_ row: BacklinkRow) -> some View {
        let label = HStack(alignment: .top, spacing: 10) {
            Text(row.label)
                .font(AturiFont.monoSmall)
                .foregroundStyle(theme.textPrimary)
                .lineLimit(1)
                .truncationMode(.middle)
                .frame(minWidth: 90, maxWidth: 160, alignment: .leading)
            VStack(alignment: .leading, spacing: 2) {
                Text(row.rkey)
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(theme.textTertiary)
                    .lineLimit(1)
                    .truncationMode(.middle)
                if let preview = row.preview, !preview.isEmpty {
                    Text(preview)
                        .font(.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .lineLimit(2)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 6)
        .contentShape(Rectangle())

        if let route = Route(atUri: row.atUri) {
            NavigationLink(value: route) {
                label
            }
            .buttonStyle(.plain)
        } else {
            label
        }
    }
}
