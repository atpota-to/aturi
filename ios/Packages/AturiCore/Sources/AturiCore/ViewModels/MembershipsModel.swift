import Foundation
import Observation

/// The lists and verifications tool's state, port of the run in
/// `src/components/tools/Memberships.tsx` (`gather` and the "Load more"
/// pages). The requests are in `MembershipsClient`.
///
/// The account comes first; the two lookups then run side by side, and
/// either can fail without taking the other with it. The first page of
/// lists and the verifications load with the page. Further pages of lists
/// load on a button, since a well-known account is on tens of thousands and
/// each one takes two lookups to describe.
@MainActor
@Observable
public final class MembershipsModel {
    /// The account being looked up, as parsed from the input.
    public private(set) var actor: String?
    public private(set) var account: Loadable<MembershipsClient.Account> = .idle
    /// The first page of lists.
    public private(set) var lists: Loadable<MembershipsClient.ListPage> = .idle
    public private(set) var verifications: Loadable<MembershipsClient.VerificationList> = .idle

    /// Pages of lists loaded after the first, in order.
    public private(set) var moreItems: [Memberships.Membership] = []
    /// Where the page after those starts, once one has loaded.
    public private(set) var moreCursor: String?
    public private(set) var hasLoadedMore = false
    public private(set) var isLoadingMore = false
    public private(set) var moreError: String?

    @ObservationIgnored private let client: MembershipsClient
    @ObservationIgnored private var task: Task<Void, Never>?
    @ObservationIgnored private var moreTask: Task<Void, Never>?
    @ObservationIgnored private var generation = 0

    public init(http: HTTPClient = .shared, resolver: IdentityResolver? = nil) {
        client = MembershipsClient(http: http, resolver: resolver)
    }

    // MARK: What the page reads

    /// Every membership loaded so far, one row per list.
    public var items: [Memberships.Membership] {
        guard let first = lists.value else { return [] }
        return Memberships.mergeMemberships(first.items, moreItems)
    }

    public var groups: Memberships.Groups {
        Memberships.groupMemberships(items)
    }

    /// Where the next page of lists starts. Nil at the end.
    public var cursor: String? {
        hasLoadedMore ? moreCursor : lists.value?.cursor
    }

    /// Every list item that names the account, as Constellation counts them.
    public var listTotal: Int? {
        lists.value?.total
    }

    /// List item records read so far, before merging repeats of one list.
    public var loadedRecords: Int {
        (lists.value?.items.count ?? 0) + moreItems.count
    }

    /// Both lookups have come back, one way or the other.
    public var isSettled: Bool {
        guard account.value != nil else { return false }
        return !lists.isIdle && !lists.isLoading && !verifications.isIdle && !verifications.isLoading
    }

    public var isLoading: Bool {
        account.isLoading || lists.isLoading || verifications.isLoading
    }

    // MARK: Actions

    /// Look an account up, unless it is already looked up or on its way.
    public func load(_ actor: String) {
        if actor == self.actor, !account.isFailed, !account.isIdle { return }
        start(actor)
    }

    /// Run the whole lookup again.
    public func retry() {
        guard let actor else { return }
        start(actor)
    }

    /// Forget the input, for a cleared field.
    public func clear() {
        generation += 1
        task?.cancel()
        moreTask?.cancel()
        actor = nil
        account = .idle
        lists = .idle
        verifications = .idle
        resetMore()
    }

    private func resetMore() {
        moreItems = []
        moreCursor = nil
        hasLoadedMore = false
        isLoadingMore = false
        moreError = nil
    }

    private func start(_ actor: String) {
        generation += 1
        let gen = generation
        task?.cancel()
        moreTask?.cancel()
        self.actor = actor
        account = .loading
        lists = .idle
        verifications = .idle
        resetMore()

        let client = client
        task = Task { [weak self] in
            do {
                let found = try await client.loadAccount(actor)
                guard let self, gen == self.generation else { return }
                self.account = .loaded(found)
                await self.gather(found, gen)
            } catch {
                guard let self, gen == self.generation, !(error is CancellationError) else { return }
                self.account = .failed(AccountCheckError.describe(error))
            }
        }
    }

    private func gather(_ account: MembershipsClient.Account, _ gen: Int) async {
        lists = .loading
        verifications = .loading
        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.loadFirstLists(account.did, gen) }
            group.addTask { await self.loadVerifications(account, gen) }
        }
    }

    private func loadFirstLists(_ did: String, _ gen: Int) async {
        let client = client
        do {
            let page = try await client.loadListPage(did, cursor: nil)
            guard gen == generation else { return }
            lists = .loaded(page)
        } catch {
            guard gen == generation, !(error is CancellationError) else { return }
            lists = .failed(Self.message(error))
        }
    }

    private func loadVerifications(_ account: MembershipsClient.Account, _ gen: Int) async {
        let client = client
        do {
            let found = try await client.loadVerifications(account.did, considered: account.considered)
            guard gen == generation else { return }
            verifications = .loaded(found)
        } catch {
            guard gen == generation, !(error is CancellationError) else { return }
            verifications = .failed(Self.message(error))
        }
    }

    private static func message(_ error: Error) -> String {
        if let error = error as? AccountCheckError { return error.message }
        return "The lookup failed."
    }

    /// "Load 25 more": the next page of lists, added under the ones shown.
    public func loadMore() {
        guard let did = account.value?.did, let cursor, !isLoadingMore else { return }
        let gen = generation
        isLoadingMore = true
        moreError = nil
        let client = client
        moreTask = Task { [weak self] in
            do {
                let page = try await client.loadListPage(did, cursor: cursor)
                guard let self, gen == self.generation else { return }
                self.moreItems.append(contentsOf: page.items)
                self.moreCursor = page.cursor
                self.hasLoadedMore = true
                self.isLoadingMore = false
            } catch {
                guard let self, gen == self.generation, !(error is CancellationError) else { return }
                self.isLoadingMore = false
                if let error = error as? AccountCheckError {
                    self.moreError = error.message
                } else {
                    self.moreError = "The next page could not be loaded."
                }
            }
        }
    }

    /// Wait for the lookups in flight. For tests.
    func waitForRuns() async {
        await task?.value
        await moreTask?.value
    }
}
