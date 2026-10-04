import AppIntents
import AturiCore

/// What a Shortcuts or Siri action says when it cannot do what was asked.
/// Shortcuts shows the message in its alert and Siri reads it out, so each
/// one says what went wrong in the person's terms and, where there is one,
/// what to try instead.
enum AturiIntentError: Error, CustomLocalizedStringResourceConvertible {
    /// The input names nothing; the message is the Links tab's copy.
    case unreadableInput(String)
    case accountNotFound(String)
    /// The resolver could not be reached; the message says to retry.
    case resolverUnavailable(String)
    case noHandle(String)
    case profileUnavailable(String)
    case notARecord
    case recordUnavailable
    case notALexicon(String)
    case signedOut
    case clientLink(ClientLinkFailure, client: String)

    var localizedStringResource: LocalizedStringResource {
        switch self {
        case .unreadableInput(let message):
            return "\(message)"
        case .accountNotFound(let handle):
            return "No account answers to \(handle). Check the spelling, or try the account's DID."
        case .resolverUnavailable(let message):
            return "\(message)"
        case .noHandle(let did):
            return "\(did) does not name a handle in its DID document."
        case .profileUnavailable(let account):
            return "The Bluesky AppView has no profile for \(account). It may not be indexed there, or the AppView may be unavailable."
        case .notARecord:
            return "That names an account, not a record. Give an at:// URI or a link to a post, list or record."
        case .recordUnavailable:
            return "The record could not be read. It may have been deleted, or the account's server may be unavailable."
        case .notALexicon(let input):
            return "\(input) is not a lexicon NSID. Try one like app.bsky.feed.post, or a namespace like app.bsky."
        case .signedOut:
            return "You are not signed in to Aturi. Sign in from Settings, then try again."
        case .clientLink(let failure, let client):
            switch failure {
            case .unknownWaypoint:
                return "\(client) is no longer one of your clients. Edit the shortcut to pick another."
            case .unsupportedType(let type):
                return "\(client) does not open \(IntentLinks.noun(for: type))s."
            case .noDestination:
                return "\(client) has no page for that link."
            case .unsafeDestination:
                return "\(client) did not produce a web link, so Aturi will not hand it on. Check the custom waypoint's template in Settings."
            }
        }
    }
}

/// The pieces every action shares: input read the way the Links tab reads
/// it, links resolved the way the preview page resolves them.
enum IntentLinks {
    /// Resolve an action's link input, or throw the error the person
    /// should see.
    static func resolve(_ input: String) async throws -> ResolvedLink {
        switch try await LinkResolution.resolve(ShortcutInput.normalized(input)) {
        case .resolved(let link):
            return link
        case .invalid(let message):
            throw AturiIntentError.unreadableInput(message)
        case .notFound(let handle):
            throw AturiIntentError.accountNotFound(handle)
        case .unavailable(let message):
            throw AturiIntentError.resolverUnavailable(message)
        }
    }

    /// The account an action's input names (handle, DID, AT URI or link),
    /// or the error saying it names none.
    static func accountIdentifier(_ input: String) throws -> String {
        guard let identifier = ShortcutInput.accountIdentifier(from: input) else {
            throw AturiIntentError.unreadableInput("\"\(input)\" is not a handle, a DID, or a link that names an account.")
        }
        return identifier
    }

    /// The DID behind a handle or DID, or the error saying why there is none.
    static func resolveDID(_ identifier: String) async throws -> String {
        switch await IdentityResolver.shared.resolveHandleStatus(identifier) {
        case .did(let did):
            return did
        case .notFound:
            throw AturiIntentError.accountNotFound(identifier)
        case .unavailable:
            throw AturiIntentError.resolverUnavailable("The atproto resolver could not be reached to look up \(identifier). This is usually temporary; try again in a moment.")
        }
    }

    /// The person's custom waypoints, read fresh from the app group: the
    /// share extension or the PDS sync may have changed them since the app
    /// last looked.
    @MainActor
    static func customWaypoints() -> [CustomWaypoint] {
        PreferencesStore().prefs.customWaypoints
    }

    /// "post", "profile", "list" or "record", for messages.
    static func noun(for type: WaypointType) -> String {
        switch type {
        case .post: return "post"
        case .profile: return "profile"
        case .list: return "list"
        case .record, .unknown: return "record"
        }
    }
}
