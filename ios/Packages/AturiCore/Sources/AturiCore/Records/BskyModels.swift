import Foundation

/// Typed views over the AppView's post, profile and embed JSON.
///
/// Port of the types in `src/utils/recordFetcher.ts` (`BskyPost`),
/// `src/utils/profileFetcher.ts` (`BskyProfile`) and
/// `src/utils/atproto/appview.ts` (`AppViewProfile`, `ViewerState`,
/// `KnownFollowers`), plus `getEmbedImages` from `src/utils/postEmbeds.ts`.
///
/// Every model decodes by hand from `JSONValue` and keeps the document it
/// came from as `raw`. The AppView adds fields without notice
/// (bookmarkCount, threadgate, ...) and reshapes embeds as new lexicons
/// land, so a post must never fail to render because one field it does not
/// even display changed shape. Only the identity a view cannot do without
/// (a post's uri and author DID, a profile's DID) is required; everything
/// else falls back to nil or an empty value.

// MARK: - Shared pieces

/// `{ width, height }` as carried by image, gallery and video embeds.
public struct EmbedAspectRatio: Hashable, Sendable {
    public var width: Double
    public var height: Double

    public init(width: Double, height: Double) {
        self.width = width
        self.height = height
    }

    public init?(json: JSONValue?) {
        guard let width = json?["width"]?.doubleValue, let height = json?["height"]?.doubleValue else {
            return nil
        }
        self.init(width: width, height: height)
    }
}

/// `{ uri, cid }`: a strong reference to another record (reply parent and
/// root, a profile's pinned post).
public struct BskyStrongRef: Hashable, Sendable {
    public var uri: String
    public var cid: String

    public init(uri: String, cid: String) {
        self.uri = uri
        self.cid = cid
    }

    public init?(json: JSONValue?) {
        guard let uri = json?["uri"]?.stringValue, !uri.isEmpty else { return nil }
        self.init(uri: uri, cid: json?["cid"]?.stringValue ?? "")
    }
}

/// The AppView's `profileViewBasic`: what a post, a quoted post, a repost
/// reason and a known-followers strip attach to identify an account.
public struct BskyPostAuthor: Hashable, Sendable {
    public var did: String
    public var handle: String
    public var displayName: String?
    public var avatar: String?
    public var pronouns: String?

    public init(did: String, handle: String, displayName: String? = nil, avatar: String? = nil, pronouns: String? = nil) {
        self.did = did
        self.handle = handle
        self.displayName = displayName
        self.avatar = avatar
        self.pronouns = pronouns
    }

    /// Requires `did`. The AppView always sends a handle (`handle.invalid`
    /// when it cannot verify one) but a missing one is tolerated as "".
    public init?(json: JSONValue?) {
        guard let did = json?["did"]?.stringValue, !did.isEmpty else { return nil }
        self.init(
            did: did,
            handle: json?["handle"]?.stringValue ?? "",
            displayName: nonEmptyBskyString(json?["displayName"]),
            avatar: nonEmptyBskyString(json?["avatar"]),
            pronouns: nonEmptyBskyString(json?["pronouns"])
        )
    }

    /// `displayName || handle`, the name the web prints beside the avatar.
    public var displayLabel: String {
        displayName ?? handle
    }
}

// MARK: - Post record (the author's own bytes)

/// One feature of a rich-text facet: a link, a mention or a tag.
public struct BskyFacetFeature: Hashable, Sendable {
    public static let linkType = "app.bsky.richtext.facet#link"
    public static let mentionType = "app.bsky.richtext.facet#mention"
    public static let tagType = "app.bsky.richtext.facet#tag"

    /// The `$type` NSID.
    public var type: String
    public var uri: String?
    public var did: String?
    public var tag: String?

    public init(type: String, uri: String? = nil, did: String? = nil, tag: String? = nil) {
        self.type = type
        self.uri = uri
        self.did = did
        self.tag = tag
    }

    public init?(json: JSONValue?) {
        guard let type = json?["$type"]?.stringValue else { return nil }
        self.init(
            type: type,
            uri: json?["uri"]?.stringValue,
            did: json?["did"]?.stringValue,
            tag: json?["tag"]?.stringValue
        )
    }
}

/// A facet: a UTF-8 byte range of the post text and the features applied to it.
public struct BskyFacet: Hashable, Sendable {
    public var byteStart: Int
    public var byteEnd: Int
    public var features: [BskyFacetFeature]

    public init(byteStart: Int, byteEnd: Int, features: [BskyFacetFeature]) {
        self.byteStart = byteStart
        self.byteEnd = byteEnd
        self.features = features
    }

    /// Requires an integral `index.byteStart` and `index.byteEnd`; features
    /// that lack a `$type` are dropped.
    public init?(json: JSONValue?) {
        guard let start = json?["index"]?["byteStart"]?.intValue,
              let end = json?["index"]?["byteEnd"]?.intValue else { return nil }
        let features = json?["features"]?.arrayValue?.compactMap { BskyFacetFeature(json: $0) } ?? []
        self.init(byteStart: start, byteEnd: end, features: features)
    }
}

/// `{ parent, root }` on a reply post.
public struct BskyReplyRef: Hashable, Sendable {
    public var parent: BskyStrongRef
    public var root: BskyStrongRef

    public init(parent: BskyStrongRef, root: BskyStrongRef) {
        self.parent = parent
        self.root = root
    }

    public init?(json: JSONValue?) {
        guard let parent = BskyStrongRef(json: json?["parent"]),
              let root = BskyStrongRef(json: json?["root"]) else { return nil }
        self.init(parent: parent, root: root)
    }
}

/// The `app.bsky.feed.post` record as written by the author: text, facets
/// and the reply reference. The record-side `embed` is kept raw because the
/// hydrated `BskyPost.embed` is what views render.
public struct BskyPostRecord: Hashable, Sendable {
    /// The `$type` NSID, "" when absent.
    public var type: String
    public var text: String
    public var createdAt: String
    public var reply: BskyReplyRef?
    public var facets: [BskyFacet]
    public var langs: [String]
    public var embed: JSONValue?
    public var raw: JSONValue

    public init(
        type: String,
        text: String,
        createdAt: String,
        reply: BskyReplyRef? = nil,
        facets: [BskyFacet] = [],
        langs: [String] = [],
        embed: JSONValue? = nil,
        raw: JSONValue = .object([:])
    ) {
        self.type = type
        self.text = text
        self.createdAt = createdAt
        self.reply = reply
        self.facets = facets
        self.langs = langs
        self.embed = embed
        self.raw = raw
    }

    /// Requires an object; every field inside is optional.
    public init?(json: JSONValue?) {
        guard let json = json, json.objectValue != nil else { return nil }
        self.init(
            type: json["$type"]?.stringValue ?? "",
            text: json["text"]?.stringValue ?? "",
            createdAt: json["createdAt"]?.stringValue ?? "",
            reply: BskyReplyRef(json: json["reply"]),
            facets: json["facets"]?.arrayValue?.compactMap { BskyFacet(json: $0) } ?? [],
            langs: json["langs"]?.arrayValue?.compactMap { $0.stringValue } ?? [],
            embed: json["embed"],
            raw: json
        )
    }

    /// `createdAt` parsed, nil when the author wrote something unparseable.
    public var createdAtDate: Date? {
        Formatting.isoDate(createdAt)
    }
}

// MARK: - Hydrated post

/// A post as the AppView returns it from getPostThread, getPosts,
/// getAuthorFeed and searchPosts: the record plus author, engagement counts
/// and the hydrated embed.
public struct BskyPost: Hashable, Sendable {
    public var uri: String
    public var cid: String
    public var author: BskyPostAuthor
    public var record: BskyPostRecord
    public var embed: EmbedView?
    public var replyCount: Int?
    public var repostCount: Int?
    public var likeCount: Int?
    public var quoteCount: Int?
    public var indexedAt: String
    public var raw: JSONValue

    public init(
        uri: String,
        cid: String,
        author: BskyPostAuthor,
        record: BskyPostRecord,
        embed: EmbedView? = nil,
        replyCount: Int? = nil,
        repostCount: Int? = nil,
        likeCount: Int? = nil,
        quoteCount: Int? = nil,
        indexedAt: String = "",
        raw: JSONValue = .object([:])
    ) {
        self.uri = uri
        self.cid = cid
        self.author = author
        self.record = record
        self.embed = embed
        self.replyCount = replyCount
        self.repostCount = repostCount
        self.likeCount = likeCount
        self.quoteCount = quoteCount
        self.indexedAt = indexedAt
        self.raw = raw
    }

    /// Requires `uri` and an author with a DID. A missing `record` decodes
    /// as an empty one and an unrecognised embed becomes `.unknown`, so the
    /// post still renders its author line and counts.
    public init?(json: JSONValue?) {
        guard let json = json,
              let uri = json["uri"]?.stringValue, !uri.isEmpty,
              let author = BskyPostAuthor(json: json["author"]) else { return nil }
        self.init(
            uri: uri,
            cid: json["cid"]?.stringValue ?? "",
            author: author,
            record: BskyPostRecord(json: json["record"]) ?? BskyPostRecord(type: "", text: "", createdAt: ""),
            embed: EmbedView(json: json["embed"]),
            replyCount: json["replyCount"]?.intValue,
            repostCount: json["repostCount"]?.intValue,
            likeCount: json["likeCount"]?.intValue,
            quoteCount: json["quoteCount"]?.intValue,
            indexedAt: json["indexedAt"]?.stringValue ?? "",
            raw: json
        )
    }

    /// The record key, the last segment of the AT URI.
    public var rkey: String? {
        rkeyFromAtUri(uri)
    }

    /// `record.createdAt` parsed; falls back to `indexedAt` when the
    /// author's timestamp is unparseable.
    public var createdAtDate: Date? {
        record.createdAtDate ?? Formatting.isoDate(indexedAt)
    }

    public var isReply: Bool {
        record.reply != nil
    }
}

// MARK: - Embeds

/// One displayable image from an images or gallery embed. All fields are
/// optional because `getEmbedImages` passes through whatever the view had.
public struct EmbedImage: Hashable, Sendable {
    public var thumb: String?
    public var fullsize: String?
    public var alt: String?
    public var aspectRatio: EmbedAspectRatio?

    public init(thumb: String? = nil, fullsize: String? = nil, alt: String? = nil, aspectRatio: EmbedAspectRatio? = nil) {
        self.thumb = thumb
        self.fullsize = fullsize
        self.alt = alt
        self.aspectRatio = aspectRatio
    }
}

/// `app.bsky.embed.external#view`'s `external` block: a link card.
public struct EmbedExternal: Hashable, Sendable {
    public var uri: String
    public var title: String
    public var description: String
    public var thumb: String?

    public init(uri: String, title: String, description: String, thumb: String? = nil) {
        self.uri = uri
        self.title = title
        self.description = description
        self.thumb = thumb
    }

    /// Requires `uri`; the card has nothing to open without one.
    public init?(json: JSONValue?) {
        guard let uri = json?["uri"]?.stringValue, !uri.isEmpty else { return nil }
        self.init(
            uri: uri,
            title: json?["title"]?.stringValue ?? "",
            description: json?["description"]?.stringValue ?? "",
            thumb: nonEmptyBskyString(json?["thumb"])
        )
    }

    /// The hostname the web prints under the title; "" when unparseable.
    public var hostname: String {
        URL(string: uri)?.host ?? ""
    }
}

/// The quoted record inside `app.bsky.embed.record#view` (and the `record`
/// half of `recordWithMedia#view`). The AppView mixes several shapes here:
/// `#viewRecord` (a post, with `value` and hydrated `embeds`), `#viewNotFound`,
/// `#viewBlocked`, `#viewDetached`, and non-post views such as a feed
/// generator, a list, a starter pack or a labeler, so every field is
/// optional and the raw document stays reachable.
public struct EmbedRecord: Hashable, Sendable {
    public static let viewRecordType = "app.bsky.embed.record#viewRecord"
    public static let viewNotFoundType = "app.bsky.embed.record#viewNotFound"
    public static let viewBlockedType = "app.bsky.embed.record#viewBlocked"
    public static let viewDetachedType = "app.bsky.embed.record#viewDetached"

    /// The `$type` NSID, "" when absent.
    public var type: String
    public var uri: String?
    public var cid: String?
    public var author: BskyPostAuthor?
    /// `value || record`: the quoted record's own fields.
    public var value: JSONValue?
    /// The quoted post's own embeds, hydrated.
    public var embeds: [EmbedView]
    public var notFound: Bool
    public var blocked: Bool
    public var raw: JSONValue

    public init(
        type: String,
        uri: String? = nil,
        cid: String? = nil,
        author: BskyPostAuthor? = nil,
        value: JSONValue? = nil,
        embeds: [EmbedView] = [],
        notFound: Bool = false,
        blocked: Bool = false,
        raw: JSONValue = .object([:])
    ) {
        self.type = type
        self.uri = uri
        self.cid = cid
        self.author = author
        self.value = value
        self.embeds = embeds
        self.notFound = notFound
        self.blocked = blocked
        self.raw = raw
    }

    /// Requires an object. A `#viewNotFound` carries little more than
    /// `notFound: true`, which is still worth a placeholder card.
    public init?(json: JSONValue?) {
        guard let json = json, json.objectValue != nil else { return nil }
        let value = json["value"] ?? json["record"]
        self.init(
            type: json["$type"]?.stringValue ?? "",
            uri: json["uri"]?.stringValue,
            cid: json["cid"]?.stringValue,
            author: BskyPostAuthor(json: json["author"]),
            value: value?.objectValue != nil ? value : nil,
            embeds: json["embeds"]?.arrayValue?.compactMap { EmbedView(json: $0) } ?? [],
            notFound: json["notFound"]?.boolValue ?? false,
            blocked: json["blocked"]?.boolValue ?? false,
            raw: json
        )
    }

    /// The quoted post's text, nil when the value has none (or is not a post).
    public var text: String? {
        nonEmptyBskyString(value?["text"])
    }

    /// The quoted record as a `BskyPostRecord` when it is a post.
    public var postRecord: BskyPostRecord? {
        guard let value = value, value["$type"]?.stringValue == "app.bsky.feed.post" else { return nil }
        return BskyPostRecord(json: value)
    }

    /// The placeholder the web shows instead of a card, nil for a live record.
    public var unavailableMessage: String? {
        if notFound { return "Post not found" }
        if blocked { return "Post unavailable" }
        return nil
    }
}

/// A hydrated embed view. Mirrors the branches `PostPreview.tsx` renders:
/// images (classic 1-4 and gallery 5+ collapse into one list, as
/// `getEmbedImages` does), an external link card, a quoted record, a quoted
/// record with media, and a video. Anything else keeps its `$type` so a
/// view can show an indicator rather than nothing.
public indirect enum EmbedView: Hashable, Sendable {
    public static let imagesViewType = "app.bsky.embed.images#view"
    public static let galleryViewType = "app.bsky.embed.gallery#view"
    public static let externalViewType = "app.bsky.embed.external#view"
    public static let recordViewType = "app.bsky.embed.record#view"
    public static let recordWithMediaViewType = "app.bsky.embed.recordWithMedia#view"
    public static let videoViewType = "app.bsky.embed.video#view"

    case images([EmbedImage])
    case external(EmbedExternal)
    case record(EmbedRecord)
    /// `record` is nil when the AppView sent no quoted record, `media` when
    /// the media half is missing or has no playable content; either way the
    /// other half still renders, as it does on the web.
    case recordWithMedia(record: EmbedRecord?, media: EmbedView?)
    case video(playlist: String, thumbnail: String?, alt: String?, aspectRatio: EmbedAspectRatio?)
    case unknown(type: String)

    /// Nil only when the value is not an object with a `$type`; a known
    /// type with unusable content (an external view without a uri, a video
    /// without a playlist) decodes as `.unknown` so the caller can still
    /// tell what the author attached.
    public init?(json: JSONValue?) {
        guard let json = json, json.objectValue != nil, let type = json["$type"]?.stringValue else {
            return nil
        }
        if let images = getEmbedImages(json) {
            self = .images(images)
            return
        }
        switch type {
        case EmbedView.imagesViewType, EmbedView.galleryViewType:
            // The type is right but the list is empty; nothing to draw.
            self = .images([])
        case EmbedView.externalViewType:
            if let external = EmbedExternal(json: json["external"]) {
                self = .external(external)
            } else {
                self = .unknown(type: type)
            }
        case EmbedView.recordViewType:
            if let record = EmbedRecord(json: json["record"]) {
                self = .record(record)
            } else {
                self = .unknown(type: type)
            }
        case EmbedView.recordWithMediaViewType:
            // The quoted record sits one level deeper here: `record.record`.
            let record = EmbedRecord(json: json["record"]?["record"])
            let media = EmbedView(json: json["media"])
            self = .recordWithMedia(record: record, media: media)
        case EmbedView.videoViewType:
            if let playlist = json["playlist"]?.stringValue, !playlist.isEmpty {
                self = .video(
                    playlist: playlist,
                    thumbnail: nonEmptyBskyString(json["thumbnail"]),
                    alt: nonEmptyBskyString(json["alt"]),
                    aspectRatio: EmbedAspectRatio(json: json["aspectRatio"])
                )
            } else {
                self = .unknown(type: type)
            }
        default:
            self = .unknown(type: type)
        }
    }

    /// The `$type` this view was decoded from.
    public var type: String {
        switch self {
        case .images: return EmbedView.imagesViewType
        case .external: return EmbedView.externalViewType
        case .record: return EmbedView.recordViewType
        case .recordWithMedia: return EmbedView.recordWithMediaViewType
        case .video: return EmbedView.videoViewType
        case .unknown(let type): return type
        }
    }

    /// The images of this view, or of its media half; nil when there are none.
    public var images: [EmbedImage]? {
        switch self {
        case .images(let images): return images.isEmpty ? nil : images
        case .recordWithMedia(_, let media): return media?.images
        default: return nil
        }
    }

    /// The short indicator the web prints for a quoted post whose embeds
    /// were not hydrated ("Images", "Link", "Video", "Quote"); nil for
    /// types it has no word for.
    public var indicatorLabel: String? {
        switch type {
        case EmbedView.imagesViewType, EmbedView.galleryViewType: return "Images"
        case EmbedView.externalViewType: return "Link"
        case EmbedView.videoViewType: return "Video"
        case EmbedView.recordViewType: return "Quote"
        default: return nil
        }
    }
}

/// Port of `getEmbedImages`: normalise a hydrated image embed into one flat
/// list, whether it is `app.bsky.embed.images#view` (1-4 images under
/// `images[]`, thumbnail in `thumb`) or `app.bsky.embed.gallery#view` (5+
/// under `items[]`, thumbnail in `thumbnail`). Nil for any other or empty
/// view, so it doubles as a presence check.
public func getEmbedImages(_ view: JSONValue?) -> [EmbedImage]? {
    guard let view = view, view.objectValue != nil else { return nil }
    let type = view["$type"]?.stringValue
    if type == EmbedView.imagesViewType, let images = view["images"]?.arrayValue, !images.isEmpty {
        return images.map { image in
            EmbedImage(
                thumb: image["thumb"]?.stringValue,
                fullsize: image["fullsize"]?.stringValue,
                alt: image["alt"]?.stringValue,
                aspectRatio: EmbedAspectRatio(json: image["aspectRatio"])
            )
        }
    }
    if type == EmbedView.galleryViewType, let items = view["items"]?.arrayValue, !items.isEmpty {
        return items.map { item in
            EmbedImage(
                thumb: item["thumbnail"]?.stringValue,
                fullsize: item["fullsize"]?.stringValue,
                alt: item["alt"]?.stringValue,
                aspectRatio: EmbedAspectRatio(json: item["aspectRatio"])
            )
        }
    }
    return nil
}

// MARK: - Profile

/// A label applied to an account. Only `val` is modelled; the rest of the
/// label (src, uri, cts, neg) stays in `raw`.
public struct BskyLabel: Hashable, Sendable {
    public var val: String
    public var src: String?
    public var raw: JSONValue

    public init(val: String, src: String? = nil, raw: JSONValue = .object([:])) {
        self.val = val
        self.src = src
        self.raw = raw
    }

    public init?(json: JSONValue?) {
        guard let json = json, let val = json["val"]?.stringValue else { return nil }
        self.init(val: val, src: json["src"]?.stringValue, raw: json)
    }
}

/// One entry of a profile's `verification.verifications`.
public struct BskyVerificationEntry: Hashable, Sendable {
    public var issuer: String
    public var uri: String
    public var isValid: Bool
    public var createdAt: String

    public init(issuer: String, uri: String, isValid: Bool, createdAt: String) {
        self.issuer = issuer
        self.uri = uri
        self.isValid = isValid
        self.createdAt = createdAt
    }

    public init?(json: JSONValue?) {
        guard let issuer = json?["issuer"]?.stringValue else { return nil }
        self.init(
            issuer: issuer,
            uri: json?["uri"]?.stringValue ?? "",
            isValid: json?["isValid"]?.boolValue ?? false,
            createdAt: json?["createdAt"]?.stringValue ?? ""
        )
    }
}

/// The `verification` block: trusted-verifier state and the verifications
/// issued for this account.
public struct BskyVerification: Hashable, Sendable {
    public var verifications: [BskyVerificationEntry]
    public var verifiedStatus: String?
    public var trustedVerifierStatus: String?

    public init(verifications: [BskyVerificationEntry] = [], verifiedStatus: String? = nil, trustedVerifierStatus: String? = nil) {
        self.verifications = verifications
        self.verifiedStatus = verifiedStatus
        self.trustedVerifierStatus = trustedVerifierStatus
    }

    public init?(json: JSONValue?) {
        guard let json = json, json.objectValue != nil else { return nil }
        self.init(
            verifications: json["verifications"]?.arrayValue?.compactMap { BskyVerificationEntry(json: $0) } ?? [],
            verifiedStatus: json["verifiedStatus"]?.stringValue,
            trustedVerifierStatus: json["trustedVerifierStatus"]?.stringValue
        )
    }

    /// True when the AppView shows the account as verified.
    public var isVerified: Bool {
        verifiedStatus == "valid"
    }

    /// True when the account is itself a trusted verifier.
    public var isTrustedVerifier: Bool {
        trustedVerifierStatus == "valid"
    }
}

/// The `associated` block: counts of the account's lists, feeds and starter
/// packs, and whether it is a labeler.
public struct BskyAssociated: Hashable, Sendable {
    public var lists: Int?
    public var feedgens: Int?
    public var starterPacks: Int?
    public var labeler: Bool?

    public init(lists: Int? = nil, feedgens: Int? = nil, starterPacks: Int? = nil, labeler: Bool? = nil) {
        self.lists = lists
        self.feedgens = feedgens
        self.starterPacks = starterPacks
        self.labeler = labeler
    }

    public init?(json: JSONValue?) {
        guard let json = json, json.objectValue != nil else { return nil }
        self.init(
            lists: json["lists"]?.intValue,
            feedgens: json["feedgens"]?.intValue,
            starterPacks: json["starterPacks"]?.intValue,
            labeler: json["labeler"]?.boolValue
        )
    }
}

/// Viewer-specific state the AppView attaches to an authenticated
/// getProfile: only present when the call was made as a signed-in user.
/// Port of `ViewerState`.
public struct BskyViewerState: Hashable, Sendable {
    /// AT URI of the viewer's follow record pointing at the target.
    public var following: String?
    /// AT URI of the target's follow record pointing at the viewer.
    public var followedBy: String?
    public var muted: Bool?
    public var blockedBy: Bool?
    public var blocking: String?

    public init(following: String? = nil, followedBy: String? = nil, muted: Bool? = nil, blockedBy: Bool? = nil, blocking: String? = nil) {
        self.following = following
        self.followedBy = followedBy
        self.muted = muted
        self.blockedBy = blockedBy
        self.blocking = blocking
    }

    public init?(json: JSONValue?) {
        guard let json = json, json.objectValue != nil else { return nil }
        self.init(
            following: json["following"]?.stringValue,
            followedBy: json["followedBy"]?.stringValue,
            muted: json["muted"]?.boolValue,
            blockedBy: json["blockedBy"]?.boolValue,
            blocking: json["blocking"]?.stringValue
        )
    }

    /// Both follow records exist.
    public var isMutual: Bool {
        following != nil && followedBy != nil
    }
}

/// Accounts the viewer follows that also follow the target. Port of
/// `KnownFollowers`.
public struct BskyKnownFollowers: Hashable, Sendable {
    public var count: Int
    public var followers: [BskyPostAuthor]

    public init(count: Int, followers: [BskyPostAuthor] = []) {
        self.count = count
        self.followers = followers
    }

    public init?(json: JSONValue?) {
        guard let json = json, let count = json["count"]?.intValue else { return nil }
        self.init(
            count: count,
            followers: json["followers"]?.arrayValue?.compactMap { BskyPostAuthor(json: $0) } ?? []
        )
    }
}

/// An actor profile as `app.bsky.actor.getProfile` / `getProfiles` return
/// it. Port of `BskyProfile` (profileFetcher) merged with `AppViewProfile`
/// and `AppViewProfileWithViewer` (appview.ts); the `viewer` and
/// `knownFollowers` blocks are only present on authenticated lookups.
public struct BskyProfile: Hashable, Sendable {
    public var did: String
    public var handle: String
    public var displayName: String?
    public var description: String?
    public var avatar: String?
    public var banner: String?
    public var pronouns: String?
    public var followersCount: Int?
    public var followsCount: Int?
    public var postsCount: Int?
    public var createdAt: String?
    public var indexedAt: String?
    public var labels: [BskyLabel]
    public var verification: BskyVerification?
    public var associated: BskyAssociated?
    public var pinnedPost: BskyStrongRef?
    public var viewer: BskyViewerState?
    public var knownFollowers: BskyKnownFollowers?
    public var raw: JSONValue

    public init(
        did: String,
        handle: String,
        displayName: String? = nil,
        description: String? = nil,
        avatar: String? = nil,
        banner: String? = nil,
        pronouns: String? = nil,
        followersCount: Int? = nil,
        followsCount: Int? = nil,
        postsCount: Int? = nil,
        createdAt: String? = nil,
        indexedAt: String? = nil,
        labels: [BskyLabel] = [],
        verification: BskyVerification? = nil,
        associated: BskyAssociated? = nil,
        pinnedPost: BskyStrongRef? = nil,
        viewer: BskyViewerState? = nil,
        knownFollowers: BskyKnownFollowers? = nil,
        raw: JSONValue = .object([:])
    ) {
        self.did = did
        self.handle = handle
        self.displayName = displayName
        self.description = description
        self.avatar = avatar
        self.banner = banner
        self.pronouns = pronouns
        self.followersCount = followersCount
        self.followsCount = followsCount
        self.postsCount = postsCount
        self.createdAt = createdAt
        self.indexedAt = indexedAt
        self.labels = labels
        self.verification = verification
        self.associated = associated
        self.pinnedPost = pinnedPost
        self.viewer = viewer
        self.knownFollowers = knownFollowers
        self.raw = raw
    }

    /// Requires `did`.
    public init?(json: JSONValue?) {
        guard let json = json, let did = json["did"]?.stringValue, !did.isEmpty else { return nil }
        self.init(
            did: did,
            handle: json["handle"]?.stringValue ?? "",
            displayName: nonEmptyBskyString(json["displayName"]),
            description: nonEmptyBskyString(json["description"]),
            avatar: nonEmptyBskyString(json["avatar"]),
            banner: nonEmptyBskyString(json["banner"]),
            pronouns: nonEmptyBskyString(json["pronouns"]),
            followersCount: json["followersCount"]?.intValue,
            followsCount: json["followsCount"]?.intValue,
            postsCount: json["postsCount"]?.intValue,
            createdAt: json["createdAt"]?.stringValue,
            indexedAt: json["indexedAt"]?.stringValue,
            labels: json["labels"]?.arrayValue?.compactMap { BskyLabel(json: $0) } ?? [],
            verification: BskyVerification(json: json["verification"]),
            associated: BskyAssociated(json: json["associated"]),
            pinnedPost: BskyStrongRef(json: json["pinnedPost"]),
            viewer: BskyViewerState(json: json["viewer"]),
            knownFollowers: BskyKnownFollowers(json: json["knownFollowers"]),
            raw: json
        )
    }

    /// `displayName || handle`.
    public var displayLabel: String {
        displayName ?? handle
    }

    /// The `profileViewBasic` slice of this profile.
    public var basic: BskyPostAuthor {
        BskyPostAuthor(did: did, handle: handle, displayName: displayName, avatar: avatar, pronouns: pronouns)
    }

    public var createdAtDate: Date? {
        createdAt.flatMap(Formatting.isoDate)
    }
}

// MARK: - Helpers

/// A string field that JavaScript would treat as present: non-nil and not "".
/// Views test `author.avatar ?` and `qRecord.text &&`, so an empty string
/// must read as absent here too.
private func nonEmptyBskyString(_ value: JSONValue?) -> String? {
    guard let s = value?.stringValue, !s.isEmpty else { return nil }
    return s
}
