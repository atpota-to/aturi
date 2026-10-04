import Foundation

/// An AT Protocol blob reference that describes an image.
public struct ImageBlobRef: Hashable, Sendable {
    public var cid: String
    public var mimeType: String

    public init(cid: String, mimeType: String) {
        self.cid = cid
        self.mimeType = mimeType
    }
}

/// Image detection for the structured record view. Port of
/// `src/utils/recordImages.ts`.
///
/// Records reference images two ways and both should render a thumbnail:
/// a direct http(s) URL in a string field, and a blob with an image
/// `mimeType`, which is served by `com.atproto.sync.getBlob` on the owning
/// PDS and therefore needs the repo's DID and PDS endpoint.
public enum RecordImages {
    /// Path extensions worth rendering inline. Checked against the URL's
    /// path only, so query strings and fragments cannot defeat the match.
    private static let imageExtensionPattern =
        #/\.(jpe?g|png|gif|webp|avif|svg|bmp|ico|apng|jfif|heic|heif|tiff?)$/#.ignoresCase()

    private static let httpSchemePattern = #/^https?:\/\//#.ignoresCase()

    /// The trimmed string when `value` is an http(s) URL whose path ends in
    /// an image extension; nil otherwise. Returned unsanitised, exactly as
    /// the field spelled it.
    public static func imageUrlFromValue(_ value: JSONValue?) -> String? {
        guard let s = value?.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) else { return nil }
        guard s.prefixMatch(of: httpSchemePattern) != nil else { return nil }
        guard let path = URLComponents(string: s)?.path
            ?? URLComponents(string: s.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed) ?? s)?.path
        else { return nil }
        return path.firstMatch(of: imageExtensionPattern) != nil ? s : nil
    }

    /// The CID and mimeType when `value` is a blob describing an image, in
    /// the current shape (`{ $type: 'blob', ref: { $link }, mimeType }`) or
    /// the legacy inline-CID shape (`{ cid, mimeType }`). Non-image blobs
    /// (video, ...) return nil.
    public static func imageBlobFromValue(_ value: JSONValue?) -> ImageBlobRef? {
        guard let object = value?.objectValue else { return nil }
        guard let mimeType = object["mimeType"]?.stringValue, mimeType.hasPrefix("image/") else { return nil }
        if let link = object["ref"]?["$link"]?.stringValue, !link.isEmpty {
            return ImageBlobRef(cid: link, mimeType: mimeType)
        }
        if let cid = object["cid"]?.stringValue, !cid.isEmpty {
            return ImageBlobRef(cid: cid, mimeType: mimeType)
        }
        return nil
    }

    /// The public `com.atproto.sync.getBlob` URL that serves a blob's bytes
    /// from the owning PDS. A trailing slash on `pds` is dropped.
    public static func getBlobUrl(pds: String, did: String, cid: String) -> String {
        let base = pds.hasSuffix("/") ? String(pds.dropLast()) : pds
        return base + "/xrpc/com.atproto.sync.getBlob?did=" + URIEncoding.encodeComponent(did)
            + "&cid=" + URIEncoding.encodeComponent(cid)
    }

    /// The DID authority of an `at://did:.../...` URI; nil when the
    /// authority is a handle or the input is not an AT URI.
    public static func didFromAtUri(_ uri: String) -> String? {
        guard let match = uri.prefixMatch(of: didAuthorityPattern) else { return nil }
        return String(match.output.1)
    }

    private static let didAuthorityPattern = #/^at:\/\/(did:[^/]+)/#
}
