import Foundation
import Observation

// The caches behind the backlink rows, port of the module-level stores in
// src/utils/atproto/backlinkDetails.ts. Results are kept for the store's
// lifetime, keyed by DID or AT URI, so moving between relationships and
// back never refetches a row. The web notifies subscribers when a batch
// lands; here the store is observable, so a row re-renders when its
// profile or context fills in, whichever call fetched it.
//
// Each lookup has three outcomes, which the web spells as a value,
// `null` and `undefined`: found, known to have nothing (the AppView has no
// profile, the record has no words), and not known yet. A lookup that
// failed is left not known, so the next batch that shows the row asks
// again.

@MainActor
@Observable
public final class BacklinkDetailsStore {
    /// Profiles by DID.
    public private(set) var profiles: [String: LinkerProfile] = [:]
    /// DIDs the AppView answered for and has no profile of.
    public private(set) var missingProfiles: Set<String> = []
    /// Context lines by AT URI.
    public private(set) var contexts: [String: RecordContext] = [:]
    /// AT URIs whose context is settled, with a line in `contexts` or none.
    public private(set) var settledContexts: Set<String> = []

    @ObservationIgnored private let appView: AppViewClient
    @ObservationIgnored private let slingshot: SlingshotClient
    @ObservationIgnored private var pendingProfiles: Set<String> = []
    @ObservationIgnored private var pendingContexts: Set<String> = []

    public init(http: HTTPClient = .shared) {
        self.appView = AppViewClient(client: http)
        self.slingshot = SlingshotClient(http: http)
    }

    // MARK: Reading

    public func profile(for did: String) -> LinkerProfile? {
        profiles[did]
    }

    /// Whether the AppView has answered for this account either way.
    public func isProfileKnown(_ did: String) -> Bool {
        profiles[did] != nil || missingProfiles.contains(did)
    }

    public func context(for uri: String) -> RecordContext? {
        contexts[uri]
    }

    public func isContextKnown(_ uri: String) -> Bool {
        settledContexts.contains(uri)
    }

    // MARK: Loading

    /// Fill in the authors and context lines for a batch of linking
    /// records. Profiles, posts and other records are asked for together;
    /// a list item's member is looked up once its list item has been read.
    /// Anything already known or already being asked for is skipped.
    public func hydrate(_ records: [BacklinkRecord]) async {
        let dids = claimProfiles(records.map(\.did))

        var posts: [String] = []
        var others: [BacklinkRecord] = []
        var seen = Set<String>()
        for record in records {
            let uri = record.atUri
            guard seen.insert(uri).inserted, !settledContexts.contains(uri), !pendingContexts.contains(uri) else { continue }
            if BacklinkDetails.hasNoContext(record.collection) {
                settledContexts.insert(uri)
            } else if record.collection == BacklinkDetails.postCollection {
                pendingContexts.insert(uri)
                posts.append(uri)
            } else {
                pendingContexts.insert(uri)
                others.append(record)
            }
        }
        guard !dids.isEmpty || !posts.isEmpty || !others.isEmpty else { return }

        // Child tasks capture constants only.
        let postUris = posts
        let otherRecords = others
        let appView = self.appView
        let slingshot = self.slingshot
        async let profileLookup = BacklinkDetails.fetchProfiles(dids, appView: appView)
        async let postLookup = BacklinkDetails.fetchPostContexts(postUris, appView: appView)
        async let recordLookup = BacklinkDetails.fetchRecordContexts(otherRecords, slingshot: slingshot)

        let foundProfiles = await profileLookup
        apply(foundProfiles, asked: dids)
        let foundPosts = await postLookup
        apply(foundPosts, asked: postUris)
        let foundRecords = await recordLookup
        apply(foundRecords, asked: otherRecords.map(\.atUri))

        let members = claimProfiles(foundRecords.memberDids)
        if !members.isEmpty {
            let foundMembers = await BacklinkDetails.fetchProfiles(members, appView: appView)
            apply(foundMembers, asked: members)
        }
    }

    /// The DIDs among `dids` nobody has asked about yet, marked as asked.
    private func claimProfiles(_ dids: [String]) -> [String] {
        var seen = Set<String>()
        var wanted: [String] = []
        for did in dids where !did.isEmpty && seen.insert(did).inserted {
            guard profiles[did] == nil, !missingProfiles.contains(did), !pendingProfiles.contains(did) else { continue }
            wanted.append(did)
        }
        pendingProfiles.formUnion(wanted)
        return wanted
    }

    /// A cancelled lookup answers with nothing, which must not read as "no
    /// profile" or "no context": only what was found is kept then.
    private func apply(_ lookup: BacklinkDetails.ProfileLookup, asked: [String]) {
        pendingProfiles.subtract(asked)
        profiles.merge(lookup.found) { _, fresh in fresh }
        if !Task.isCancelled {
            missingProfiles.formUnion(lookup.missing)
        }
    }

    private func apply(_ lookup: BacklinkDetails.ContextLookup, asked: [String]) {
        pendingContexts.subtract(asked)
        contexts.merge(lookup.found) { _, fresh in fresh }
        if Task.isCancelled {
            settledContexts.formUnion(lookup.found.keys)
        } else {
            settledContexts.formUnion(lookup.settled)
        }
    }
}
