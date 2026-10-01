import AppIntents

/* The tab bar as an App Enum, so a shortcut can name a tab and Siri can
   take one in a phrase ("Open Lexicons in Aturi"). */
extension Tab: AppEnum {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Section", synonyms: ["Tab"])
    static let caseDisplayRepresentations: [Tab: DisplayRepresentation] = [
        .explore: DisplayRepresentation(
            title: "Explore",
            subtitle: "The Atmosphere Explorer",
            image: DisplayRepresentation.Image(systemName: "magnifyingglass")
        ),
        .links: DisplayRepresentation(
            title: "Links",
            subtitle: "Previews and clients for any link",
            image: DisplayRepresentation.Image(systemName: "link")
        ),
        .lexicons: DisplayRepresentation(
            title: "Lexicons",
            subtitle: "Every lexicon in the Atmosphere",
            image: DisplayRepresentation.Image(systemName: "book.closed")
        ),
        .settings: DisplayRepresentation(
            title: "Settings",
            subtitle: "Waypoints, redirects and your account",
            image: DisplayRepresentation.Image(systemName: "gearshape")
        ),
    ]
}

struct OpenSectionIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Section in Aturi"
    static let description = IntentDescription(
        "Opens Aturi on one of its tabs, Explore, Links, Lexicons or Settings, back at the top of the tab.",
        categoryName: "Navigation",
        searchKeywords: ["tab", "explore", "links", "lexicons", "settings"]
    )
    static let openAppWhenRun = true

    @Parameter(title: "Section", requestValueDialog: "Which section?")
    var section: Tab

    static var parameterSummary: some ParameterSummary {
        Summary("Open \(\.$section) in Aturi")
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        let router = AppEnvironment.shared.router
        router.popToRoot(section)
        router.select(section)
        return .result()
    }
}
