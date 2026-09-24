import SwiftUI
import UIKit
import AturiCore

/// The cards for `at.margin.*` records: annotations, bookmarks, highlights,
/// collections, collection items, replies and likes. Port of the web's
/// `margin/*` previews, sharing one frame: a header with the type badge,
/// the type's own sections, the date and raw-data footer, and the at://
/// path line.
struct MarginRecordCard: View {
    let type: MarginLexiconType
    let record: AtRecord
    let identity: IdentityBundle

    @Environment(\.aturiTheme) private var theme
    @Environment(\.openURL) private var openURL
    @State private var showsJSON = false

    private var value: JSONValue {
        record.value
    }

    private var parsedUri: AtUri? {
        AtUri(parsing: record.uri)
    }

    private var collection: String {
        parsedUri?.collection ?? type.rawValue
    }

    private var rkey: String {
        parsedUri?.rkey ?? rkeyFromAtUri(record.uri) ?? ""
    }

    private var handle: String {
        identity.handle ?? identity.did
    }

    private var createdDate: Date? {
        value["createdAt"]?.stringValue.flatMap(Formatting.isoDate)
    }

    private var datePrefix: String? {
        switch type {
        case .bookmark: return "Bookmarked"
        case .collection: return "Created"
        default: return nil
        }
    }

    private var symbol: String {
        switch type {
        case .annotation: return "text.quote"
        case .bookmark: return "bookmark"
        case .highlight: return "highlighter"
        case .collection: return "folder"
        case .collectionItem: return "link"
        case .reply: return "bubble.left"
        case .like: return "heart"
        }
    }

    /// The page an annotation, highlight or bookmark is about.
    private var pageTitle: String? {
        switch type {
        case .annotation, .highlight:
            return value["target"]?["title"]?.stringValue
        case .bookmark:
            return value["title"]?.stringValue
        case .collection:
            return value["name"]?.stringValue
        default:
            return nil
        }
    }

    private var sourceURL: String? {
        switch type {
        case .annotation, .highlight:
            return value["target"]?["source"]?.stringValue
        case .bookmark:
            return value["source"]?.stringValue
        default:
            return nil
        }
    }

    private var descriptionText: String? {
        switch type {
        case .bookmark, .collection:
            return value["description"]?.stringValue
        default:
            return nil
        }
    }

    private var tags: [String] {
        value["tags"]?.arrayValue?.compactMap(\.stringValue) ?? []
    }

    private var selectedText: String? {
        value["target"]?["selector"]?["exact"]?.stringValue
    }

    /// Margin's default highlight colour when the record names none.
    private var highlightColor: Color {
        Color(hex: value["color"]?.stringValue ?? "#fde047")
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
                .padding(16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.bgTertiary)

            sections

            footer

            Divider()
                .overlay(theme.borderSubtle)

            (Text("at://").foregroundStyle(theme.textTertiary)
                + Text(handle).foregroundStyle(theme.textSecondary)
                + Text("/").foregroundStyle(theme.textTertiary)
                + Text(collection).foregroundStyle(theme.textSecondary)
                + Text("/").foregroundStyle(theme.textTertiary)
                + Text(rkey).foregroundStyle(theme.textTertiary))
                .font(AturiFont.monoSmall)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .padding(12)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .cardBackground()
        .sheet(isPresented: $showsJSON) {
            MarginJSONSheet(title: "Raw \(type.displayName.lowercased()) data", subtitle: collection, value: value)
        }
    }

    // MARK: Header

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            if type == .collection, let icon = value["icon"]?.stringValue, !icon.isEmpty {
                Text(icon)
                    .font(.largeTitle)
                    .accessibilityHidden(true)
            }

            HStack(spacing: 8) {
                Chip(type.displayName, systemImage: symbol, style: .accent)
                if type == .annotation, let motivation = value["motivation"]?.stringValue, !motivation.isEmpty {
                    Text(motivation)
                        .font(.footnote)
                        .italic()
                        .foregroundStyle(theme.textTertiary)
                }
                if type == .highlight, value["color"]?.stringValue != nil {
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(highlightColor)
                        .frame(width: 20, height: 20)
                        .overlay(RoundedRectangle(cornerRadius: 4, style: .continuous).strokeBorder(theme.borderSubtle))
                        .accessibilityLabel("Highlight colour")
                }
            }

            if let pageTitle, !pageTitle.isEmpty {
                Text(pageTitle)
                    .font(AturiFont.title)
                    .foregroundStyle(theme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let descriptionText, !descriptionText.isEmpty {
                Text(descriptionText)
                    .font(.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if let sourceURL, !sourceURL.isEmpty {
                Button {
                    if let url = URL(string: sourceURL) {
                        openURL(url)
                    }
                } label: {
                    Label(sourceURL, systemImage: "arrow.up.right")
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textAccent)
                        .lineLimit(2)
                        .truncationMode(.middle)
                        .multilineTextAlignment(.leading)
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Open source page")
                .accessibilityHint("Opens outside the app")
            }

            switch type {
            case .collectionItem:
                Text("Links an annotation to a collection")
                    .font(.footnote)
                    .foregroundStyle(theme.textSecondary)
                if let position = value["position"]?.intValue {
                    Text("Position: \(position)")
                        .font(.footnote)
                        .foregroundStyle(theme.textTertiary)
                }
            case .like:
                Text("Liked an annotation or reply")
                    .font(.footnote)
                    .foregroundStyle(theme.textSecondary)
            default:
                EmptyView()
            }
        }
    }

    // MARK: Sections

    @ViewBuilder
    private var sections: some View {
        switch type {
        case .annotation:
            if let selectedText, !selectedText.isEmpty {
                MarginSection("Selected text") {
                    Text(selectedText)
                        .font(.body)
                        .italic()
                        .foregroundStyle(theme.textPrimary)
                        .padding(.leading, 12)
                        .overlay(alignment: .leading) {
                            Rectangle()
                                .fill(theme.accent)
                                .frame(width: 3)
                        }
                }
            }
            if let note = value["body"]?["value"]?.stringValue, !note.isEmpty {
                MarginSection("Note") {
                    Text(note)
                        .font(.body)
                        .foregroundStyle(theme.textPrimary)
                }
            }
            tagsSection
        case .bookmark:
            tagsSection
        case .highlight:
            if let selectedText, !selectedText.isEmpty {
                MarginSection("Highlighted text") {
                    Text(selectedText)
                        .font(.body)
                        .foregroundStyle(theme.textPrimary)
                        .padding(.vertical, 8)
                        .padding(.horizontal, 12)
                        .background(highlightColor.opacity(0.15))
                        .overlay(alignment: .leading) {
                            Rectangle()
                                .fill(highlightColor)
                                .frame(width: 3)
                        }
                }
            }
            tagsSection
        case .collection:
            EmptyView()
        case .collectionItem:
            MarginReference(label: "Collection", uri: value["collection"]?.stringValue)
            MarginReference(label: "Annotation", uri: value["annotation"]?.stringValue)
        case .reply:
            if let text = value["text"]?.stringValue, !text.isEmpty {
                MarginSection(nil) {
                    Text(text)
                        .font(.body)
                        .foregroundStyle(theme.textPrimary)
                }
            }
            MarginReference(label: "In reply to", uri: value["parent"]?["uri"]?.stringValue)
        case .like:
            MarginReference(label: "Subject", uri: value["subject"]?["uri"]?.stringValue)
        }
    }

    @ViewBuilder
    private var tagsSection: some View {
        if !tags.isEmpty {
            MarginSection(nil) {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        Image(systemName: "tag")
                            .font(.caption)
                            .foregroundStyle(theme.textTertiary)
                            .accessibilityHidden(true)
                        ForEach(Array(tags.enumerated()), id: \.offset) { _, tag in
                            Chip(tag)
                        }
                    }
                }
                .accessibilityLabel("Tags: \(tags.joined(separator: ", "))")
            }
        }
    }

    // MARK: Footer

    private var footer: some View {
        HStack(spacing: 12) {
            if let createdDate {
                HStack(spacing: 6) {
                    Image(systemName: "calendar")
                        .accessibilityHidden(true)
                    if let datePrefix {
                        Text("\(datePrefix) ") + Text(createdDate, format: .dateTime.year().month(.abbreviated).day().hour().minute())
                    } else {
                        Text(createdDate, format: .dateTime.year().month(.abbreviated).day().hour().minute())
                    }
                }
                .font(.footnote)
                .foregroundStyle(theme.textTertiary)
                .accessibilityElement(children: .combine)
            }
            Spacer(minLength: 0)
            Button("View raw data") {
                showsJSON = true
            }
            .buttonStyle(.aturiSecondary)
            .font(.footnote)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.bgTertiary)
    }
}

/// One block of a margin card: an optional uppercase label above the
/// content, separated from the next block by a hairline.
private struct MarginSection<Content: View>: View {
    let label: String?
    let content: Content

    @Environment(\.aturiTheme) private var theme

    init(_ label: String?, @ViewBuilder content: () -> Content) {
        self.label = label
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            if let label {
                Text(label)
                    .aturiLabel()
                    .foregroundStyle(theme.textTertiary)
            }
            content
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        Divider()
            .overlay(theme.borderSubtle)
    }
}

/// A labelled AT URI another margin record points at. Pushes the explorer
/// page when the URI is one the app has a page for.
private struct MarginReference: View {
    let label: String
    let uri: String?

    @Environment(\.aturiTheme) private var theme
    @Environment(AppRouter.self) private var router: AppRouter?
    @Environment(\.openURL) private var openURL

    private var route: Route? {
        guard let uri else { return nil }
        if isValidDid(uri) {
            return .repo(uri)
        }
        return Route(atUri: uri)
    }

    var body: some View {
        MarginSection(label) {
            if let uri, !uri.isEmpty {
                if let route {
                    Button {
                        LinkNavigation.open(route, router: router, openURL: openURL)
                    } label: {
                        IdentifierText(uri, lineLimit: 2, font: AturiFont.monoSmall)
                            .foregroundStyle(theme.textAccent)
                            .multilineTextAlignment(.leading)
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens in the explorer")
                } else {
                    IdentifierText(uri, lineLimit: 2, font: AturiFont.monoSmall)
                        .foregroundStyle(theme.textSecondary)
                }
            } else {
                Text("Missing")
                    .font(.footnote)
                    .foregroundStyle(theme.textTertiary)
            }
        }
    }
}

/// The "View raw data" sheet: the record's JSON tree with a copy button.
private struct MarginJSONSheet: View {
    let title: String
    let subtitle: String
    let value: JSONValue

    @Environment(\.dismiss) private var dismiss
    @Environment(\.aturiTheme) private var theme
    @State private var copied = false
    @State private var copyResetTask: Task<Void, Never>?

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 12) {
                    IdentifierText(subtitle, font: AturiFont.monoSmall)
                        .foregroundStyle(theme.textTertiary)
                    JSONTreeView(value: value, expandedDepth: 3)
                }
                .padding(16)
            }
            .background(theme.bgPrimary)
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Done") {
                        dismiss()
                    }
                }
                ToolbarItem(placement: .primaryAction) {
                    Button(action: copy) {
                        Image(systemName: copied ? "checkmark" : "doc.on.doc")
                    }
                    .accessibilityLabel(copied ? "Copied" : "Copy JSON")
                }
            }
        }
    }

    private func copy() {
        UIPasteboard.general.string = value.prettyPrinted()
        copied = true
        copyResetTask?.cancel()
        copyResetTask = Task { @MainActor in
            try? await Task.sleep(for: .seconds(1.5))
            guard !Task.isCancelled else { return }
            copied = false
        }
    }
}
