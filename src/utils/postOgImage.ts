/**
 * Extract the best preview image from a Bluesky post for use as og:image.
 *
 * When a post has an image, video, or external-link embed we want rich-link
 * previewers (iMessage, Twitter, Slack, etc.) to render that media as the
 * large card image — same as bsky.app does. Without this, all aturi post
 * links fall back to the author's small avatar thumbnail.
 */

import type { BskyPost } from './recordFetcher';
import { getEmbedImages } from './postEmbeds';

export type PostOgImage = {
  url: string;
  alt?: string;
  width?: number;
  height?: number;
};

type EmbedView = {
  $type?: string;
  images?: Array<{
    thumb?: string;
    fullsize?: string;
    alt?: string;
    aspectRatio?: { width: number; height: number };
  }>;
  external?: {
    thumb?: string;
    title?: string;
  };
  thumbnail?: string;
  alt?: string;
  aspectRatio?: { width: number; height: number };
  media?: EmbedView;
};

function pickFromView(view: EmbedView | undefined): PostOgImage | null {
  if (!view) return null;

  // Classic images embed (1–4) and the newer gallery embed (5+) both
  // surface a list of images we can pull the first frame from.
  const images = getEmbedImages(view);
  if (images && images.length > 0) {
    const img = images[0];
    const url = img.fullsize || img.thumb;
    if (!url) return null;
    return {
      url,
      alt: img.alt,
      width: img.aspectRatio?.width,
      height: img.aspectRatio?.height,
    };
  }

  if (view.$type === 'app.bsky.embed.video#view' && view.thumbnail) {
    return {
      url: view.thumbnail,
      alt: view.alt,
      width: view.aspectRatio?.width,
      height: view.aspectRatio?.height,
    };
  }

  if (view.$type === 'app.bsky.embed.external#view' && view.external?.thumb) {
    return {
      url: view.external.thumb,
      alt: view.external.title,
    };
  }

  return null;
}

export function getPostOgImage(post: BskyPost): PostOgImage | null {
  const embed = post.embed as EmbedView | undefined;
  if (!embed) return null;

  const direct = pickFromView(embed);
  if (direct) return direct;

  if (embed.$type === 'app.bsky.embed.recordWithMedia#view') {
    return pickFromView(embed.media);
  }

  return null;
}
