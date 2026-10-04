import SwiftUI
import AturiCore

/// The rich card for an account: banner, avatar, names, bio, counts and
/// the verification and label chips. Port of `ProfilePreview.tsx`.
struct ProfileCardView: View {
    let profile: BskyProfile
    /// The web hides its "View repo in the Explorer" footer when the card
    /// is already inside the explorer.
    let showsExplorerLink: Bool

    @Environment(\.aturiTheme) private var theme
    @Environment(AppRouter.self) private var router: AppRouter?
    @Environment(\.openURL) private var openURL

    private static let bannerHeight: CGFloat = 120
    private static let avatarSize: CGFloat = 88
    /// How far the avatar rises into the banner.
    private static let avatarOverlap: CGFloat = 40

    init(profile: BskyProfile, showsExplorerLink: Bool = true) {
        self.profile = profile
        self.showsExplorerLink = showsExplorerLink
    }

    private var hasAssociated: Bool {
        guard let associated = profile.associated else { return false }
        return (associated.lists ?? 0) > 0 || (associated.feedgens ?? 0) > 0 || (associated.starterPacks ?? 0) > 0
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            banner
            VStack(alignment: .leading, spacing: 14) {
                header
                if let description = profile.description, !description.isEmpty {
                    Text(description)
                        .font(.body)
                        .foregroundStyle(theme.textPrimary)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
                stats
                if hasAssociated {
                    Divider()
                        .overlay(theme.borderSubtle)
                    associatedRow
                }
                if showsExplorerLink {
                    Divider()
                        .overlay(theme.borderSubtle)
                    Button {
                        LinkNavigation.open(.repo(profile.did), router: router, openURL: openURL)
                    } label: {
                        Label("View repo in the Explorer", systemImage: "binoculars")
                            .font(.footnote)
                            .foregroundStyle(theme.textAccent)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(16)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .cardBackground()
    }

    /* A missing banner is a plain block of the deep accent rather than the
       web's gradient; the app draws no gradients anywhere. */
    private var banner: some View {
        ZStack {
            theme.accentDeep
            if let banner = profile.banner, !banner.isEmpty, let url = URL(string: banner) {
                AsyncImage(url: url) { phase in
                    if case .success(let image) = phase {
                        image
                            .resizable()
                            .scaledToFill()
                    }
                }
            }
        }
        .frame(height: Self.bannerHeight)
        .frame(maxWidth: .infinity)
        .clipped()
        .accessibilityHidden(true)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            AvatarView(url: profile.avatar, size: Self.avatarSize)
                .overlay(Circle().strokeBorder(theme.bgSecondary, lineWidth: 3))
                .offset(y: -Self.avatarOverlap)
                .padding(.bottom, -Self.avatarOverlap)

            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(profile.displayLabel)
                    .font(AturiFont.title)
                    .foregroundStyle(theme.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                if profile.verification?.isVerified == true {
                    Image(systemName: "checkmark.seal.fill")
                        .foregroundStyle(theme.textAccent)
                        .accessibilityLabel("Verified")
                }
            }

            HStack(spacing: 8) {
                IdentifierText("@\(profile.handle)", font: AturiFont.mono)
                    .foregroundStyle(theme.textTertiary)
                if let pronouns = profile.pronouns, !pronouns.isEmpty {
                    Text(pronouns)
                        .font(.footnote)
                        .foregroundStyle(theme.textTertiary)
                }
            }

            chips
        }
    }

    @ViewBuilder
    private var chips: some View {
        let isTrustedVerifier = profile.verification?.isTrustedVerifier == true
        let isLabeler = profile.associated?.labeler == true
        if isTrustedVerifier || isLabeler || !profile.labels.isEmpty {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 6) {
                    if isTrustedVerifier {
                        Chip("Trusted verifier", systemImage: "checkmark.shield", style: .accent)
                    }
                    if isLabeler {
                        Chip("Labeler", systemImage: "tag", style: .accent)
                    }
                    ForEach(Array(profile.labels.enumerated()), id: \.offset) { _, label in
                        Chip(label.val, systemImage: "exclamationmark.triangle", style: .danger)
                    }
                }
            }
        }
    }

    private var stats: some View {
        VStack(alignment: .leading, spacing: 8) {
            ViewThatFits(in: .horizontal) {
                HStack(spacing: 16) {
                    statItems
                }
                VStack(alignment: .leading, spacing: 6) {
                    statItems
                }
            }
            if let joined = profile.createdAtDate {
                HStack(spacing: 6) {
                    Image(systemName: "calendar")
                    Text("Joined ") + Text(joined, format: .dateTime.year().month(.abbreviated))
                }
                .font(.footnote)
                .foregroundStyle(theme.textTertiary)
                .accessibilityElement(children: .combine)
            }
        }
    }

    @ViewBuilder
    private var statItems: some View {
        if let count = profile.followersCount {
            stat(count, noun: "followers", systemImage: "person.2")
        }
        if let count = profile.followsCount {
            stat(count, noun: "following", systemImage: "person.2")
        }
        if let count = profile.postsCount {
            stat(count, noun: "posts", systemImage: "bubble.left")
        }
    }

    private func stat(_ count: Int, noun: String, systemImage: String) -> some View {
        HStack(spacing: 4) {
            Image(systemName: systemImage)
                .foregroundStyle(theme.textTertiary)
            Text(count.formatted())
                .font(.footnote.weight(.semibold))
                .foregroundStyle(theme.textPrimary)
            Text(noun)
                .font(.footnote)
                .foregroundStyle(theme.textTertiary)
        }
        .accessibilityElement(children: .combine)
    }

    private var associatedRow: some View {
        HStack(spacing: 16) {
            if let lists = profile.associated?.lists, lists > 0 {
                associatedItem(lists, singular: "list", plural: "lists")
            }
            if let feeds = profile.associated?.feedgens, feeds > 0 {
                associatedItem(feeds, singular: "feed", plural: "feeds")
            }
            if let packs = profile.associated?.starterPacks, packs > 0 {
                associatedItem(packs, singular: "starter pack", plural: "starter packs")
            }
        }
        .font(.footnote)
        .foregroundStyle(theme.textSecondary)
    }

    private func associatedItem(_ count: Int, singular: String, plural: String) -> some View {
        HStack(spacing: 4) {
            Text(count.formatted())
                .fontWeight(.semibold)
            Text(count == 1 ? singular : plural)
        }
        .accessibilityElement(children: .combine)
    }
}
