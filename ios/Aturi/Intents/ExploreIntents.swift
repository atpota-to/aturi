import AppIntents
import AturiCore

/* The Atmosphere Explorer and the Lexicons tab as Shortcuts actions. The
   "Open" and "Explore" actions bring the app forward on the page; "Get
   Record" runs without opening the app. */

struct ExploreIntent: AppIntent {
    static let title: LocalizedStringResource = "Explore in Aturi"
    static let description = IntentDescription(
        "Opens the Atmosphere Explorer on whatever you give it, routed the way the explorer's search box routes it: a handle or DID opens the repo, an at:// URI or a link from a supported app opens the record, and a PDS host opens the server.",
        categoryName: "Explore",
        searchKeywords: ["explorer", "repo", "pds", "search", "atproto"]
    )
    static let openAppWhenRun = true

    @Parameter(
        title: "Handle, DID, AT URI or Link",
        inputOptions: String.IntentInputOptions(keyboardType: .URL, capitalizationType: .none, autocorrect: false),
        requestValueDialog: "What do you want to explore?"
    )
    var query: String

    static var parameterSummary: some ParameterSummary {
        Summary("Explore \(\.$query) in Aturi")
    }

    /* `Route.search` is the search box's own result page: it routes the
       text (asking aturi.to about an unrecognised URL), records it in the
       search history and pushes the page it lands on. */
    @MainActor
    func perform() async throws -> some IntentResult {
        let value = ShortcutInput.normalized(query)
        guard !value.isEmpty else {
            throw AturiIntentError.unreadableInput("There is nothing to explore. Give a handle, a DID, an at:// URI or a link.")
        }
        AppEnvironment.shared.router.open(.search(value), in: .explore)
        return .result()
    }
}

struct GetRecordIntent: AppIntent {
    static let title: LocalizedStringResource = "Get Record"
    static let description = IntentDescription(
        "Fetches a record's JSON from the account's own server, falling back to the public Bluesky API when that server cannot be reached. Use Get Dictionary from Input to read its fields.",
        categoryName: "Explore",
        searchKeywords: ["json", "record", "at uri", "pds", "atproto"]
    )

    @Parameter(
        title: "Record",
        description: "An at:// URI, or a link to a post, list or record.",
        inputOptions: String.IntentInputOptions(keyboardType: .URL, capitalizationType: .none, autocorrect: false),
        requestValueDialog: "Which record?"
    )
    var record: String

    static var parameterSummary: some ParameterSummary {
        Summary("Get the record at \(\.$record)")
    }

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        let resolved = try await IntentLinks.resolve(record)
        guard let collection = resolved.collection, let rkey = resolved.rkey else {
            throw AturiIntentError.notARecord
        }
        guard let fetched = await resolved.fetchRecord(identity: .shared, pds: PDSClient()) else {
            throw AturiIntentError.recordUnavailable
        }
        /* Siri reads the dialog, so it names the record rather than
           reciting its JSON; the JSON is the returned value. */
        return .result(
            value: fetched.0.value.prettyPrinted(),
            dialog: "Got \(collection) record \(rkey) from \(resolved.displayName)."
        )
    }
}

struct OpenLexiconIntent: AppIntent {
    static let title: LocalizedStringResource = "Open Lexicon in Aturi"
    static let description = IntentDescription(
        "Opens a lexicon's page in Aturi's Lexicons tab: its schema, where it is used and the records published under it. Give an NSID such as app.bsky.feed.post, or a namespace such as app.bsky to browse its group.",
        categoryName: "Explore",
        searchKeywords: ["lexicon", "nsid", "schema", "collection", "atproto"]
    )
    static let openAppWhenRun = true

    @Parameter(
        title: "Lexicon",
        description: "An NSID such as app.bsky.feed.post, or a namespace such as app.bsky.",
        inputOptions: String.IntentInputOptions(keyboardType: .URL, capitalizationType: .none, autocorrect: false),
        requestValueDialog: "Which lexicon?"
    )
    var nsid: String

    static var parameterSummary: some ParameterSummary {
        Summary("Open the lexicon \(\.$nsid) in Aturi")
    }

    @MainActor
    func perform() async throws -> some IntentResult {
        guard let target = ShortcutInput.lexiconTarget(from: nsid) else {
            throw AturiIntentError.notALexicon(nsid)
        }
        let router = AppEnvironment.shared.router
        switch target {
        case .lexicon(let nsid):
            router.open(.lexicon(nsid: nsid), in: .lexicons)
        case .group(let prefix):
            router.open(.lexiconGroup(prefix: prefix), in: .lexicons)
        }
        return .result()
    }
}

struct OpenMyRepoIntent: AppIntent {
    static let title: LocalizedStringResource = "Open My Repo in Aturi"
    static let description = IntentDescription(
        "Opens your own repo in the Atmosphere Explorer: the account you are signed in to Aturi with.",
        categoryName: "Explore",
        searchKeywords: ["my account", "my repo", "pds", "records", "atproto"]
    )
    static let openAppWhenRun = true

    /* Signed out, the app is left on Settings, where signing in starts,
       and the error says why. */
    @MainActor
    func perform() async throws -> some IntentResult {
        let environment = AppEnvironment.shared
        guard let did = environment.session.state.did else {
            environment.router.popToRoot(.settings)
            environment.router.select(.settings)
            throw AturiIntentError.signedOut
        }
        environment.router.open(.repo(did), in: .explore)
        return .result()
    }
}
