import SwiftUI
import AturiCore

/// `/tools/share`, port of `src/components/tools/ShareBuilder.tsx`: some
/// text and a link in, the link that opens each client's composer with it
/// out, and the markup to put one on a page. The clients and their routes
/// are the waypoint catalog's compose intents (`ShareBuilder` in AturiCore),
/// so a client is listed only once its route is confirmed.
///
/// Reads `?text=` and `?url=`.
struct ShareToolView: View {
    let query: [String: String]

    init(query: [String: String]) {
        self.query = query
    }

    @State private var model = ShareBuilderModel()
    @State private var started = false

    @Environment(\.aturiTheme) private var theme
    @Environment(\.openURL) private var openURL

    var body: some View {
        ToolFrame(slug: "share", shareQuery: model.shareQuery) {
            form
        } content: {
            results
        }
        .onAppear(perform: start)
    }

    private func start() {
        guard !started else { return }
        started = true
        model.apply(query: query)
    }

    // MARK: Input

    private var form: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text("Text")
                        .font(AturiFont.caption)
                        .foregroundStyle(theme.textTertiary)
                    Spacer()
                    Text("\(model.graphemes) / \(ShareBuilder.postGraphemeLimit)")
                        .font(AturiFont.monoSmall)
                        .foregroundStyle(model.over > 0 ? theme.danger : theme.textTertiary)
                        .accessibilityLabel("\(model.graphemes) of \(ShareBuilder.postGraphemeLimit) characters")
                }
                editor
            }
            VStack(alignment: .leading, spacing: 6) {
                Text("Link (optional)")
                    .font(AturiFont.caption)
                    .foregroundStyle(theme.textTertiary)
                linkField
                if let problem = model.urlProblem {
                    Text(problem)
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.danger)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    Text("Try")
                        .font(AturiFont.caption)
                        .foregroundStyle(theme.textTertiary)
                    ForEach(ShareBuilderModel.examples, id: \.self) { example in
                        Button {
                            model.applyExample(text: example.text, url: example.url)
                        } label: {
                            Chip(example.label)
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Try \(example.label)")
                    }
                }
                .padding(.vertical, 2)
            }
        }
    }

    private var editor: some View {
        let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
        return ZStack(alignment: .topLeading) {
            TextEditor(text: $model.text)
                .font(AturiFont.body)
                .scrollContentBackground(.hidden)
                .frame(minHeight: 96)
                .padding(6)
                .accessibilityLabel("Text")
            if model.text.isEmpty {
                Text("What the post should say")
                    .font(AturiFont.body)
                    .foregroundStyle(theme.textTertiary)
                    .padding(.horizontal, 11)
                    .padding(.vertical, 14)
                    .allowsHitTesting(false)
                    .accessibilityHidden(true)
            }
        }
        .background(theme.bgSecondary, in: shape)
        .overlay(shape.strokeBorder(theme.borderStrong, lineWidth: 1))
    }

    private var linkField: some View {
        let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
        /* A String, not a localized key: a key is read as markdown, which
           turns the URL into a link and tints the placeholder blue. */
        return TextField("https://example.com/post" as String, text: $model.url)
            .font(AturiFont.body)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .keyboardType(.URL)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(theme.bgSecondary, in: shape)
            .overlay(shape.strokeBorder(model.urlProblem == nil ? theme.borderStrong : theme.danger, lineWidth: 1))
            .accessibilityLabel("Link (optional)")
    }

    // MARK: Results

    @ViewBuilder
    private var results: some View {
        if let warning = model.lengthWarning {
            ServicesVerdictCard(verdict: warning)
        }
        if model.post.isEmpty {
            ServicesIntro(
                title: "How it works",
                items: [
                    ServicesIntroItem(
                        term: "One link per client",
                        text: "Each link opens that client’s composer with the text already in it. Nothing is posted until the person presses send, and someone who is signed out is asked to sign in first."
                    ),
                    ServicesIntroItem(
                        term: "The text is the post",
                        text: "A link, when there is one, goes on a line of its own after the text. The whole thing has to fit in \(ShareBuilder.postGraphemeLimit) characters."
                    ),
                    ServicesIntroItem(
                        term: "Markup to paste",
                        text: "Pick a client and copy a plain link, or a button that carries its own styling."
                    ),
                ]
            )
        }
        let targets = model.targets
        ToolSection(
            "Links",
            detail: "\(targets.count) clients. These are the clients in the universal links catalog with a confirmed compose route, Bluesky’s action intent link."
        ) {
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(targets.enumerated()), id: \.element.id) { index, target in
                    if index > 0 {
                        Divider()
                    }
                    targetRow(target)
                }
            }
        }
        if let target = model.target {
            markup(target, targets: targets)
        }
    }

    private func targetRow(_ target: ShareBuilder.Target) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 10) {
                WaypointMark(id: target.id, size: 22)
                    .accessibilityHidden(true)
                Text(target.name)
                    .font(AturiFont.sans(.subheadline, weight: .semibold))
                    .foregroundStyle(theme.textPrimary)
                Spacer(minLength: 0)
                if let url = URL(string: target.url) {
                    Button {
                        openURL(url)
                    } label: {
                        Label("Open", systemImage: "arrow.up.right.square")
                    }
                    .buttonStyle(.aturiSecondary)
                    .accessibilityLabel("Open the \(target.name) composer")
                    .accessibilityHint("Opens outside the app")
                }
            }
            CopyRow(label: "Link", value: target.url)
            if !target.prefillsText {
                Text("Opens the composer, but does not fill in the text.")
                    .font(AturiFont.caption)
                    .foregroundStyle(theme.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            if let appUrl = target.appUrl {
                CopyRow(label: "In the app", value: appUrl)
            }
        }
        .padding(.vertical, 8)
    }

    private func markup(_ target: ShareBuilder.Target, targets: [ShareBuilder.Target]) -> some View {
        ToolSection("Markup") {
            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 6) {
                    Text("For")
                        .font(AturiFont.caption)
                        .foregroundStyle(theme.textTertiary)
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 6) {
                            ForEach(targets) { item in
                                Button {
                                    model.chosen = item.id
                                } label: {
                                    Chip(item.name, style: item.id == target.id ? .accent : .neutral)
                                }
                                .buttonStyle(.plain)
                                .accessibilityAddTraits(item.id == target.id ? .isSelected : [])
                            }
                        }
                        .padding(.vertical, 2)
                    }
                }
                VStack(alignment: .leading, spacing: 6) {
                    Text("Label")
                        .font(AturiFont.caption)
                        .foregroundStyle(theme.textTertiary)
                    labelField
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("A plain link")
                        .font(AturiFont.sans(.subheadline, weight: .semibold))
                        .foregroundStyle(theme.textPrimary)
                    ServicesCodeBlock(text: model.anchorSnippet ?? "", label: "link markup")
                }
                VStack(alignment: .leading, spacing: 8) {
                    Text("A button with its own styling")
                        .font(AturiFont.sans(.subheadline, weight: .semibold))
                        .foregroundStyle(theme.textPrimary)
                    buttonPreview(target)
                    ServicesCodeBlock(text: model.buttonSnippet ?? "", label: "button markup")
                }
            }
        }
    }

    private var labelField: some View {
        let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
        let binding = Binding<String>(
            get: { model.buttonLabel },
            set: { model.label = $0 }
        )
        return TextField("Label", text: binding)
            .font(AturiFont.body)
            .padding(.horizontal, 12)
            .frame(minHeight: 44)
            .background(theme.bgSecondary, in: shape)
            .overlay(shape.strokeBorder(theme.borderStrong, lineWidth: 1))
    }

    /// The button the snippet draws, in its own colours: the site's moss,
    /// white, semibold, 8pt corners. It opens the composer, as on a page.
    private func buttonPreview(_ target: ShareBuilder.Target) -> some View {
        let rgb = ShareBuilder.buttonBackgroundRGB
        return Button {
            if let url = URL(string: target.url) {
                openURL(url)
            }
        } label: {
            Text(model.buttonLabel)
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(Color.white)
                .padding(.vertical, 9)
                .padding(.horizontal, 16)
                .background(Color(red: rgb.red, green: rgb.green, blue: rgb.blue), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityHint("Opens the composer outside the app")
        .padding(12)
        .frame(maxWidth: .infinity)
        .background(theme.surfaceSubtle, in: RoundedRectangle(cornerRadius: AturiTheme.controlRadius, style: .continuous))
    }
}
