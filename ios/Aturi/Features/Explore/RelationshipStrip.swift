import SwiftUI
import AturiCore

/// The "You + @them" strip on someone else's repo page, port of
/// `RelationshipStrip.tsx`: whether the two accounts share a PDS host,
/// the follow relationship in both directions (with the follow date
/// decoded from the record's TID), the mutual-follower count and the
/// lexicons both repos hold. Reads the session here and hands it to the
/// model, since a `@State` model cannot be built from the environment.
struct RelationshipStrip: View {
    let target: IdentityBundle
    let viewerDid: String
    /// The repo page's collections, once its describeRepo lands.
    let targetCollections: [String]?
    /// The repo page's lookup of the viewer's own collections.
    let viewerCollections: Set<String>?
    /// Where the mutuals and in-common chips lead: the page's own tabs.
    let onSelect: (RelationshipChip.Destination) -> Void

    @Environment(\.sessionStore) private var session
    @Environment(\.identityResolver) private var identity

    var body: some View {
        RelationshipStripBody(
            target: target,
            viewerDid: viewerDid,
            profileSource: { [session] actor in
                try await session.profileWithViewer(actor: actor)
            },
            resolver: identity,
            targetCollections: targetCollections,
            viewerCollections: viewerCollections,
            onSelect: onSelect
        )
        /* The viewer's identity changes the whole question, so a new
           account gets a fresh model rather than a reloaded one. */
        .id(viewerDid + "|" + target.did)
    }
}

private struct RelationshipStripBody: View {
    let targetCollections: [String]?
    let viewerCollections: Set<String>?
    let onSelect: (RelationshipChip.Destination) -> Void

    @State private var model: RelationshipModel

    @Environment(\.aturiTheme) private var theme

    init(
        target: IdentityBundle,
        viewerDid: String,
        profileSource: @escaping RelationshipModel.ProfileSource,
        resolver: IdentityResolver,
        targetCollections: [String]?,
        viewerCollections: Set<String>?,
        onSelect: @escaping (RelationshipChip.Destination) -> Void
    ) {
        self.targetCollections = targetCollections
        self.viewerCollections = viewerCollections
        self.onSelect = onSelect
        _model = State(initialValue: RelationshipModel(
            target: target,
            viewerDid: viewerDid,
            profileSource: profileSource,
            resolver: resolver
        ))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(model.title)
                .aturiLabel()
                .foregroundStyle(theme.textTertiary)
                .accessibilityAddTraits(.isHeader)
            if !model.isLoaded {
                Text(RelationshipModel.loadingCopy)
                    .font(.caption)
                    .foregroundStyle(theme.textTertiary)
            } else if model.hasSignals {
                SettingsWrapLayout(spacing: 8) {
                    ForEach(model.chips) { chip in
                        chipView(chip)
                    }
                }
            } else {
                Text(RelationshipModel.noSignalsCopy)
                    .font(.caption.italic())
                    .foregroundStyle(theme.textTertiary)
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
        .task {
            if model.profile.isIdle {
                model.load()
            }
        }
        /* The collection sets arrive on the repo page's own schedule; the
           model recounts whenever either lands. `initial` covers the case
           where both were already there when the strip appeared. */
        .onChange(of: targetCollections, initial: true) { _, next in
            model.targetCollections = next
        }
        .onChange(of: viewerCollections, initial: true) { _, next in
            model.viewerCollections = next
        }
    }

    @ViewBuilder
    private func chipView(_ chip: RelationshipChip) -> some View {
        if let destination = chip.destination {
            Button {
                onSelect(destination)
            } label: {
                chipLabel(chip)
            }
            .buttonStyle(.plain)
            .accessibilityHint(destination == .identityTab ? "Shows the ID tab" : "Shows the Lexicons tab")
        } else {
            chipLabel(chip)
        }
    }

    /// The web's chip: serif caption, hairline border, the accent tone for
    /// a mutual follow.
    private func chipLabel(_ chip: RelationshipChip) -> some View {
        let accent = chip.tone == .accent
        return HStack(spacing: 5) {
            Image(systemName: RelationshipModel.systemImage(for: chip.id))
                .font(.caption2)
            Text(chip.label)
                .font(.system(.caption, design: .serif))
            if let note = chip.note {
                Text(note)
                    .font(.system(.caption, design: .serif))
                    .opacity(0.75)
            }
        }
        .foregroundStyle(accent ? theme.textAccent : theme.textSecondary)
        .lineLimit(1)
        .padding(.horizontal, 9)
        .padding(.vertical, 5)
        .background(theme.bgTertiary, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .strokeBorder(accent ? theme.textAccent : theme.borderSubtle, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
    }
}
