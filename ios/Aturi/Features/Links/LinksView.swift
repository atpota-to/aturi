import SwiftUI
import UIKit
import AturiCore

/// The Links tab root: paste anything that names an Atmosphere page and
/// get the preview and the waypoint picker. This is the input half of the
/// universal-link experience; a link that arrives from outside the app
/// skips this screen and lands straight on `PreviewView`.
struct LinksView: View {
    @Environment(AppRouter.self) private var router
    @Environment(\.aturiTheme) private var theme
    @State private var input = ""
    @State private var showsInvalidHint = false
    @FocusState private var inputFocused: Bool

    /// Inputs offered as a starting point: public accounts the web app
    /// already uses as examples.
    private static let examples = ["dame.is", "https://bsky.app/profile/aturi.to"]

    private var recents: RecentLinksStore {
        RecentLinksStore.shared
    }

    private var trimmed: String {
        input.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var isValid: Bool {
        !trimmed.isEmpty && isValidInput(trimmed)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                intro
                inputCard
                if !recents.entries.isEmpty {
                    recentsSection
                }
                explanation
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
        }
        .scrollDismissesKeyboard(.interactively)
        .background(theme.bgPrimary)
        .navigationTitle("Links")
        .task {
            recents.reload()
        }
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Tour the Atmosphere.")
                .font(AturiFont.display)
                .foregroundStyle(theme.textPrimary)
            Text("Paste a link from any Atmosphere app, an at:// URI, a handle or a DID. You get a preview and a list of every client that can open it.")
                .font(.footnote)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var inputCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            SectionHeader("Open a link")
            HStack(spacing: 8) {
                TextField("Link, AT URI, handle or DID", text: $input)
                    .font(AturiFont.mono)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .keyboardType(.URL)
                    .submitLabel(.go)
                    .focused($inputFocused)
                    .onSubmit(open)
                    .padding(10)
                    .background(theme.bgTertiary, in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                if !input.isEmpty {
                    Button {
                        input = ""
                        showsInvalidHint = false
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundStyle(theme.textTertiary)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("Clear")
                }
            }
            if showsInvalidHint && !trimmed.isEmpty && !isValid {
                Text("That is not a link this app can open. Try an at:// URI, a handle, a DID, or a link from a supported app.")
                    .font(.footnote)
                    .foregroundStyle(theme.danger)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 10) {
                Button(action: paste) {
                    Label("Paste", systemImage: "doc.on.clipboard")
                }
                .buttonStyle(.aturiSecondary)
                Button(action: open) {
                    Label("Open", systemImage: "arrow.right")
                }
                .buttonStyle(.aturiPrimary)
                .disabled(trimmed.isEmpty)
            }
            examplesRow
        }
        .padding(14)
        .cardBackground()
    }

    private var examplesRow: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Try")
                .aturiLabel()
                .foregroundStyle(theme.textTertiary)
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    ForEach(Self.examples, id: \.self) { example in
                        Button {
                            input = example
                            open()
                        } label: {
                            Chip(example, systemImage: "arrow.up.right")
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel("Open \(example)")
                    }
                }
            }
        }
    }

    private var recentsSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                SectionHeader("Recent")
                Button("Clear") {
                    recents.clear()
                }
                .font(.footnote)
                .foregroundStyle(theme.textSecondary)
            }
            VStack(spacing: 0) {
                ForEach(recents.entries) { entry in
                    Button {
                        input = entry.input
                        open()
                    } label: {
                        recentRow(entry)
                    }
                    .buttonStyle(.plain)
                    .contextMenu {
                        Button {
                            UIPasteboard.general.string = entry.input
                        } label: {
                            Label("Copy link", systemImage: "doc.on.doc")
                        }
                        Button(role: .destructive) {
                            recents.remove(entry)
                        } label: {
                            Label("Remove", systemImage: "trash")
                        }
                    }
                    if entry.id != recents.entries.last?.id {
                        Divider()
                            .overlay(theme.borderSubtle)
                    }
                }
            }
            .cardBackground()
        }
    }

    private func recentRow(_ entry: RecentLinksStore.Entry) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(entry.label)
                        .font(.body)
                        .foregroundStyle(theme.textPrimary)
                        .lineLimit(1)
                    if let detail = entry.detail, !detail.isEmpty {
                        Chip(detail)
                    }
                }
                IdentifierText(entry.input, font: AturiFont.monoSmall)
                    .foregroundStyle(theme.textSecondary)
            }
            Spacer(minLength: 0)
            RelativeDateText(date: entry.visitedAt)
                .font(.caption)
                .foregroundStyle(theme.textTertiary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }

    private var explanation: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("What is a universal link?")
                .font(AturiFont.subtitle)
                .foregroundStyle(theme.textPrimary)
            Text("An aturi.to link names an account or a record on the AT Protocol rather than one app. Whoever opens it picks the client they prefer, and this app is one of the places it can land.")
                .font(.footnote)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
            Text("Every page you preview here has a share button with its aturi.to link, so the people you send it to get the same choice.")
                .font(.footnote)
                .foregroundStyle(theme.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }

    /* The pasteboard's URL is preferred over its string because a copied
       link may carry surrounding text; a valid paste opens straight away
       since that is the whole point of the button. */
    private func paste() {
        let board = UIPasteboard.general
        let text = board.url?.absoluteString ?? board.string
        guard let text, !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else { return }
        input = text.trimmingCharacters(in: .whitespacesAndNewlines)
        showsInvalidHint = false
        if isValid {
            open()
        }
    }

    /* Anything `extractAtUriComponents` understands becomes a preview page
       on this tab. Other links the router knows (an aturi.to explorer page)
       go where the router sends them; everything else is refused with the
       hint rather than handed to Safari. */
    private func open() {
        let value = trimmed
        guard !value.isEmpty else { return }
        if var components = extractAtUriComponents(value) {
            if components.identifier.hasPrefix("@") {
                components.identifier.removeFirst()
            }
            inputFocused = false
            showsInvalidHint = false
            router.open(.preview(components), in: .links)
            return
        }
        if router.handle(string: value) {
            inputFocused = false
            showsInvalidHint = false
            return
        }
        showsInvalidHint = true
    }
}
