import SwiftUI
import AturiCore

/// A collapsible rendering of a record value. Objects and arrays fold;
/// strings that spell an AT URI or a DID push the matching explorer route,
/// http(s) URLs open outside, and long strings are cut with a control to
/// show the rest.
struct JSONTreeView: View {
    let value: JSONValue
    /// How many levels open on first render.
    var expandedDepth: Int = 2

    init(value: JSONValue, expandedDepth: Int = 2) {
        self.value = value
        self.expandedDepth = expandedDepth
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            JSONNodeView(key: nil, value: value, depth: 0, expandedDepth: expandedDepth)
        }
        .font(AturiFont.monoSmall)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct JSONChild: Identifiable {
    let id: String
    let value: JSONValue
}

private struct JSONNodeView: View {
    let key: String?
    let value: JSONValue
    let depth: Int
    let expandedDepth: Int

    @Environment(\.aturiTheme) private var theme
    @State private var expanded: Bool

    init(key: String?, value: JSONValue, depth: Int, expandedDepth: Int) {
        self.key = key
        self.value = value
        self.depth = depth
        self.expandedDepth = expandedDepth
        _expanded = State(initialValue: depth < expandedDepth)
    }

    var body: some View {
        switch value {
        case .object(let members):
            objectView(members)
        case .array(let items):
            arrayView(items)
        default:
            JSONLeafRow(key: key, value: value)
        }
    }

    private func objectView(_ members: [String: JSONValue]) -> some View {
        let children = members.keys.sorted().map { JSONChild(id: $0, value: members[$0] ?? .null) }
        let summary = members.count == 1 ? "1 key" : "\(members.count) keys"
        return container(children: children, summary: summary, open: "{", close: "}")
    }

    private func arrayView(_ items: [JSONValue]) -> some View {
        let children = items.enumerated().map { JSONChild(id: String($0.offset), value: $0.element) }
        let summary = items.count == 1 ? "1 item" : "\(items.count) items"
        return container(children: children, summary: summary, open: "[", close: "]")
    }

    private func container(children: [JSONChild], summary: String, open: String, close: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Button {
                withAnimation(.easeInOut(duration: 0.15)) {
                    expanded.toggle()
                }
            } label: {
                HStack(alignment: .firstTextBaseline, spacing: 4) {
                    Image(systemName: expanded ? "chevron.down" : "chevron.right")
                        .font(.caption2)
                        .frame(width: 12)
                        .foregroundStyle(theme.textTertiary)
                    if let key {
                        Text(key)
                            .foregroundStyle(theme.textSecondary)
                        Text(":")
                            .foregroundStyle(theme.textTertiary)
                    }
                    Text(expanded ? open : "\(open) \(summary) \(close)")
                        .foregroundStyle(theme.textTertiary)
                }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("\(key ?? "root"), \(summary)")
            .accessibilityValue(expanded ? "Expanded" : "Collapsed")

            if expanded {
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(children) { child in
                        /* The child is the same view type; boxing it keeps
                           the recursive body's opaque type finite. */
                        AnyView(JSONNodeView(key: child.id, value: child.value, depth: depth + 1, expandedDepth: expandedDepth))
                    }
                    Text(close)
                        .foregroundStyle(theme.textTertiary)
                }
                .padding(.leading, 16)
            }
        }
    }
}

private struct JSONLeafRow: View {
    let key: String?
    let value: JSONValue

    @Environment(\.aturiTheme) private var theme
    @Environment(\.openURL) private var openURL
    @Environment(AppRouter.self) private var router: AppRouter?
    @State private var showsFull = false

    /// Long strings (a full post, a base64 blob) are cut here.
    private static let truncateAt = 200

    private enum LinkTarget {
        case route(Route)
        case url(URL)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(alignment: .firstTextBaseline, spacing: 4) {
                if let key {
                    Text(key)
                        .foregroundStyle(theme.textSecondary)
                    Text(":")
                        .foregroundStyle(theme.textTertiary)
                }
                valueView
            }
            if case .string(let text) = value, text.count > Self.truncateAt {
                Button(showsFull ? "Show less" : "Show all") {
                    showsFull.toggle()
                }
                .font(.caption)
                .buttonStyle(.plain)
                .foregroundStyle(theme.textAccent)
            }
        }
    }

    @ViewBuilder
    private var valueView: some View {
        switch value {
        case .string(let text):
            stringView(text)
        case .number(let number):
            Text(value.intValue.map { String($0) } ?? String(number))
                .foregroundStyle(theme.textAccent)
        case .bool(let flag):
            Text(flag ? "true" : "false")
                .foregroundStyle(theme.accent)
        case .null:
            Text("null")
                .foregroundStyle(theme.textTertiary)
        case .object, .array:
            EmptyView()
        }
    }

    @ViewBuilder
    private func stringView(_ text: String) -> some View {
        let display = displayText(text)
        if let target = linkTarget(text) {
            Button {
                open(target)
            } label: {
                Text("\"\(display)\"")
                    .foregroundStyle(theme.textAccent)
                    .underline()
                    .multilineTextAlignment(.leading)
            }
            .buttonStyle(.plain)
            .accessibilityHint(accessibilityHint(for: target))
        } else {
            Text("\"\(display)\"")
                .foregroundStyle(theme.textPrimary)
                .textSelection(.enabled)
        }
    }

    private func displayText(_ text: String) -> String {
        if showsFull || text.count <= Self.truncateAt {
            return text
        }
        return String(text.prefix(Self.truncateAt)) + "\u{2026}"
    }

    private func linkTarget(_ text: String) -> LinkTarget? {
        if text.hasPrefix("at://"), let route = Route(atUri: text) {
            return .route(route)
        }
        if isValidDid(text) {
            return .route(.repo(text))
        }
        if text.hasPrefix("https://") || text.hasPrefix("http://"), let url = URL(string: text) {
            return .url(url)
        }
        return nil
    }

    @MainActor private func open(_ target: LinkTarget) {
        switch target {
        case .route(let route):
            if let router {
                router.open(route)
            } else if let url = route.webURL {
                openURL(url)
            }
        case .url(let url):
            openURL(url)
        }
    }

    private func accessibilityHint(for target: LinkTarget) -> String {
        switch target {
        case .route: return "Opens in the explorer"
        case .url: return "Opens the link"
        }
    }
}
