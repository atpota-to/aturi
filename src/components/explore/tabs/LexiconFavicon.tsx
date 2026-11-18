'use client';

import { useState } from 'react';
import { faviconSrcFor } from '@/utils/favicon';

/**
 * The icon of the site a lexicon namespace reverses to (`app.bsky` -> the
 * bsky.app favicon), drawn before a top-level group's name in the collections
 * tree. Served by `/api/favicon`, which reads the site for its declared icons.
 *
 * A namespace that names no site (`a.guestbook`), or whose site has no icon
 * the route can serve, gets a letter tile in the same 14px slot instead, so
 * group names stay aligned whether or not their icon arrived. Decorative: the
 * name beside it already says which namespace this is.
 */
export default function LexiconFavicon({ prefix }: { prefix: string }) {
  const src = faviconSrcFor(prefix);
  // Keyed by src rather than a boolean, so a row reused for another prefix
  // never shows the previous one's state.
  const [loaded, setLoaded] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const showImage = src !== null && failed !== src;
  const labels = prefix.split('.');
  const letter = (labels[1] || labels[0] || '?').charAt(0).toUpperCase();
  return (
    <span
      className="fx-favicon"
      data-state={!showImage ? 'letter' : loaded === src ? 'loaded' : 'loading'}
      aria-hidden
    >
      {showImage ? (
        // Plain <img>: the route already serves a small, cached image, and
        // next/image would add a second hop through the optimizer for it.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt=""
          width={14}
          height={14}
          loading="lazy"
          decoding="async"
          onLoad={() => setLoaded(src)}
          onError={() => setFailed(src)}
        />
      ) : (
        letter
      )}
    </span>
  );
}
