import SwiftUI
import AturiCore

/// `/tools/page`, port of `src/components/tools/PageChecker.tsx`: how a web
/// page presents itself to the Atmosphere. The link card a client would draw
/// from its Open Graph and Twitter tags, and the at:// records its AT Tags
/// declare, with the one it is a view of read beside them. The reading is
/// `PageChecker` in AturiCore; the page is fetched from the app, straight
/// from its host, with the web's cap and deadline.
///
/// Reads `?url=`.
struct PageToolView: View {
    let query: [String: String]

    @State private var model = PageCheckerModel()
    @State private var text = ""
    @State private var started = false

    @Environment(\.aturiTheme) private var theme
    @Environment(AppRouter.self) private var router: AppRouter?
    @Environment(\.openURL) private var openURL

    private static let atTagsProposal = URL(string: "https://tangled.org/chrisshank.com/at-tags/")

    var body: some View {
        ToolFrame(slug: "page", shareQuery: model.shareQuery) {
            VStack(alignment: .leading, spacing: 10) {
                ToolInputBar(
                    placeholder: "https://example.com/post",
                    text: $text,
                    isRunning: model.isRunning
                ) {
                    model.run(text)
                }
                ToolExamples(examples: PageCheckerModel.examples) { value in
                    text = value
                    model.run(value)
                }
            }
        } content: {
            results
        }
        .onAppear(perform: start)
    }

    private func start() {
        guard !started else { return }
        started = true
        let url = query["url"] ?? ""
        guard !url.isEmpty else { return }
        text = url
        model.run(url)
    }

    private func open(_ route: Route) {
        LinkNavigation.open(route, router: router, openURL: openURL)
    }

    // MARK: Results

    @ViewBuilder
    private var results: some View {
        if let reason = model.input?.reason {
            ServicesInputError(message: reason)
        }
        if let verdict = model.verdict {
            ServicesVerdictCard(verdict: verdict)
            if let card = model.linkCard {
                ToolSection("Link card", detail: "As a client would draw it") {
                    PageLinkCardPreview(card: card)
                }
            }
            ToolSection("Checks", detail: model.isRunning ? "Checking…" : nil) {
                ServicesCheckList(checks: model.checks)
                if !model.isRunning {
                    Button("Check again") {
                        model.rerun()
                    }
                    .buttonStyle(.aturiSecondary)
                    .padding(.top, 8)
                }
            }
            if let reading = model.reading {
                recordsSection(reading)
                primaryRecordSection
                fieldsSection
            }
        }
        if model.raw.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            ServicesIntro(items: [
                ServicesIntroItem(
                    term: "The page can be fetched",
                    text: "A client that draws a link card fetches the page itself. A page that refuses the request gets no card."
                ),
                ServicesIntroItem(
                    term: "It offers a link card",
                    text: "og:title, og:description and og:image, with the fallbacks a client reaches for when one is missing."
                ),
                ServicesIntroItem(
                    term: "It names the record behind it",
                    text: "at:canonical and the other AT Tags tie a page to an at:// record. Tags that are present but ignored are listed with the reason."
                ),
            ])
        }
    }

    private func recordsSection(_ reading: PageChecker.Reading) -> some View {
        let records = model.records
        let count: String? = records.isEmpty ? nil : (records.count == 1 ? "1 URI" : "\(records.count) URIs")
        return ToolSection("Records this page declares", detail: count) {
            VStack(alignment: .leading, spacing: 0) {
                if records.isEmpty {
                    Text("None. A page that is a view of an atproto record can say so with a tag such as <meta name=\"at:canonical\" content=\"at://…\">, and tools that are handed the link can then find the record.")
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    ForEach(Array(records.enumerated()), id: \.element.id) { index, record in
                        if index > 0 {
                            Divider()
                        }
                        recordRow(record, primary: record.uri == reading.primary)
                    }
                }
                if let proposal = Self.atTagsProposal {
                    Button {
                        openURL(proposal)
                    } label: {
                        Text("The tags follow the AT Tags proposal.")
                            .font(AturiFont.caption)
                            .foregroundStyle(theme.textAccent)
                    }
                    .buttonStyle(.plain)
                    .accessibilityHint("Opens outside the app")
                    .padding(.top, 10)
                }
            }
        }
    }

    private func recordRow(_ record: PageChecker.DeclaredRecord, primary: Bool) -> some View {
        let route = Self.route(for: record.uri)
        return VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Chip(record.name, style: primary ? .accent : .neutral)
                Spacer(minLength: 0)
            }
            if let route {
                Button {
                    open(route)
                } label: {
                    IdentifierText(record.uri, lineLimit: 2, font: AturiFont.monoSmall)
                        .foregroundStyle(theme.textAccent)
                        .multilineTextAlignment(.leading)
                }
                .buttonStyle(.plain)
                .accessibilityHint("Opens in the explorer")
            } else {
                IdentifierText(record.uri, lineLimit: 2, font: AturiFont.monoSmall)
                    .foregroundStyle(theme.textSecondary)
            }
            Text(record.meaning)
                .font(AturiFont.caption)
                .foregroundStyle(theme.textTertiary)
        }
        .padding(.vertical, 8)
    }

    /// An at:// URI as an explorer page: a bare DID is the account.
    private static func route(for uri: String) -> Route? {
        let did = uri.hasPrefix("at://") ? String(uri.dropFirst("at://".count)) : uri
        if isValidDid(did) {
            return .repo(did)
        }
        return Route(atUri: uri)
    }

    /// The record the page says it is a view of, as Slingshot has it.
    @ViewBuilder
    private var primaryRecordSection: some View {
        if let primary = model.reading?.primary, let state = model.primaryRecord {
            ToolSection("The record behind the page", detail: primary) {
                switch state {
                case .pending:
                    SkeletonRows(count: 2)
                case .failed:
                    Text("No record at this address could be read. It may have been deleted, or the tag may name it wrongly.")
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                case .done(let record):
                    VStack(alignment: .leading, spacing: 10) {
                        JSONTreeView(value: record.value, expandedDepth: 1)
                        if let route = Self.route(for: primary) {
                            Button {
                                open(route)
                            } label: {
                                Label("Open the record in the Explorer", systemImage: "arrow.right.circle")
                            }
                            .buttonStyle(.aturiSecondary)
                        }
                    }
                }
            }
        }
    }

    @ViewBuilder
    private var fieldsSection: some View {
        let fields = model.fields
        if !fields.isEmpty {
            ToolSection("What the page says", detail: fields.count == 1 ? "1 field" : "\(fields.count) fields") {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(fields.enumerated()), id: \.offset) { _, field in
                        ToolFactRow(label: field.label, value: field.value, mono: false)
                    }
                }
            }
        }
    }
}

/// The card as a client would draw it: the image over the title, the
/// description and the host. No client's own styling is copied; this is the
/// app's card with those four parts in it. An image that does not load here
/// will not load in a client either, so a failure is shown rather than left
/// as a gap.
private struct PageLinkCardPreview: View {
    let card: PageChecker.LinkCard

    @Environment(\.aturiTheme) private var theme

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let image = card.image, let url = URL(string: image) {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let loaded):
                        loaded
                            .resizable()
                            .scaledToFill()
                            .frame(maxWidth: .infinity)
                            .frame(height: 170)
                            .clipped()
                    case .failure:
                        Label("The image did not load", systemImage: "photo.badge.exclamationmark")
                            .font(AturiFont.footnote)
                            .foregroundStyle(theme.textTertiary)
                            .frame(maxWidth: .infinity)
                            .frame(height: 80)
                            .background(theme.surfaceSubtle)
                    default:
                        theme.surfaceSubtle
                            .frame(height: 170)
                    }
                }
                .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(card.title ?? card.host)
                    .font(AturiFont.sans(.subheadline, weight: .semibold))
                    .foregroundStyle(theme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                if let description = card.description {
                    Text(description)
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textSecondary)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Label(card.host, systemImage: "globe")
                    .font(AturiFont.caption)
                    .foregroundStyle(theme.textTertiary)
            }
            .padding(12)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .clipShape(RoundedRectangle(cornerRadius: AturiTheme.controlRadius, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: AturiTheme.controlRadius, style: .continuous).strokeBorder(theme.borderMedium, lineWidth: 1))
    }
}
