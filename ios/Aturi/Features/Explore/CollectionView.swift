import SwiftUI
import Observation
import AturiCore

/// The collection page (`/explore/{repo}/{collection}`), port of
/// `CollectionExplorer.tsx` with `CollectionEditBar.tsx`: paged rows with
/// the TID date and a preview, a search over what has been fetched,
/// oldest-first and live toggles, the singleton jump to a collection's
/// only record, and for the repo's owner a selection mode whose bulk
/// delete runs in paced applyWrites batches with Stop and a progress bar.
///
/// Records can only be deleted from your own repository, so selection
/// mode is gated on the signed-in account owning this repo. The Edit
/// button is also offered to signed-out visitors: pressing it opens the
/// sign-in sheet prefilled with this repo's handle (mirroring the record
/// page) so the owner can sign in and start managing in two taps. Only
/// someone signed in as a different account sees no button.
struct CollectionView: View {
    @State private var model: CollectionModel
    @State private var confirmingDelete = false
    @State private var showsSignIn = false

    @Environment(AppRouter.self) private var router
    @Environment(\.sessionStore) private var session
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
                    if model.isEditing {
                        editBar
                    }
                    list
                }
            }
            .padding(16)
        }
        .background(theme.bgPrimary)
        .navigationTitle(model.collection)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                if showsEditButton {
                    Button(model.isEditing ? "Done" : "Edit") {
                        editTapped()
                    }
                    .disabled(model.isDeleting)
                    .accessibilityHint(editHint)
                }
                if let url = shareURL {
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
        /* Signing out mid-edit takes the affordance away; leave the mode
           with it so the checkmarks do not linger on a page that can no
           longer act on them. */
        .onChange(of: canEdit) { _, can in
            if !can, model.isEditing {
                model.exitEditing()
            }
        }
        .onDisappear {
            model.stopLive()
        }
        .sheet(isPresented: $showsSignIn) {
            SignInSheet(defaultInput: model.identity.value.map { $0.handle ?? $0.did } ?? model.repo)
        }
        .confirmationDialog(
            model.deleteConfirmationMessage,
            isPresented: $confirmingDelete,
            titleVisibility: .visible
        ) {
            Button("Confirm delete", role: .destructive) {
                deleteSelected()
            }
        }
    }

    // MARK: Ownership

    /// The signed-in account owns this repo.
    private var canEdit: Bool {
        guard let did = session.state.did, let identity = model.identity.value else { return false }
        return did == identity.did
    }

    private var showsEditButton: Bool {
        model.identity.value != nil && (canEdit || !session.state.isSignedIn)
    }

    private var editHint: String {
        if canEdit {
            return model.isEditing ? "Leaves selection mode" : "Select records to delete"
        }
        return "Sign in to manage your records"
    }

    private func editTapped() {
        if canEdit {
            model.toggleEditing()
        } else {
            showsSignIn = true
        }
    }

    private var shareURL: URL? {
        URL(string: Endpoints.aturiBase.absoluteString + model.sharePath)
    }

    // MARK: Controls

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

    /// Port of `CollectionEditBar`: Select / Deselect, the running count,
    /// and the delete affordance, which walks through delete, confirm and
    /// in-flight (progress bar + Stop).
    private var editBar: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Button("Select") {
                    model.selectAllVisible()
                }
                .buttonStyle(.aturiSecondary)
                .disabled(model.visibleRows.isEmpty || model.allVisibleSelected || model.isDeleting)
                .accessibilityLabel("Select all visible records")
                Button("Deselect") {
                    model.deselectAll()
                }
                .buttonStyle(.aturiSecondary)
                .disabled(model.selectedCount == 0 || model.isDeleting)
                .accessibilityLabel("Deselect all records")
                Text("\(model.selectedCount) selected")
                    .font(.footnote)
                    .monospacedDigit()
                    .foregroundStyle(theme.textTertiary)
                Spacer(minLength: 0)
                if !model.isDeleting {
                    Button {
                        confirmingDelete = true
                    } label: {
                        Image(systemName: "trash")
                            .foregroundStyle(theme.danger)
                    }
                    .buttonStyle(.aturiSecondary)
                    .disabled(model.selectedCount == 0 || !session.deleteAccess)
                    .accessibilityLabel(deleteLabel)
                }
            }
            if model.isDeleting, let progress = model.deleteProgress {
                HStack(spacing: 10) {
                    ProgressView(value: progress.fraction)
                        .tint(theme.danger)
                        .accessibilityLabel(progress.accessibilityLabel)
                    Text(progress.label)
                        .font(AturiFont.monoSmall)
                        .monospacedDigit()
                        .foregroundStyle(theme.textSecondary)
                    Button("Stop") {
                        model.stopDelete()
                    }
                    .buttonStyle(.aturiSecondary)
                    .accessibilityHint("Stops after the current batch")
                }
                if let status = model.deleteStatusLabel {
                    Text(status)
                        .font(.footnote)
                        .foregroundStyle(theme.textSecondary)
                }
            }
            if !session.deleteAccess {
                Text("This sign-in cannot delete records. Sign out and back in to grant it.")
                    .font(.footnote)
                    .foregroundStyle(theme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let error = model.deleteError {
                Text(error)
                    .font(.footnote)
                    .foregroundStyle(theme.danger)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityLabel("Error: \(error)")
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }

    private var deleteLabel: String {
        let count = model.selectedCount
        guard count > 0 else { return "Delete selected records" }
        return "Delete \(count) selected record\(count == 1 ? "" : "s")"
    }

    private func deleteSelected() {
        let collection = model.collection
        model.deleteSelected { [session] rkeys in
            try await session.applyWrites(deletes: rkeys, collection: collection)
        }
    }

    // MARK: List

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
                    if model.isEditing {
                        Button {
                            model.toggleSelected(row.uri)
                        } label: {
                            rowView(row, selected: model.isSelected(row.uri))
                        }
                        .buttonStyle(.plain)
                        .disabled(model.isDeleting)
                        .accessibilityAddTraits(model.isSelected(row.uri) ? AccessibilityTraits.isSelected : AccessibilityTraits())
                        .accessibilityHint("Toggles selection")
                    } else {
                        NavigationLink(value: Route.record(repo: model.repo, collection: model.collection, rkey: row.rkey)) {
                            rowView(row, selected: nil)
                        }
                        .buttonStyle(.plain)
                    }
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

    /// One row; `selected` is nil outside selection mode, where the row
    /// carries no checkbox.
    private func rowView(_ row: CollectionRow, selected: Bool?) -> some View {
        HStack(alignment: .top, spacing: 12) {
            if let selected {
                Image(systemName: selected ? "checkmark.circle.fill" : "circle")
                    .font(.body)
                    .foregroundStyle(selected ? theme.textAccent : theme.textTertiary)
                    .padding(.top, 1)
                    .accessibilityHidden(true)
            }
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
