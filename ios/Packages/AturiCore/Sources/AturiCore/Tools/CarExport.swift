import Foundation

/// Records from an opened repository archive, written out as one JSON file.
/// Port of `src/lib/tools/carExport.ts`.
///
/// The web builds a Blob from many small pieces rather than one string,
/// because a large repository's JSON runs to a hundred megabytes. Here the
/// pieces go straight to a file a batch at a time, so the JSON never sits in
/// memory whole, and a Stop lands between batches.
///
/// Records are in the shape `com.atproto.repo.listRecords` returns them
/// (`uri`, `cid`, `value`), so the file reads like the API's own answer.
public struct CarExportSummary: Hashable, Sendable {
    public var file: URL
    public var written: Int
    public var skipped: Int

    public init(file: URL, written: Int, skipped: Int) {
        self.file = file
        self.written = written
        self.skipped = skipped
    }
}

public enum CarExport {
    /// Records turned to JSON between two writes, two reports and two looks
    /// at whether to stop.
    public static let recordsPerBatch = 2000

    /// Write `collections` of `archive` to `file`, replacing what is there.
    /// Throws `CancellationError` once `isStopped` says so, leaving a partial
    /// file the caller should remove.
    public static func writeJSON(
        _ archive: CarRepoArchive,
        collections: [CarRepoCollection],
        to file: URL,
        isStopped: () -> Bool = { false },
        onProgress: (_ done: Int, _ total: Int) -> Void = { _, _ in }
    ) throws -> CarExportSummary {
        let total = collections.reduce(0) { $0 + $1.rkeys.count }
        if FileManager.default.fileExists(atPath: file.path) {
            try FileManager.default.removeItem(at: file)
        }
        guard FileManager.default.createFile(atPath: file.path, contents: nil) else {
            throw CocoaError(.fileWriteUnknown)
        }
        let handle = try FileHandle(forWritingTo: file)
        defer { try? handle.close() }

        // The head object is left open, and `records` added as its last member,
        // laid out the way JSON.stringify(head, null, 2) lays it out.
        var head = "{\n"
        head += "  \"repo\": \(quoted(archive.commit.did)),\n"
        head += "  \"rev\": \(quoted(archive.commit.rev)),\n"
        head += "  \"commit\": \(quoted(archive.commit.cid)),\n"
        if collections.isEmpty {
            head += "  \"collections\": [],\n"
        } else {
            head += "  \"collections\": [\n"
            head += collections.map { "    " + quoted($0.nsid) }.joined(separator: ",\n")
            head += "\n  ],\n"
        }
        head += "  \"records\": ["
        try handle.write(contentsOf: Data(head.utf8))

        var written = 0
        var skipped = 0
        var done = 0
        var batch = ""
        for collection in collections {
            for index in collection.rkeys.indices {
                if let record = CarRepo.exportRecord(archive, collection: collection, index: index) {
                    batch += written == 0 ? "\n    " : ",\n    "
                    batch += line(record)
                    written += 1
                } else {
                    // Listed by the tree, but its block is not in the file or is not readable.
                    skipped += 1
                }
                done += 1
                if done % recordsPerBatch == 0 {
                    try handle.write(contentsOf: Data(batch.utf8))
                    batch = ""
                    onProgress(done, total)
                    if isStopped() { throw CancellationError() }
                }
            }
        }
        batch += written == 0 ? "]\n}\n" : "\n  ]\n}\n"
        try handle.write(contentsOf: Data(batch.utf8))
        return CarExportSummary(file: file, written: written, skipped: skipped)
    }

    /// One record as compact JSON, its members in listRecords' order.
    static func line(_ record: CarExportedRecord) -> String {
        "{\"uri\":\(quoted(record.uri)),\"cid\":\(quoted(record.cid)),\"value\":\(record.value.compactString(sortKeys: true))}"
    }

    private static func quoted(_ text: String) -> String {
        JSONValue.string(text).compactString()
    }
}
