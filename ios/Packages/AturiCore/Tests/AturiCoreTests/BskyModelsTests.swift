import XCTest
@testable import AturiCore

/// Fixtures follow the shapes `public.api.bsky.app` returns today for the
/// `bsky.app` account's own posts (images, gallery, video, recordWithMedia)
/// plus hand-built external, quote, not-found and blocked cases.
final class BskyModelsTests: XCTestCase {
    private func json(_ text: String) throws -> JSONValue {
        try JSONValue.parse(Data(text.utf8))
    }

    private let author = """
    {"did":"did:plc:z72i7hdynmk6r22z27h6tvur","handle":"bsky.app","displayName":"Bluesky",
     "avatar":"https://cdn.bsky.app/img/avatar/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreiavatar","labels":[]}
    """

    private func post(embed: String, record: String = #"{"$type":"app.bsky.feed.post","text":"hello","createdAt":"2026-09-09T15:00:07.513Z","langs":["en"]}"#) -> String {
        """
        {"uri":"at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3mv3shqdfuc2e",
         "cid":"bafyreicctz5gxccl6ql35ae7a6wdk3zl2ry6o5ioltme52yezp7s6l42ji",
         "author":\(author),
         "record":\(record),
         "embed":\(embed),
         "bookmarkCount":47,"replyCount":113,"repostCount":148,"likeCount":2285,"quoteCount":40,
         "indexedAt":"2026-09-09T15:00:45.669Z","labels":[],
         "threadgate":{"uri":"at://x","cid":"y","record":{"$type":"app.bsky.feed.threadgate"}}}
        """
    }

    private let imagesView = """
    {"$type":"app.bsky.embed.images#view","images":[
      {"thumb":"https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreiimg1@jpeg",
       "fullsize":"https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreiimg1@jpeg",
       "alt":"An enormous pile of apples","aspectRatio":{"height":3000,"width":4000}},
      {"thumb":"https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreiimg2@jpeg",
       "fullsize":"https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreiimg2@jpeg",
       "alt":""}]}
    """

    private let externalView = """
    {"$type":"app.bsky.embed.external#view","external":{
      "uri":"https://bsky.social/about/blog/example","title":"A blog post","description":"Words about things",
      "thumb":"https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreithumb@jpeg"}}
    """

    private let quotedRecord = """
    {"$type":"app.bsky.embed.record#viewRecord",
     "uri":"at://did:plc:lcieujcfkv4jx7gehsvok3pr/app.bsky.feed.post/3m6mwoadjbp2d","cid":"bafyreidquoted",
     "author":{"did":"did:plc:lcieujcfkv4jx7gehsvok3pr","handle":"anisota.net","displayName":"Anisota"},
     "value":{"$type":"app.bsky.feed.post","text":"the quoted words","createdAt":"2025-11-30T10:00:00.000Z"},
     "labels":[],"likeCount":3,"replyCount":0,"repostCount":1,"quoteCount":1,"indexedAt":"2025-11-30T10:00:01.000Z",
     "embeds":[{"$type":"app.bsky.embed.external#view","external":{"uri":"https://example.com/q","title":"Q","description":""}}]}
    """

    private var recordView: String {
        #"{"$type":"app.bsky.embed.record#view","record":"# + quotedRecord + "}"
    }

    private var recordWithMediaView: String {
        """
        {"$type":"app.bsky.embed.recordWithMedia#view",
         "media":{"$type":"app.bsky.embed.images#view","images":[
           {"thumb":"https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreicloud@jpeg",
            "fullsize":"https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreicloud@jpeg",
            "alt":"Word cloud","aspectRatio":{"height":550,"width":591}}]},
         "record":{"record":\(quotedRecord)}}
        """
    }

    private let galleryView = """
    {"$type":"app.bsky.embed.gallery#view","items":[
      {"thumbnail":"https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreig1@jpeg","fullsize":"https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreig1@jpeg","alt":"one","aspectRatio":{"height":1000,"width":1000}},
      {"thumbnail":"https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreig2@jpeg","fullsize":"https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreig2@jpeg","alt":"two","aspectRatio":{"height":1000,"width":1000}},
      {"thumbnail":"https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreig3@jpeg","fullsize":"https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreig3@jpeg","alt":"three","aspectRatio":{"height":1000,"width":1000}},
      {"thumbnail":"https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreig4@jpeg","fullsize":"https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreig4@jpeg","alt":"four","aspectRatio":{"height":1000,"width":1000}},
      {"thumbnail":"https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreig5@jpeg","fullsize":"https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreig5@jpeg","alt":"five","aspectRatio":{"height":1000,"width":1000}}]}
    """

    private let videoView = """
    {"$type":"app.bsky.embed.video#view","cid":"bafkreivideo",
     "playlist":"https://video.bsky.app/watch/did%3Aplc%3Az72i7hdynmk6r22z27h6tvur/bafkreivideo/playlist.m3u8",
     "thumbnail":"https://video.bsky.app/watch/did%3Aplc%3Az72i7hdynmk6r22z27h6tvur/bafkreivideo/thumbnail.jpg",
     "aspectRatio":{"height":800,"width":381},"presentation":"gif"}
    """

    // MARK: Post

    func testDecodesAPostWithImages() throws {
        let value = try json(post(embed: imagesView))
        let decoded = try XCTUnwrap(BskyPost(json: value))
        XCTAssertEqual(decoded.uri, "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3mv3shqdfuc2e")
        XCTAssertEqual(decoded.cid, "bafyreicctz5gxccl6ql35ae7a6wdk3zl2ry6o5ioltme52yezp7s6l42ji")
        XCTAssertEqual(decoded.rkey, "3mv3shqdfuc2e")
        XCTAssertEqual(decoded.author.did, "did:plc:z72i7hdynmk6r22z27h6tvur")
        XCTAssertEqual(decoded.author.handle, "bsky.app")
        XCTAssertEqual(decoded.author.displayName, "Bluesky")
        XCTAssertEqual(decoded.author.displayLabel, "Bluesky")
        XCTAssertNil(decoded.author.pronouns)
        XCTAssertEqual(decoded.record.type, "app.bsky.feed.post")
        XCTAssertEqual(decoded.record.text, "hello")
        XCTAssertEqual(decoded.record.langs, ["en"])
        XCTAssertEqual(decoded.record.createdAt, "2026-09-09T15:00:07.513Z")
        XCTAssertNotNil(decoded.createdAtDate)
        XCTAssertFalse(decoded.isReply)
        XCTAssertEqual(decoded.replyCount, 113)
        XCTAssertEqual(decoded.repostCount, 148)
        XCTAssertEqual(decoded.likeCount, 2285)
        XCTAssertEqual(decoded.quoteCount, 40)
        XCTAssertEqual(decoded.indexedAt, "2026-09-09T15:00:45.669Z")
        XCTAssertEqual(decoded.raw, value, "the whole document is kept")
        XCTAssertEqual(decoded.raw["bookmarkCount"]?.intValue, 47)

        guard case .images(let images)? = decoded.embed else {
            return XCTFail("expected an images embed, got \(String(describing: decoded.embed))")
        }
        XCTAssertEqual(images.count, 2)
        XCTAssertEqual(images[0].alt, "An enormous pile of apples")
        XCTAssertEqual(images[0].thumb, "https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreiimg1@jpeg")
        XCTAssertEqual(images[0].fullsize, "https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreiimg1@jpeg")
        XCTAssertEqual(images[0].aspectRatio, EmbedAspectRatio(width: 4000, height: 3000))
        XCTAssertEqual(images[1].alt, "")
        XCTAssertNil(images[1].aspectRatio)
        XCTAssertEqual(decoded.embed?.images?.count, 2)
        XCTAssertEqual(decoded.embed?.type, "app.bsky.embed.images#view")
    }

    func testDecodesAnExternalEmbed() throws {
        let decoded = try XCTUnwrap(BskyPost(json: json(post(embed: externalView))))
        guard case .external(let external)? = decoded.embed else {
            return XCTFail("expected an external embed")
        }
        XCTAssertEqual(external.uri, "https://bsky.social/about/blog/example")
        XCTAssertEqual(external.title, "A blog post")
        XCTAssertEqual(external.description, "Words about things")
        XCTAssertEqual(external.thumb, "https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreithumb@jpeg")
        XCTAssertEqual(external.hostname, "bsky.social")
        XCTAssertNil(decoded.embed?.images)
        XCTAssertEqual(decoded.embed?.indicatorLabel, "Link")
    }

    func testDecodesAQuoteEmbed() throws {
        let decoded = try XCTUnwrap(BskyPost(json: json(post(embed: recordView))))
        guard case .record(let quoted)? = decoded.embed else {
            return XCTFail("expected a record embed")
        }
        XCTAssertEqual(quoted.type, EmbedRecord.viewRecordType)
        XCTAssertEqual(quoted.uri, "at://did:plc:lcieujcfkv4jx7gehsvok3pr/app.bsky.feed.post/3m6mwoadjbp2d")
        XCTAssertEqual(quoted.cid, "bafyreidquoted")
        XCTAssertEqual(quoted.author?.handle, "anisota.net")
        XCTAssertEqual(quoted.author?.displayLabel, "Anisota")
        XCTAssertEqual(quoted.text, "the quoted words")
        XCTAssertEqual(quoted.postRecord?.text, "the quoted words")
        XCTAssertFalse(quoted.notFound)
        XCTAssertFalse(quoted.blocked)
        XCTAssertNil(quoted.unavailableMessage)
        XCTAssertEqual(quoted.embeds.count, 1)
        guard case .external(let nested)? = quoted.embeds.first else {
            return XCTFail("expected the quoted post's external embed")
        }
        XCTAssertEqual(nested.uri, "https://example.com/q")
        XCTAssertEqual(quoted.raw["likeCount"]?.intValue, 3)
        XCTAssertEqual(decoded.embed?.indicatorLabel, "Quote")
    }

    func testDecodesARecordWithMediaEmbed() throws {
        let decoded = try XCTUnwrap(BskyPost(json: json(post(embed: recordWithMediaView))))
        guard case .recordWithMedia(let record, let media)? = decoded.embed else {
            return XCTFail("expected a recordWithMedia embed")
        }
        XCTAssertEqual(record?.uri, "at://did:plc:lcieujcfkv4jx7gehsvok3pr/app.bsky.feed.post/3m6mwoadjbp2d")
        XCTAssertEqual(record?.text, "the quoted words")
        guard case .images(let images)? = media else {
            return XCTFail("expected image media")
        }
        XCTAssertEqual(images.count, 1)
        XCTAssertEqual(images[0].alt, "Word cloud")
        XCTAssertEqual(decoded.embed?.images?.count, 1, "images reach through the media half")
    }

    func testDecodesAGalleryViewAsImages() throws {
        let decoded = try XCTUnwrap(BskyPost(json: json(post(embed: galleryView))))
        guard case .images(let images)? = decoded.embed else {
            return XCTFail("expected a gallery to decode as images")
        }
        XCTAssertEqual(images.count, 5)
        XCTAssertEqual(images.map { $0.alt }, ["one", "two", "three", "four", "five"])
        XCTAssertEqual(images[0].thumb, "https://cdn.bsky.app/img/feed_thumbnail/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreig1@jpeg", "gallery `thumbnail` is normalised to `thumb`")
        XCTAssertEqual(images[4].fullsize, "https://cdn.bsky.app/img/feed_fullsize/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreig5@jpeg")
        XCTAssertEqual(images[2].aspectRatio, EmbedAspectRatio(width: 1000, height: 1000))
    }

    func testDecodesAVideoEmbed() throws {
        let decoded = try XCTUnwrap(BskyPost(json: json(post(embed: videoView))))
        guard case .video(let playlist, let thumbnail, let alt, let aspectRatio)? = decoded.embed else {
            return XCTFail("expected a video embed")
        }
        XCTAssertEqual(playlist, "https://video.bsky.app/watch/did%3Aplc%3Az72i7hdynmk6r22z27h6tvur/bafkreivideo/playlist.m3u8")
        XCTAssertEqual(thumbnail, "https://video.bsky.app/watch/did%3Aplc%3Az72i7hdynmk6r22z27h6tvur/bafkreivideo/thumbnail.jpg")
        XCTAssertNil(alt)
        XCTAssertEqual(aspectRatio, EmbedAspectRatio(width: 381, height: 800))
        XCTAssertEqual(decoded.embed?.indicatorLabel, "Video")
    }

    func testVideoWithoutAPlaylistIsUnknownNotAFailure() throws {
        let decoded = try XCTUnwrap(BskyPost(json: json(post(embed: #"{"$type":"app.bsky.embed.video#view","cid":"x"}"#))))
        XCTAssertEqual(decoded.embed, .unknown(type: "app.bsky.embed.video#view"))
    }

    func testUnknownEmbedTypeKeepsItsName() throws {
        let decoded = try XCTUnwrap(BskyPost(json: json(post(embed: #"{"$type":"app.bsky.embed.somethingNew#view","payload":[1,2]}"#))))
        XCTAssertEqual(decoded.embed, .unknown(type: "app.bsky.embed.somethingNew#view"))
        XCTAssertNil(decoded.embed?.indicatorLabel)
        XCTAssertEqual(decoded.record.text, "hello", "the rest of the post still decodes")
    }

    func testEmbedWithoutATypeIsAbsent() throws {
        let decoded = try XCTUnwrap(BskyPost(json: json(post(embed: #"{"images":[]}"#))))
        XCTAssertNil(decoded.embed)
        XCTAssertNil(EmbedView(json: "not an object"))
        XCTAssertNil(EmbedView(json: nil))
    }

    func testEmptyImagesViewDecodesAsNoImages() throws {
        let view = EmbedView(json: try json(#"{"$type":"app.bsky.embed.images#view","images":[]}"#))
        XCTAssertEqual(view, .images([]))
        XCTAssertNil(view?.images, "an empty list reads as no images, like getEmbedImages' null")
    }

    func testNotFoundAndBlockedQuotes() throws {
        let notFound = try XCTUnwrap(BskyPost(json: json(post(embed: #"{"$type":"app.bsky.embed.record#view","record":{"$type":"app.bsky.embed.record#viewNotFound","uri":"at://did:plc:gone/app.bsky.feed.post/1","notFound":true}}"#))))
        guard case .record(let missing)? = notFound.embed else { return XCTFail("expected a record embed") }
        XCTAssertTrue(missing.notFound)
        XCTAssertEqual(missing.unavailableMessage, "Post not found")
        XCTAssertNil(missing.author)
        XCTAssertNil(missing.text)

        let blocked = try XCTUnwrap(BskyPost(json: json(post(embed: #"{"$type":"app.bsky.embed.record#view","record":{"$type":"app.bsky.embed.record#viewBlocked","uri":"at://did:plc:b/app.bsky.feed.post/1","blocked":true,"author":{"did":"did:plc:b","viewer":{"blockedBy":true}}}}"#))))
        guard case .record(let hidden)? = blocked.embed else { return XCTFail("expected a record embed") }
        XCTAssertTrue(hidden.blocked)
        XCTAssertEqual(hidden.unavailableMessage, "Post unavailable")
        XCTAssertEqual(hidden.author?.did, "did:plc:b")
        XCTAssertEqual(hidden.author?.handle, "", "a missing handle is tolerated")
    }

    func testQuotedNonPostRecordKeepsItsValueButHasNoPostRecord() throws {
        let view = try XCTUnwrap(EmbedView(json: json("""
        {"$type":"app.bsky.embed.record#view","record":{"$type":"app.bsky.feed.defs#generatorView",
         "uri":"at://did:plc:f/app.bsky.feed.generator/g","cid":"c","did":"did:web:feeds.example",
         "creator":{"did":"did:plc:f","handle":"feeds.example"},"displayName":"A feed"}}
        """)))
        guard case .record(let generator) = view else { return XCTFail("expected a record embed") }
        XCTAssertEqual(generator.type, "app.bsky.feed.defs#generatorView")
        XCTAssertNil(generator.value, "a generator view has no value/record block")
        XCTAssertNil(generator.postRecord)
        XCTAssertEqual(generator.raw["displayName"]?.stringValue, "A feed")
    }

    func testReplyAndFacetsDecode() throws {
        let record = """
        {"$type":"app.bsky.feed.post","text":"hi @alice #tag","createdAt":"2026-01-01T00:00:00Z",
         "reply":{"root":{"uri":"at://did:plc:r/app.bsky.feed.post/root","cid":"cr"},"parent":{"uri":"at://did:plc:r/app.bsky.feed.post/parent","cid":"cp"}},
         "facets":[
           {"index":{"byteStart":3,"byteEnd":9},"features":[{"$type":"app.bsky.richtext.facet#mention","did":"did:plc:alice"}]},
           {"index":{"byteStart":10,"byteEnd":14},"features":[{"$type":"app.bsky.richtext.facet#tag","tag":"tag"}]},
           {"index":{"byteStart":"bad"},"features":[]}
         ]}
        """
        let decoded = try XCTUnwrap(BskyPost(json: json(post(embed: "null", record: record))))
        XCTAssertTrue(decoded.isReply)
        XCTAssertEqual(decoded.record.reply?.root.uri, "at://did:plc:r/app.bsky.feed.post/root")
        XCTAssertEqual(decoded.record.reply?.parent.cid, "cp")
        XCTAssertEqual(decoded.record.facets.count, 2, "a facet without numeric offsets is dropped")
        XCTAssertEqual(decoded.record.facets[0].features.first?.type, BskyFacetFeature.mentionType)
        XCTAssertEqual(decoded.record.facets[0].features.first?.did, "did:plc:alice")
        XCTAssertEqual(decoded.record.facets[1].features.first?.tag, "tag")
        XCTAssertNil(decoded.embed)
    }

    func testPostRequiresUriAndAuthorDidOnly() throws {
        XCTAssertNil(BskyPost(json: try json(#"{"cid":"x","author":{"did":"did:plc:a"}}"#)), "no uri")
        XCTAssertNil(BskyPost(json: try json(#"{"uri":"at://did:plc:a/app.bsky.feed.post/1","author":{"handle":"a.test"}}"#)), "no author did")
        XCTAssertNil(BskyPost(json: nil))
        let minimal = try XCTUnwrap(BskyPost(json: try json(#"{"uri":"at://did:plc:a/app.bsky.feed.post/1","author":{"did":"did:plc:a"}}"#)))
        XCTAssertEqual(minimal.cid, "")
        XCTAssertEqual(minimal.record.text, "")
        XCTAssertNil(minimal.embed)
        XCTAssertNil(minimal.likeCount)
        XCTAssertEqual(minimal.indexedAt, "")
        XCTAssertNil(minimal.createdAtDate)
    }

    func testEmptyStringsReadAsAbsentWhereTheWebTestsTruthiness() throws {
        let decoded = try XCTUnwrap(BskyPost(json: try json(#"{"uri":"at://did:plc:a/app.bsky.feed.post/1","author":{"did":"did:plc:a","handle":"a.test","displayName":"","avatar":""}}"#)))
        XCTAssertNil(decoded.author.displayName)
        XCTAssertNil(decoded.author.avatar)
        XCTAssertEqual(decoded.author.displayLabel, "a.test")
    }

    func testCountsThatAreNotIntegralAreNil() throws {
        let decoded = try XCTUnwrap(BskyPost(json: try json(#"{"uri":"at://did:plc:a/app.bsky.feed.post/1","author":{"did":"did:plc:a"},"likeCount":"12","replyCount":2.5,"repostCount":7}"#)))
        XCTAssertNil(decoded.likeCount)
        XCTAssertNil(decoded.replyCount)
        XCTAssertEqual(decoded.repostCount, 7)
    }

    // MARK: getEmbedImages

    func testGetEmbedImagesHandlesBothShapesAndNothingElse() throws {
        XCTAssertEqual(getEmbedImages(try json(imagesView))?.count, 2)
        XCTAssertEqual(getEmbedImages(try json(galleryView))?.count, 5)
        XCTAssertNil(getEmbedImages(try json(externalView)))
        XCTAssertNil(getEmbedImages(try json(videoView)))
        XCTAssertNil(getEmbedImages(try json(#"{"$type":"app.bsky.embed.images#view","images":[]}"#)))
        XCTAssertNil(getEmbedImages(try json(#"{"$type":"app.bsky.embed.gallery#view","items":[]}"#)))
        XCTAssertNil(getEmbedImages(try json(#"{"$type":"app.bsky.embed.images#view","items":[{"thumbnail":"x"}]}"#)), "a gallery list under the images type is not read")
        XCTAssertNil(getEmbedImages(nil))
        XCTAssertNil(getEmbedImages(.string("app.bsky.embed.images#view")))
        XCTAssertNil(getEmbedImages(.array([])))
    }

    // MARK: Profile

    func testDecodesAProfile() throws {
        let value = try json("""
        {"did":"did:plc:z72i7hdynmk6r22z27h6tvur","handle":"bsky.app","displayName":"Bluesky",
         "avatar":"https://cdn.bsky.app/img/avatar/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreiavatar",
         "associated":{"lists":18,"feedgens":7,"starterPacks":15,"labeler":false,"chat":{"allowIncoming":"none"}},
         "labels":[{"src":"did:plc:z72i7hdynmk6r22z27h6tvur","uri":"at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.actor.profile/self","val":"!no-unauthenticated","cts":"2024-01-01T00:00:00.000Z"}],
         "createdAt":"2023-04-12T04:53:57.057Z",
         "verification":{"verifications":[{"issuer":"did:plc:issuer","uri":"at://did:plc:issuer/app.bsky.graph.verification/1","isValid":true,"createdAt":"2025-04-21T00:00:00.000Z"}],"verifiedStatus":"valid","trustedVerifierStatus":"valid"},
         "description":"official Bluesky account (check username)\\n\\nBugs, feature requests, feedback: support@bsky.app",
         "indexedAt":"2025-10-27T21:05:26.152Z",
         "banner":"https://cdn.bsky.app/img/banner/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreibanner",
         "followersCount":34960429,"followsCount":15,"postsCount":863,"pronouns":"they/them",
         "pinnedPost":{"cid":"bafyreipinned","uri":"at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3l6oveex3ii2l"},
         "viewer":{"muted":false,"blockedBy":false,"following":"at://did:plc:me/app.bsky.graph.follow/1","followedBy":"at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.graph.follow/2"},
         "knownFollowers":{"count":3,"followers":[{"did":"did:plc:kf","handle":"kf.test","displayName":"Known"}]}}
        """)
        let profile = try XCTUnwrap(BskyProfile(json: value))
        XCTAssertEqual(profile.did, "did:plc:z72i7hdynmk6r22z27h6tvur")
        XCTAssertEqual(profile.handle, "bsky.app")
        XCTAssertEqual(profile.displayName, "Bluesky")
        XCTAssertEqual(profile.displayLabel, "Bluesky")
        XCTAssertEqual(profile.pronouns, "they/them")
        XCTAssertTrue(profile.description?.hasPrefix("official Bluesky account") ?? false)
        XCTAssertEqual(profile.banner, "https://cdn.bsky.app/img/banner/plain/did:plc:z72i7hdynmk6r22z27h6tvur/bafkreibanner")
        XCTAssertEqual(profile.followersCount, 34_960_429)
        XCTAssertEqual(profile.followsCount, 15)
        XCTAssertEqual(profile.postsCount, 863)
        XCTAssertEqual(profile.createdAt, "2023-04-12T04:53:57.057Z")
        XCTAssertEqual(profile.createdAtDate.map { Formatting.isoDay($0) }, "2023-04-12")
        XCTAssertEqual(profile.indexedAt, "2025-10-27T21:05:26.152Z")
        XCTAssertEqual(profile.labels.map { $0.val }, ["!no-unauthenticated"])
        XCTAssertEqual(profile.labels.first?.src, "did:plc:z72i7hdynmk6r22z27h6tvur")
        XCTAssertEqual(profile.labels.first?.raw["cts"]?.stringValue, "2024-01-01T00:00:00.000Z")
        XCTAssertEqual(profile.verification?.verifiedStatus, "valid")
        XCTAssertEqual(profile.verification?.isVerified, true)
        XCTAssertEqual(profile.verification?.isTrustedVerifier, true)
        XCTAssertEqual(profile.verification?.verifications.first?.issuer, "did:plc:issuer")
        XCTAssertEqual(profile.verification?.verifications.first?.isValid, true)
        XCTAssertEqual(profile.associated?.lists, 18)
        XCTAssertEqual(profile.associated?.feedgens, 7)
        XCTAssertEqual(profile.associated?.starterPacks, 15)
        XCTAssertEqual(profile.associated?.labeler, false)
        XCTAssertEqual(profile.pinnedPost?.uri, "at://did:plc:z72i7hdynmk6r22z27h6tvur/app.bsky.feed.post/3l6oveex3ii2l")
        XCTAssertEqual(profile.viewer?.following, "at://did:plc:me/app.bsky.graph.follow/1")
        XCTAssertEqual(profile.viewer?.muted, false)
        XCTAssertEqual(profile.viewer?.isMutual, true)
        XCTAssertNil(profile.viewer?.blocking)
        XCTAssertEqual(profile.knownFollowers?.count, 3)
        XCTAssertEqual(profile.knownFollowers?.followers.first?.handle, "kf.test")
        XCTAssertEqual(profile.basic, BskyPostAuthor(did: profile.did, handle: "bsky.app", displayName: "Bluesky", avatar: profile.avatar, pronouns: "they/them"))
        XCTAssertEqual(profile.raw, value)
    }

    func testProfileRequiresOnlyADid() throws {
        XCTAssertNil(BskyProfile(json: try json(#"{"handle":"x.test"}"#)))
        XCTAssertNil(BskyProfile(json: try json(#"{"did":""}"#)))
        let minimal = try XCTUnwrap(BskyProfile(json: try json(#"{"did":"did:web:example.com"}"#)))
        XCTAssertEqual(minimal.handle, "")
        XCTAssertEqual(minimal.displayLabel, "")
        XCTAssertNil(minimal.viewer)
        XCTAssertNil(minimal.verification)
        XCTAssertNil(minimal.associated)
        XCTAssertNil(minimal.pinnedPost)
        XCTAssertNil(minimal.knownFollowers)
        XCTAssertEqual(minimal.labels, [])
        XCTAssertNil(minimal.createdAtDate)
    }

    func testMalformedNestedBlocksDoNotFailTheProfile() throws {
        let profile = try XCTUnwrap(BskyProfile(json: try json(#"{"did":"did:plc:a","labels":"nope","verification":[],"associated":7,"pinnedPost":{"cid":"only"},"viewer":null,"knownFollowers":{"followers":[]}}"#)))
        XCTAssertEqual(profile.labels, [])
        XCTAssertNil(profile.verification)
        XCTAssertNil(profile.associated)
        XCTAssertNil(profile.pinnedPost, "a strong ref without a uri is nothing")
        XCTAssertNil(profile.viewer)
        XCTAssertNil(profile.knownFollowers, "known followers without a count is nothing")
    }
}
