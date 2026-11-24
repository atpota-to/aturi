import AppIntents

/* The app's sections as an App Enum, so a shortcut can name one and Siri
   can take one in a phrase ("Open Lexicons in Aturi"). Links and Lexicons
   are no longer tabs but stay here, landing inside Explore. */
extension AppSection: AppEnum {
    static let typeDisplayRepresentation = TypeDisplayRepresentation(name: "Section", synonyms: ["Tab"])
    static let caseDisplayRepresentations: [AppSection: DisplayRepresentation] = [
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
        .tools: DisplayRepresentation(
            title: "Tools",
            subtitle: "Handle, record, feed and network checks",
            image: DisplayRepresentation.Image(systemName: "wrench.and.screwdriver")
        ),
        .settings: DisplayRepresentation(
            title: "Settings",
            subtitle: "Waypoints, redirects and appearance",
            image: DisplayRepresentation.Image(systemName: "gearshape")
        ),
        .account: DisplayRepresentation(
            title: "Account",
            subtitle: "Sign in and sync your settings",
            image: DisplayRepresentation.Image(systemName: "person.crop.circle")
        ),
    ]
}

struct OpenSectionIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Section in Aturi"
    static let description = IntentDescription(
        "Opens Aturi on a section: Explore, Links, Lexicons, Tools, Settings or Account.",
        categoryName: "Navigation",
        searchKeywords: ["tab", "explore", "links", "lexicons", "tools", "settings", "account"]
    )
    static let openAppWhenRun = true

    @Parameter(title: "Section", requestValueDialog: "Which section?")
    var section: AppSection

    static var parameterSummary: some ParameterSummary {
        Summary("Open \(\.$section) in Aturi")
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        AppEnvironment.shared.router.show(section)
        return .result()
    }
}
