/**
 * Builds Next.js Metadata for a Bluesky post link in the same shape that
 * `bskyweb` (the official server-side template at
 * https://github.com/bluesky-social/social-app/blob/main/bskyweb/templates/post.html)
 * emits — so an aturi post link unfurls in iMessage / Discord / Bluesky / etc.
 * with the same compact author + text card you get when sharing a native
 * `bsky.app` link.
 *
 * The trick bskyweb uses, and that we mirror here:
 *  - Posts with media (images / video / external link card / recordWithMedia)
 *    → emit `twitter:card: summary_large_image` + the media thumbnail as
 *      `og:image` so the unfurl shows the real media.
 *  - Text-only posts → emit `twitter:card: summary` + the *small* avatar
 *    thumbnail (128×128, served from `/img/avatar_thumbnail/plain/...` on the
 *    bsky CDN) as `og:image`. The smaller image triggers the compact preview
 *    layout in messaging clients instead of a hero-style banner.
 */
import type { Metadata } from 'next';
import type { BskyPost } from '@/utils/recordFetcher';
import { toBskyAvatarThumbnail } from '@/lib/og-image';

function pickEmbedThumbnail(embed: BskyPost['embed']): string | undefined {
  if (!embed) return undefined;
  if (embed.$type === 'app.bsky.embed.images#view' && embed.images?.[0]?.thumb) {
    return embed.images[0].thumb;
  }
  if (embed.$type === 'app.bsky.embed.video#view' && embed.thumbnail) {
    return embed.thumbnail;
  }
  if (embed.$type === 'app.bsky.embed.external#view' && embed.external?.thumb) {
    return embed.external.thumb;
  }
  if (embed.$type === 'app.bsky.embed.recordWithMedia#view' && embed.media) {
    if (embed.media.images?.[0]?.thumb) return embed.media.images[0].thumb;
    if (embed.media.thumbnail) return embed.media.thumbnail;
    if (embed.media.external?.thumb) return embed.media.external.thumb;
  }
  return undefined;
}

export function buildPostMetadata(post: BskyPost): Metadata {
  const author = post.author;

  // Page <title> still carries aturi branding so people see context when
  // they actually visit the page in a browser.
  const pageTitle = `Post by ${author.displayName || author.handle} (@${author.handle}) on Bluesky — View on Aturi`;

  // OG/Twitter title mirrors bskyweb's "Display Name (@handle)" format so
  // the unfurled card reads identically to a native bsky.app post link.
  const ogTitle = author.displayName
    ? `${author.displayName} (@${author.handle})`
    : `@${author.handle}`;

  const description = post.record?.text ? post.record.text.slice(0, 300) : '';

  const mediaThumb = pickEmbedThumbnail(post.embed);

  let ogImageUrl: string | undefined;
  let twitterCard: 'summary' | 'summary_large_image' = 'summary_large_image';
  let ogImageWidth: number | undefined;
  let ogImageHeight: number | undefined;

  if (mediaThumb) {
    ogImageUrl = mediaThumb;
    ogImageWidth = post.embed?.images?.[0]?.aspectRatio?.width
      ?? post.embed?.media?.images?.[0]?.aspectRatio?.width
      ?? post.embed?.aspectRatio?.width;
    ogImageHeight = post.embed?.images?.[0]?.aspectRatio?.height
      ?? post.embed?.media?.images?.[0]?.aspectRatio?.height
      ?? post.embed?.aspectRatio?.height;
  } else {
    const avatarThumb = toBskyAvatarThumbnail(author.avatar);
    if (avatarThumb) {
      ogImageUrl = avatarThumb;
      twitterCard = 'summary';
    }
  }

  return {
    title: pageTitle,
    description,
    openGraph: {
      title: ogTitle,
      description,
      type: 'article',
      images: ogImageUrl
        ? [
            {
              url: ogImageUrl,
              ...(ogImageWidth && ogImageHeight
                ? { width: ogImageWidth, height: ogImageHeight }
                : {}),
              alt: ogTitle,
            },
          ]
        : undefined,
    },
    twitter: {
      card: twitterCard,
      title: ogTitle,
      description,
      images: ogImageUrl ? [ogImageUrl] : undefined,
    },
  };
}
