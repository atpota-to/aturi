import Foundation

/// The account card's two check rows, Labels and Visibility, in words. Port
/// of `src/lib/tools/accountChecks.ts`, plus `keptFor` from
/// `src/components/explore/useAccountChecks.ts`, which is pure too.
///
/// The label checker and the shadowban checker each answer in a page of
/// detail. The explorer shows an account's answer in a line on its card, and
/// these functions decide what that line says. They read the same results
/// the full views draw, so the card and the tab can never disagree; nothing
/// here asks anything of the network.
public enum AccountChecks {
    // MARK: - When Bluesky has no profile

    public enum ProfileAbsence: String, Hashable, Sendable {
        case missing
        case suspended
        case deactivated
    }

    /// Why Bluesky's AppView would not describe an account, from the words it
    /// answered with (the label client's `SubjectUnavailable`). "Profile not
    /// found" is an account it never indexed: one that has not used Bluesky.
    public static func profileAbsence(_ message: String) -> ProfileAbsence {
        switch Shadowban.readProfileFailure(status: 400, error: nil, message: message) {
        case .suspended: return .suspended
        case .deactivated: return .deactivated
        case .found, .missing, .error: return .missing
        }
    }

    /// Whether the visibility check has anything to compare. An account with
    /// no Bluesky profile, or one that deactivated it, has nothing for an
    /// AppView to hide; a suspended one does, and the check says so.
    public static func visibilityApplies(_ absence: ProfileAbsence?) -> Bool {
        absence == nil || absence == .suspended
    }

    // MARK: - Labels

    public struct LabelSummary: Hashable, Sendable {
        /// Labels in force: not withdrawn, not expired.
        public var active: Int
        /// Distinct accounts behind those labels, the subject included.
        public var sources: Int
        /// Some of them the account put on itself.
        public var selfLabelled: Bool
        /// Values in force from Bluesky's own moderation service, newest first.
        public var moderation: [String]

        public init(active: Int, sources: Int, selfLabelled: Bool, moderation: [String]) {
            self.active = active
            self.sources = sources
            self.selfLabelled = selfLabelled
            self.moderation = moderation
        }
    }

    public static func labelSummary(_ labels: [Labels.Label], subjectDid: String, now: Date) -> LabelSummary {
        let live = labels.filter { !$0.neg && !Labels.isExpired($0, now: now) }
        let sources = Set(live.map { $0.src })
        let fromBluesky = live.filter { $0.src == Labels.blueskyModerationDid }
        let newestFirst = toolsStableSorted(fromBluesky) { ($0.cts ?? "") > ($1.cts ?? "") }
        var moderation: [String] = []
        for label in newestFirst where !moderation.contains(label.val) {
            moderation.append(label.val)
        }
        return LabelSummary(
            active: live.count,
            sources: sources.count,
            selfLabelled: sources.contains(subjectDid),
            moderation: moderation
        )
    }

    /// Where a count of labels comes from, as the card's row says it: "from
    /// 10 labelers", "from 3 sources" when the account labelled itself too,
    /// and "set by the account" when only it did.
    public static func labelSourceWords(_ summary: LabelSummary) -> String {
        if summary.active == 0 { return "" }
        if summary.selfLabelled && summary.sources == 1 { return "set by the account" }
        let noun = summary.selfLabelled ? "source" : "labeler"
        return "from \(summary.sources) \(noun)\(summary.sources == 1 ? "" : "s")"
    }

    // MARK: - Visibility

    /// One of the six dots: a check still running, or how it came out.
    public enum DotState: String, Hashable, Sendable {
        case run
        case pass
        case warn
        case fail
        case skip
    }

    public struct VisibilityDot: Hashable, Sendable, Identifiable {
        public var id: Shadowban.CheckID
        public var title: String
        public var state: DotState
        public var summary: String

        public init(id: Shadowban.CheckID, title: String, state: DotState, summary: String) {
            self.id = id
            self.title = title
            self.state = state
            self.summary = summary
        }
    }

    public enum VisibilityTone: String, Hashable, Sendable {
        case pending
        case pass
        case info
        case warn
        case fail
    }

    public struct VisibilitySummary: Hashable, Sendable {
        /// The account checks, in the checker's order.
        public var dots: [VisibilityDot]
        /// How many of them have come back.
        public var done: Int
        public var tone: VisibilityTone
        /// A few words for the card: "Nothing hidden", "Left out of search".
        public var short: String
        /// Further findings beyond the one `short` names.
        public var more: Int
        /// The checker's own verdict, for the tab's heading.
        public var title: String
        public var text: String

        public init(dots: [VisibilityDot], done: Int, tone: VisibilityTone, short: String, more: Int, title: String, text: String) {
            self.dots = dots
            self.done = done
            self.tone = tone
            self.short = short
            self.more = more
            self.title = title
            self.text = text
        }
    }

    /// "Nothing to look at" (no recent replies, a deactivated profile) and
    /// "could not ask" both leave the dot grey.
    static func dotState(_ status: Shadowban.CheckStatus) -> DotState {
        switch status {
        case .pending: return .run
        case .pass: return .pass
        case .warn: return .warn
        case .fail: return .fail
        case .info, .skip: return .skip
        }
    }

    /// What a failed check found, in a few words.
    static let failWords: [Shadowban.CheckID: String] = [
        .pds: "Problem on its PDS",
        .profile: "Profile hidden",
        .posts: "Posts missing",
        .threads: "Replies missing",
        .actorSearch: "Left out of search",
        .postSearch: "Posts not in search",
    ]

    /// What a warning is about, in a few words.
    static let warnWords: [Shadowban.CheckID: String] = [
        .pds: "Not active on its PDS",
        .posts: "Posts not compared",
        .threads: "Replies not checked",
        .actorSearch: "Not found in search",
        .postSearch: "Some posts not in search",
    ]

    /// The visibility check of an account so far, for its row. Reads the
    /// same checks and verdict the full view draws.
    public static func visibilitySummary(_ evidence: Shadowban.Evidence, now: Date) -> VisibilitySummary {
        let checks = Shadowban.buildAccountChecks(evidence, now: now)
        let verdict = Shadowban.shadowbanVerdict(evidence, checks: checks)
        let dots = checks.map { check in
            VisibilityDot(id: check.id, title: check.title, state: dotState(check.status), summary: check.summary)
        }
        let done = dots.filter { $0.state != .run }.count
        func summary(_ tone: VisibilityTone, _ short: String, more: Int = 0) -> VisibilitySummary {
            VisibilitySummary(dots: dots, done: done, tone: tone, short: short, more: more, title: verdict.title, text: verdict.text)
        }

        if verdict.tone == .pending {
            return summary(.pending, done == 0 ? "Reading the PDS" : "\(done) of \(dots.count) checks")
        }

        let name = evidence.appview.name
        switch evidence.profile {
        case .suspended?:
            return summary(.fail, "Suspended")
        case .missing?:
            return summary(.fail, "No profile on Bluesky")
        case .deactivated?:
            return summary(.info, "Deactivated")
        case .found?, .error?, nil:
            break
        }
        if verdict.tone == .warn && evidence.isRepoInactive {
            return summary(.warn, "Not active on its PDS")
        }
        if case .error? = evidence.profile, !evidence.shownAnswered {
            return summary(.warn, "\(name) didn’t answer")
        }

        let failed = checks.filter { $0.status == .fail }
        if let first = failed.first {
            return summary(.fail, failWords[first.id] ?? "Something hidden", more: failed.count - 1)
        }
        let warned = checks.filter { $0.status == .warn }
        if let first = warned.first {
            let short: String
            if first.id == .profile {
                short = evidence.profile?.found != nil ? "Labelled by \(name)" : "\(name) didn’t answer"
            } else {
                short = warnWords[first.id] ?? "Worth a look"
            }
            return summary(.warn, short, more: warned.count - 1)
        }
        return summary(.pass, "Nothing hidden")
    }

    // MARK: - Age of a kept result

    /// "4 min ago" for a result kept from earlier, or nil when it is fresh.
    public static func keptFor(_ settledAt: Date?, now: Date) -> String? {
        guard let settledAt else { return nil }
        let minutes = Int((now.timeIntervalSince(settledAt) / 60).rounded(.down))
        if minutes < 1 { return nil }
        return "\(minutes) min ago"
    }
}
