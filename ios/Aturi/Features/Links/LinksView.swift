import SwiftUI
import UIKit
import AturiCore

/* Links used to be a tab of its own: a box to paste a link into and the
   links opened lately. Both now live on the Explore landing, whose search
   box already took links. What the two screens share is here. */

/// How a typed or pasted string becomes the universal-link page. Only a
/// web link does: a handle, a DID or an `at://` URI typed into Explore
/// still opens the explorer page for it, as it always has.
enum LinkInput {
    /// The preview for `value` when it is an http(s) link to a page this
    /// app can preview: an aturi.to universal link, or a link from any
    /// client in the catalog (bsky.app, deer.social, tangled.org...). Nil
    /// for anything else, including aturi.to explorer pages, which the
    /// router opens as explorer pages.
    static func previewComponents(for value: String) -> AtUriComponents? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = trimmed.lowercased()
        guard lower.hasPrefix("https://") || lower.hasPrefix("http://") else { return nil }
        if let target = DeepLinks.target(for: trimmed) {
            if case .route(.preview(let components), _) = target {
                return components
            }
            return nil
        }
        guard var components = extractAtUriComponents(trimmed) else { return nil }
        if components.identifier.hasPrefix("@") {
            components.identifier.removeFirst()
        }
        return components
    }

    /// Push the preview for a link the person entered in the app. It is
    /// noted as in-app, so an auto-redirect preference never fires for it.
    @MainActor
    static func openPreview(_ components: AtUriComponents, router: AppRouter) {
        LinkNavigation.noteInAppPreview(components)
        router.open(.preview(components), in: .explore)
    }
}

/// "Recent links" on the Explore landing: the universal-link pages opened
/// lately, newest first, with Clear. Tapping one opens it again as an
/// in-app link.
struct RecentLinksSection: View {
    @Environment(AppRouter.self) private var router
    @Environment(\.aturiTheme) private var theme

    private var recents: RecentLinksStore {
        RecentLinksStore.shared
    }

    var body: some View {
        Group {
            if !recents.entries.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(alignment: .firstTextBaseline) {
                        SectionHeader("Recent links")
                        Button("Clear") {
                            recents.clear()
                            /* The pages this app put in Spotlight and Siri
                               Suggestions (PageActivity.swift) are history too. */
                            NSUserActivity.deleteAllSavedUserActivities {}
                        }
                        .font(AturiFont.footnote)
                        .foregroundStyle(theme.textSecondary)
                    }
                    VStack(spacing: 0) {
                        ForEach(recents.entries) { entry in
                            Button {
                                open(entry.input)
                            } label: {
                                row(entry)
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
        }
        .task {
            recents.reload()
        }
    }

    private func row(_ entry: RecentLinksStore.Entry) -> some View {
        HStack(alignment: .center, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(entry.label)
                        .font(AturiFont.body)
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
                .font(AturiFont.caption)
                .foregroundStyle(theme.textTertiary)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .contentShape(Rectangle())
    }

    /* Entries are aturi.to links, so this is almost always the preview;
       anything else goes where the router sends it. */
    private func open(_ input: String) {
        if let components = LinkInput.previewComponents(for: input) {
            LinkInput.openPreview(components, router: router)
        } else {
            router.handle(string: input)
        }
    }
}
