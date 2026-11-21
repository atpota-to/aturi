import Foundation

/// A CARv1 reader, for the repo archive inspector. Port of
/// `src/lib/tools/car.ts`.
///
/// A CAR file is a header and then blocks, each prefixed by its length:
///
///     varint | header      a DAG-CBOR map, { version: 1, roots: [link, …] }
///     varint | CID | data  one block, the varint counting the CID and the data
///     …
///
/// `com.atproto.sync.getRepo` returns one, with the repository's latest
/// commit as its first root. Nothing here knows about repositories: it reads
/// blocks and hands them back by CID. `CarRepo` makes a repository of them.
///
/// The file is read in place. Each block is a range of the one array the
/// file arrived in, so opening a 100 MB export does not copy 100 MB.
public struct CarError: Error, Hashable, Sendable, CustomStringConvertible {
    public let message: String

    public init(_ message: String) {
        self.message = message
    }

    public var description: String { message }
}

/// A CAR file, read.
public struct CarFile: Sendable {
    /// The header's roots, as CID text. For a repository, the first is its commit.
    public let roots: [String]
    /// The whole file. Every block is a range of it.
    public let bytes: [UInt8]
    /// Every distinct block's data, by CID text, as a range of `bytes`.
    public internal(set) var blocks: [String: Range<Int>]
    /// Blocks that appeared again after their first copy. The format allows it.
    public internal(set) var duplicates: Int

    /// The size of the whole file in bytes.
    public var size: Int { bytes.count }

    /// One block's data, copied out. Nil when the file has no such block.
    public func blockData(_ cid: String) -> [UInt8]? {
        guard let range = blocks[cid] else { return nil }
        return Array(bytes[range])
    }
}

/// An unsigned LEB128 varint and where it ends.
public struct CarVarint: Hashable, Sendable {
    public let value: Int
    public let next: Int
}

/// A binary CID, taken apart.
public struct CarParsedCID: Hashable, Sendable {
    public let version: Int
    /// The multicodec of what the block holds: 0x71 dag-cbor, 0x55 raw.
    public let codec: Int
    /// The multihash code: 0x12 is sha2-256.
    public let hash: Int
    public let digest: [UInt8]
    /// Where the CID ends.
    public let next: Int
}

/// What recomputing every block's hash found.
public struct CarHashCheck: Hashable, Sendable {
    /// Blocks whose sha2-256 was recomputed.
    public var checked: Int
    /// Blocks addressed by another hash, which this cannot recompute.
    public var skipped: Int
    /// CIDs whose data does not hash to what the CID says.
    public var mismatched: [String]

    public init(checked: Int = 0, skipped: Int = 0, mismatched: [String] = []) {
        self.checked = checked
        self.skipped = skipped
        self.mismatched = mismatched
    }
}

/// A CAR file part-way through being read. `step` reads up to `budget` more
/// blocks and says whether the end was reached, so a caller can read a
/// large file a slice at a time and stay stoppable (`CarRepo.openArchive`).
/// `CarReader.read` is the same reader run straight through.
public final class CarReader {
    public private(set) var file: CarFile
    /// How far into the file the reader is, in bytes.
    public private(set) var offset: Int

    public init(bytes: [UInt8]) throws {
        if bytes.isEmpty { throw CarError("The file is empty") }

        let header: CarCBORValue
        let start: Int
        do {
            let length = try CarReader.readVarint(bytes, 0)
            if length.value == 0 || length.value > bytes.count - length.next {
                throw CarError("the header is longer than the file")
            }
            let end = length.next + length.value
            header = try CarCBOR.decodeAt(bytes, offset: length.next, end: end).value
            start = end
        } catch let error as CarError {
            // A file that is not a CAR at all fails here, on its first bytes.
            throw CarError("This does not look like a CAR file: its header could not be read (\(error.message))")
        } catch let error as CarCBORError {
            throw CarError("This does not look like a CAR file: its header could not be read (\(error.message))")
        }

        guard case .map(let members) = header else {
            throw CarError("This does not look like a CAR file: its header is not a map")
        }
        let version: Int64?
        if case .int(let number)? = members["version"] {
            version = number
        } else {
            version = nil
        }
        if version != 1 {
            if version == 2 {
                throw CarError("This is a CARv2 file. Repository exports are CARv1.")
            }
            throw CarError("This does not look like a CAR file: its header names no version")
        }
        var roots: [String] = []
        if case .array(let items)? = members["roots"] {
            for item in items {
                if case .link(let link) = item {
                    roots.append(link.string)
                }
            }
        }

        file = CarFile(roots: roots, bytes: bytes, blocks: [:], duplicates: 0)
        offset = start
    }

    /// Read up to `budget` blocks. True once the whole file has been read.
    @discardableResult
    public func step(_ budget: Int) throws -> Bool {
        let bytes = file.bytes
        var read = 0
        while read < budget, offset < bytes.count {
            let length = try CarReader.readVarint(bytes, offset)
            if length.value == 0 {
                throw CarError("The file holds an empty block where a CID should be")
            }
            if length.value > bytes.count - length.next {
                throw CarError("The file ends in the middle of a block. The download may have been cut short.")
            }
            let end = length.next + length.value
            let cid = try CarReader.parseCid(bytes, offset: length.next, end: end)
            let key = CarCBOR.cidString(bytes[length.next..<cid.next])
            if file.blocks[key] != nil {
                file.duplicates += 1
            } else {
                file.blocks[key] = cid.next..<end
            }
            offset = end
            read += 1
        }
        return offset >= bytes.count
    }

    /// The whole file, read straight through.
    public static func read(_ bytes: [UInt8]) throws -> CarFile {
        let reader = try CarReader(bytes: bytes)
        try reader.step(Int.max)
        return reader.file
    }

    /// An unsigned LEB128 varint at `offset`, read no further than `end`
    /// (the whole array when nil). At most eight bytes, which is already
    /// past any length a file could state.
    public static func readVarint(_ bytes: [UInt8], _ offset: Int, end: Int? = nil) throws -> CarVarint {
        let limit = min(end ?? bytes.count, bytes.count)
        var value: UInt64 = 0
        var shift: UInt64 = 0
        var i = offset
        while i < limit, i < offset + 8 {
            let byte = bytes[i]
            value |= UInt64(byte & 0x7f) << shift
            if byte & 0x80 == 0 {
                return CarVarint(value: Int(value), next: i + 1)
            }
            shift += 7
            i += 1
        }
        throw CarError(offset >= limit ? "The file ends where a length should be" : "A length in the file is malformed")
    }

    /// Read a binary CID starting at `offset`. A CIDv0 is a bare sha2-256
    /// multihash (0x12 0x20 and 32 bytes), which is how it is told apart: no
    /// CIDv1 starts with 0x12.
    public static func parseCid(_ bytes: [UInt8], offset: Int = 0, end: Int? = nil) throws -> CarParsedCID {
        let limit = min(end ?? bytes.count, bytes.count)
        if offset + 1 < limit, bytes[offset] == 0x12, bytes[offset + 1] == 0x20 {
            let next = offset + 34
            if next > limit { throw CarError("A CID runs past the end of the data") }
            return CarParsedCID(version: 0, codec: 0x70, hash: 0x12, digest: Array(bytes[(offset + 2)..<next]), next: next)
        }
        let version = try readVarint(bytes, offset, end: limit)
        if version.value != 1 {
            throw CarError("A CID has version \(version.value); only 0 and 1 exist")
        }
        let codec = try readVarint(bytes, version.next, end: limit)
        let hash = try readVarint(bytes, codec.next, end: limit)
        let length = try readVarint(bytes, hash.next, end: limit)
        if length.value > limit - length.next {
            throw CarError("A CID runs past the end of the data")
        }
        let next = length.next + length.value
        return CarParsedCID(
            version: 1,
            codec: codec.value,
            hash: hash.value,
            digest: Array(bytes[length.next..<next]),
            next: next
        )
    }

    /// The bytes of a CID from its text form, or nil when the text is not one.
    public static func cidFromString(_ text: String) -> [UInt8]? {
        if text.hasPrefix("b") { return CarCBOR.decodeBase32(text.dropFirst()) }
        if text.hasPrefix("Qm") { return CarCBOR.decodeBase58(text) }
        return nil
    }

    /// Blocks hashed between two looks at whether to stop and two reports.
    public static let hashBatch = 256

    /// Recompute every block's hash and compare it with its CID.
    ///
    /// This shows the file is internally consistent: each block is the data
    /// its address says it is. It does not show who wrote it. That takes the
    /// commit's signature, which needs a curve the device's own crypto does
    /// not offer.
    ///
    /// `hash` is SHA-256; the app hands in the system's, and the default is
    /// the package's own. Runs in batches, reporting as it goes and stopping
    /// with `CancellationError` once `isStopped` says so, so a large archive
    /// can show progress and be stopped.
    public static func verifyBlockHashes(
        _ car: CarFile,
        hash: ([UInt8]) -> [UInt8] = { OAuthSHA256.hash($0) },
        isStopped: () -> Bool = { false },
        onProgress: (_ done: Int, _ total: Int) -> Void = { _, _ in }
    ) throws -> CarHashCheck {
        var result = CarHashCheck()
        let entries = Array(car.blocks)
        var start = 0
        while start < entries.count {
            if isStopped() { throw CancellationError() }
            let stop = min(start + hashBatch, entries.count)
            for index in start..<stop {
                let (text, range) = entries[index]
                guard let cidBytes = cidFromString(text),
                      let cid = try? parseCid(cidBytes),
                      cid.hash == 0x12
                else {
                    result.skipped += 1
                    continue
                }
                let digest = hash(Array(car.bytes[range]))
                result.checked += 1
                if digest != cid.digest {
                    result.mismatched.append(text)
                }
            }
            onProgress(stop, entries.count)
            start = stop
        }
        return result
    }
}
