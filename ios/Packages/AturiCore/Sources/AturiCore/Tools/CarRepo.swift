import Foundation

/// A repository, read out of the blocks of a CAR file (`CarFile`). Port of
/// `src/lib/tools/carRepo.ts`.
///
/// An atproto repository is three kinds of block (the repository spec):
///
///     commit   { did, version, data, rev, prev, sig }: whose repository this
///              is, when it was last written (`rev`, a TID), and `data`, a
///              link to the top of the tree.
///     node     { l, e: [{ p, k, v, t }] }: one node of the Merkle search
///              tree that maps `collection/rkey` to a record. `l` links to
///              the subtree of keys before this node's first entry; each
///              entry's `t` links to the subtree of keys after it and before
///              the next.
///     record   the record itself.
///
/// Keys are compressed inside a node: an entry stores only the part of its
/// key that differs from the entry before it, as `p`, how many leading bytes
/// the two share, and `k`, the rest. The first entry of a node has `p` 0 and
/// its whole key.
///
/// Walking the tree left to right visits every key in sorted order, which is
/// how the list of records comes out: grouped by collection, in key order,
/// with no sorting done here.
///
/// This reads the structure and reports where it is broken (a subtree that
/// is not in the file, keys out of order). It does not check the commit's
/// signature, which needs a curve library, so nothing here says who wrote the
/// repository; only what the file contains.
public struct CarRepoError: Error, Hashable, Sendable, CustomStringConvertible {
    public let message: String

    public init(_ message: String) {
        self.message = message
    }

    public var description: String { message }
}

public struct CarRepoCommit: Hashable, Sendable {
    /// The commit block's own CID: the file's first root.
    public var cid: String
    public var did: String
    public var version: Int
    /// The TID of the last write.
    public var rev: String
    /// CID of the top node of the tree.
    public var data: String
    /// CID of the commit before this one. Almost always nil in version 3.
    public var prev: String?
    /// Length of the signature in bytes, or nil when the commit carries none.
    public var signatureBytes: Int?

    public init(cid: String, did: String, version: Int, rev: String, data: String, prev: String?, signatureBytes: Int?) {
        self.cid = cid
        self.did = did
        self.version = version
        self.rev = rev
        self.data = data
        self.prev = prev
        self.signatureBytes = signatureBytes
    }
}

public struct CarRepoCollection: Hashable, Sendable, Identifiable {
    public var nsid: String
    /// Record keys, in the tree's order.
    public var rkeys: [String]
    /// The record CID for the key at the same index.
    public var cids: [String]

    public var id: String { nsid }

    public init(nsid: String, rkeys: [String] = [], cids: [String] = []) {
        self.nsid = nsid
        self.rkeys = rkeys
        self.cids = cids
    }
}

public struct CarRepoArchive: Sendable {
    public var commit: CarRepoCommit
    /// Collections in the tree's order, which is byte order of their names.
    public var collections: [CarRepoCollection]
    public var recordCount: Int
    /// Tree nodes the walk visited.
    public var nodeCount: Int
    /// Subtrees the tree links to that are not in the file. Their records cannot be listed.
    public var missingNodes: [String]
    /// Records the tree lists whose block is not in the file.
    public var missingRecords: Int
    /// Blocks in the file that nothing in this commit's tree reaches.
    public var unreachedBlocks: Int
    /// Keys that did not sort after the key before them. A well-formed tree has none.
    public var outOfOrder: Int
    /// Keys that are not `collection/rkey`. They are left out of the collections.
    public var malformedKeys: Int
    public var car: CarFile
}

/// Where opening an archive has got to.
public enum CarOpenProgress: Hashable, Sendable {
    /// Reading blocks out of the file: `done` of `total` bytes.
    case blocks(done: Int, total: Int)
    /// Walking the tree: `records` listed so far.
    case tree(records: Int)
}

/// A record in the shape `com.atproto.repo.listRecords` returns it.
public struct CarExportedRecord: Hashable, Sendable {
    public var uri: String
    public var cid: String
    public var value: JSONValue

    public init(uri: String, cid: String, value: JSONValue) {
        self.uri = uri
        self.cid = cid
        self.value = value
    }
}

/// A repository part-way through being read out of a CAR file. Like the CAR
/// reader, it works in steps so a large tree can be walked and stopped
/// between slices: `step` lists up to `budget` more records.
///
/// The walk keeps its own stack rather than recursing, which is what lets it
/// stop between any two records and pick up again.
public final class CarRepoReader {
    /// The deepest a tree can usefully be. Depth comes from a hash, so a real
    /// tree is far shallower.
    static let maxTreeDepth = 128

    /// One node of the tree, part-way through its entries.
    private struct Frame {
        var entries: [CarCBORValue]
        var index: Int
        /// The subtree before the first entry, until it has been entered.
        var left: String?
        /// The last key built in this node, which the next entry's prefix is cut from.
        var last: [UInt8]
    }

    public let commit: CarRepoCommit
    private let car: CarFile
    private var collections: [CarRepoCollection] = []
    private var byNsid: [String: Int] = [:]
    private var reached: Set<String>
    private var missingNodes: [String] = []
    private var stack: [Frame] = []
    public private(set) var recordCount = 0
    private var nodeCount = 0
    private var missingRecords = 0
    private var outOfOrder = 0
    private var malformedKeys = 0
    private var previousKey: [UInt8]?

    public init(car: CarFile) throws {
        self.car = car
        let commit = try CarRepoReader.readCommit(car)
        self.commit = commit
        reached = [commit.cid]
        enter(commit.data)
    }

    /// List up to `budget` more records. True once the whole tree has been walked.
    @discardableResult
    public func step(_ budget: Int) -> Bool {
        let target = budget > Int.max - recordCount ? Int.max : recordCount + budget
        while !stack.isEmpty, recordCount < target {
            let top = stack.count - 1
            if let left = stack[top].left {
                stack[top].left = nil
                enter(left)
                continue
            }
            if stack[top].index >= stack[top].entries.count {
                stack.removeLast()
                continue
            }
            let entry = stack[top].entries[stack[top].index]
            stack[top].index += 1
            guard case .bytes(let suffix)? = entry["k"], case .link(let value)? = entry["v"] else {
                malformedKeys += 1
                continue
            }
            let last = stack[top].last
            var shared = 0
            if case .int(let prefix)? = entry["p"] {
                shared = Int(min(max(prefix, 0), Int64(last.count)))
            }
            var key = Array(last[0..<shared])
            key.append(contentsOf: suffix)
            stack[top].last = key
            addEntry(key, cid: value.string)
            if case .link(let right)? = entry["t"] {
                enter(right.string)
            }
        }
        return stack.isEmpty
    }

    public func archive() -> CarRepoArchive {
        CarRepoArchive(
            commit: commit,
            collections: collections,
            recordCount: recordCount,
            nodeCount: nodeCount,
            missingNodes: missingNodes,
            missingRecords: missingRecords,
            unreachedBlocks: car.blocks.count - reached.count,
            outOfOrder: outOfOrder,
            malformedKeys: malformedKeys,
            car: car
        )
    }

    private func addEntry(_ key: [UInt8], cid: String) {
        if let previousKey, CarRepoReader.compareBytes(previousKey, key) >= 0 {
            outOfOrder += 1
        }
        previousKey = key

        let slash = UInt8(ascii: "/")
        guard let first = key.firstIndex(of: slash),
              first > 0,
              first < key.count - 1,
              !key[(first + 1)...].contains(slash)
        else {
            malformedKeys += 1
            return
        }
        let nsid = String(decoding: key[..<first], as: UTF8.self)
        let rkey = String(decoding: key[(first + 1)...], as: UTF8.self)
        let index: Int
        if let known = byNsid[nsid] {
            index = known
        } else {
            index = collections.count
            byNsid[nsid] = index
            collections.append(CarRepoCollection(nsid: nsid))
        }
        collections[index].rkeys.append(rkey)
        collections[index].cids.append(cid)
        recordCount += 1
        if car.blocks[cid] != nil {
            reached.insert(cid)
        } else {
            missingRecords += 1
        }
    }

    private func enter(_ cid: String) {
        // A node already visited means the links form a loop, which no
        // honest tree does; following it again would never end.
        if reached.contains(cid) || stack.count >= CarRepoReader.maxTreeDepth { return }
        guard let range = car.blocks[cid] else {
            missingNodes.append(cid)
            return
        }
        reached.insert(cid)
        guard let node = try? CarCBOR.decode(car.bytes, in: range),
              case .array(let entries)? = node["e"]
        else {
            missingNodes.append(cid)
            return
        }
        nodeCount += 1
        var left: String?
        if case .link(let link)? = node["l"] {
            left = link.string
        }
        // Key compression runs within one node, so each node starts afresh.
        stack.append(Frame(entries: entries, index: 0, left: left, last: []))
    }

    private static func decodeBlock(_ car: CarFile, _ cid: String, _ what: String) throws -> CarCBORValue {
        guard let range = car.blocks[cid] else {
            throw CarRepoError("The \(what) is not in the file.")
        }
        do {
            return try CarCBOR.decode(car.bytes, in: range)
        } catch let error as CarCBORError {
            throw CarRepoError("The \(what) could not be read: \(error.message).")
        }
    }

    private static func readCommit(_ car: CarFile) throws -> CarRepoCommit {
        guard let cid = car.roots.first else {
            throw CarRepoError("The file names no root, so there is no commit to start from. It may not be a repository export.")
        }
        let value = try decodeBlock(car, cid, "commit the file starts from")
        guard case .text(let did)? = value["did"], case .link(let data)? = value["data"] else {
            throw CarRepoError("The file\u{2019}s root is not a repository commit. It is a CAR file, but not a repository export.")
        }
        var version = 0
        if case .int(let number)? = value["version"] {
            version = Int(number)
        }
        var rev = ""
        if case .text(let text)? = value["rev"] {
            rev = text
        }
        var prev: String?
        if case .link(let link)? = value["prev"] {
            prev = link.string
        }
        var signatureBytes: Int?
        if case .bytes(let sig)? = value["sig"] {
            signatureBytes = sig.count
        }
        return CarRepoCommit(cid: cid, did: did, version: version, rev: rev, data: data.string, prev: prev, signatureBytes: signatureBytes)
    }

    /// Lexical order of two keys by their bytes, as the tree sorts them.
    static func compareBytes(_ a: [UInt8], _ b: [UInt8]) -> Int {
        let shared = min(a.count, b.count)
        for i in 0..<shared where a[i] != b[i] {
            return Int(a[i]) - Int(b[i])
        }
        return a.count - b.count
    }
}

public enum CarRepo {
    /// Blocks, then records, read between two chances to report and to stop.
    public static let blocksPerSlice = 20_000
    public static let recordsPerSlice = 20_000

    /// The whole repository, read straight through.
    public static func read(_ car: CarFile) throws -> CarRepoArchive {
        let reader = try CarRepoReader(car: car)
        reader.step(Int.max)
        return reader.archive()
    }

    /// Open a repository export a slice at a time, reporting progress
    /// between slices and stopping with `CancellationError` when the task
    /// running it is cancelled. Run it off the main actor: the reading is
    /// synchronous within each slice.
    public static func openArchive(
        _ bytes: [UInt8],
        onProgress: @Sendable (CarOpenProgress) -> Void = { _ in }
    ) async throws -> CarRepoArchive {
        let car = try CarReader(bytes: bytes)
        var finished = false
        while !finished {
            finished = try car.step(blocksPerSlice)
            if !finished {
                onProgress(.blocks(done: car.offset, total: bytes.count))
                await Task.yield()
                try Task.checkCancellation()
            }
        }

        let repo = try CarRepoReader(car: car.file)
        finished = false
        while !finished {
            finished = repo.step(recordsPerSlice)
            if !finished {
                onProgress(.tree(records: repo.recordCount))
                await Task.yield()
                try Task.checkCancellation()
            }
        }
        return repo.archive()
    }

    /// One record as JSON, decoded when asked for. Nil when its block is not
    /// in the file; throws when the block is not DAG-CBOR.
    public static func readRecord(_ archive: CarRepoArchive, cid: String) throws -> JSONValue? {
        guard let range = archive.car.blocks[cid] else { return nil }
        let value = try CarCBOR.decode(archive.car.bytes, in: range)
        return CarCBOR.toJSON(value)
    }

    /// The record's `at://` URI.
    public static func recordUri(_ archive: CarRepoArchive, collection: CarRepoCollection, index: Int) -> String {
        "at://\(archive.commit.did)/\(collection.nsid)/\(collection.rkeys[index])"
    }

    /// A record in the shape `com.atproto.repo.listRecords` returns it. Nil
    /// when its block is not in the file or cannot be read.
    public static func exportRecord(_ archive: CarRepoArchive, collection: CarRepoCollection, index: Int) -> CarExportedRecord? {
        guard collection.cids.indices.contains(index) else { return nil }
        let cid = collection.cids[index]
        guard let value = try? readRecord(archive, cid: cid) else { return nil }
        return CarExportedRecord(uri: recordUri(archive, collection: collection, index: index), cid: cid, value: value)
    }
}
