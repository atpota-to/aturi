'use client';

import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { animate } from '@/lib/motion';

const DIGITS = '0123456789';

/**
 * A number whose digits roll. Each digit is a column of 0–9 behind a window
 * one line tall (motion.css, "Numbers"), so when the value changes only the
 * digits that changed move, the rightmost first. With `rollIn`, every digit
 * also rolls up from 0 on first appearance, for a figure that arrives after
 * a placeholder.
 *
 * The digits are aria-hidden beside a visually hidden copy of the text, so
 * a screen reader reads the number once, not ten columns. Server and client
 * render the same markup: each column's resting position is an inline
 * transform, so there is nothing to reconcile on hydration.
 */
export default function Odometer({
  value,
  format = (n) => n.toLocaleString('en-US'),
  rollIn = false,
  duration,
  className,
}: {
  /** A number, or text already formatted (signs, decimals and units roll past). */
  value: number | string;
  format?: (n: number) => string;
  rollIn?: boolean;
  /** Milliseconds per roll; quicker for figures that update every second. */
  duration?: number;
  className?: string;
}) {
  const text = typeof value === 'string' ? value : format(value);
  const chars = Array.from(text);
  const ref = useRef<HTMLSpanElement>(null);

  // Roll in from 0, once, on mount.
  useLayoutEffect(() => {
    if (!rollIn || !ref.current) return;
    const cols = Array.from(ref.current.querySelectorAll<HTMLElement>('.fn-odo-col'));
    cols.forEach((col, i) =>
      animate(col, [{ transform: 'translateY(0%)' }, { transform: col.style.transform }], {
        duration: duration ?? 700,
        delay: (cols.length - 1 - i) * 30,
      }),
    );
    // Mount only: later changes roll through the columns' own transition.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <span
      ref={ref}
      className={className ? `fn-odo ${className}` : 'fn-odo'}
      style={duration ? ({ '--odo-dur': `${duration}ms` } as CSSProperties) : undefined}
    >
      <span className="fn-sr-only">{text}</span>
      <span aria-hidden className="fn-odo-digits">
        {chars.map((ch, i) => {
          // Keyed from the right, so the ones column stays the ones column
          // when the number grows a digit.
          const key = chars.length - 1 - i;
          if (!DIGITS.includes(ch)) {
            return (
              <span key={key} className="fn-odo-mark">
                {ch}
              </span>
            );
          }
          return (
            <span key={key} className="fn-odo-cell">
              <span className="fn-odo-ghost">{ch}</span>
              <span
                className="fn-odo-col"
                style={{
                  transform: `translateY(${-Number(ch) * 10}%)`,
                  transitionDelay: `${key * 30}ms`,
                }}
              >
                {Array.from(DIGITS).map((d) => (
                  <span key={d}>{d}</span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}
