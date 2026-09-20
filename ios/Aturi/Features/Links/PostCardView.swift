import SwiftUI
import AturiCore

/// The rich card for an `app.bsky.feed.post`: the reply parent when there
/// is one, the author line, the text with its facets, the hydrated embeds
/// and the engagement counts. Port of `PostPreview.tsx` and
/// `PostEmbeds.tsx`.
struct PostCardView: View {
    let post: BskyPost
    let parent: BskyPost?
    /// The web hides its "View record data in the Explorer" footer when
    /// the card is already inside the explorer.
    let showsExplorerLink: Bool

    @Environment(\.aturiTheme) private var theme
    @Environment(AppRouter.self) private var router: AppRouter?
    @Environment(\.openURL) private var openURL
    @State private var lightbox: PostLightboxSelection?

    init(post: BskyPost, parent: BskyPost? = nil, showsExplorerLink: Bool = true) {
        self.post = post
        self.parent = parent
        self.showsExplorerLink = showsExplorerLink
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let parent {
                /* The parent sits behind the post the way the web tucks it
                   under: slightly smaller, overlapped by the main card. */
                PostParentCard(post: parent, showImages: showLightbox)
                    .scaleEffect(0.97, anchor: .top)
                    .padding(.bottom, -14)
                    .zIndex(0)
            }
            mainCard
                .zIndex(1)
        }
        .fullScreenCover(item: $lightbox) { selection in
            ImageLightbox(images: selection.images, index: selection.index)
        }
    }

    private var mainCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            PostAuthorRow(author: post.author, avatarSize: 48)

            if !post.record.text.isEmpty {
                PostFacetText(record: post.record)
            }

            if let embed = post.embed {
                PostEmbedContent(embed: embed, showImages: showLightbox)
            }

            Divider()
                .overlay(theme.borderSubtle)

            countsRow

            if showsExplorerLink, let route = Route(atUri: post.uri) {
                Divider()
                    .overlay(theme.borderSubtle)
                Button {
                    LinkNavigation.open(route, router: router, openURL: openURL)
                } label: {
                    Label("View record data in the Explorer", systemImage: "binoculars")
                        .font(.footnote)
                        .foregroundStyle(theme.textAccent)
                }
                .buttonStyle(.plain)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .cardBackground()
    }

    private var countsRow: some View {
        HStack(spacing: 18) {
            stat("bubble.left", count: post.replyCount, noun: "replies")
            stat("arrow.2.squarepath", count: post.repostCount, noun: "reposts")
            stat("heart", count: post.likeCount, noun: "likes")
            stat("quote.opening", count: post.quoteCount, noun: "quotes")
            Spacer(minLength: 0)
            if let date = post.createdAtDate {
                RelativeDateText(date: date)
                    .font(.caption)
            }
        }
        .font(.footnote)
        .foregroundStyle(theme.textTertiary)
    }

    private func stat(_ systemImage: String, count: Int?, noun: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: systemImage)
            Text(Formatting.compactCount(count ?? 0))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("\(count ?? 0) \(noun)")
    }

    private func showLightbox(_ images: [EmbedImage], _ index: Int) {
        lightbox = PostLightboxSelection(images: images, index: index)
    }
}

/// What the lightbox opens on: the whole embed, even where the grid was
/// capped, so the reply parent's two thumbnails browse all four images.
private struct PostLightboxSelection: Identifiable {
    let id = UUID()
    let images: [EmbedImage]
    let index: Int
}

/// Avatar, display name (with pronouns) and handle; tapping opens the
/// account's universal-link page, as the web's author links do.
private struct PostAuthorRow: View {
    let author: BskyPostAuthor
    var avatarSize: CGFloat = 40

    @Environment(\.aturiTheme) private var theme
    @Environment(AppRouter.self) private var router: AppRouter?
    @Environment(\.openURL) private var openURL

    var body: some View {
        Button {
            LinkNavigation.open(LinkNavigation.previewRoute(actor: author.did), router: router, openURL: openURL)
        } label: {
            HStack(spacing: 10) {
                AvatarView(url: author.avatar, size: avatarSize)
                VStack(alignment: .leading, spacing: 2) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(author.displayLabel)
                            .font(.body.weight(.semibold))
                            .foregroundStyle(theme.textPrimary)
                            .lineLimit(1)
                        if let pronouns = author.pronouns, !pronouns.isEmpty {
                            Text(pronouns)
                                .font(.footnote)
                                .foregroundStyle(theme.textTertiary)
                                .lineLimit(1)
                        }
                    }
                    if !author.handle.isEmpty {
                        Text("@\(author.handle)")
                            .font(AturiFont.monoSmall)
                            .foregroundStyle(theme.textTertiary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
                Spacer(minLength: 0)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(author.handle.isEmpty ? author.displayLabel : "\(author.displayLabel), @\(author.handle)")
        .accessibilityHint("Opens the profile")
    }
}

/// The post text with its facets applied: links open outside, mentions
/// push the account's page, tags go to the Bluesky hashtag feed. Plain
/// text where a facet is malformed, exactly as `Facets.segments` decides.
struct PostFacetText: View {
    let record: BskyPostRecord
    var font: Font = .body
    var color: Color? = nil

    @Environment(\.aturiTheme) private var theme
    @Environment(AppRouter.self) private var router: AppRouter?
    @Environment(\.openURL) private var openURL

    var body: some View {
        Text(attributed)
            .font(font)
            .foregroundStyle(color ?? theme.textPrimary)
            .textSelection(.enabled)
            .fixedSize(horizontal: false, vertical: true)
            .environment(\.openURL, OpenURLAction { url in
                /* Mentions are spelled as aturi.to profile links so the
                   same grammar that routes incoming links routes them; a
                   link the app has no page for goes to the system. */
                if let target = DeepLinks.target(for: url), case .route(let route, _) = target {
                    LinkNavigation.open(route, router: router, openURL: openURL)
                    return .handled
                }
                return .systemAction
            })
    }

    private var attributed: AttributedString {
        var result = AttributedString()
        for segment in Facets.segments(of: record) {
            switch segment {
            case .text(let text):
                result.append(AttributedString(text))
            case .link(let text, let url):
                result.append(linked(text, url: url, underline: true))
            case .mention(let text, let did):
                result.append(linked(text, url: generateAturiLink(AtUriComponents(identifier: did)), underline: false))
            case .tag(let text, let tag):
                result.append(linked(text, url: Facets.hashtagURL(tag), underline: false))
            }
        }
        return result
    }

    private func linked(_ text: String, url: String, underline: Bool) -> AttributedString {
        var run = AttributedString(text)
        guard let link = URL(string: url) else { return run }
        run.link = link
        run.foregroundColor = theme.textAccent
        if underline {
            run.underlineStyle = Text.LineStyle.single
        }
        return run
    }
}

/// The reply parent: "Replying to", the author, three lines of text and
/// compact embeds. Tapping anywhere but the author opens the parent post.
private struct PostParentCard: View {
    let post: BskyPost
    let showImages: ([EmbedImage], Int) -> Void

    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale
    @Environment(AppRouter.self) private var router: AppRouter?
    @Environment(\.openURL) private var openURL

    private var route: Route? {
        LinkNavigation.previewRoute(recordUri: post.uri)
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)
        VStack(alignment: .leading, spacing: 8) {
            Label("Replying to", systemImage: "arrow.turn.down.right")
                .font(.footnote)
                .foregroundStyle(theme.textTertiary)
            PostAuthorRow(author: post.author, avatarSize: 32)
            if !post.record.text.isEmpty {
                Text(post.record.text)
                    .font(.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .lineLimit(3)
            }
            if let embed = post.embed {
                PostMediaEmbed(embed: embed, compact: true, imageLimit: 2, showImages: showImages)
            }
        }
        .padding(12)
        .padding(.bottom, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(theme.bgTertiary, in: shape)
        .overlay(shape.strokeBorder(theme.borderSubtle, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
        .contentShape(shape)
        .onTapGesture {
            if let route {
                LinkNavigation.open(route, router: router, openURL: openURL)
            }
        }
        .accessibilityAction(named: "Open parent post") {
            if let route {
                LinkNavigation.open(route, router: router, openURL: openURL)
            }
        }
    }
}

/// A hydrated embed on the main post: media on its own, a quoted record,
/// or both. Anything the AppView sent that has no rendering is skipped, as
/// on the web.
struct PostEmbedContent: View {
    let embed: EmbedView
    let showImages: ([EmbedImage], Int) -> Void

    var body: some View {
        switch embed {
        case .images, .external, .video:
            PostMediaEmbed(embed: embed, compact: false, showImages: showImages)
        case .record(let record):
            PostQuoteCard(record: record, showImages: showImages)
        case .recordWithMedia(let record, let media):
            VStack(alignment: .leading, spacing: 12) {
                if let media {
                    PostMediaEmbed(embed: media, compact: false, showImages: showImages)
                }
                if let record {
                    PostQuoteCard(record: record, showImages: showImages)
                }
            }
        case .unknown:
            EmptyView()
        }
    }
}

/// The media half of any embed: an image grid, a link card or a video
/// poster. `compact` is the quoted-post and reply-parent treatment.
struct PostMediaEmbed: View {
    let embed: EmbedView
    var compact: Bool = false
    var imageLimit: Int? = nil
    let showImages: ([EmbedImage], Int) -> Void

    var body: some View {
        switch embed {
        case .images(let images):
            PostImageGrid(images: images, limit: imageLimit, compact: compact, onTap: showImages)
        case .external(let external):
            PostExternalCard(external: external, compact: compact)
        case .video(let playlist, let thumbnail, let alt, let aspectRatio):
            PostVideoView(playlist: playlist, thumbnail: thumbnail, alt: alt, aspectRatio: aspectRatio, compact: compact)
        case .record, .recordWithMedia, .unknown:
            EmptyView()
        }
    }
}

/// Grid for a post's images: one image at its own aspect ratio, two to
/// four in two columns, a gallery of five or more in three. Tapping opens
/// the lightbox on that image.
struct PostImageGrid: View {
    let images: [EmbedImage]
    var limit: Int? = nil
    var compact: Bool = false
    let onTap: ([EmbedImage], Int) -> Void

    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale

    private var shown: [EmbedImage] {
        if let limit {
            return Array(images.prefix(limit))
        }
        return images
    }

    private var columns: Int {
        if shown.count == 1 { return 1 }
        return shown.count >= 5 ? 3 : 2
    }

    private var maxHeight: CGFloat {
        compact ? 200 : 480
    }

    var body: some View {
        if shown.count == 1, let single = shown.first {
            tile(single, index: 0)
                .aspectRatio(ratio(of: single), contentMode: .fit)
                .frame(maxHeight: maxHeight)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else {
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 4), count: columns), spacing: 4) {
                ForEach(Array(shown.enumerated()), id: \.offset) { offset, image in
                    tile(image, index: offset)
                        .aspectRatio(1, contentMode: .fit)
                }
            }
        }
    }

    private func ratio(of image: EmbedImage) -> CGFloat {
        guard let aspect = image.aspectRatio, aspect.width > 0, aspect.height > 0 else { return 16 / 9 }
        return CGFloat(aspect.width / aspect.height)
    }

    private func tile(_ image: EmbedImage, index: Int) -> some View {
        let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)
        return Button {
            onTap(images, index)
        } label: {
            PostRemoteImage(url: image.thumb ?? image.fullsize)
                .clipShape(shape)
                .overlay(shape.strokeBorder(theme.borderSubtle, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(image.alt.flatMap { $0.isEmpty ? nil : $0 } ?? "Image \(index + 1) of \(images.count)")
        .accessibilityHint("Opens the image")
    }
}

/// An image that fills whatever frame it is given, with the tertiary
/// background while it loads or when it fails.
private struct PostRemoteImage: View {
    let url: String?

    @Environment(\.aturiTheme) private var theme

    private var imageURL: URL? {
        guard let url, !url.isEmpty else { return nil }
        return URL(string: url)
    }

    var body: some View {
        Color.clear
            .overlay {
                AsyncImage(url: imageURL) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                    default:
                        theme.bgTertiary
                    }
                }
            }
            .clipped()
            .contentShape(Rectangle())
    }
}

/// External-link card: thumbnail, title, description (full variant only)
/// and hostname. Opens the link outside the app.
struct PostExternalCard: View {
    let external: EmbedExternal
    var compact: Bool = false

    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale
    @Environment(\.openURL) private var openURL

    private var destination: URL? {
        URL(string: external.uri)
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
        Button {
            if let destination {
                openURL(destination)
            }
        } label: {
            VStack(alignment: .leading, spacing: 0) {
                if let thumb = external.thumb, !thumb.isEmpty {
                    PostRemoteImage(url: thumb)
                        .frame(height: compact ? 120 : 200)
                }
                VStack(alignment: .leading, spacing: 4) {
                    if !external.title.isEmpty {
                        Text(external.title)
                            .font(compact ? .footnote.weight(.semibold) : .body.weight(.semibold))
                            .foregroundStyle(theme.textPrimary)
                            .lineLimit(2)
                    }
                    if !compact, !external.description.isEmpty {
                        Text(external.description)
                            .font(.footnote)
                            .foregroundStyle(theme.textSecondary)
                            .lineLimit(3)
                    }
                    Text(external.hostname.isEmpty ? external.uri : external.hostname)
                        .font(.caption)
                        .foregroundStyle(theme.textTertiary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }
                .padding(compact ? 8 : 12)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(compact ? theme.bgSecondary : theme.bgTertiary, in: shape)
            .overlay(shape.strokeBorder(theme.borderSubtle, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
            .contentShape(shape)
        }
        .buttonStyle(.plain)
        .disabled(destination == nil)
        .accessibilityLabel(external.title.isEmpty ? "Link to \(external.hostname)" : external.title)
        .accessibilityHint("Opens the link outside the app")
    }
}

/// A video embed as its poster with a play mark. The HLS playlist opens
/// outside the app, where the system player handles it; there is no
/// in-app player because AVKit is not part of this build.
struct PostVideoView: View {
    let playlist: String
    let thumbnail: String?
    let alt: String?
    let aspectRatio: EmbedAspectRatio?
    var compact: Bool = false

    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale
    @Environment(\.openURL) private var openURL

    private var destination: URL? {
        URL(string: playlist)
    }

    private var ratio: CGFloat {
        guard let aspectRatio, aspectRatio.width > 0, aspectRatio.height > 0 else { return 16 / 9 }
        return CGFloat(aspectRatio.width / aspectRatio.height)
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
        VStack(alignment: .leading, spacing: 0) {
            Button {
                if let destination {
                    openURL(destination)
                }
            } label: {
                ZStack {
                    PostRemoteImage(url: thumbnail)
                    Image(systemName: "play.circle.fill")
                        .font(.system(size: compact ? 36 : 52))
                        .foregroundStyle(.white.opacity(0.9))
                        .shadow(radius: 6)
                }
                .aspectRatio(ratio, contentMode: .fit)
                .frame(maxHeight: compact ? 200 : 420)
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.plain)
            .disabled(destination == nil)
            .accessibilityLabel(alt.flatMap { $0.isEmpty ? nil : "Video: \($0)" } ?? "Video")
            .accessibilityHint("Plays the video outside the app")

            if !compact, let alt, !alt.isEmpty {
                Text(alt)
                    .font(.footnote)
                    .foregroundStyle(theme.textTertiary)
                    .padding(8)
            }
        }
        .background(compact ? theme.bgSecondary : theme.bgTertiary, in: shape)
        .clipShape(shape)
        .overlay(shape.strokeBorder(theme.borderSubtle, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
    }
}

/// A quoted record: the author line and text of a quoted post with its
/// media, the placeholder for one that is blocked, detached or gone, and a
/// title for non-post views (feeds, lists, starter packs, labelers).
/// Tapping opens the quoted record's universal-link page.
struct PostQuoteCard: View {
    let record: EmbedRecord
    let showImages: ([EmbedImage], Int) -> Void

    @Environment(\.aturiTheme) private var theme
    @Environment(\.displayScale) private var displayScale
    @Environment(AppRouter.self) private var router: AppRouter?
    @Environment(\.openURL) private var openURL

    private var route: Route? {
        guard let uri = record.uri else { return nil }
        return LinkNavigation.previewRoute(recordUri: uri)
    }

    /// The indicator for an embed the AppView did not hydrate, read off
    /// the quoted record's own `embed` block.
    private var unhydratedEmbedLabel: String? {
        guard record.embeds.isEmpty, let type = record.value?["embed"]?["$type"]?.stringValue else { return nil }
        if type.contains("images") || type.contains("gallery") { return "Images" }
        if type.contains("external") { return "Link" }
        if type.contains("video") { return "Video" }
        if type.contains("record") { return "Quote" }
        return nil
    }

    private var nonPostTitle: String? {
        guard record.postRecord == nil else { return nil }
        let title = RecordPreview.titleFor(record.value ?? record.raw)
        return title == "record" ? nil : title
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 10, style: .continuous)
        Group {
            if let message = record.unavailableMessage {
                Text(message)
                    .font(.footnote)
                    .foregroundStyle(theme.textTertiary)
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                Button {
                    if let route {
                        LinkNavigation.open(route, router: router, openURL: openURL)
                    }
                } label: {
                    quoteBody
                        .contentShape(shape)
                }
                .buttonStyle(.plain)
                .disabled(route == nil)
                .accessibilityHint(route == nil ? "" : "Opens the quoted record")
            }
        }
        .background(theme.bgTertiary, in: shape)
        .overlay(shape.strokeBorder(theme.borderSubtle, lineWidth: AturiTheme.hairline(displayScale: displayScale)))
    }

    private var quoteBody: some View {
        VStack(alignment: .leading, spacing: 6) {
            if let author = record.author {
                HStack(spacing: 8) {
                    AvatarView(url: author.avatar, size: 24)
                    Text(author.displayLabel)
                        .font(.footnote.weight(.semibold))
                        .foregroundStyle(theme.textPrimary)
                        .lineLimit(1)
                    if !author.handle.isEmpty {
                        Text("@\(author.handle)")
                            .font(.caption)
                            .foregroundStyle(theme.textTertiary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
            }
            if let text = record.text, !text.isEmpty {
                Text(text)
                    .font(.footnote)
                    .foregroundStyle(theme.textSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else if let title = nonPostTitle {
                Text(title)
                    .font(.footnote.weight(.semibold))
                    .foregroundStyle(theme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            ForEach(Array(record.embeds.enumerated()), id: \.offset) { _, embed in
                PostMediaEmbed(embed: embed, compact: true, showImages: showImages)
            }
            if let label = unhydratedEmbedLabel {
                Text(label)
                    .font(.caption)
                    .foregroundStyle(theme.textTertiary)
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
