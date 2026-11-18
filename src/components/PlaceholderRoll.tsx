'use client';

import { useEffect, useRef, useState } from 'react';
import { motionAllowed } from '@/lib/motion';

const HOLD_MS = 2600;

/**
 * A placeholder that cycles through things the field accepts, each line
 * rolling up as the next rolls in. It holds still while `paused` (the field
 * focused or filled), while it is off screen or the tab is hidden, and for
 * reduced motion, where the caller keeps the plain placeholder instead.
 *
 * Purely visual: the input's accessible name carries the description, so
 * this is aria-hidden. Lines after the first are examples and set in mono.
 */
export default function PlaceholderRoll({
  items,
  paused,
  className,
}: {
  items: readonly string[];
  paused: boolean;
  className?: string;
}) {
  // The line on show, and the one rolling away above it (null once gone).
  const [{ index, leaving }, setRoll] = useState<{ index: number; leaving: number | null }>({
    index: 0,
    leaving: null,
  });
  const ref = useRef<HTMLSpanElement>(null);
  const visible = useRef(true);

  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === 'undefined') return;
    const io = new IntersectionObserver(([entry]) => {
      visible.current = entry.isIntersecting;
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (paused) return;
    const timer = window.setInterval(() => {
      if (document.hidden || !visible.current || !motionAllowed()) return;
      setRoll((r) => ({ index: (r.index + 1) % items.length, leaving: r.index }));
    }, HOLD_MS);
    return () => window.clearInterval(timer);
  }, [paused, items.length]);

  return (
    <span ref={ref} className={className} aria-hidden>
      {leaving !== null && (
        <span
          key={`out-${leaving}`}
          className="fn-roll-line is-out"
          data-example={leaving > 0 || undefined}
          onAnimationEnd={() => setRoll((r) => ({ ...r, leaving: null }))}
        >
          {items[leaving]}
        </span>
      )}
      <span
        key={`in-${index}`}
        className={leaving !== null ? 'fn-roll-line is-in' : 'fn-roll-line'}
        data-example={index > 0 || undefined}
      >
        {items[index]}
      </span>
    </span>
  );
}
