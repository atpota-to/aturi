import Foundation
import Observation

/// One chip of the relationship strip: what it says, how it is toned and
/// where a tap goes (the repo page's own tabs).
public struct RelationshipChip: Hashable, Sendable, Identifiable {
    public enum Tone: Hashable, Sendable {
        case neutral
        case accent
    }

    public enum Destination: Hashable, Sendable {
        /// The repo page's ID tab (the web's `?tab=identity`).
        case identityTab
        /// The repo page's Lexicons tab (the web's `?tab=collections`).
        case collectionsTab
    }

    public let id: String
    public let label: String
    /// The trailing dimmed note (" since Mar 14, 2024"), nil for none.
    public let note: String?
    public let tone: Tone
    public let destination: Destination?

    public init(id: String, label: String, note: String? = nil, tone: Tone = .neutral, destination: Destination? = nil) {
        self.id = id
        self.label = label
        self.note = note
        self.tone = tone
        self.destination = destination
    }
}

/// The "You + @them" relationship strip shown above the profile header
/// on a repo page when a signed-in visitor is viewing somebody else's
/// repo. Port of the state in `RelationshipStrip.tsx`. Surfaces:
///
///   - Same PDS host (free: both PDS endpoints are already on hand).
///   - Bidirectional follow status from the AppView's `viewer` block.
///   - Mutual followers count from `knownFollowers.count`.
///   - Lexicons in common, counted from the collection sets the repo page
///     already loads for its cross-repo filter.
///
/// Both viewer state and known-followers are AppView-authenticated fields,
/// so the profile read goes through the session (`profileSource`), which
/// the app backs with `AuthenticatedPDS.getProfileWithViewer` and its
/// token refresh; the public AppView endpoint silently omits them.
///
/// Bidirectional backlink counts (you -> them, them -> you) are skipped as
/// on the web: Constellation cannot filter inbound links by source DID.
@MainActor
@Observable
public final class RelationshipModel {
    public nonisolated static let loadingCopy = "Loading relationship\u{2026}"
    public nonisolated static let noSignalsCopy = "No public signals between your accounts."

    public typealias ProfileSource = @Sendable (String) async throws -> BskyProfile?

    /// The repo the visitor is looking at.
    public let target: IdentityBundle
    /// The signed-in account.
    public let viewerDid: String

    /// The target's profile as the viewer sees it. `loaded(nil)` when the
    /// AppView has no profile, or the authenticated read failed: the strip
    /// then shows whatever the other signals say, as the web does when
    /// `getProfileWithViewer` returns null.
    public private(set) var profile: Loadable<BskyProfile?> = .idle
    /// The viewer's own PDS, for the same-host chip. `loaded(nil)` when the
    /// viewer's identity would not resolve.
    public private(set) var viewerPds: Loadable<String?> = .idle
    /// The target repo's collections, handed in by the repo page once its
    /// describeRepo lands. Nil until then.
    public var targetCollections: [String]?
    /// The viewer's own collections, handed in by the repo page. Nil until
    /// its lookup lands (or when it failed).
    public var viewerCollections: Set<String>?

    @ObservationIgnored private let profileSource: ProfileSource
    @ObservationIgnored private let resolver: IdentityResolver
    @ObservationIgnored private var loadTask: Task<Void, Never>?
    @ObservationIgnored private var generation = 0

    /// - Parameters:
    ///   - profileSource: the authenticated `getProfile` read; the app
    ///     passes the session store's proxied call.
    ///   - resolver: resolves the viewer's PDS; defaults to the shared
    ///     resolver and its caches.
    public init(
        target: IdentityBundle,
        viewerDid: String,
        profileSource: @escaping ProfileSource,
        resolver: IdentityResolver = .shared
    ) {
        self.target = target
        self.viewerDid = viewerDid
        self.profileSource = profileSource
        self.resolver = resolver
    }

    /// Whether the strip applies at all: signed in, and on someone else's
    /// repo. Own and signed-out pages render nothing, as on the web.
    public nonisolated static func applies(viewerDid: String?, targetDid: String) -> Bool {
        guard let viewerDid, !viewerDid.isEmpty else { return false }
        return viewerDid != targetDid
    }

    // MARK: Loading

    /// Fan out: the authenticated profile (viewer + knownFollowers) and the
    /// viewer's own identity (to compare PDS hosts). Cancels a previous
    /// load.
    public func load() {
        loadTask?.cancel()
        generation += 1
        let gen = generation
        profile = .loading
        viewerPds = .loading
        let source = profileSource
        let resolver = self.resolver
        let targetDid = target.did
        let viewerDid = self.viewerDid
        loadTask = Task { [weak self] in
            async let profileResult: BskyProfile? = {
                do {
                    return try await source(targetDid)
                } catch {
                    // The web logs and returns null; the strip still draws
                    // the signals that do not need the AppView.
                    return nil
                }
            }()
            async let pdsResult: String? = {
                do {
                    return try await resolver.resolveIdentifier(viewerDid).pds
                } catch {
                    return nil
                }
            }()
            let (fetchedProfile, fetchedPds) = await (profileResult, pdsResult)
            guard let self, gen == self.generation, !Task.isCancelled else { return }
            self.profile = .loaded(fetchedProfile)
            self.viewerPds = .loaded(fetchedPds)
        }
    }

    public func loadAndWait() async {
        load()
        await loadTask?.value
    }

    public func cancel() {
        loadTask?.cancel()
        loadTask = nil
    }

    /// Both lookups have answered (or failed), so the chips can draw.
    public var isLoaded: Bool {
        profile.value != nil && viewerPds.value != nil
    }

    // MARK: Signals

    /// "You + @them", the strip's title.
    public var title: String {
        "You + \(Self.targetLabel(target))"
    }

    /// `@handle`, or a DID cut at 24 characters.
    public nonisolated static func targetLabel(_ target: IdentityBundle) -> String {
        if let handle = target.handle, !handle.isEmpty {
            return "@\(handle)"
        }
        let did = target.did
        return did.count > 24 ? String(did.prefix(24)) + "\u{2026}" : did
    }

    /// The shared PDS hostname when both accounts live on the same host.
    public var samePdsHost: String? {
        guard let mine = viewerPds.value ?? nil, !mine.isEmpty, !target.pds.isEmpty else { return nil }
        let theirs = PDSServer.pdsHostname(target.pds)
        return PDSServer.pdsHostname(mine) == theirs ? theirs : nil
    }

    private var viewer: BskyViewerState? {
        (profile.value ?? nil)?.viewer
    }

    public var youFollow: Bool {
        viewer?.following.map { !$0.isEmpty } ?? false
    }

    public var followsYou: Bool {
        viewer?.followedBy.map { !$0.isEmpty } ?? false
    }

    public var isMutualFollow: Bool {
        youFollow && followsYou
    }

    /// When the viewer's follow record was created, decoded from its rkey.
    public var youFollowedOn: Date? {
        Self.dateFromFollowUri(viewer?.following)
    }

    /// When the target's follow record was created, decoded from its rkey.
    public var theyFollowedOn: Date? {
        Self.dateFromFollowUri(viewer?.followedBy)
    }

    /// Accounts the viewer follows that also follow the target.
    public var mutualCount: Int {
        (profile.value ?? nil)?.knownFollowers?.count ?? 0
    }

    /// Lexicons both repos hold records in; 0 until both sets are known.
    public var inCommonCount: Int {
        guard let target = targetCollections, let mine = viewerCollections else { return 0 }
        return target.reduce(0) { $0 + (mine.contains($1) ? 1 : 0) }
    }

    /// Whether anything at all connects the two accounts. False draws the
    /// "No public signals" line.
    public var hasSignals: Bool {
        samePdsHost != nil || youFollow || followsYou || mutualCount > 0 || inCommonCount > 0
    }

    /// The chips in the web's order: same PDS, the follow relationship,
    /// mutuals, lexicons in common.
    public var chips: [RelationshipChip] {
        var out: [RelationshipChip] = []
        if let host = samePdsHost {
            out.append(RelationshipChip(id: "pds", label: "Same PDS \u{00B7} \(host)"))
        }
        if isMutualFollow {
            out.append(RelationshipChip(
                id: "mutual-follow",
                label: "Mutual follow",
                note: youFollowedOn.map { "\u{00B7} since \(Self.formatShortDate($0))" },
                tone: .accent
            ))
        } else {
            if youFollow {
                out.append(RelationshipChip(
                    id: "you-follow",
                    label: "You follow them",
                    note: youFollowedOn.map { "\u{00B7} \(Self.formatShortDate($0))" }
                ))
            }
            if followsYou {
                out.append(RelationshipChip(
                    id: "follows-you",
                    label: "They follow you",
                    note: theyFollowedOn.map { "\u{00B7} \(Self.formatShortDate($0))" }
                ))
            }
        }
        if mutualCount > 0 {
            out.append(RelationshipChip(
                id: "mutuals",
                label: "\(JetstreamModel.grouped(mutualCount)) \(mutualCount == 1 ? "mutual" : "mutuals")",
                destination: .identityTab
            ))
        }
        if inCommonCount > 0 {
            out.append(RelationshipChip(
                id: "in-common",
                label: "\(JetstreamModel.grouped(inCommonCount)) \(inCommonCount == 1 ? "lexicon" : "lexicons") in common",
                destination: .collectionsTab
            ))
        }
        return out
    }

    /// The system image the app draws beside a chip, keyed by its id.
    public nonisolated static func systemImage(for chipId: String) -> String {
        switch chipId {
        case "pds": return "server.rack"
        case "mutual-follow": return "person.crop.circle.badge.checkmark"
        case "you-follow": return "person.badge.plus"
        case "follows-you": return "heart"
        case "mutuals": return "person.2"
        case "in-common": return "square.stack.3d.up"
        default: return "circle"
        }
    }

    // MARK: Helpers

    /// The creation date of a follow record from its AT URI, by decoding
    /// the TID rkey: the upper 53 bits encode microseconds since the epoch,
    /// accurate enough to avoid a second getRecord round trip for
    /// `createdAt`. Nil for a non-TID rkey.
    public nonisolated static func dateFromFollowUri(_ uri: String?) -> Date? {
        guard let uri, let rkey = uri.split(separator: "/").last.map(String.init), rkey.count == 13 else {
            return nil
        }
        return TID.date(from: rkey)
    }

    /// "Mar 14, 2024": the web's `toLocaleDateString` with a short month,
    /// rendered in the current locale.
    public nonisolated static func formatShortDate(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.setLocalizedDateFormatFromTemplate("MMM d yyyy")
        return formatter.string(from: date)
    }
}
