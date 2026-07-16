/**
 * Image detection for the rich JSON record preview.
 *
 * Records reference images two ways, and both should render a thumbnail in the
 * structured field view:
 *
 *   1. A direct HTTP(S) URL in a string field (e.g. arena mirror's `image.src`,
 *      an external `thumbnail`, etc.). Rendered straight from the URL.
 *   2. An AT Protocol blob with an image `mimeType` (e.g. a profile avatar, or
 *      arena mirror's `image.blob`). Rendered via `com.atproto.sync.getBlob`
 *      against the owning PDS, so it needs the repo's DID + PDS endpoint.
 *
 * These are pure helpers (no React, no fetch) so both the preview component and
 * any future caller share one definition of "is this field an image".
 */

/** Path extensions we're willing to render inline as an image. */
const IMAGE_EXT_RE =
  /\.(jpe?g|png|gif|webp|avif|svg|bmp|ico|apng|jfif|heic|heif|tiff?)$/i;

/**
 * If `value` is a string that points at a renderable image over HTTP(S),
 * return the URL; otherwise null. The extension is checked against the URL's
 * pathname only, so query strings (arena appends `?<timestamp>`) and fragments
 * don't defeat the match. The raw URL is returned un-sanitized — callers pass
 * it through `sanitizeUrl` before putting it in the DOM.
 */
export function imageUrlFromValue(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const s = value.trim();
  if (!/^https?:\/\//i.test(s)) return null;
  let pathname: string;
  try {
    pathname = new URL(s).pathname;
  } catch {
    return null;
  }
  return IMAGE_EXT_RE.test(pathname) ? s : null;
}

export type ImageBlobRef = { cid: string; mimeType: string };

/**
 * If `value` is an AT Protocol blob describing an image, return its CID +
 * mimeType; otherwise null. Handles both the current blob shape
 * (`{ $type: 'blob', ref: { $link }, mimeType }`) and the legacy inline-CID
 * shape (`{ cid, mimeType }`). Non-image blobs (video, etc.) return null so we
 * never try to render them as `<img>`.
 */
export function imageBlobFromValue(value: unknown): ImageBlobRef | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const mimeType = typeof obj.mimeType === 'string' ? obj.mimeType : null;
  if (!mimeType || !mimeType.startsWith('image/')) return null;

  const ref = obj.ref;
  if (ref && typeof ref === 'object') {
    const link = (ref as Record<string, unknown>)['$link'];
    if (typeof link === 'string' && link) return { cid: link, mimeType };
  }
  // Legacy shape: the CID sits directly on the blob.
  if (typeof obj.cid === 'string' && obj.cid) return { cid: obj.cid, mimeType };
  return null;
}

/**
 * Build the public `com.atproto.sync.getBlob` URL that serves a blob's bytes
 * straight from the owning PDS.
 */
export function getBlobUrl(pds: string, did: string, cid: string): string {
  const params = new URLSearchParams({ did, cid });
  return `${pds.replace(/\/$/, '')}/xrpc/com.atproto.sync.getBlob?${params}`;
}

/** Pull the DID authority out of an `at://did:.../…` URI (null if not a DID). */
export function didFromAtUri(uri: string): string | null {
  const match = /^at:\/\/(did:[^/]+)/.exec(uri);
  return match ? match[1] : null;
}
