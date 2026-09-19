import SwiftUI
import Observation
import AturiCore

/// The collection page (`/explore/{repo}/{collection}`), port of the read
/// side of `CollectionExplorer.tsx`: paged rows with the TID date and a
/// preview, a search over what has been fetched, oldest-first and live
/// toggles, and the singleton jump to a collection's only record.
struct CollectionView: View {
    @State private var model: CollectionModel

    @Environment(AppRouter.self) private var router
    @Environment(\.aturiTheme) private var theme

    init(repo: String, collection: String) {
        _model = State(initialValue: CollectionModel(repo: repo, collection: collection))
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                ExploreBreadcrumb(identity: model.identity.value, repo: model.repo, collection: model.collection)
                switch model.identity {
                case .idle, .loading:
                    SkeletonRows(count: 6)
                case .failed(let message):
                    ExploreNotFoundPanel(
                        eyebrow: RecordModel.identityFailureEyebrow,
                        headline: RecordModel.identityFailureHeadline,
                        message: model.notFoundMessage ?? message
                    ) {
                        model.load()
                    }
                case .loaded:
                    controls
                    list
                }
            }
            .padding(16)
        }
        .background(theme.bgPrimary)
        .navigationTitle(model.collection)
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
            if model.identity.isIdle {
                model.load()
            }
        }
        .refreshable {
            await model.load().value
        }
        /* The web replaces a one-record collection with its record page;
           here the record is pushed and the listing stays underneath. */
        .onChange(of: model.singleRecordRkey) { _, rkey in
            guard let rkey else { return }
            router.open(.record(repo: model.repo, collection: model.collection, rkey: rkey))
        }
        .onDisappear {
            model.stopLive()
        }
    }

    private var shareURL: URL? {
        URL(string: Endpoints.aturiBase.absoluteString + model.sharePath)
    }

    private var controls: some View {
        @Bindable var model = model
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Button {
                    model.toggleLive()
                } label: {
                    Label("Live", systemImage: model.isLive ? "pause.fill" : "play.fill")
                        .foregroundStyle(model.isLive ? theme.textAccent : theme.textPrimary)
                }
                .buttonStyle(.aturiSecondary)
                .accessibilityLabel(model.isLive ? "Pause live stream" : "Stream new records as they arrive")
                Button {
                    model.setReverse(!model.reverse)
                } label: {
                    Label(model.reverse ? "Oldest first" : "Newest first", systemImage: "arrow.up.arrow.down")
                }
                .buttonStyle(.aturiSecondary)
                .accessibilityHint("Flips the listing order")
                Spacer(minLength: 0)
            }
            ExploreFilterField("Search records", text: $model.filter, label: "Search records in this collection")
            Text(model.countLabel)
                .font(AturiFont.monoSmall)
                .foregroundStyle(theme.textTertiary)
        }
    }

    @ViewBuilder
    private var list: some View {
        if let error = model.pageError {
            ErrorPanel(message: error) {
                if model.rows.isEmpty {
                    model.load()
                } else {
                    model.loadMore()
                }
            }
        }
        if model.awaitingFirstPage {
            SkeletonRows(count: 6)
        } else if model.isEmpty {
            EmptyState(title: "No records in this collection.", systemImage: "tray")
        } else if let message = model.noMatchMessage {
            EmptyState(title: message, systemImage: "line.3.horizontal.decrease")
        } else {
            LazyVStack(spacing: 0) {
                ForEach(model.visibleRows) { row in
                    NavigationLink(value: Route.record(repo: model.repo, collection: model.collection, rkey: row.rkey)) {
                        rowView(row)
                    }
                    .buttonStyle(.plain)
                    Divider()
                }
            }
            .cardBackground()
        }
        if model.canLoadMore {
            Button {
                model.loadMore()
            } label: {
                HStack(spacing: 6) {
                    if model.isLoadingPage {
                        ProgressView()
                            .controlSize(.small)
                    } else {
                        Image(systemName: "plus")
                    }
                    Text("Fetch \(CollectionModel.recordsPerPage) more")
                }
            }
            .buttonStyle(.aturiSecondary)
            .disabled(model.isLoadingPage)
        }
    }

    private func rowView(_ row: CollectionRow) -> some View {
        HStack(alignment: .top, spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                /* The rkey is the record's identity, so a long one wraps
                   rather than losing its tail to an ellipsis. */
                Text(row.rkey)
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(theme.textPrimary)
                    .lineLimit(2)
                if let date = row.tidDate {
                    RelativeDateText(date: date)
                        .font(.caption2)
                        .foregroundStyle(theme.textTertiary)
                }
            }
            .frame(minWidth: 100, maxWidth: 160, alignment: .leading)
            Text(row.preview)
                .font(.footnote)
                .foregroundStyle(theme.textSecondary)
                .lineLimit(2)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .contentShape(Rectangle())
        .accessibilityElement(children: .combine)
    }
}
