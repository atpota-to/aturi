'use client';

import { useLayoutEffect, useRef } from 'react';

/** The chosen option, however a toggle marks it. */
const CHOSEN = ':scope > [aria-pressed="true"], :scope > .is-active';

/**
 * The sliding thumb of a segmented control. Render it as the first child of
 * the track and pass the chosen value as `active`: it measures the chosen
 * option and sits under it, then slides to the next one when `active`
 * changes. While it is placed the track carries `data-thumb`, and the
 * options' own chosen fills step aside for it (explore.css, "Sliding
 * thumb"); until then, and without script, each option paints its own.
 *
 * One component for the four toggles that share the segmented look
 * (.fn-segmented, .settings-seg, .waypoint-layout-toggle), so none of them
 * changes how it marks its chosen option.
 */
export default function SegmentThumb({ active }: { active: unknown }) {
  const ref = useRef<HTMLSpanElement>(null);
  const placed = useRef(false);

  useLayoutEffect(() => {
    const thumb = ref.current;
    const track = thumb?.parentElement;
    if (!thumb || !track) return;

    const place = (instant: boolean) => {
      // data-thumb first: it makes the track the options' offset parent.
      track.setAttribute('data-thumb', '');
      const on = track.querySelector<HTMLElement>(CHOSEN);
      if (!on || on.offsetWidth === 0) {
        track.removeAttribute('data-thumb');
        placed.current = false;
        return;
      }
      if (instant) thumb.style.transition = 'none';
      thumb.style.transform = `translate(${on.offsetLeft}px, ${on.offsetTop}px)`;
      thumb.style.width = `${on.offsetWidth}px`;
      thumb.style.height = `${on.offsetHeight}px`;
      if (instant) {
        void thumb.offsetWidth;
        thumb.style.transition = '';
      }
      placed.current = true;
    };

    place(!placed.current);

    // Fonts landing, wrapping and breakpoints move the options without a
    // change of choice: follow them without sliding. The first callback
    // reports the size just measured and is skipped.
    let size = `${track.offsetWidth}x${track.offsetHeight}`;
    const ro = new ResizeObserver(() => {
      const next = `${track.offsetWidth}x${track.offsetHeight}`;
      if (next === size) return;
      size = next;
      place(true);
    });
    ro.observe(track);
    return () => ro.disconnect();
  }, [active]);

  return <span ref={ref} className="fn-seg-thumb" aria-hidden />;
}
