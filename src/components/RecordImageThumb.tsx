'use client';

import { useState } from 'react';

/**
 * A bounded inline image preview for the rich JSON record view. Used for both
 * direct image URLs and blob-backed images (the caller resolves the src).
 *
 * Behaviour:
 *   - Lazy-loaded and `no-referrer` — record fields can point at arbitrary
 *     third-party hosts, so we don't eagerly fetch off-screen images or leak
 *     the referrer to them.
 *   - Fails closed: a URL that isn't actually an image (or 404s) removes the
 *     element instead of leaving a broken-image glyph in the field table.
 *   - Click opens the full image in a new tab; `stopPropagation` keeps that
 *     click from tripping the surrounding copy-on-click / expand affordances.
 */
export default function RecordImageThumb({
  src,
  alt = '',
}: {
  src: string;
  alt?: string;
}) {
  const [failed, setFailed] = useState(false);
  if (failed) return null;
  return (
    <a
      href={src}
      target="_blank"
      rel="noreferrer noopener"
      onClick={(e) => e.stopPropagation()}
      title="Open full image in a new tab"
      style={{
        display: 'inline-block',
        marginTop: '0.5rem',
        maxWidth: '100%',
        lineHeight: 0,
      }}
    >
      {/* Plain <img> (not next/image) so arbitrary record image hosts render
          without being enumerated in next.config's remotePatterns. */}
      <img
        src={src}
        alt={alt}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        style={{
          display: 'block',
          maxWidth: '100%',
          maxHeight: '320px',
          width: 'auto',
          height: 'auto',
          objectFit: 'contain',
          border: '1px solid var(--border-medium)',
          background: 'var(--bg-tertiary)',
        }}
      />
    </a>
  );
}
