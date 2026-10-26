import AppIntents

/// The shortcuts Aturi offers with no setup: Siri runs them by phrase,
/// Spotlight and the Shortcuts app list them, and any of them can go on the
/// Action button. Every action in this folder is also available to build
/// shortcuts and automations with; these are the ones worth a phrase.
///
/// Siri cannot take a link by voice, so the phrases favour actions that need
/// none (the copied link, a tab, your repo) or that take a handle, which Siri
/// asks for and `ShortcutInput.normalized` reads back from dictation. Apple
/// caps an app at ten of these, and every phrase has to name the app. Phrases
/// are kept apart from the section names ("Open Links in Aturi") so Siri
/// does not mistake one for another.
struct AturiShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: OpenCopiedLinkIntent(),
            phrases: [
                "Open copied link in \(.applicationName)",
                "Open the clipboard in \(.applicationName)",
                "Open my copied link with \(.applicationName)",
            ],
            shortTitle: "Open Copied Link",
            systemImageName: "doc.on.clipboard"
        )
        AppShortcut(
            intent: OpenLinkIntent(),
            phrases: [
                "Open a link with \(.applicationName)",
                "Preview a link in \(.applicationName)",
            ],
            shortTitle: "Open Link",
            systemImageName: "link"
        )
        AppShortcut(
            intent: GetClientLinkIntent(),
            phrases: [
                "Get a client link from \(.applicationName)",
                "Convert a link for another client with \(.applicationName)",
            ],
            shortTitle: "Get Client Link",
            systemImageName: "arrow.triangle.branch"
        )
        AppShortcut(
            intent: GetAturiLinkIntent(),
            phrases: [
                "Make an \(.applicationName) link",
                "Get an \(.applicationName) link",
            ],
            shortTitle: "Get Aturi Link",
            systemImageName: "link.badge.plus"
        )
        AppShortcut(
            intent: ExploreIntent(),
            phrases: [
                "Explore in \(.applicationName)",
                "Look up an account in \(.applicationName)",
                "Search the Atmosphere with \(.applicationName)",
            ],
            shortTitle: "Explore",
            systemImageName: "magnifyingglass"
        )
        AppShortcut(
            intent: ResolveHandleIntent(),
            phrases: [
                "Resolve a handle with \(.applicationName)",
                "Find a DID with \(.applicationName)",
            ],
            shortTitle: "Resolve Handle",
            systemImageName: "person.text.rectangle"
        )
        AppShortcut(
            intent: GetProfileIntent(),
            phrases: [
                "Get a profile with \(.applicationName)",
                "Look up a profile in \(.applicationName)",
            ],
            shortTitle: "Get Profile",
            systemImageName: "person.crop.circle"
        )
        AppShortcut(
            intent: OpenMyRepoIntent(),
            phrases: [
                "Open my repo in \(.applicationName)",
                "Show my repo in \(.applicationName)",
            ],
            shortTitle: "My Repo",
            systemImageName: "tray.full"
        )
        AppShortcut(
            intent: OpenLexiconIntent(),
            phrases: [
                "Look up a lexicon in \(.applicationName)",
                "Find a lexicon in \(.applicationName)",
            ],
            shortTitle: "Open Lexicon",
            systemImageName: "book.closed"
        )
        AppShortcut(
            intent: OpenSectionIntent(),
            phrases: [
                "Open \(\.$section) in \(.applicationName)",
                "Show \(\.$section) in \(.applicationName)",
                "Go to \(\.$section) in \(.applicationName)",
            ],
            shortTitle: "Open Section",
            systemImageName: "square.grid.2x2"
        )
    }

    /* The nearest tile colour to the app's sage accent. */
    static let shortcutTileColor: ShortcutTileColor = .grayGreen
}
