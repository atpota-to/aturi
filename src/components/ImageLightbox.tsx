'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, ExternalLink, X } from 'lucide-react';
import { sanitizeUrl } from '@/utils/sanitize';
import type { EmbedDisplayImage } from '@/utils/postEmbeds';

/**
 * Full-screen viewer for a post's image embeds. Tapping a thumbnail used to
 * navigate away to the raw CDN blob; this keeps the reader in the post.
 *
 * Notes on the implementation:
 *   - Native <dialog> + showModal(), matching the command palette and the
 *     shortcuts sheet: we inherit the top layer, the focus trap, ::backdrop,
 *     and Escape-to-close for free.
 *   - The thumbnail is shown blurred as an instant placeholder while the
 *     fullsize blob is preloaded, so the image never pops in from blank.
 *   - Multi-image embeds are browsable in place: arrow keys, on-screen arrows,
 *     and horizontal swipes. A downward swipe dismisses (phone convention).
 *   - Clicking the image toggles a 1:1 zoom, which is what screenshots of text
 *     — a good chunk of what gets posted — actually need.
 *   - Clicks and Enter/Space are stopped at the dialog root: these grids render
 *     inside quoted/parent post cards that are themselves click-to-navigate,
 *     and the dialog is a DOM descendant of those cards.
 */

/** Distance (px) a horizontal swipe must cover to page to the next image. */
const SWIPE_NAV_PX = 60;
/** Distance (px) a downward swipe must cover to dismiss. */
const SWIPE_DISMISS_PX = 120;
/** Movement (px) before a drag commits to an axis. */
const AXIS_LOCK_PX = 10;

type DragState = { axis: 'x' | 'y'; dx: number; dy: number };

export default function ImageLightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: EmbedDisplayImage[];
  /** Index into `images` of the image being shown. */
  index: number;
  onIndexChange: (next: number) => void;
  onClose: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [preloaded, setPreloaded] = useState<{ src: string; ok: boolean } | null>(null);
  const [zoomed, setZoomed] = useState(false);
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  /** Keep the live gesture (ref, read by handlers) and the rendered offset in step. */
  const trackDrag = (next: DragState | null) => {
    dragRef.current = next;
    setDrag(next);
  };

  const count = images.length;
  const image = images[index];
  const fullsize = sanitizeUrl(image?.fullsize);
  const thumb = sanitizeUrl(image?.thumb);
  // sanitizeUrl collapses anything unsafe to '#' — fall back rather than
  // pointing an <img> at a placeholder href.
  const hasFullsize = fullsize !== '#';
  const hasThumb = thumb !== '#';
  // With no thumbnail there is nothing to stand in for the fullsize, so skip
  // the placeholder pass entirely. Keying the resolution off the URL (rather
  // than a boolean reset in an effect) means paging to the next image is
  // back to "not yet loaded" on the same render as the new src.
  const needsPreload = hasFullsize && hasThumb;
  const resolved = preloaded?.src === fullsize;
  const fullsizeReady = !needsPreload || (resolved && preloaded.ok);
  // A fullsize blob that 404s leaves the thumbnail up, but sharp rather than
  // blurred — a permanent blur reads as a stuck loading state.
  const stillLoading = needsPreload && !resolved;
  const displaySrc = fullsizeReady ? fullsize : thumb;

  // Always dismiss through close(): the browser restores focus to whatever
  // opened the dialog (the thumbnail), which unmounting alone would not.
  const dismiss = useCallback(() => {
    const dlg = dialogRef.current;
    if (dlg?.open) dlg.close();
    else onClose();
  }, [onClose]);

  const go = useCallback(
    (delta: number) => {
      if (count < 2) return;
      setZoomed(false);
      onIndexChange((index + delta + count) % count);
    },
    [count, index, onIndexChange],
  );

  // Open on mount; the caller unmounts us to close.
  useEffect(() => {
    const dlg = dialogRef.current;
    if (dlg && !dlg.open) dlg.showModal();
  }, []);

  // Escape (and any other native close path) routes back through onClose.
  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    const handleClose = () => onClose();
    dlg.addEventListener('close', handleClose);
    return () => dlg.removeEventListener('close', handleClose);
  }, [onClose]);

  // The backdrop covers the page but the page underneath still scrolls, which
  // is disorienting on a phone where a swipe is also a lightbox gesture.
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.overflow;
    root.style.overflow = 'hidden';
    return () => {
      root.style.overflow = previous;
    };
  }, []);

  // Swap the blurred thumbnail for the fullsize blob once it has decoded.
  useEffect(() => {
    if (!needsPreload) return;
    let cancelled = false;
    const preload = new window.Image();
    const settle = (ok: boolean) => () => {
      if (!cancelled) setPreloaded({ src: fullsize, ok });
    };
    preload.onload = settle(true);
    preload.onerror = settle(false);
    preload.src = fullsize;
    return () => {
      cancelled = true;
    };
  }, [fullsize, needsPreload]);

  // Warm the neighbours so paging through a gallery is instant.
  useEffect(() => {
    if (count < 2 || !fullsizeReady) return;
    for (const delta of [1, -1]) {
      const neighbour = sanitizeUrl(images[(index + delta + count) % count]?.fullsize);
      if (neighbour === '#') continue;
      const preload = new window.Image();
      preload.src = neighbour;
    }
  }, [images, index, count, fullsizeReady]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Enter/Space on our buttons must not reach the click-to-navigate card
    // this dialog is nested inside.
    e.stopPropagation();
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      go(1);
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      go(-1);
    }
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (zoomed || e.touches.length !== 1) return;
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  const onTouchMove = (e: React.TouchEvent) => {
    const start = touchStart.current;
    if (!start || e.touches.length !== 1) return;
    const dx = e.touches[0].clientX - start.x;
    const dy = e.touches[0].clientY - start.y;

    // Lock to whichever axis the finger commits to first, then stay there.
    const locked = dragRef.current;
    const axis = locked?.axis ?? (Math.abs(dx) > Math.abs(dy) ? 'x' : 'y');
    if (!locked && Math.abs(dx) < AXIS_LOCK_PX && Math.abs(dy) < AXIS_LOCK_PX) return;
    if (axis === 'y' && dy < 0) return; // only downward dismisses

    trackDrag({
      axis,
      // A single-image embed has nowhere to swipe to; rubber-band instead.
      dx: axis === 'x' ? (count > 1 ? dx : dx * 0.25) : 0,
      dy: axis === 'y' ? dy : 0,
    });
  };

  const onTouchEnd = () => {
    // The gesture is accumulated in a ref, not in `drag`: touch handlers run
    // in the same React batch, so the state set by touchmove isn't guaranteed
    // to be readable by the time touchend runs.
    const current = dragRef.current;
    touchStart.current = null;
    trackDrag(null);
    if (!current) return;
    if (current.axis === 'x' && Math.abs(current.dx) > SWIPE_NAV_PX) {
      go(current.dx < 0 ? 1 : -1);
    } else if (current.axis === 'y' && current.dy > SWIPE_DISMISS_PX) {
      dismiss();
    }
  };

  if (!image) return null;

  const dragOffset = drag ? `translate3d(${drag.dx}px, ${drag.dy}px, 0)` : undefined;
  const dragOpacity = drag?.axis === 'y' ? Math.max(0.3, 1 - drag.dy / 500) : 1;

  return (
    <dialog
      ref={dialogRef}
      className="lightbox"
      aria-label={count > 1 ? `Image ${index + 1} of ${count}` : 'Image'}
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
    >
      <div className="lightbox-bar">
        {count > 1 && <span className="lightbox-count">{index + 1} / {count}</span>}
        <div className="lightbox-bar-actions">
          {hasFullsize && (
            <a
              className="lightbox-btn"
              href={fullsize}
              target="_blank"
              rel="noopener noreferrer"
              title="Open the original file in a new tab"
            >
              <ExternalLink size={15} aria-hidden />
              <span className="lightbox-btn-label">Original</span>
            </a>
          )}
          <button
            type="button"
            className="lightbox-btn lightbox-btn-icon"
            onClick={dismiss}
            aria-label="Close image viewer"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
      </div>

      <div
        className={`lightbox-stage${zoomed ? ' is-zoomed' : ''}`}
        // Clicking the empty space around the image dismisses; the image and
        // the chrome stop their own clicks.
        onClick={dismiss}
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onTouchCancel={onTouchEnd}
      >
        <div
          className={`lightbox-frame${zoomed ? ' is-zoomed' : ''}`}
          style={{ transform: dragOffset, opacity: dragOpacity }}
        >
          {/* Plain <img>: these are arbitrary PDS/CDN hosts, not next/image
              remotePatterns entries. */}
          <img
            className={`lightbox-img${stillLoading ? ' is-loading' : ''}`}
            src={displaySrc}
            alt={image.alt || ''}
            draggable={false}
            onClick={(e) => {
              e.stopPropagation();
              setZoomed((z) => !z);
            }}
          />
        </div>
      </div>

      {count > 1 && (
        <>
          <button
            type="button"
            className="lightbox-nav lightbox-nav-prev"
            onClick={() => go(-1)}
            aria-label="Previous image"
          >
            <ChevronLeft size={22} aria-hidden />
          </button>
          <button
            type="button"
            className="lightbox-nav lightbox-nav-next"
            onClick={() => go(1)}
            aria-label="Next image"
          >
            <ChevronRight size={22} aria-hidden />
          </button>
        </>
      )}

      {image.alt && (
        <div className="lightbox-alt">
          <p className="lightbox-alt-text">{image.alt}</p>
        </div>
      )}
    </dialog>
  );
}
