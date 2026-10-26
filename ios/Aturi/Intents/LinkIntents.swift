import AppIntents
import AturiCore

/* The Links tab as Shortcuts actions. The two "Open" actions bring the app
   forward and land on the same preview a universal link lands on; the
   "Get" actions run without opening the app and hand their result to the
   next action in the shortcut. */

/* The App Intents metadata extractor reads parameter attributes at build
   time and expects literal values there, so the keyboard options are
   spelled out on each link field rather than shared through a constant. */

struct OpenLinkIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Link in Aturi"
    static let description = IntentDescription(
        "Opens a link from any Atmosphere app, an at:// URI, a handle or a DID in Aturi, with its preview and every client that can open it. If you have auto-redirect on, Aturi follows it as it would for a link you tapped.",
        categoryName: "Links",
        searchKeywords: ["atproto", "bluesky", "universal link", "waypoint", "preview"]
    )
    static let openAppWhenRun = true

    @Parameter(
        title: "Link",
        description: "A link from any Atmosphere app, an at:// URI, a handle or a DID.",
        inputOptions: String.IntentInputOptions(keyboardType: .URL, capitalizationType: .none, autocorrect: false),
        requestValueDialog: "Which link do you want to open?"
    )
    var link: String

    static var parameterSummary: some ParameterSummary {
        Summary("Open \(\.$link) in Aturi")
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        guard AppEnvironment.shared.router.openLink(ShortcutInput.normalized(link)) else {
            throw AturiIntentError.unreadableInput(LinkResolution.unreadableInputMessage)
        }
        return .result()
    }
}

struct OpenCopiedLinkIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Copied Link in Aturi"
    static let description = IntentDescription(
        "Opens whatever link is on the clipboard in Aturi's Links tab, with its preview and every client that can open it. iOS asks before Aturi reads something another app copied; allow pasting from other apps in Aturi's settings to skip the question.",
        categoryName: "Links",
        searchKeywords: ["clipboard", "paste", "copied", "atproto", "bluesky"]
    )
    static let openAppWhenRun = true

    /* The clipboard is read by the Links tab once the app is in front (see
       `AppRouter.requestClipboardLink`), not here: this can run while the
       app is still coming forward, when iOS cannot ask about the paste. */
    @MainActor
    func perform() async throws -> some IntentResult {
        AppEnvironment.shared.router.requestClipboardLink()
        return .result()
    }
}

struct GetAturiLinkIntent: AppIntent {
    static let title: LocalizedStringResource = "Get Aturi Link"
    static let description = IntentDescription(
        "Turns a link from any Atmosphere app, an at:// URI, a handle or a DID into an aturi.to link, which lets whoever opens it choose their own client. Works offline: the link is built from what you give it, without looking the account up.",
        categoryName: "Links",
        searchKeywords: ["universal link", "share", "convert", "aturi.to", "atproto"]
    )

    @Parameter(
        title: "Link",
        description: "A link from any Atmosphere app, an at:// URI, a handle or a DID.",
        inputOptions: String.IntentInputOptions(keyboardType: .URL, capitalizationType: .none, autocorrect: false),
        requestValueDialog: "Which link should become an Aturi link?"
    )
    var link: String

    static var parameterSummary: some ParameterSummary {
        Summary("Get the Aturi link for \(\.$link)")
    }

    func perform() async throws -> some IntentResult & ReturnsValue<URL> & ProvidesDialog {
        guard let aturiLink = ShortcutInput.aturiLink(from: link), let url = URL(string: aturiLink) else {
            throw AturiIntentError.unreadableInput(LinkResolution.unreadableInputMessage)
        }
        return .result(value: url, dialog: "\(aturiLink)")
    }
}

struct GetClientLinkIntent: AppIntent {
    static let title: LocalizedStringResource = "Get Client Link"
    static let description = IntentDescription(
        "Builds the link that opens a post, profile, list or record in the client you choose, from Bluesky and its forks to Leaflet, Tangled or pdsls, including your custom waypoints. Pass the result to Open URLs to open it there.",
        categoryName: "Links",
        searchKeywords: ["open in", "client", "waypoint", "bluesky", "convert"]
    )

    @Parameter(
        title: "Link",
        description: "A link from any Atmosphere app, an at:// URI, a handle or a DID.",
        inputOptions: String.IntentInputOptions(keyboardType: .URL, capitalizationType: .none, autocorrect: false),
        requestValueDialog: "Which link should I convert?"
    )
    var link: String

    @Parameter(title: "Client", requestValueDialog: "Which client should open it?")
    var client: WaypointEntity

    static var parameterSummary: some ParameterSummary {
        Summary("Get the \(\.$client) link for \(\.$link)")
    }

    func perform() async throws -> some IntentResult & ReturnsValue<URL> & ProvidesDialog {
        let resolved = try await IntentLinks.resolve(link)
        let customs = await IntentLinks.customWaypoints()
        switch WaypointDirectory.clientLink(for: resolved, waypointId: client.id, customWaypoints: customs) {
        case .success(let string):
            guard let url = URL(string: string) else {
                throw AturiIntentError.clientLink(.noDestination, client: client.name)
            }
            return .result(value: url, dialog: "\(string)")
        case .failure(let failure):
            throw AturiIntentError.clientLink(failure, client: client.name)
        }
    }
}

struct GetAtUriIntent: AppIntent {
    static let title: LocalizedStringResource = "Get AT URI"
    static let description = IntentDescription(
        "Looks up the canonical at:// URI for a link, handle or DID, with the handle resolved to the account's DID.",
        categoryName: "Links",
        searchKeywords: ["at uri", "at://", "did", "canonical", "atproto"]
    )

    @Parameter(
        title: "Link",
        description: "A link from any Atmosphere app, an at:// URI, a handle or a DID.",
        inputOptions: String.IntentInputOptions(keyboardType: .URL, capitalizationType: .none, autocorrect: false),
        requestValueDialog: "Which link do you want the AT URI for?"
    )
    var link: String

    static var parameterSummary: some ParameterSummary {
        Summary("Get the AT URI for \(\.$link)")
    }

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        let resolved = try await IntentLinks.resolve(link)
        return .result(value: resolved.atUri, dialog: "\(resolved.atUri)")
    }
}
