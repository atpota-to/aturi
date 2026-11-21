import Foundation
@testable import AturiCore

/// Builders for the CBOR, CAR and repository tests, port of
/// `src/lib/tools/__tests__/carFixtures.ts`: a small DAG-CBOR encoder and the
/// few lines it takes to wrap blocks into a CAR file. Test-only. The tool
/// itself never writes either format.
enum CarFixture {
    static let did = "did:plc:z72i7hdynmk6r22z27h6tvur"

    struct Block {
        let cid: CarCIDLink
        let data: [UInt8]
    }

    struct Entry {
        let p: Int
        let k: String
        let v: CarCIDLink
        var t: CarCIDLink? = nil
    }

    private static func head(_ major: UInt8, _ value: UInt64) -> [UInt8] {
        let m = major << 5
        if value < 24 { return [m | UInt8(value)] }
        if value < 0x100 { return [m | 24, UInt8(value)] }
        if value < 0x10000 { return [m | 25, UInt8(value >> 8), UInt8(value & 0xff)] }
        if value < 0x1_0000_0000 {
            return [m | 26] + (0..<4).map { UInt8((value >> UInt64(24 - $0 * 8)) & 0xff) }
        }
        return [m | 27] + (0..<8).map { UInt8((value >> UInt64(56 - $0 * 8)) & 0xff) }
    }

    /// Encode a value as DAG-CBOR. Map keys go in DAG-CBOR's order (shorter
    /// first, then bytewise), so the same value always has the same CID.
    static func encode(_ value: CarCBORValue) -> [UInt8] {
        switch value {
        case .null: return [0xf6]
        case .bool(let flag): return [flag ? 0xf5 : 0xf4]
        case .int(let number):
            if number >= 0 { return head(0, UInt64(number)) }
            return head(1, UInt64(-1 - number))
        case .bigInt:
            fatalError("the fixtures do not write big integers")
        case .float(let number):
            let bits = number.bitPattern
            return [0xfb] + (0..<8).map { UInt8((bits >> UInt64(56 - $0 * 8)) & 0xff) }
        case .text(let text):
            let bytes = Array(text.utf8)
            return head(3, UInt64(bytes.count)) + bytes
        case .bytes(let bytes):
            return head(2, UInt64(bytes.count)) + bytes
        case .link(let link):
            return [0xd8, 42] + head(2, UInt64(link.bytes.count + 1)) + [0x00] + link.bytes
        case .array(let items):
            return head(4, UInt64(items.count)) + items.flatMap { encode($0) }
        case .map(let members):
            let keys = members.keys.sorted { a, b in
                let x = Array(a.utf8)
                let y = Array(b.utf8)
                if x.count != y.count { return x.count < y.count }
                return x.lexicographicallyPrecedes(y)
            }
            var out = head(5, UInt64(keys.count))
            for key in keys {
                out += encode(.text(key))
                out += encode(members[key]!)
            }
            return out
        }
    }

    static func sha256(_ bytes: [UInt8]) -> [UInt8] {
        OAuthSHA256.hash(bytes)
    }

    /// The CIDv1 of a block: version 1, the codec, sha2-256, 32 bytes of digest.
    static func cidFor(_ data: [UInt8], codec: UInt8 = 0x71) -> CarCIDLink {
        CarCIDLink(bytes: [0x01, codec, 0x12, 0x20] + sha256(data))
    }

    /// A block from a value, addressed by its own hash.
    static func block(_ value: CarCBORValue) -> Block {
        let data = encode(value)
        return Block(cid: cidFor(data), data: data)
    }

    static func varint(_ value: Int) -> [UInt8] {
        var out: [UInt8] = []
        var rest = value
        while rest >= 0x80 {
            out.append(UInt8(rest & 0x7f) | 0x80)
            rest /= 128
        }
        out.append(UInt8(rest))
        return out
    }

    /// A CARv1 file: the header, then each block behind its length.
    static func carFile(_ roots: [CarCIDLink], _ blocks: [Block], version: Int64 = 1) -> [UInt8] {
        let header = encode(.map(["version": .int(version), "roots": .array(roots.map { .link($0) })]))
        var out = varint(header.count) + header
        for block in blocks {
            out += varint(block.cid.bytes.count + block.data.count) + block.cid.bytes + block.data
        }
        return out
    }

    /// One tree node, with keys given already cut to their suffix.
    static func node(_ left: CarCIDLink?, _ entries: [Entry]) -> Block {
        let encoded: [CarCBORValue] = entries.map { entry in
            CarCBORValue.map([
                "p": .int(Int64(entry.p)),
                "k": .bytes(Array(entry.k.utf8)),
                "v": .link(entry.v),
                "t": entry.t.map { CarCBORValue.link($0) } ?? .null,
            ])
        }
        return block(.map([
            "l": left.map { CarCBORValue.link($0) } ?? .null,
            "e": .array(encoded),
        ]))
    }

    static func commit(_ did: String, _ data: CarCIDLink, extra: [String: CarCBORValue] = [:]) -> Block {
        var members: [String: CarCBORValue] = [
            "did": .text(did),
            "version": .int(3),
            "data": .link(data),
            "rev": .text("3n22yg6lg2k2f"),
            "prev": .null,
            "sig": .bytes([UInt8](repeating: 7, count: 64)),
        ]
        for (key, value) in extra {
            members[key] = value
        }
        return block(.map(members))
    }

    static func like(_ createdAt: String) -> Block {
        block(.map(["$type": .text("app.bsky.feed.like"), "createdAt": .text(createdAt)]))
    }

    static func post(_ text: String, _ createdAt: String) -> Block {
        block(.map(["$type": .text("app.bsky.feed.post"), "text": .text(text), "createdAt": .text(createdAt)]))
    }

    /// A small, well-formed repository: five records in two collections, in
    /// a tree of three nodes.
    ///
    ///                top: [ …post/3aaa ]  → right
    ///       left: [ …like/3aaa, …like/3bbb ]      right: [ …post/3bbb, …post/3ccc ]
    struct SampleRepo {
        let like1: Block
        let like2: Block
        let post1: Block
        let post2: Block
        let post3: Block
        let left: Block
        let right: Block
        let top: Block
        let head: Block

        var records: [Block] { [like1, like2, post1, post2, post3] }
        var blocks: [Block] { [head, top, left, right] + records }
        var bytes: [UInt8] { CarFixture.carFile([head.cid], blocks) }
    }

    static func sampleRepo() -> SampleRepo {
        let like1 = like("2026-01-01T00:00:00.000Z")
        let like2 = like("2026-01-02T00:00:00.000Z")
        let post1 = post("one", "2026-01-03T00:00:00.000Z")
        let post2 = post("two", "2026-01-04T00:00:00.000Z")
        let post3 = post("three", "2026-01-05T00:00:00.000Z")
        let left = node(nil, [
            Entry(p: 0, k: "app.bsky.feed.like/3aaa", v: like1.cid),
            // Shares "app.bsky.feed.like/3" with the key before it.
            Entry(p: 20, k: "bbb", v: like2.cid),
        ])
        let right = node(nil, [
            Entry(p: 0, k: "app.bsky.feed.post/3bbb", v: post2.cid),
            Entry(p: 20, k: "ccc", v: post3.cid),
        ])
        let top = node(left.cid, [Entry(p: 0, k: "app.bsky.feed.post/3aaa", v: post1.cid, t: right.cid)])
        let head = commit(did, top.cid)
        return SampleRepo(
            like1: like1, like2: like2, post1: post1, post2: post2, post3: post3,
            left: left, right: right, top: top, head: head
        )
    }

    /// Bytes from hex, for the decoder's byte-level tests.
    static func hex(_ text: String) -> [UInt8] {
        var out: [UInt8] = []
        var index = text.startIndex
        while index < text.endIndex {
            let next = text.index(index, offsetBy: 2)
            out.append(UInt8(text[index..<next], radix: 16)!)
            index = next
        }
        return out
    }
}
