import AppIntents
import AturiCore

/* Identity lookups as Shortcuts actions. None of them opens the app: each
   answers in a dialog Siri can read out and returns the value for the next
   action. A handle spoken to Siri ("dame dot is") is read as the handle it
   spells. */

struct ResolveHandleIntent: AppIntent {
    static let title: LocalizedStringResource = "Resolve Handle"
    static let description = IntentDescription(
        "Looks up the DID behind an Atmosphere handle. Also takes a link or AT URI and resolves the account it names.",
        categoryName: "Identity",
        searchKeywords: ["did", "handle", "lookup", "atproto", "identity"]
    )

    @Parameter(
        title: "Handle",
        description: "A handle such as alice.bsky.social, or a link or AT URI naming an account.",
        inputOptions: String.IntentInputOptions(keyboardType: .URL, capitalizationType: .none, autocorrect: false),
        requestValueDialog: "Which handle should I look up?"
    )
    var handle: String

    static var parameterSummary: some ParameterSummary {
        Summary("Resolve \(\.$handle) to a DID")
    }

    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        let identifier = try IntentLinks.accountIdentifier(handle)
        if identifier.hasPrefix("did:") {
            return .result(value: identifier, dialog: "That is already a DID: \(identifier)")
        }
        let did = try await IntentLinks.resolveDID(identifier)
        return .result(value: did, dialog: "\(identifier) is \(did)")
    }
}

struct GetHandleIntent: AppIntent {
    static let title: LocalizedStringResource = "Get Handle for DID"
    static let description = IntentDescription(
        "Reads the handle a DID's document names, straight from plc.directory or the did:web host, with no Bluesky service involved.",
        categoryName: "Identity",
        searchKeywords: ["did", "handle", "reverse lookup", "atproto", "plc"]
    )

    @Parameter(
        title: "DID",
        description: "A DID such as did:plc:..., or a link or AT URI naming an account.",
        inputOptions: String.IntentInputOptions(keyboardType: .URL, capitalizationType: .none, autocorrect: false),
        requestValueDialog: "Which DID should I look up?"
    )
    var did: String

    static var parameterSummary: some ParameterSummary {
        Summary("Get the handle for \(\.$did)")
    }

    /* A handle given here resolves to its DID first, so the answer is the
       handle the account's own document claims, which is the one to trust. */
    func perform() async throws -> some IntentResult & ReturnsValue<String> & ProvidesDialog {
        let identifier = try IntentLinks.accountIdentifier(did)
        let resolvedDID: String
        if identifier.hasPrefix("did:") {
            resolvedDID = identifier
        } else {
            resolvedDID = try await IntentLinks.resolveDID(identifier)
        }
        guard let handle = await IdentityResolver.shared.resolveDIDHandle(resolvedDID) else {
            throw AturiIntentError.noHandle(resolvedDID)
        }
        return .result(value: handle, dialog: "\(resolvedDID) is @\(handle)")
    }
}

struct GetProfileIntent: AppIntent {
    static let title: LocalizedStringResource = "Get Profile"
    static let description = IntentDescription(
        "Gets an account's Bluesky profile from the public AppView: display name, description, avatar and banner, follower, following and post counts, and its aturi.to link.",
        categoryName: "Identity",
        searchKeywords: ["profile", "followers", "bio", "bluesky", "account"]
    )

    @Parameter(
        title: "Account",
        description: "A handle, a DID, or a link or AT URI naming an account.",
        inputOptions: String.IntentInputOptions(keyboardType: .URL, capitalizationType: .none, autocorrect: false),
        requestValueDialog: "Whose profile?"
    )
    var account: String

    static var parameterSummary: some ParameterSummary {
        Summary("Get the profile of \(\.$account)")
    }

    func perform() async throws -> some IntentResult & ReturnsValue<ProfileEntity> & ProvidesDialog {
        let identifier = try IntentLinks.accountIdentifier(account)
        guard let profile = await AppViewClient().getProfile(identifier) else {
            throw AturiIntentError.profileUnavailable(identifier)
        }
        let entity = ProfileEntity(profile: profile)
        return .result(value: entity, dialog: "\(Self.summary(of: profile))")
    }

    /// "Alice (@alice.test): 120 followers, 80 following, 1,024 posts."
    /// Counts the AppView left out are left out here too.
    private static func summary(of profile: BskyProfile) -> String {
        let name = profile.displayName.flatMap { $0.isEmpty ? nil : $0 }
        let who = name.map { "\($0) (@\(profile.handle))" } ?? "@\(profile.handle)"
        let counts = [
            profile.followersCount.map { "\($0.formatted()) followers" },
            profile.followsCount.map { "\($0.formatted()) following" },
            profile.postsCount.map { "\($0.formatted()) posts" },
        ].compactMap { $0 }
        guard !counts.isEmpty else { return "\(who)." }
        return "\(who): \(counts.joined(separator: ", "))."
    }
}
