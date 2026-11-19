import SwiftUI
import UIKit
import AturiCore

/// `/tools/xrpc`, port of `src/components/tools/XrpcConsole.tsx` and its
/// parts (`XrpcConsoleMethods`, `XrpcConsoleParams`, `XrpcConsoleResponse`):
/// pick an atproto query, fill in its parameters from the lexicon, choose
/// the host, send the GET, and read the status, the timing and the response.
/// The state is `XrpcConsoleModel` in AturiCore.
///
/// The head card holds the method field and the try-chips. With no method
/// open the page lists every query by namespace, or the matches for what is
/// typed; with one open, the request and then the response stack beneath
/// it, one column, as the web's two columns do at phone width.
struct XrpcToolView: View {
    let query: [String: String]

    @State private var model: XrpcConsoleModel
    /// The namespace family the list shows; nil for all of them.
    @State private var family: String?

    @Environment(\.aturiTheme) private var theme

    init(query: [String: String]) {
        self.query = query
        _model = State(initialValue: XrpcConsoleModel(query: query))
    }

    /// The request as the web keeps it in the address. A route's query
    /// holds one value per key, so a list parameter shares its first value
    /// from the toolbar; the request card's link carries all of them.
    private var shareQuery: [String: String] {
        NetworkToolQuery.dictionary(model.queryItems).query
    }

    var body: some View {
        ToolFrame(slug: "xrpc", shareQuery: shareQuery) {
            XrpcMethodPicker(model: model)
        } content: {
            if !model.request.method.isEmpty && !model.methodValid {
                XrpcNotAMethod(method: model.request.method)
            }
            if model.methodValid {
                XrpcRequestSection(model: model)
                XrpcResponseSection(model: model)
            } else {
                XrpcMethodCatalog(model: model, family: $family)
            }
        }
        .onAppear {
            model.start()
        }
    }
}

/// A link's `method` that is not an NSID.
private struct XrpcNotAMethod: View {
    let method: String

    var body: some View {
        ToolSection("Not a method") {
            ToolCheckRow(
                status: .fail,
                title: "\u{201C}\(method)\u{201D} is not a method name.",
                detail: "A method is an NSID such as app.bsky.actor.getProfile."
            )
        }
    }
}

// MARK: - Choosing a method

/// The field in the head card. With no method open it filters the list on
/// the page; with one open, the same typing drops a short list of matches
/// under the field. Either way Return takes the first match.
private struct XrpcMethodPicker: View {
    let model: XrpcConsoleModel

    @FocusState private var focused: Bool
    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale

    private var text: Binding<String> {
        Binding(
            get: { model.methodQuery },
            set: { model.methodQuery = $0 }
        )
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(theme.textTertiary)
                TextField("getProfile, listRecords\u{2026}", text: text)
                    .font(AturiFont.mono)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.asciiCapable)
                    .submitLabel(.go)
                    .focused($focused)
                    .onSubmit {
                        model.pickFirstMatch()
                    }
                    .accessibilityLabel("Find a method by name or by what it does")
                if !model.methodQuery.isEmpty {
                    Button {
                        model.methodQuery = ""
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
            .overlay(shape.strokeBorder(focused ? theme.textAccent : theme.borderStrong, lineWidth: AturiTheme.hairline(displayScale: displayScale)))

            let matches = model.pickerMatches
            if focused && !matches.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(matches.enumerated()), id: \.element.id) { index, method in
                        if index > 0 {
                            Divider()
                        }
                        XrpcMethodRow(method: method, full: true) {
                            focused = false
                            model.pick(method.nsid)
                        }
                    }
                }
                .cardBackground(cornerRadius: AturiTheme.controlRadius)
            }

            ToolExamples(examples: XrpcConsoleModel.examples.map(\.label)) { label in
                focused = false
                if let example = XrpcConsoleModel.examples.first(where: { $0.label == label }) {
                    model.runExample(example)
                }
            }
        }
    }
}

/// One method in a list: its name (or whole NSID where rows are not under
/// a namespace heading) and what it does.
private struct XrpcMethodRow: View {
    let method: XrpcMethod
    var full: Bool = false
    let action: () -> Void

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        Button(action: action) {
            VStack(alignment: .leading, spacing: 3) {
                Text(full ? method.nsid : XrpcConsole.nameOf(method.nsid))
                    .font(AturiFont.monoFont(.footnote, weight: .medium))
                    .foregroundStyle(theme.textAccent)
                    .lineLimit(1)
                    .truncationMode(.middle)
                if !method.description.isEmpty {
                    Text(method.description)
                        .font(AturiFont.caption)
                        .foregroundStyle(theme.textSecondary)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 9)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens the method")
    }
}

/// Every query in the list, by namespace, or the matches for what was typed.
private struct XrpcMethodCatalog: View {
    let model: XrpcConsoleModel
    @Binding var family: String?

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        let text = model.methodQuery.trimmingCharacters(in: .whitespacesAndNewlines)
        if text.isEmpty {
            catalog
        } else {
            matches(text)
        }
    }

    @ViewBuilder
    private func matches(_ text: String) -> some View {
        let results = model.searchResults
        let limit = XrpcConsoleModel.searchLimit
        let meta = results.rows.isEmpty ? nil : "\(results.found)\(results.found == limit ? "+" : "") of \(model.methods.count)"
        if results.rows.isEmpty {
            EmptyState(
                title: "No query matches \u{201C}\(text)\u{201D}",
                detail: "A method outside this list can still be opened by typing its full NSID.",
                systemImage: "magnifyingglass"
            )
        } else {
            VStack(alignment: .leading, spacing: 8) {
                SectionHeader("Matching queries", detail: meta)
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(results.rows.enumerated()), id: \.element.id) { index, method in
                        if index > 0 {
                            Divider()
                        }
                        XrpcMethodRow(method: method, full: true) {
                            model.pick(method.nsid)
                        }
                    }
                }
                .cardBackground()
            }
        }
    }

    private var catalog: some View {
        let groups = model.groups(family: family)
        let count = groups.reduce(0) { $0 + $1.methods.count }
        return VStack(alignment: .leading, spacing: 12) {
            SectionHeader("Queries", detail: "\(count) methods")
            Picker("Namespace", selection: $family) {
                Text("All").tag(String?.none)
                ForEach(model.families, id: \.self) { name in
                    Text(name).tag(String?.some(name))
                }
            }
            .pickerStyle(.segmented)
            ForEach(groups) { group in
                VStack(alignment: .leading, spacing: 0) {
                    HStack {
                        Text(group.namespace)
                            .font(AturiFont.monoFont(.footnote, weight: .medium))
                            .foregroundStyle(theme.textPrimary)
                        Spacer()
                        Text(String(group.methods.count))
                            .font(AturiFont.monoSmall)
                            .foregroundStyle(theme.textTertiary)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 9)
                    .accessibilityElement(children: .combine)
                    .accessibilityAddTraits(.isHeader)
                    ForEach(group.methods) { method in
                        Divider()
                        XrpcMethodRow(method: method) {
                            model.pick(method.nsid)
                        }
                    }
                }
                .cardBackground()
            }
            Text("Queries from the atproto and Bluesky lexicons that a public host answers without signing in. Type a full NSID to open any other method; its parameters are read from its lexicon.")
                .font(AturiFont.caption)
                .foregroundStyle(theme.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }
}

// MARK: - The request

private struct XrpcRequestSection: View {
    let model: XrpcConsoleModel

    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale
    @State private var copiedCurl = false

    init(model: XrpcConsoleModel) {
        self.model = model
    }

    private var shareURL: URL? {
        let search = model.canonical
        guard !search.isEmpty else { return nil }
        return URL(string: Endpoints.aturiBase.absoluteString + "/tools/xrpc?" + search)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                SectionHeader("Request")
                Spacer(minLength: 0)
                Button("All methods") {
                    model.showAllMethods()
                }
                .font(AturiFont.caption)
            }
            VStack(alignment: .leading, spacing: 18) {
                methodHead
                if let type = model.notAQuery {
                    ToolCheckRow(
                        status: .warn,
                        title: "This is a \(type), not a query",
                        detail: "The console sends queries, which only read. It does not send procedures or open subscriptions."
                    )
                }
                hostBlock
                paramsBlock
                sendBlock
                previewBlock
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .cardBackground()
        }
    }

    private var methodHead: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(model.request.method)
                .font(AturiFont.monoFont(.subheadline, weight: .medium))
                .foregroundStyle(theme.textPrimary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
            if let description = model.lexicon.value?.description, !description.isEmpty {
                Text(description)
                    .font(AturiFont.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 8) {
                NavigationLink(value: Route.lexicon(nsid: model.request.method)) {
                    Label("Lexicon", systemImage: "text.book.closed")
                        .font(AturiFont.footnote)
                }
                .buttonStyle(.aturiSecondary)
                if let shareURL {
                    ShareLink(item: shareURL) {
                        Label("Share request", systemImage: "square.and.arrow.up")
                            .font(AturiFont.footnote)
                    }
                    .buttonStyle(.aturiSecondary)
                }
            }
        }
    }

    private var hostBlock: some View {
        VStack(alignment: .leading, spacing: 8) {
            blockTitle("Send to")
            Picker("Where to send the request", selection: Binding(get: { model.draft.host }, set: { model.draft.host = $0 })) {
                ForEach(XrpcHostChoice.allCases, id: \.self) { choice in
                    Text(choice.label).tag(choice)
                }
            }
            .pickerStyle(.segmented)
            Text(model.draft.host.hint + ".")
                .font(AturiFont.caption)
                .foregroundStyle(theme.textTertiary)
            switch model.draft.host {
            case .pds:
                XrpcTextField(
                    placeholder: "Handle or DID",
                    text: Binding(get: { model.draft.acct }, set: { model.draft.acct = $0.trimmingCharacters(in: .whitespaces) })
                )
                .accessibilityLabel("Account whose PDS to ask")
                Text("Left empty, the request goes to the PDS of the repo it asks about.")
                    .font(AturiFont.caption)
                    .foregroundStyle(theme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            case .other:
                XrpcTextField(
                    placeholder: "pds.example.com",
                    text: Binding(get: { model.draft.url }, set: { model.draft.url = $0.trimmingCharacters(in: .whitespaces) }),
                    keyboard: .URL
                )
                .accessibilityLabel("Host to send the request to")
            case .appview, .relay:
                EmptyView()
            }
        }
    }

    private var paramsBlock: some View {
        VStack(alignment: .leading, spacing: 12) {
            blockTitle("Parameters")
            if model.lexicon.isLoading {
                SkeletonRows(count: 2)
            } else {
                if model.fields.isEmpty && model.lexiconKnown {
                    Text("This method takes no parameters.")
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textSecondary)
                }
                ForEach(model.fields) { spec in
                    XrpcParamField(
                        spec: spec,
                        values: model.draft.params[spec.name] ?? [],
                        lexiconKnown: model.lexiconKnown
                    ) { values in
                        model.setParam(spec.name, values)
                    }
                }
                if !model.lexiconKnown {
                    XrpcAddParam(taken: model.fields.map(\.name)) { name in
                        model.addParam(name)
                    }
                }
                if let note = model.lexicon.value?.source.note {
                    Text(note)
                        .font(AturiFont.caption)
                        .foregroundStyle(theme.textTertiary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    private var sendBlock: some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                model.submit()
            } label: {
                HStack(spacing: 6) {
                    if model.run.isLoading {
                        ProgressView()
                            .controlSize(.small)
                            .tint(theme.textOnAccent)
                    }
                    Text(model.run.isLoading ? "Sending\u{2026}" : "Send")
                }
            }
            .buttonStyle(.aturiPrimary)
            .disabled(model.run.isLoading || model.notAQuery != nil)
            if !model.missing.isEmpty {
                Text("Still needed: " + model.missing.joined(separator: ", "))
                    .font(AturiFont.caption)
                    .foregroundStyle(theme.textSecondary)
            }
        }
    }

    private var previewBlock: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("GET " + model.previewURL)
                .font(AturiFont.monoSmall)
                .foregroundStyle(theme.textSecondary)
                .textSelection(.enabled)
                .fixedSize(horizontal: false, vertical: true)
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(theme.bgTertiary, in: RoundedRectangle(cornerRadius: AturiTheme.controlRadius, style: .continuous))
            if model.previewOrigin != nil {
                HStack(spacing: 8) {
                    Button {
                        UIPasteboard.general.string = model.previewURL
                    } label: {
                        Label("Copy URL", systemImage: "link")
                            .font(AturiFont.footnote)
                    }
                    .buttonStyle(.aturiSecondary)
                    Button {
                        UIPasteboard.general.string = XrpcConsole.curl(for: model.previewURL)
                        copiedCurl = true
                    } label: {
                        Label(copiedCurl ? "Copied" : "Copy as curl", systemImage: copiedCurl ? "checkmark" : "terminal")
                            .font(AturiFont.footnote)
                    }
                    .buttonStyle(.aturiSecondary)
                }
                .onChange(of: model.previewURL) { _, _ in
                    copiedCurl = false
                }
            }
        }
    }

    private func blockTitle(_ title: String) -> some View {
        Text(title)
            .aturiLabel()
            .foregroundStyle(theme.textTertiary)
            .accessibilityAddTraits(.isHeader)
    }
}

/// A one-line field in the request card.
private struct XrpcTextField: View {
    let placeholder: String
    @Binding var text: String
    var keyboard: UIKeyboardType = .asciiCapable

    @FocusState private var focused: Bool
    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: AturiTheme.controlRadius, style: .continuous)
        TextField(placeholder, text: $text)
            .font(AturiFont.monoSmall)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .keyboardType(keyboard)
            .focused($focused)
            .padding(.horizontal, 10)
            .frame(minHeight: 40)
            .background(theme.bgSecondary, in: shape)
            .overlay(shape.strokeBorder(focused ? theme.textAccent : theme.borderStrong, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
    }
}

/// One parameter, shaped by what the lexicon says it is (`ParamField`).
/// Values are held as lists of strings whatever the type, because that is
/// what a query string carries. Nothing is refused here: a value the lexicon
/// would reject is sent as typed and the host's own error is shown, which is
/// more use to someone debugging a client than a form that will not submit.
private struct XrpcParamField: View {
    let spec: XrpcParamSpec
    let values: [String]
    let lexiconKnown: Bool
    let onChange: ([String]) -> Void

    @Environment(\.aturiTheme) private var theme

    private var single: String { values.first ?? "" }

    private enum BooleanChoice: String, CaseIterable, Hashable {
        case unset = "Not set"
        case yes = "True"
        case no = "False"
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(spec.name)
                    .font(AturiFont.monoFont(.footnote, weight: .medium))
                    .foregroundStyle(theme.textPrimary)
                if spec.required {
                    Chip("Required")
                }
                let line = spec.typeLine(lexiconKnown: lexiconKnown)
                if !line.isEmpty {
                    Text(line)
                        .font(AturiFont.caption)
                        .foregroundStyle(theme.textTertiary)
                        .lineLimit(1)
                        .truncationMode(.tail)
                }
            }
            control
            if let description = spec.description, !description.isEmpty {
                Text(description)
                    .font(AturiFont.caption)
                    .foregroundStyle(theme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let known = spec.knownValues, spec.kind != .array {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 6) {
                        ForEach(known, id: \.self) { value in
                            Button {
                                onChange(single == value ? [] : [value])
                            } label: {
                                Chip(value, style: single == value ? .accent : .neutral)
                            }
                            .buttonStyle(.plain)
                            .accessibilityAddTraits(single == value ? .isSelected : [])
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var control: some View {
        if spec.kind == .boolean {
            Picker(spec.name, selection: Binding(get: { booleanChoice }, set: { setBoolean($0) })) {
                ForEach(BooleanChoice.allCases, id: \.self) { choice in
                    Text(choice.rawValue).tag(choice)
                }
            }
            .pickerStyle(.segmented)
        } else if spec.kind == .array {
            XrpcListEditor(
                text: Binding(
                    get: { values.joined(separator: "\n") },
                    set: { onChange($0.components(separatedBy: "\n")) }
                )
            )
        } else if let options = spec.enumValues {
            Picker(spec.name, selection: Binding(get: { single }, set: { onChange($0.isEmpty ? [] : [$0]) })) {
                Text(spec.defaultValue.map { "Default (\($0))" } ?? "Not set").tag("")
                ForEach(options, id: \.self) { option in
                    Text(option).tag(option)
                }
            }
            .pickerStyle(.menu)
        } else {
            XrpcTextField(
                placeholder: spec.defaultValue.map { "Default: \($0)" } ?? "",
                text: Binding(get: { single }, set: { onChange($0.isEmpty ? [] : [$0]) }),
                keyboard: spec.kind == .integer ? .numbersAndPunctuation : .asciiCapable
            )
            .accessibilityLabel(spec.name)
        }
    }

    private var booleanChoice: BooleanChoice {
        switch single {
        case "true": return .yes
        case "false": return .no
        default: return .unset
        }
    }

    private func setBoolean(_ choice: BooleanChoice) {
        switch choice {
        case .unset: onChange([])
        case .yes: onChange(["true"])
        case .no: onChange(["false"])
        }
    }
}

/// A list parameter: one value per line.
private struct XrpcListEditor: View {
    @Binding var text: String

    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: AturiTheme.controlRadius, style: .continuous)
        ZStack(alignment: .topLeading) {
            TextEditor(text: $text)
                .font(AturiFont.monoSmall)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .scrollContentBackground(.hidden)
                .frame(minHeight: 84)
                .padding(4)
            if text.isEmpty {
                Text("One value per line")
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(theme.textTertiary)
                    .padding(.horizontal, 9)
                    .padding(.vertical, 12)
                    .allowsHitTesting(false)
            }
        }
        .background(theme.bgSecondary, in: shape)
        .overlay(shape.strokeBorder(theme.borderStrong, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
    }
}

/// A name to add as a parameter, for a method whose lexicon could not be
/// found: with no list of parameters to draw, this is the only way to send
/// one (`AddParam`).
private struct XrpcAddParam: View {
    let taken: [String]
    let onAdd: (String) -> Void

    @State private var name = ""

    init(taken: [String], onAdd: @escaping (String) -> Void) {
        self.taken = taken
        self.onAdd = onAdd
    }

    private var usable: Bool {
        let trimmed = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return XrpcConsole.isParamName(trimmed) && !taken.contains(trimmed)
    }

    var body: some View {
        HStack(spacing: 8) {
            XrpcTextField(placeholder: "Parameter name", text: $name)
                .onSubmit(add)
                .accessibilityLabel("Name of a parameter to add")
            Button(action: add) {
                Label("Add", systemImage: "plus")
                    .font(AturiFont.footnote)
            }
            .buttonStyle(.aturiSecondary)
            .disabled(!usable)
        }
    }

    private func add() {
        guard usable else { return }
        onAdd(name.trimmingCharacters(in: .whitespacesAndNewlines))
        name = ""
    }
}

// MARK: - The response

/// What came back (`XrpcConsoleResponse`).
private struct XrpcResponseSection: View {
    let model: XrpcConsoleModel

    /// Above this the body is shown as text rather than as a tree, which
    /// makes a row of every value.
    private static let treeMaxCharacters = 150_000
    /// Most of a body drawn as text; the rest is a copy away.
    private static let textMaxCharacters = 100_000

    @Environment(\.aturiTheme) private var theme
    @Environment(\.openURL) private var openURL
    @State private var copied = false

    init(model: XrpcConsoleModel) {
        self.model = model
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            SectionHeader("Response", detail: heading)
            content
        }
    }

    private var heading: String? {
        guard let result = model.run.value, result.kind != .network else { return nil }
        return result.host
    }

    @ViewBuilder
    private var content: some View {
        switch model.run {
        case .idle:
            EmptyState(title: "No response yet", detail: "Fill in the parameters and send the request. The response appears here.", systemImage: "arrow.up.circle")
        case .loading:
            SkeletonRows(count: 5)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .cardBackground()
        case .failed(let message):
            ErrorPanel(message: message) {
                model.retry()
            }
        case .loaded(let result):
            loaded(result)
        }
    }

    @ViewBuilder
    private func loaded(_ result: XrpcConsoleResult) -> some View {
        switch result.kind {
        case .network:
            card {
                ToolCheckRow(
                    status: .fail,
                    title: "The request did not complete",
                    detail: "\(result.host) did not answer, or refused the connection. The same request may still work from a terminal."
                )
                CopyRow(label: "curl command", value: XrpcConsole.curl(for: result.url))
            }
        case .tooLarge:
            card {
                ToolCheckRow(
                    status: .info,
                    title: "The response is too large to show",
                    detail: "It is over \(XrpcConsole.formatBytes(result.bytes ?? 0)), more than the console reads, so it was not kept. Ask for fewer results, or use the curl command for the whole of it."
                )
                CopyRow(label: "curl command", value: XrpcConsole.curl(for: result.url))
                openButton(result)
            }
        case .binary:
            card {
                ToolCheckRow(
                    status: result.isOK ? .info : .fail,
                    title: result.title,
                    detail: binaryDetail(result)
                )
                openButton(result)
            }
        case .text:
            textResult(result)
        }
    }

    private func binaryDetail(_ result: XrpcConsoleResult) -> String {
        let size = result.bytes.map { ", " + XrpcConsole.formatBytes($0) } ?? ""
        return "The response is \(result.contentType ?? "not text")\(size), so it is not shown here. Open it in Safari to save it."
    }

    private func textResult(_ result: XrpcConsoleResult) -> some View {
        let explanation = result.explanation(summary: model.lexicon.value?.summary)
        let detail = explanation.isEmpty ? result.facts : explanation + "\n" + result.facts
        let cursor = result.isOK && model.canPage ? XrpcConsole.nextCursor(result.json) : nil
        return VStack(alignment: .leading, spacing: 10) {
            card {
                ToolCheckRow(status: result.isOK ? .pass : .fail, title: result.title, detail: detail)
            }
            responseBody(result)
            HStack(spacing: 8) {
                if !result.text.isEmpty {
                    Button {
                        UIPasteboard.general.string = result.json.map { $0.prettyPrinted(sortKeys: false) } ?? result.text
                        copied = true
                    } label: {
                        Label(copied ? "Copied" : "Copy response", systemImage: copied ? "checkmark" : "doc.on.doc")
                            .font(AturiFont.footnote)
                    }
                    .buttonStyle(.aturiSecondary)
                }
                if let cursor {
                    Button {
                        model.nextPage(cursor)
                    } label: {
                        Label("Next page", systemImage: "arrow.right")
                            .font(AturiFont.footnote)
                    }
                    .buttonStyle(.aturiSecondary)
                }
            }
            .onChange(of: result) { _, _ in
                copied = false
            }
        }
    }

    @ViewBuilder
    private func responseBody(_ result: XrpcConsoleResult) -> some View {
        if result.text.isEmpty {
            EmptyState(title: "The response has no body.", systemImage: "tray")
        } else if let json = result.json, result.text.count <= XrpcResponseSection.treeMaxCharacters {
            JSONTreeView(value: json, expandedDepth: 2)
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .cardBackground()
        } else {
            let full = result.json.map { $0.prettyPrinted(sortKeys: false) } ?? result.text
            VStack(alignment: .leading, spacing: 8) {
                Text(String(full.prefix(XrpcResponseSection.textMaxCharacters)))
                    .font(AturiFont.monoSmall)
                    .foregroundStyle(theme.textPrimary)
                    .textSelection(.enabled)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if full.count > XrpcResponseSection.textMaxCharacters {
                    Text("The response is longer than is drawn here. Copy it for the whole of it.")
                        .font(AturiFont.caption)
                        .foregroundStyle(theme.textTertiary)
                }
            }
            .padding(14)
            .cardBackground()
        }
    }

    private func openButton(_ result: XrpcConsoleResult) -> some View {
        Button {
            if let url = URL(string: result.url) {
                openURL(url)
            }
        } label: {
            Label("Open the response", systemImage: "safari")
                .font(AturiFont.footnote)
        }
        .buttonStyle(.aturiSecondary)
        .accessibilityHint("Opens outside the app")
        .padding(.top, 6)
    }

    private func card<Content: View>(@ViewBuilder _ content: () -> Content) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            content()
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }
}
