/**
 * Helpers for normalizing Bluesky post image embeds.
 *
 * Bluesky has two image-embed shapes that render identically to a viewer:
 *   - app.bsky.embed.images  (1–4 images) → hydrated as `images#view`, an
 *     `images[]` array whose entries carry `thumb` / `fullsize`.
 *   - app.bsky.embed.gallery (5+ images)  → hydrated as `gallery#view`, an
 *     `items[]` array whose entries carry `thumbnail` / `fullsize`.
 *
 * getEmbedImages collapses both into a single list so every render path
 * (the post preview, parent/quoted posts, recordWithMedia media, and OG
 * image extraction) can treat galleries and classic image embeds the same
 * way instead of branching on each `$type` separately.
 */

export type EmbedDisplayImage = {
  thumb?: string;
  fullsize?: string;
  alt?: string;
  aspectRatio?: { width: number; height: number };
};

type EmbedViewLike =
  | {
      $type?: string;
      images?: Array<{
        thumb?: string;
        fullsize?: string;
        alt?: string;
        aspectRatio?: { width: number; height: number };
      }>;
      items?: Array<{
        thumbnail?: string;
        fullsize?: string;
        alt?: string;
        aspectRatio?: { width: number; height: number };
      }>;
    }
  | null
  | undefined;

/**
 * Normalize a hydrated image embed view into a flat list of displayable
 * images, transparently supporting both `app.bsky.embed.images#view` and
 * the newer `app.bsky.embed.gallery#view`. Returns null for any other (or
 * missing) embed view, so callers can use it as a presence check too.
 */
export function getEmbedImages(view: EmbedViewLike): EmbedDisplayImage[] | null {
  if (!view || typeof view !== 'object') return null;

  if (
    view.$type === 'app.bsky.embed.images#view' &&
    Array.isArray(view.images) &&
    view.images.length > 0
  ) {
    return view.images.map((img) => ({
      thumb: img.thumb,
      fullsize: img.fullsize,
      alt: img.alt,
      aspectRatio: img.aspectRatio,
    }));
  }

  if (
    view.$type === 'app.bsky.embed.gallery#view' &&
    Array.isArray(view.items) &&
    view.items.length > 0
  ) {
    return view.items.map((item) => ({
      // Gallery view images expose the thumbnail under `thumbnail`, where
      // the classic images view uses `thumb` — normalize to `thumb`.
      thumb: item.thumbnail,
      fullsize: item.fullsize,
      alt: item.alt,
      aspectRatio: item.aspectRatio,
    }));
  }

  return null;
}
