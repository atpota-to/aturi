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
 * Identify an image by its magic bytes, for hosts that don't declare a usable
 * content-type. `video.bsky.app` serves post video thumbnails
 * (`.../thumbnail.jpg`) as `application/octet-stream`, so trusting the header
 * alone dropped the thumbnail from every video post's card and left a hole in
 * the layout.
 *
 * Deliberately narrow: only the formats @vercel/og can actually decode are
 * recognized, so a webp or avif body still gets rejected rather than being
 * waved through on a permissive header.
 */
function sniffImageMime(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  const b = bytes;
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x38) return 'image/gif';
  return null;
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
    const declaredType = rawContentType.split(';')[0].trim().toLowerCase();

    const buffer = await response.arrayBuffer();

    // Trust the header when it names a format we can decode; otherwise fall
    // back to the file's own magic bytes before giving up.
    const contentType = OG_SUPPORTED_MIME_TYPES.has(declaredType)
      ? declaredType
      : sniffImageMime(new Uint8Array(buffer.slice(0, 12)));

    if (!contentType) {
      // Silently drop unsupported formats (webp/avif/etc.). Including them would
      // blow up image generation with "l is not iterable" inside @vercel/og.
      console.warn(
        `[og-image] Skipping image with unsupported content-type "${declaredType}" (${url})`
      );
      return '';
    }

    const base64 = Buffer.from(buffer).toString('base64');
    return `data:${contentType};base64,${base64}`;
  } catch (error) {
    console.error('[og-image] Failed to fetch image:', url, error);
    return '';
  } finally {
    clearTimeout(timeoutId);
  }
}
