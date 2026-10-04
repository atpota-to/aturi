import SwiftUI
import UIKit
import AturiCore

/// The card for any record that is not a Bluesky post or a profile: the
/// at:// path, the type badge, a readable table of the record's fields
/// and the raw JSON tree. Port of `RecordPreview.tsx`; `at.margin.*`
/// collections get their own cards, as the web's `margin/*` previews.
struct GenericRecordCardView: View {
    let record: AtRecord
    /// The identity the read went through: names the handle for the path
    /// line and the PDS that serves blob thumbnails.
    let identity: IdentityBundle
    /// The web hides its explorer link when the card is already inside
    /// the explorer.
    let showsExplorerLink: Bool

    @Environment(\.aturiTheme) private var theme
    @Environment(AppRouter.self) private var router: AppRouter?
    @Environment(\.openURL) private var openURL
    @State private var showsAllFields = false
    @State private var showsJSON = false
    @State private var copiedJSON = false
    @State private var copyResetTask: Task<Void, Never>?

    /// The universal-link page shows a compact teaser; the rest is a tap away.
    private static let previewFieldLimit = 6

    /// Keys that identify a record come first, timestamps last, so the
    /// teaser leads with what the record is about. Dictionaries have no
    /// order of their own, so the rest is alphabetical.
    private static let leadingKeys = ["$type", "title", "name", "displayName", "subject", "text", "description", "summary", "status"]
    private static let trailingKeys = ["createdAt", "updatedAt"]

    init(record: AtRecord, identity: IdentityBundle, showsExplorerLink: Bool = true) {
        self.record = record
        self.identity = identity
        self.showsExplorerLink = showsExplorerLink
    }

    private var parsedUri: AtUri? {
        AtUri(parsing: record.uri)
    }

    private var collection: String {
        parsedUri?.collection ?? record.value["$type"]?.stringValue ?? ""
    }

    private var rkey: String {
        parsedUri?.rkey ?? rkeyFromAtUri(record.uri) ?? ""
    }

    private var handle: String {
        identity.handle ?? identity.did
    }

    var body: some View {
        if let marginType = MarginLexicons.type(of: collection) {
            MarginRecordCard(type: marginType, record: record, identity: identity)
        } else {
            genericCard
        }
    }

    // MARK: Generic card

    private var displayType: String {
        let type = record.value["$type"]?.stringValue ?? collection
        return type
            .replacingOccurrences(of: "app.bsky.", with: "")
            .replacingOccurrences(of: "com.atproto.", with: "")
            .replacingOccurrences(of: "net.anisota.", with: "")
    }

    private var createdDate: Date? {
        record.value["createdAt"]?.stringValue.flatMap(Formatting.isoDate)
    }

    private var title: String {
        RecordPreview.titleFor(record.value, collection: collection, rkey: rkey)
    }

    private var fields: [RecordField] {
        guard let object = record.value.objectValue else { return [] }
        var ordered: [String] = []
        for key in Self.leadingKeys where object[key] != nil {
            ordered.append(key)
        }
        for key in object.keys.sorted() where !Self.leadingKeys.contains(key) && !Self.trailingKeys.contains(key) {
            ordered.append(key)
        }
        for key in Self.trailingKeys where object[key] != nil {
            ordered.append(key)
        }
        return ordered.compactMap { key in
            object[key].map { RecordField(key: key, value: $0) }
        }
    }

    private var shownFields: [RecordField] {
        showsAllFields ? fields : Array(fields.prefix(Self.previewFieldLimit))
    }

    private var genericCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.bgTertiary)

            Divider()
                .overlay(theme.borderSubtle)

            VStack(alignment: .leading, spacing: 14) {
                Text(title)
                    .font(AturiFont.title)
                    .foregroundStyle(theme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                if fields.isEmpty {
                    Text("This record has no fields.")
                        .font(.footnote)
                        .foregroundStyle(theme.textSecondary)
                } else {
                    fieldsTable
                }

                if fields.count > Self.previewFieldLimit {
                    Button(showsAllFields ? "Show fewer fields" : "Show all \(fields.count) fields") {
                        withAnimation(.easeInOut(duration: 0.15)) {
                            showsAllFields.toggle()
                        }
                    }
                    .font(.footnote)
                    .buttonStyle(.plain)
                    .foregroundStyle(theme.textAccent)
                }

                DisclosureGroup(isExpanded: $showsJSON) {
                    JSONTreeView(value: record.value, expandedDepth: 1)
                        .padding(.top, 8)
                } label: {
                    Text("Record JSON")
                        .font(.footnote.weight(.medium))
                        .foregroundStyle(theme.textSecondary)
                }
                .tint(theme.textTertiary)

                actions
            }
            .padding(16)

            if !record.cid.isEmpty {
                Divider()
                    .overlay(theme.borderSubtle)
                CopyRow(label: "CID", value: record.cid)
                    .padding(.horizontal, 16)
                    .background(theme.bgTertiary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .cardBackground()
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            (Text("at://").foregroundStyle(theme.textTertiary)
                + Text(handle).foregroundStyle(theme.textAccent)
                + Text("/").foregroundStyle(theme.textTertiary)
                + Text(collection).foregroundStyle(theme.textSecondary)
                + Text("/").foregroundStyle(theme.textTertiary)
                + Text(rkey).foregroundStyle(theme.textTertiary))
                .font(AturiFont.monoSmall)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 10) {
                Chip(displayType, style: .accent)
                if let createdDate {
                    Text(createdDate, format: .dateTime.year().month(.abbreviated).day())
                        .font(.footnote)
                        .foregroundStyle(theme.textTertiary)
                }
            }
        }
    }

    private var fieldsTable: some View {
        VStack(spacing: 0) {
            ForEach(shownFields) { field in
                RecordFieldRow(label: field.key, value: field.value, identity: identity)
                if field.id != shownFields.last?.id {
                    Divider()
                        .overlay(theme.borderSubtle)
                }
            }
        }
    }

    private var actions: some View {
        HStack(spacing: 10) {
            Button(action: copyJSON) {
                Label(copiedJSON ? "Copied" : "Copy JSON", systemImage: copiedJSON ? "checkmark" : "doc.on.doc")
            }
            .buttonStyle(.aturiSecondary)
            .accessibilityLabel(copiedJSON ? "Copied" : "Copy record JSON")

            if showsExplorerLink, !collection.isEmpty, !rkey.isEmpty {
                Button {
                    LinkNavigation.open(.record(repo: identity.did, collection: collection, rkey: rkey), router: router, openURL: openURL)
                } label: {
                    Label("Open in Explorer", systemImage: "binoculars")
                }
                .buttonStyle(.aturiSecondary)
            }
        }
    }

    private func copyJSON() {
        UIPasteboard.general.string = record.value.prettyPrinted()
        copiedJSON = true
        copyResetTask?.cancel()
        copyResetTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            guard !Task.isCancelled else { return }
            copiedJSON = false
        }
    }
}

/// One top-level field of a record, keyed for `ForEach`.
struct RecordField: Identifiable, Hashable {
    let key: String
    let value: JSONValue

    var id: String { key }
}

/// One row of the field table: the key above the value. Objects and
/// arrays fold into a chip that opens the JSON tree; AT URIs and DIDs push
/// their explorer page; image URLs and image blobs show a thumbnail.
private struct RecordFieldRow: View {
    let label: String
    let value: JSONValue
    let identity: IdentityBundle

    @Environment(\.aturiTheme) private var theme
    @Environment(AppRouter.self) private var router: AppRouter?
    @Environment(\.openURL) private var openURL
    @State private var expanded = false

    /// Long strings are cut here; the JSON tree below has the rest.
    private static let truncateAt = 280

    private var imageURL: String? {
        if let direct = RecordImages.imageUrlFromValue(value) {
            return direct
        }
        if let blob = RecordImages.imageBlobFromValue(value) {
            return RecordImages.getBlobUrl(pds: identity.pds, did: identity.did, cid: blob.cid)
        }
        return nil
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(label)
                .font(.system(.caption, design: .monospaced, weight: .semibold))
                .foregroundStyle(theme.textTertiary)
                .textCase(.uppercase)
            valueView
            if let imageURL {
                RecordImageThumb(url: imageURL)
            }
        }
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var containerSummary: String {
        switch value {
        case .array(let items):
            if items.isEmpty { return "[ ]" }
            return items.count == 1 ? "[1 item]" : "[\(items.count) items]"
        case .object(let members):
            if members.isEmpty { return "{ }" }
            return members.count == 1 ? "{1 field}" : "{\(members.count) fields}"
        default:
            return ""
        }
    }

    @ViewBuilder
    private var valueView: some View {
        switch value {
        case .object, .array:
            Button {
                withAnimation(.easeInOut(duration: 0.15)) {
                    expanded.toggle()
                }
            } label: {
                HStack(spacing: 4) {
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.caption2)
                    Text(containerSummary)
                }
                .font(AturiFont.monoSmall)
                .foregroundStyle(theme.textAccent)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(theme.bgTertiary, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(label), \(containerSummary)")
            .accessibilityValue(expanded ? "Expanded" : "Collapsed")
            if expanded {
                JSONTreeView(value: value, expandedDepth: 1)
                    .padding(.leading, 8)
            }
        case .string(let text):
            stringView(text)
        case .number(let number):
            Text(value.intValue.map { String($0) } ?? String(number))
                .font(.body)
                .foregroundStyle(theme.textPrimary)
                .textSelection(.enabled)
        case .bool(let flag):
            Text(flag ? "true" : "false")
                .font(.body)
                .foregroundStyle(theme.textPrimary)
        case .null:
            Text("null")
                .font(.body)
                .foregroundStyle(theme.textTertiary)
        }
    }

    @ViewBuilder
    private func stringView(_ text: String) -> some View {
        if let route = linkRoute(text) {
            Button {
                LinkNavigation.open(route, router: router, openURL: openURL)
            } label: {
                Text(display(text))
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(theme.textAccent)
                    .underline()
                    .multilineTextAlignment(.leading)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens in the explorer")
        } else {
            Text(display(text))
                .font(.body)
                .foregroundStyle(theme.textPrimary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    /* AT URIs and DIDs in record fields are cross-references (a follow's
       subject, a gallery item's photo), so they navigate rather than copy;
       the JSON tree keeps the copyable spelling. */
    private func linkRoute(_ text: String) -> Route? {
        if isValidDid(text) {
            return .repo(text)
        }
        if text.hasPrefix("at://") {
            return Route(atUri: text)
        }
        return nil
    }

    private func display(_ text: String) -> String {
        guard text.count > Self.truncateAt else { return text }
        return String(text.prefix(Self.truncateAt)) + "\u{2026}"
    }
}

/// A thumbnail for an image a record field points at.
struct RecordImageThumb: View {
    let url: String

    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
        AsyncImage(url: URL(string: url)) { phase in
            if case .success(let image) = phase {
                image
                    .resizable()
                    .scaledToFit()
                    .frame(maxHeight: 160)
                    .clipShape(shape)
                    .overlay(shape.strokeBorder(theme.borderSubtle, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
                    .accessibilityLabel("Image")
            }
        }
    }
}
