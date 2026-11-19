import Foundation

/// What an opened archive's structure says about it, as a check list: is
/// the tree all there, is every record it lists in the file, do the blocks
/// hash to their addresses. Port of `src/lib/tools/carChecks.ts`. The page
/// draws these; the words are decided here so they can be tested.
public enum CarCheckStatus: String, Hashable, Sendable {
    case pass
    case warn
    case fail
    case info
    case pending
}

public struct CarArchiveCheck: Hashable, Sendable, Identifiable {
    public enum Kind: String, Hashable, Sendable {
        case tree
        case records
        case keys
        case extra
        case version
        case hashes
        case signature
    }

    public var id: Kind
    public var status: CarCheckStatus
    public var title: String
    public var summary: String
    /// Evidence, one line each: the CIDs in question.
    public var detail: [String]?

    public init(id: Kind, status: CarCheckStatus, title: String, summary: String, detail: [String]? = nil) {
        self.id = id
        self.status = status
        self.title = title
        self.summary = summary
        self.detail = detail
    }
}

/// Where the hash check has got to: not asked for, running, or finished.
public enum CarHashProgress: Hashable, Sendable {
    case idle
    case running(done: Int, total: Int)
    case done(CarHashCheck)
}

public enum CarChecks {
    /// At most this many CIDs are listed as evidence; the rest are counted.
    static let maxListed = 5

    static func plural(_ n: Int, _ one: String, _ many: String) -> String {
        "\(CarFormat.count(n)) \(n == 1 ? one : many)"
    }

    static func listed(_ cids: [String]) -> [String] {
        let shown = Array(cids.prefix(maxListed))
        if cids.count > maxListed {
            return shown + ["and \(CarFormat.count(cids.count - maxListed)) more"]
        }
        return shown
    }

    public static func archiveChecks(_ archive: CarRepoArchive, hashes: CarHashProgress) -> [CarArchiveCheck] {
        var checks: [CarArchiveCheck] = []
        let car = archive.car
        let commit = archive.commit

        if archive.missingNodes.isEmpty {
            checks.append(CarArchiveCheck(
                id: .tree,
                status: .pass,
                title: "Tree",
                summary: "All \(plural(archive.nodeCount, "node", "nodes")) of the tree are in the file, so every record can be listed."
            ))
        } else {
            let missing = archive.missingNodes.count
            let verb = missing == 1 ? "is" : "are"
            let pronoun = missing == 1 ? "it" : "them"
            checks.append(CarArchiveCheck(
                id: .tree,
                status: .fail,
                title: "Tree",
                summary: "\(plural(missing, "part", "parts")) of the tree \(verb) missing from the file or unreadable. The records under \(pronoun) cannot be listed.",
                detail: listed(archive.missingNodes)
            ))
        }

        if archive.missingRecords == 0 {
            let summary: String
            if archive.recordCount == 0 {
                summary = "The tree lists no records."
            } else {
                let verb = archive.recordCount == 1 ? "is" : "are"
                summary = "All \(plural(archive.recordCount, "listed record", "listed records")) \(verb) in the file."
            }
            checks.append(CarArchiveCheck(id: .records, status: .pass, title: "Records", summary: summary))
        } else {
            let verb = archive.missingRecords == 1 ? "has" : "have"
            checks.append(CarArchiveCheck(
                id: .records,
                status: .warn,
                title: "Records",
                summary: "\(CarFormat.count(archive.missingRecords)) of \(plural(archive.recordCount, "listed record", "listed records")) \(verb) no data in the file. A partial export, or a proof for a single record, looks like this."
            ))
        }

        if archive.outOfOrder > 0 || archive.malformedKeys > 0 {
            var problems: [String] = []
            if archive.outOfOrder > 0 {
                problems.append("\(plural(archive.outOfOrder, "key is", "keys are")) out of sorted order")
            }
            if archive.malformedKeys > 0 {
                problems.append("\(plural(archive.malformedKeys, "entry is", "entries are")) not a collection and a record key")
            }
            checks.append(CarArchiveCheck(
                id: .keys,
                status: .fail,
                title: "Keys",
                summary: "\(problems.joined(separator: ", and ")). A tree written by a PDS has neither, so this file was not produced the usual way."
            ))
        } else {
            checks.append(CarArchiveCheck(
                id: .keys,
                status: .pass,
                title: "Keys",
                summary: "Every key is a collection and a record key, and they are in sorted order."
            ))
        }

        if archive.unreachedBlocks > 0 || car.duplicates > 0 {
            var parts: [String] = []
            if archive.unreachedBlocks > 0 {
                parts.append("\(plural(archive.unreachedBlocks, "block is", "blocks are")) not reached from this commit")
            }
            if car.duplicates > 0 {
                parts.append("\(plural(car.duplicates, "block appears", "blocks appear")) more than once")
            }
            checks.append(CarArchiveCheck(
                id: .extra,
                status: .info,
                title: "Other blocks",
                summary: "\(parts.joined(separator: ", and ")). The format allows both, and they are ignored here."
            ))
        }

        if commit.version != 3 {
            checks.append(CarArchiveCheck(
                id: .version,
                status: .warn,
                title: "Format version",
                summary: "This commit says version \(commit.version). Repositories are written as version 3 today, so this may be an old export."
            ))
        }

        switch hashes {
        case .idle:
            checks.append(CarArchiveCheck(
                id: .hashes,
                status: .info,
                title: "Block hashes",
                summary: "Not checked yet. Every block can be hashed again and compared with the CID it is filed under."
            ))
        case .running(let done, let total):
            checks.append(CarArchiveCheck(
                id: .hashes,
                status: .pending,
                title: "Block hashes",
                summary: "Hashing \(CarFormat.count(done)) of \(plural(total, "block", "blocks"))."
            ))
        case .done(let result):
            let skipped = result.skipped
            var skippedNote = ""
            if skipped > 0 {
                skippedNote = " \(plural(skipped, "block uses", "blocks use")) another hash and \(skipped == 1 ? "was" : "were") not checked."
            }
            if result.mismatched.isEmpty {
                let checked = result.checked
                checks.append(CarArchiveCheck(
                    id: .hashes,
                    status: .pass,
                    title: "Block hashes",
                    summary: "All \(plural(checked, "block hashes", "blocks hash")) to \(checked == 1 ? "its CID" : "their CIDs"). The file holds the data its addresses say it does.\(skippedNote)"
                ))
            } else {
                let count = result.mismatched.count
                checks.append(CarArchiveCheck(
                    id: .hashes,
                    status: .fail,
                    title: "Block hashes",
                    summary: "\(plural(count, "block does", "blocks do")) not hash to \(count == 1 ? "its CID" : "their CIDs"). The file was changed or damaged after it was written.\(skippedNote)",
                    detail: listed(result.mismatched)
                ))
            }
        }

        if let bytes = commit.signatureBytes {
            checks.append(CarArchiveCheck(
                id: .signature,
                status: .info,
                title: "Commit signature",
                summary: "Not checked. The commit carries a \(bytes)-byte signature, and verifying it takes a curve the device\u{2019}s own crypto does not offer. This page shows what the file holds, not who signed it."
            ))
        } else {
            checks.append(CarArchiveCheck(
                id: .signature,
                status: .warn,
                title: "Commit signature",
                summary: "The commit carries no signature, so nothing ties this repository to its account\u{2019}s key."
            ))
        }

        return checks
    }
}
