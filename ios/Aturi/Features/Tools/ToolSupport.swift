import SwiftUI
import UIKit
import AturiCore

// The parts every tool page is built from, port of `ToolFrame.tsx`, so the
// tools read as one section: a head card (where it is, what it is, its
// input), then sections of results underneath, in the explorer's cards.
// Each tool lives in its own file in this folder (`<Name>ToolView.swift`)
// and reads its input from the route's query, the keys its web page keeps
// in the address (`useToolQuery`), so a link to `/tools/handle?handle=x`
// opens the tool already run.

/// `Route.tool` as a screen: the tool for a catalog slug.
struct ToolPageView: View {
    let slug: String
    let query: [String: String]

    var body: some View {
        switch slug {
        case "stream": StreamToolView(query: query)
        case "xrpc": XrpcToolView(query: query)
        case "relay": RelayToolView(query: query)
        case "handle": HandleToolView(query: query)
        case "resolve": ResolveToolView(query: query)
        case "decode": DecodeToolView(query: query)
        case "activity": ActivityToolView(query: query)
        case "memberships": MembershipsToolView(query: query)
        case "labels": LabelsToolView(query: query)
        case "shadowban": ShadowbanToolView(query: query)
        case "mutuals": MutualsToolView(query: query)
        case "car": CarToolView(query: query)
        case "validate": ValidateToolView(query: query)
        case "post": PostToolView(query: query)
        case "lexicon": LexiconToolView(query: query)
        case "feed": FeedToolView(query: query)
        case "oauth": OAuthToolView(query: query)
        case "share": ShareToolView(query: query)
        case "page": PageToolView(query: query)
        default:
            ToolFrame(slug: slug) {
                ToolPlaceholder(slug: slug, query: query)
            }
        }
    }
}

/// The SF Symbol for a tool, standing in for the web's Lucide icon.
enum ToolIcon {
    static func systemImage(for slug: String) -> String {
        switch slug {
        case "stream": return "waveform.path.ecg"
        case "xrpc": return "terminal"
        case "relay": return "antenna.radiowaves.left.and.right"
        case "handle": return "at"
        case "resolve": return "list.bullet.rectangle"
        case "decode": return "number.square"
        case "activity": return "calendar"
        case "memberships": return "checkmark.seal"
        case "labels": return "tag"
        case "shadowban": return "eye.slash"
        case "mutuals": return "person.2"
        case "car": return "archivebox"
        case "validate": return "checkmark.shield"
        case "post": return "doc.text.magnifyingglass"
        case "lexicon": return "text.book.closed"
        case "feed": return "dot.radiowaves.up.forward"
        case "oauth": return "key"
        case "share": return "square.and.arrow.up"
        case "page": return "rectangle.and.text.magnifyingglass"
        default: return "wrench.and.screwdriver"
        }
    }
}

// MARK: - Frame

/// The page: the head card with the tool's group, title, lead and `form`,
/// then `content`. The share button hands out `/tools/{slug}` with
/// `shareQuery`, the input as the web would keep it in the address.
struct ToolFrame<Form: View, Content: View>: View {
    let slug: String
    var shareQuery: [String: String]
    let form: Form
    let content: Content

    @Environment(\.aturiTheme) private var theme

    init(
        slug: String,
        shareQuery: [String: String] = [:],
        @ViewBuilder form: () -> Form,
        @ViewBuilder content: () -> Content
    ) {
        self.slug = slug
        self.shareQuery = shareQuery
        self.form = form()
        self.content = content()
    }

    private var tool: ToolEntry? {
        ToolCatalog.tool(slug)
    }

    private var groupTitle: String? {
        guard let tool else { return nil }
        return ToolCatalog.groups.first { $0.id == tool.group }?.title
    }

    private var shareURL: URL? {
        Route.tool(slug: slug, query: shareQuery.filter { !$0.value.isEmpty }).webURL
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                headCard
                content
            }
            .padding(16)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(theme.bgPrimary)
        .navigationTitle(tool?.title ?? "Tool")
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
    }

    private var headCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label(groupTitle ?? "Tools", systemImage: ToolIcon.systemImage(for: slug))
                .aturiLabel()
                .foregroundStyle(theme.textAccent)
            Text(tool?.title ?? slug)
                .font(AturiFont.title)
                .tracking(AturiFont.titleTracking)
                .foregroundStyle(theme.textPrimary)
                .accessibilityAddTraits(.isHeader)
            if let lead = tool?.lead {
                Text(lead)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            form
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }
}

extension ToolFrame where Form == EmptyView {
    /// A tool with no input in the head card.
    init(slug: String, shareQuery: [String: String] = [:], @ViewBuilder content: () -> Content) {
        self.init(slug: slug, shareQuery: shareQuery, form: { EmptyView() }, content: content)
    }
}

// MARK: - Input

/// One line of input and the button that runs the tool: the explorer's
/// search field in a tool's head card.
struct ToolInputBar: View {
    let placeholder: String
    @Binding var text: String
    var buttonTitle: String = "Check"
    var isRunning: Bool = false
    var keyboard: UIKeyboardType = .URL
    let submit: () -> Void

    @FocusState private var focused: Bool
    @Environment(\.aturiTheme) private var theme

    private var trimmed: String {
        text.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
        HStack(spacing: 8) {
            HStack(spacing: 8) {
                TextField(placeholder, text: $text)
                    .font(AturiFont.body)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(keyboard)
                    .submitLabel(.go)
                    .focused($focused)
                    .onSubmit(run)
                if !text.isEmpty {
                    Button {
                        text = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(theme.textTertiary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear")
                }
            }
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(theme.bgSecondary, in: shape)
            .overlay(shape.strokeBorder(focused ? theme.textAccent : theme.borderStrong, lineWidth: 1))

            Button(action: run) {
                HStack(spacing: 6) {
                    if isRunning {
                        ProgressView()
                            .controlSize(.small)
                    }
                    Text(buttonTitle)
                }
            }
            .buttonStyle(.aturiSecondary)
            .disabled(trimmed.isEmpty || isRunning)
        }
    }

    private func run() {
        guard !trimmed.isEmpty else { return }
        focused = false
        submit()
    }
}

/// Several lines of input (a list of handles, a record's JSON), with its
/// placeholder over the empty editor and the run button beneath.
struct ToolTextEditor: View {
    let placeholder: String
    @Binding var text: String
    var buttonTitle: String = "Check"
    var isRunning: Bool = false
    var minHeight: CGFloat = 120
    let submit: () -> Void

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
        VStack(alignment: .leading, spacing: 8) {
            ZStack(alignment: .topLeading) {
                TextEditor(text: $text)
                    .font(AturiFont.monoSmall)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: minHeight)
                    .padding(6)
                if text.isEmpty {
                    Text(placeholder)
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(theme.textTertiary)
                        .padding(.horizontal, 11)
                        .padding(.vertical, 14)
                        .allowsHitTesting(false)
                }
            }
            .background(theme.bgSecondary, in: shape)
            .overlay(shape.strokeBorder(theme.borderStrong, lineWidth: 1))
            Button(action: submit) {
                HStack(spacing: 6) {
                    if isRunning {
                        ProgressView()
                            .controlSize(.small)
                    }
                    Text(buttonTitle)
                }
            }
            .buttonStyle(.aturiSecondary)
            .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty || isRunning)
        }
    }
}

/// "Try" and a row of example inputs, the web tools' try-chips. Tapping
/// one hands its value to `pick`, which fills the input and runs.
struct ToolExamples: View {
    let examples: [String]
    let pick: (String) -> Void

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                Text("Try")
                    .font(AturiFont.caption)
                    .foregroundStyle(theme.textTertiary)
                ForEach(examples, id: \.self) { example in
                    Button {
                        pick(example)
                    } label: {
                        Chip(example)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Try \(example)")
                }
            }
            .padding(.vertical, 2)
        }
    }
}

// MARK: - Results

/// A titled card of results under the head card.
struct ToolSection<Content: View>: View {
    let title: String
    var detail: String?
    let content: Content

    @Environment(\.aturiTheme) private var theme

    init(_ title: String, detail: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.detail = detail
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(AturiFont.sans(.subheadline, weight: .bold))
                    .foregroundStyle(theme.textPrimary)
                if let detail, !detail.isEmpty {
                    Text(detail)
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.isHeader)
            VStack(alignment: .leading, spacing: 0) {
                content
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(14)
            .cardBackground()
        }
    }
}

/// How one step of a check came out, the web tools' `CheckStatus`.
enum ToolCheckStatus: Hashable {
    case pass
    case warn
    case fail
    case info
    case pending

    var systemImage: String {
        switch self {
        case .pass: return "checkmark.circle.fill"
        case .warn: return "exclamationmark.triangle.fill"
        case .fail: return "xmark.octagon.fill"
        case .info: return "info.circle"
        case .pending: return "circle.dotted"
        }
    }

    var accessibilityLabel: String {
        switch self {
        case .pass: return "Passed"
        case .warn: return "Warning"
        case .fail: return "Failed"
        case .info: return "Note"
        case .pending: return "Checking"
        }
    }
}

/// One step of a check: its status mark, a title and the evidence.
struct ToolCheckRow: View {
    let status: ToolCheckStatus
    let title: String
    var detail: String?

    @Environment(\.aturiTheme) private var theme

    private var tint: Color {
        switch status {
        case .pass: return theme.textAccent
        /* The theme has no amber; the account checks use the system orange
           for a warning too. */
        case .warn: return .orange
        case .fail: return theme.danger
        case .info, .pending: return theme.textTertiary
        }
    }

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 10) {
            Group {
                if status == .pending {
                    ProgressView()
                        .controlSize(.mini)
                } else {
                    Image(systemName: status.systemImage)
                        .foregroundStyle(tint)
                }
            }
            .frame(width: 18)
            .accessibilityLabel(status.accessibilityLabel)
            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(AturiFont.sans(.subheadline, weight: .semibold))
                    .foregroundStyle(theme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                if let detail, !detail.isEmpty {
                    Text(detail)
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}

/// A label and its value, selectable; the value in mono for identifiers.
struct ToolFactRow: View {
    let label: String
    let value: String
    var mono: Bool = true

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(label)
                .font(AturiFont.caption)
                .foregroundStyle(theme.textTertiary)
            Text(value)
                .font(mono ? AturiFont.monoSmall : AturiFont.footnote)
                .foregroundStyle(theme.textPrimary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}

/// What a tool shows until it has been ported: the tool's page on aturi.to,
/// with the same input, which opens in Safari.
struct ToolPlaceholder: View {
    let slug: String
    let query: [String: String]

    @Environment(\.openURL) private var openURL
    @Environment(\.aturiTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("This tool is not in the app yet. It runs on aturi.to with the same input.")
                .font(AturiFont.footnote)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            if let url = Route.tool(slug: slug, query: query).webURL {
                Button {
                    openURL(url)
                } label: {
                    Label("Open on aturi.to", systemImage: "safari")
                }
                .buttonStyle(.aturiSecondary)
                .accessibilityHint("Opens outside the app")
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }
}

// MARK: - Links into tools

/// One row that opens a tool with its input filled in, as the explorer
/// offers them where a record or account is already open
/// (`AccountToolLinks.tsx`, the record page's Open links).
struct ToolLinkRow: View {
    let link: ToolLink

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        NavigationLink(value: Route.tool(slug: link.slug, query: link.query)) {
            HStack(spacing: 8) {
                Image(systemName: ToolIcon.systemImage(for: link.slug))
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textTertiary)
                    .frame(width: 18)
                    .accessibilityHidden(true)
                Text(link.label)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textAccent)
                Spacer(minLength: 0)
                Image(systemName: "chevron.right")
                    .font(AturiFont.caption2)
                    .foregroundStyle(theme.textTertiary)
                    .accessibilityHidden(true)
            }
            .padding(.vertical, 10)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint(link.title)
    }
}

/// The account page's Tools card: the tools that read a whole account.
struct AccountToolLinksCard: View {
    let did: String

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        let links = ToolLinks.forAccount(did: did)
        VStack(alignment: .leading, spacing: 0) {
            Text("Tools")
                .font(AturiFont.sans(.footnote, weight: .bold))
                .foregroundStyle(theme.textSecondary)
                .padding(.top, 12)
                .padding(.bottom, 2)
                .accessibilityAddTraits(.isHeader)
            ForEach(Array(links.enumerated()), id: \.element.id) { index, link in
                if index > 0 {
                    Divider()
                }
                ToolLinkRow(link: link)
            }
        }
        .padding(.horizontal, 14)
        .padding(.bottom, 2)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }
}
