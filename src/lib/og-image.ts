/**
 * Mime types that @vercel/og's image decoder can base64-decode from a data URI.
 * webp and avif are NOT supported here — passing them causes
 * "TypeError: l is not iterable" inside the edge runtime bundle.
 */
const OG_SUPPORTED_MIME_TYPES = new Set([
  'image/png',
  'image/apng',
  'image/jpeg',
  'image/gif',
  'image/svg+xml',
]);

/**
 * Rewrite a Bluesky CDN avatar URL to its smaller thumbnail variant.
 *
 * Bluesky's CDN serves two avatar sizes from the same blob:
 *   - /img/avatar/plain/<did>/<cid>            → ~1000×1000
 *   - /img/avatar_thumbnail/plain/<did>/<cid>  → 128×128
 *
 * The thumbnail variant is small enough that messaging clients (iMessage,
 * Signal, Discord) render link previews as a compact "square thumbnail" card
 * instead of a giant hero image — matching how native bsky.app post links
 * unfurl. See bskyweb's `avatar_thumbnail` filter for the canonical version.
 */
export function toBskyAvatarThumbnail(url: string | undefined | null): string | undefined {
  if (!url) return undefined;
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'cdn.bsky.app') return url;
    parsed.pathname = parsed.pathname.replace('/img/avatar/plain/', '/img/avatar_thumbnail/plain/');
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Rewrite Bluesky CDN image URLs so the CDN returns JPEG instead of WebP.
 * The bsky CDN honours an `@jpeg` suffix on the blob CID. We only touch URLs
 * where it's safe to append the suffix (no existing format suffix and no query).
 */
function normalizeBskyImageUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== 'cdn.bsky.app') {
      return url;
    }

    // Path looks like: /img/<kind>/plain/<did>/<cid>[@format]
    const path = parsed.pathname;
    if (path.includes('@')) {
      return url;
    }

    parsed.pathname = `${path}@jpeg`;
    return parsed.toString();
  } catch {
    return url;
  }
}

/**
 * Fetch a remote image and return a base64 data URI suitable for <img src> inside
 * @vercel/og's ImageResponse. Returns an empty string when the image is missing,
 * times out, or is in a format that @vercel/og cannot decode (e.g. webp/avif).
 */
export async function fetchImageAsDataUrl(
  rawUrl: string | undefined | null,
  { timeoutMs = 3000 }: { timeoutMs?: number } = {}
): Promise<string> {
  if (!rawUrl) return '';

  const url = normalizeBskyImageUrl(rawUrl);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return '';

    const rawContentType = response.headers.get('content-type') || 'image/jpeg';
    const contentType = rawContentType.split(';')[0].trim().toLowerCase();

    if (!OG_SUPPORTED_MIME_TYPES.has(contentType)) {
      // Silently drop unsupported formats (webp/avif/etc.). Including them would
      // blow up image generation with "l is not iterable" inside @vercel/og.
      console.warn(
        `[og-image] Skipping image with unsupported content-type "${contentType}" (${url})`
      );
      return '';
    }

    const buffer = await response.arrayBuffer();
    const base64 = Buffer.from(buffer).toString('base64');
    return `data:${contentType};base64,${base64}`;
  } catch (error) {
    console.error('[og-image] Failed to fetch image:', url, error);
    return '';
  } finally {
    clearTimeout(timeoutId);
  }
}
