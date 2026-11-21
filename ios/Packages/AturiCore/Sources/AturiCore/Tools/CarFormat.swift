import Foundation

/// The repo archive inspector's small formatters and limits. Port of
/// `src/lib/tools/carFormat.ts`, with the input reading from
/// `CarInspector.tsx`.
public enum CarFormat {
    /// The largest export the inspector will open.
    ///
    /// The file is held whole in memory, and the index built over it (every
    /// block by CID, every record key) takes about as much again. The web
    /// sets its limit at 150 MB, where a desktop browser still has room to
    /// spare; a phone has less, and an app that runs out is ended by the
    /// system rather than told, so the limit here is lower.
    public static let maxArchiveBytes = 100 * 1024 * 1024

    /// What the inspector says when a file or a download is over the limit.
    public static var tooLargeMessage: String {
        "Exports over \(bytes(maxArchiveBytes)) are not opened here. The file is held whole in this app\u{2019}s memory, and a larger one would exhaust it."
    }

    /// A byte count in the unit a person would say it in: 512 B, 432 KB, 84.1 MB.
    public static func bytes(_ count: Int) -> String {
        if count < 1024 { return "\(count) B" }
        let units = ["KB", "MB", "GB"]
        var value = Double(count) / 1024
        var unit = 0
        while value >= 1024, unit < units.count - 1 {
            value /= 1024
            unit += 1
        }
        if value >= 100 || unit == 0 {
            // Math.round: halves go up.
            return "\(Int((value + 0.5).rounded(.down))) \(units[unit])"
        }
        return String(format: "%.1f", value) + " " + units[unit]
    }

    /// The first two segments of an NSID, which is the app it belongs to: `app.bsky`.
    public static func appOfCollection(_ nsid: String) -> String {
        nsid.split(separator: ".", omittingEmptySubsequences: false).prefix(2).joined(separator: ".")
    }

    /// A handle or DID out of what was typed: `@name`, an at:// URI, or a
    /// profile link (`https://host/profile/name`).
    public static func actorFromInput(_ raw: String) -> String {
        let text = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = text.lowercased()
        for scheme in ["https://", "http://"] where lower.hasPrefix(scheme) {
            let rest = text.dropFirst(scheme.count)
            if let slash = rest.firstIndex(of: "/"), slash > rest.startIndex {
                let path = rest[slash...]
                if path.lowercased().hasPrefix("/profile/") {
                    let segment = path.dropFirst("/profile/".count).prefix { $0 != "/" && $0 != "?" && $0 != "#" }
                    if !segment.isEmpty {
                        return String(segment).removingPercentEncoding ?? String(segment)
                    }
                }
            }
        }
        var actor = Substring(text)
        if actor.lowercased().hasPrefix("at://") {
            actor = actor.dropFirst("at://".count)
        }
        if actor.hasPrefix("@") {
            actor = actor.dropFirst()
        }
        return String(actor.prefix { $0 != "/" })
    }

    /// A file name for an account's export: its handle (or DID) with
    /// anything but letters, digits, dots and hyphens made a hyphen.
    public static func exportFileName(handle: String?, did: String) -> String {
        let base = handle ?? did
        let safe = base.unicodeScalars.map { scalar -> String in
            let value = scalar.value
            let isLetter = (value >= 0x41 && value <= 0x5a) || (value >= 0x61 && value <= 0x7a)
            let isDigit = value >= 0x30 && value <= 0x39
            if isLetter || isDigit || scalar == "." || scalar == "-" {
                return String(scalar)
            }
            return "-"
        }
        return safe.joined() + ".car"
    }

    /// A count the way `Intl.NumberFormat('en-US')` writes it: 1,234,567.
    public static func count(_ n: Int) -> String {
        let digits = String(n.magnitude)
        var out = ""
        for (index, char) in digits.enumerated() {
            if index > 0, (digits.count - index) % 3 == 0 {
                out.append(",")
            }
            out.append(char)
        }
        return n < 0 ? "-" + out : out
    }
}
