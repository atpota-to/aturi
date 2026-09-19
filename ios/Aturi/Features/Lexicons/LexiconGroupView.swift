import SwiftUI
import Observation
import UIKit
import AturiCore

/// The namespace page (`/explore/lexicons/group/{prefix}`), port of
/// `LexiconGroup.tsx`. A dotted prefix lists everything under it from
/// `/prefix`: sub-namespaces that drill deeper and collections that open
/// their detail page. A single-segment term cannot use `/prefix`, so the
/// model falls back to `/search` and the page reads as its results.
struct LexiconGroupView: View {
    @State private var model: LexiconGroupModel

    @Environment(\.aturiTheme) private var theme

    init(prefix: String) {
        _model = State(initialValue: LexiconGroupModel(prefix: prefix))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                headerCard
                filterBar
                listCard
                MicrocosmCredit()
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(theme.bgPrimary)
        .navigationTitle(model.prefix)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let url = Route.lexiconGroup(prefix: model.prefix).webURL {
                ToolbarItem(placement: .topBarTrailing) {
                    ShareLink(item: url) {
                        Image(systemName: "square.and.arrow.up")
                    }
                    .accessibilityLabel("Share")
                }
            }
        }
        .task {
            if model.entries.isIdle {
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
            Label(model.eyebrow, systemImage: model.isPrefixView ? "square.stack.3d.up" : "magnifyingglass")
                .aturiLabel()
                .foregroundStyle(theme.textAccent)
            breadcrumbs
            if let summary = model.summaryLine {
                Text(summary)
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(theme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            } else if model.isPrefixView, model.entries.isIdle || model.entries.isLoading {
                RoundedRectangle(cornerRadius: 4, style: .continuous)
                    .fill(theme.bgTertiary)
                    .frame(width: 200, height: 12)
                    .accessibilityLabel("Loading")
            }
            CopyRow(label: model.isPrefixView ? "Namespace" : "Term", value: model.prefix)
        }
        .padding(16)
        .cardBackground()
    }

    /// The dotted heading, each segment but the last a link to its own
    /// group page, as `Frame` in LexiconGroup.tsx draws it.
    private var breadcrumbs: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 2) {
                ForEach(Array(model.breadcrumbs.enumerated()), id: \.element.id) { index, crumb in
                    if index > 0 {
                        Text(".")
                            .font(AturiFont.mono)
                            .foregroundStyle(theme.textTertiary)
                            .accessibilityHidden(true)
                    }
                    if crumb.isLast {
                        Text(crumb.segment)
                            .font(AturiFont.mono)
                            .foregroundStyle(theme.textPrimary)
                    } else {
                        NavigationLink(value: Route.lexiconGroup(prefix: crumb.cumulative)) {
                            Text(crumb.segment)
                                .font(AturiFont.mono)
                                .foregroundStyle(theme.textSecondary)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Browse \(crumb.cumulative)")
                    }
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel(model.prefix)
    }

    // MARK: Filter

    private var filterBar: some View {
        @Bindable var model = model
        return HStack(spacing: 8) {
            ExploreFilterField(model.filterPlaceholder, text: $model.filter, label: model.filterLabel)
            if let status = model.statusLabel {
                Text(status)
                    .font(AturiFont.monoSmall)
                    .monospacedDigit()
                    .foregroundStyle(theme.textTertiary)
                    .accessibilityLabel("\(status) entries")
            }
        }
    }

    // MARK: Listing

    @ViewBuilder
    private var listCard: some View {
        switch model.entries {
        case .idle, .loading:
            SkeletonRows(count: 5)
                .padding(14)
                .cardBackground()
        case .failed:
            ErrorPanel(message: model.errorMessage ?? LexiconsModel.apiUnavailableMessage) {
                model.load()
            }
        case .loaded:
            if let message = model.emptyMessage {
                VStack(alignment: .leading, spacing: 8) {
                    EmptyState(title: message, systemImage: "tray")
                    if let label = model.emptyLexiconLinkLabel {
                        NavigationLink(value: Route.lexicon(nsid: model.prefix)) {
                            Text(label)
                                .font(.footnote)
                                .foregroundStyle(theme.textAccent)
                        }
                        .buttonStyle(.plain)
                    }
                }
            } else if let message = model.noMatchMessage {
                EmptyState(title: message, systemImage: "line.3.horizontal.decrease")
            } else if let entries = model.visibleEntries {
                VStack(spacing: 0) {
                    LazyVStack(spacing: 0) {
                        ForEach(Array(entries.enumerated()), id: \.element.id) { index, entry in
                            if index > 0 {
                                Divider()
                            }
                            entryRow(entry)
                        }
                    }
                    if model.canLoadMore {
                        Divider()
                        loadMoreButton
                    }
                    if let error = model.loadMoreError {
                        Divider()
                        ErrorPanel(message: "Couldn't reach the UFOs API: \(error)") {
                            model.loadMore()
                        }
                        .padding(12)
                    }
                }
                .cardBackground()
            }
        }
    }

    private func entryRow(_ entry: LexiconGroupEntry) -> some View {
        let label = HStack(spacing: 10) {
            Image(systemName: entry.isNamespace ? "folder" : "doc.text")
                .font(.footnote)
                .foregroundStyle(entry.isNamespace ? theme.textAccent : theme.textTertiary)
                .frame(width: 16)
                .accessibilityHidden(true)
            Text(entry.displayName)
                .font(AturiFont.monoSmall)
                .foregroundStyle(theme.textPrimary)
                .lineLimit(1)
                .truncationMode(.middle)
            Spacer(minLength: 8)
            LexiconCountText(value: entry.counts.creates, unit: "creates")
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 9)
        .contentShape(Rectangle())

        return Group {
            if let route = Route(destination: entry.destination) {
                NavigationLink(value: route) {
                    label
                }
                .buttonStyle(.plain)
            } else {
                label
            }
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(entry.isNamespace ? "Namespace" : "Lexicon") \(entry.name), \(entry.counts.creates.formatted()) creates")
        .accessibilityAddTraits(.isButton)
        .contextMenu {
            if entry.isNamespace {
                Button {
                    UIPasteboard.general.string = entry.name
                } label: {
                    Label("Copy namespace", systemImage: "doc.on.doc")
                }
            } else {
                LexiconRowMenu(nsid: entry.name)
            }
        }
    }

    private var loadMoreButton: some View {
        Button {
            model.loadMore()
        } label: {
            HStack(spacing: 6) {
                if model.isLoadingMore {
                    ProgressView()
                        .controlSize(.small)
                }
                Text(model.isLoadingMore ? "Loading\u{2026}" : "Load more")
            }
            .frame(maxWidth: .infinity)
        }
        .buttonStyle(.aturiSecondary)
        .disabled(model.isLoadingMore)
        .padding(12)
    }
}
