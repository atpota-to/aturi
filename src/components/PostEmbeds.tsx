'use client';

import { useState } from 'react';
import { sanitizeUrl } from '@/utils/sanitize';
import type { EmbedDisplayImage } from '@/utils/postEmbeds';
import ImageLightbox from './ImageLightbox';

/**
 * Shared renderers for a post's embeds. PostPreview shows embeds in four
 * contexts — the main post, a quoted post, the reply parent, and the media
 * half of a recordWithMedia embed — which previously each carried their own
 * copy of the external-link card and video player. They collapse to two style
 * bundles:
 *
 *   - `full`    — the main post and recordWithMedia media (large, with the
 *                 link description, heavier shadow, hover transition).
 *   - `compact` — quoted posts and the reply parent (smaller, no description,
 *                 lighter shadow, and click-stop so opening the embed doesn't
 *                 also trigger the surrounding card's navigation).
 *
 * Only the margins and the thumbnail/video max-height vary per call site.
 */

type EmbedVariant = 'full' | 'compact';

/**
 * Grid for a post's image embeds. Renders the classic images embed (1–4) and
 * the gallery embed (5+) identically — callers pass a normalized list from
 * getEmbedImages. Galleries (5+) lay out in 3 columns; smaller sets keep the
 * original 1/2-column behaviour.
 */
export function EmbedImageGrid({
  images,
  gap,
  marginTop,
  marginBottom,
  maxHeight,
  background,
  boxShadow,
  limit,
  stopPropagation,
}: {
  images: EmbedDisplayImage[];
  gap: string;
  marginTop?: string;
  marginBottom?: string;
  maxHeight: string;
  background: string;
  boxShadow: string;
  /** Cap the number of images shown (e.g. the parent preview shows 2). */
  limit?: number;
  /** Stop click propagation so opening an image doesn't trigger card nav. */
  stopPropagation?: boolean;
}) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  const shown = typeof limit === 'number' ? images.slice(0, limit) : images;
  const columns =
    shown.length === 1 ? '1fr' : shown.length >= 5 ? 'repeat(3, 1fr)' : 'repeat(2, 1fr)';

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: columns, gap, marginTop, marginBottom }}>
        {shown.map((image, i) => {
          const sanitizedFullsize = sanitizeUrl(image.fullsize);
          const sanitizedThumb = sanitizeUrl(image.thumb);

          return (
            <a
              key={i}
              // The href stays real so ⌘/middle-click, "open image in new tab",
              // and long-press-to-save keep working — a plain click is
              // intercepted below and opens the lightbox instead.
              href={sanitizedFullsize}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => {
                if (stopPropagation) e.stopPropagation();
                // Leave modified clicks to the browser.
                if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
                e.preventDefault();
                setLightboxIndex(i);
              }}
              style={{ display: 'block', overflow: 'hidden', cursor: 'zoom-in' }}
            >
              <img
                src={sanitizedThumb}
                alt={image.alt}
                style={{
                  width: '100%',
                  height: 'auto',
                  maxHeight,
                  objectFit: 'cover',
                  background,
                  display: 'block',
                  border: '1px solid var(--border-medium)',
                  boxShadow,
                }}
              />
            </a>
          );
        })}
      </div>

      {lightboxIndex !== null && (
        // The viewer browses the whole embed even where the grid is capped
        // (the reply parent shows two thumbnails of a four-image post).
        <ImageLightbox
          images={images}
          index={lightboxIndex}
          onIndexChange={setLightboxIndex}
          onClose={() => setLightboxIndex(null)}
        />
      )}
    </>
  );
}

/** External-link card (thumbnail + title + [description] + hostname). */
export function ExternalEmbedCard({
  external,
  variant,
  marginTop,
  marginBottom,
  thumbMaxHeight,
}: {
  external: { uri?: string; thumb?: string; title?: string; description?: string };
  variant: EmbedVariant;
  marginTop?: string;
  marginBottom?: string;
  thumbMaxHeight: string;
}) {
  const uri = sanitizeUrl(external.uri);
  if (uri === '#') return null; // Skip invalid/unsafe URLs
  const thumb = sanitizeUrl(external.thumb);
  const full = variant === 'full';

  let hostname = '';
  try {
    hostname = new URL(uri).hostname;
  } catch {
    // leave blank on malformed URLs
  }

  return (
    <a
      href={uri}
      target="_blank"
      rel="noopener noreferrer"
      onClick={full ? undefined : (e) => e.stopPropagation()}
      className={full ? 'external-link-card' : undefined}
      style={{
        display: 'block',
        marginTop,
        marginBottom,
        border: '1px solid var(--border-medium)',
        textDecoration: 'none',
        color: 'inherit',
        overflow: 'hidden',
        ...(full ? { transition: 'border-color 0.2s ease' } : { fontSize: '0.75rem' }),
        boxShadow: full ? '0 4px 12px rgba(0, 0, 0, 0.3)' : '0 2px 8px rgba(0, 0, 0, 0.2)',
      }}
    >
      {external.thumb && (
        <img
          src={thumb}
          alt=""
          style={{
            width: '100%',
            height: 'auto',
            maxHeight: thumbMaxHeight,
            objectFit: 'cover',
            background: full ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
            display: 'block',
            borderBottom: '1px solid var(--border-medium)',
          }}
        />
      )}
      <div style={{ padding: full ? '1rem' : '0.5rem' }}>
        <div style={{ fontWeight: '600', marginBottom: '0.25rem', color: 'var(--text-primary)' }}>
          {external.title}
        </div>
        {full && (
          <div style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
            {external.description}
          </div>
        )}
        <div
          style={{
            fontSize: '0.75rem',
            color: 'var(--text-tertiary)',
            ...(full ? { marginTop: '0.5rem' } : {}),
          }}
        >
          {hostname}
        </div>
      </div>
    </a>
  );
}

/** HLS video player with poster and (full variant) an alt caption. */
export function VideoEmbed({
  video,
  variant,
  marginTop,
  marginBottom,
  videoMaxHeight,
}: {
  video: { playlist?: string; thumbnail?: string; alt?: string };
  variant: EmbedVariant;
  marginTop?: string;
  marginBottom?: string;
  videoMaxHeight: string;
}) {
  const playlist = sanitizeUrl(video.playlist);
  if (playlist === '#') return null; // Skip invalid/unsafe video URLs
  const thumbnail = sanitizeUrl(video.thumbnail);
  const full = variant === 'full';

  return (
    <div
      onClick={full ? undefined : (e) => e.stopPropagation()}
      style={{
        ...(full ? { position: 'relative' } : {}),
        marginTop,
        marginBottom,
        background: full ? 'var(--bg-tertiary)' : 'var(--bg-secondary)',
        overflow: 'hidden',
        border: '1px solid var(--border-medium)',
        boxShadow: full ? '0 4px 12px rgba(0, 0, 0, 0.4)' : '0 2px 8px rgba(0, 0, 0, 0.3)',
      }}
    >
      <video
        controls
        poster={thumbnail}
        style={{ width: '100%', maxHeight: videoMaxHeight, display: 'block' }}
      >
        <source src={playlist} type="application/x-mpegURL" />
        Your browser does not support the video tag.
      </video>
      {full && video.alt && (
        <div
          style={{
            padding: '0.5rem',
            fontSize: '0.875rem',
            color: 'var(--text-tertiary)',
            background: 'var(--bg-secondary)',
          }}
        >
          {video.alt}
        </div>
      )}
    </div>
  );
}
