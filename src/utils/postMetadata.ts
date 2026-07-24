import type { Metadata } from 'next';
import type { BskyPost } from './recordFetcher';
import { getPostOgImage } from './postOgImage';
import { buildAtTagsMetadata } from './atproto/atTags';

/**
 * Build the page <head> metadata for a Bluesky post. Shared by the two routes
 * that render a post — /profile/[handle]/post/[rkey] and the generic
 * /[handle]/[collection]/[rkey] — which previously carried byte-identical
 * ~90-line copies of this.
 *
 * We MUST set openGraph and twitter blocks here to override the root layout's
 * site-wide defaults; without them the root layout's og:title / og:image bleed
 * through and create conflicting tags that confuse Apple's LinkPresentation
 * framework and other rich-link previewers.
 */
export function buildPostMetadata(
  post: BskyPost,
  { resolvedDid, collection, rkey }: { resolvedDid: string; collection: string; rkey: string },
): Metadata {
  const author = post.author;
  const authorByline = author.displayName
    ? `${author.displayName} (@${author.handle})`
    : `@${author.handle}`;
  const pageTitle = `@${author.handle} on Bluesky: View on Aturi`;
  const postText = post.record?.text || '';
  const description = postText || 'View this post in your preferred Atmosphere client';
  const avatarThumb = author.avatar
    ? author.avatar.replace('/img/avatar/', '/img/avatar_thumbnail/')
    : '';

  // Prefer the post's embedded media (photo/video/external thumb) so rich-link
  // previewers (iMessage, Twitter, Slack, etc.) render the large image like
  // bsky.app does. Fall back to the avatar thumbnail for text-only or
  // quote-only posts.
  const postOgImage = getPostOgImage(post);
  const ogImage = postOgImage
    ? {
        url: postOgImage.url,
        ...(postOgImage.alt ? { alt: postOgImage.alt } : {}),
        ...(postOgImage.width && postOgImage.height
          ? { width: postOgImage.width, height: postOgImage.height }
          : {}),
      }
    : avatarThumb
    ? { url: avatarThumb }
    : null;
  const twitterCard = postOgImage ? 'summary_large_image' : 'summary';

  const canonicalUrl = `https://aturi.to/profile/${author.handle}/post/${rkey}`;
  const atUri = `at://${resolvedDid}/${collection}/${rkey}`;
  const oembedUrl = `https://aturi.to/api/oembed?format=json&url=${encodeURIComponent(atUri)}`;
  const publishedTime = post.indexedAt || post.record?.createdAt;

  return {
    title: pageTitle,
    description,
    alternates: {
      canonical: canonicalUrl,
      types: {
        'application/json+oembed': oembedUrl,
      },
    },
    openGraph: {
      title: authorByline,
      description: postText || description,
      type: 'article',
      url: canonicalUrl,
      siteName: 'Aturi',
      ...(publishedTime ? { publishedTime } : {}),
      ...(ogImage ? { images: [ogImage] } : {}),
    },
    twitter: {
      card: twitterCard,
      title: authorByline,
      description: postText || description,
      ...(ogImage ? { images: [ogImage.url] } : {}),
    },
    other: {
      // AT Tags (https://tangled.org/chrisshank.com/at-tags/): declare the
      // record this page renders and the identity that authored it, so
      // extensions, crawlers, and verifiers can map the page back to atproto.
      ...buildAtTagsMetadata({
        canonical: atUri,
        author: `at://${resolvedDid}`,
      }),
      'profile:username': author.handle,
      ...(publishedTime
        ? {
            'twitter:label1': 'Posted At',
            'twitter:value1': publishedTime,
          }
        : {}),
      ...(post.likeCount
        ? {
            'twitter:label2': 'Likes',
            'twitter:value2': String(post.likeCount),
          }
        : {}),
      ...(post.replyCount
        ? {
            'twitter:label3': 'Replies',
            'twitter:value3': String(post.replyCount),
          }
        : {}),
      ...(post.repostCount
        ? {
            'twitter:label4': 'Reposts',
            'twitter:value4': String(post.repostCount),
          }
        : {}),
    },
  };
}

/**
 * schema.org JSON-LD for a post, so Apple LinkPresentation and search engines
 * can identify the page as a discussion posting. Shared by both post routes.
 */
export function buildPostJsonLd(post: BskyPost): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': 'DiscussionForumPosting',
    author: {
      '@type': 'Person',
      ...(post.author.displayName
        ? {
            name: post.author.displayName,
            alternateName: `@${post.author.handle}`,
          }
        : { name: `@${post.author.handle}` }),
      url: `https://aturi.to/profile/${post.author.handle}`,
    },
    ...(post.record?.text ? { text: post.record.text } : {}),
    datePublished: post.indexedAt || post.record?.createdAt,
    interactionStatistic: [
      {
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/LikeAction',
        userInteractionCount: post.likeCount || 0,
      },
      {
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/CommentAction',
        userInteractionCount: post.replyCount || 0,
      },
      {
        '@type': 'InteractionCounter',
        interactionType: 'https://schema.org/ShareAction',
        userInteractionCount: (post.repostCount || 0) + (post.quoteCount || 0),
      },
    ],
  };
}
