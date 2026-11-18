'use client';

import { useCallback, useMemo, useState, type CSSProperties, type KeyboardEvent } from 'react';
import {
  dateFromKey,
  dayKey,
  intensityLevel,
  intensityThresholds,
  windowDays,
  type ActivityWindow,
} from '@/lib/tools/activity';

/**
 * A year of days as a grid: one column a week, Sunday at the top, each day
 * shaded by how much was written on it.
 *
 * Presentational, so anything with day counts can draw one: the activity
 * calendar tool gives it a full year and a way to pick a day, and a host
 * with less room can pass `compact` and a shorter window (buildWindow takes
 * a week count) for a strip with no labels.
 *
 * The shades are mixed from the theme's accent, so they follow both themes
 * and every colour scheme (tool-pages.css). Shade alone never carries a
 * count: every day has its date and number as its name, for a pointer's
 * tooltip and for a screen reader alike.
 *
 * With `onSelect` the days are buttons, and the grid is one stop in the tab
 * order: the arrow keys move between days (left and right by a week, up and
 * down by a day), Home and End go to the first and last day, and Enter or
 * Space picks one. Without it the grid is a single image with a summary for
 * its name.
 */

const WEEKDAY_LABELS: [row: number, label: string][] = [
  [1, 'Mon'],
  [3, 'Wed'],
  [5, 'Fri'],
];

const LEVELS = [0, 1, 2, 3, 4] as const;

const DAY_NAME = new Intl.DateTimeFormat(undefined, {
  weekday: 'long',
  day: 'numeric',
  month: 'long',
  year: 'numeric',
});

export function formatDayName(key: string): string {
  return DAY_NAME.format(dateFromKey(key));
}

function countPhrase(count: number, unit: string): string {
  if (count === 0) return `no ${unit}s`;
  return `${count.toLocaleString()} ${unit}${count === 1 ? '' : 's'}`;
}

export type ActivityHeatmapProps = {
  window: ActivityWindow;
  /** Count per local day key (`YYYY-MM-DD`). Days left out count as zero. */
  days: Record<string, number>;
  /** The grid's accessible name, e.g. "Records written by @alice.example.com". */
  label: string;
  /** What is being counted, singular. */
  unit?: string;
  selected?: string | null;
  /** Called with a day key, or null when the selected day is picked again. */
  onSelect?: (key: string | null) => void;
  /** Smaller cells, and no weekday labels or legend. */
  compact?: boolean;
};

export default function ActivityHeatmap({
  window,
  days,
  label,
  unit = 'record',
  selected = null,
  onSelect,
  compact = false,
}: ActivityHeatmapProps) {
  const keys = useMemo(() => windowDays(window), [window]);
  const thresholds = useMemo(() => intensityThresholds(keys.map((key) => days[key] ?? 0)), [keys, days]);
  const names = useMemo(() => new Map(keys.map((key) => [key, formatDayName(key)])), [keys]);
  const total = useMemo(() => keys.reduce((sum, key) => sum + (days[key] ?? 0), 0), [keys, days]);

  // The one day in the tab order. It follows the arrow keys, and starts on
  // the selected day or, failing that, today.
  const [cursor, setCursor] = useState<string | null>(null);
  const tabStop = cursor && names.has(cursor) ? cursor : selected && names.has(selected) ? selected : window.todayKey;

  // A phone shows a few months at a time; open on the most recent ones.
  // Stable, so it runs when the scroller mounts and not on every render,
  // which would pull a reader who had scrolled back to the right again.
  const openAtEnd = useCallback((el: HTMLDivElement | null) => {
    if (el) el.scrollLeft = el.scrollWidth;
  }, []);

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const target = (event.target as HTMLElement).closest<HTMLElement>('[data-day]');
    const from = target?.dataset.day;
    if (!from) return;
    const step =
      event.key === 'ArrowLeft' ? -7 : event.key === 'ArrowRight' ? 7 : event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    let next: string | null = null;
    if (step !== 0) {
      const date = dateFromKey(from);
      const moved = dayKey(new Date(date.getFullYear(), date.getMonth(), date.getDate() + step));
      next = names.has(moved) ? moved : null;
    } else if (event.key === 'Home') {
      next = keys[0];
    } else if (event.key === 'End') {
      next = keys[keys.length - 1];
    } else {
      return;
    }
    event.preventDefault();
    if (!next || next === from) return;
    setCursor(next);
    event.currentTarget.querySelector<HTMLElement>(`[data-day="${next}"]`)?.focus();
  }

  const interactive = Boolean(onSelect);
  const firstColumn = compact ? 1 : 2;
  const gridStyle = { '--fn-tool-activity-weeks': window.weeks.length } as CSSProperties;

  return (
    <div className="fn-tool-activity-map" data-compact={compact || undefined}>
      <div className="fn-tool-activity-scroll" ref={openAtEnd}>
        <div
          className="fn-tool-activity-grid"
          style={gridStyle}
          role={interactive ? 'group' : 'img'}
          aria-label={interactive ? label : `${label}: ${countPhrase(total, unit)} in the last 12 months`}
          onKeyDown={interactive ? onKeyDown : undefined}
        >
          {window.months.map((month) => (
            <span
              key={`${month.label}-${month.column}`}
              aria-hidden
              className="fn-tool-activity-month"
              style={{ gridColumn: month.column + firstColumn }}
            >
              {month.label}
            </span>
          ))}
          {!compact && (
            <span aria-hidden className="fn-tool-activity-weekdays">
              {WEEKDAY_LABELS.map(([row, text]) => (
                <span key={text} style={{ gridRow: row + 1 }}>
                  {text}
                </span>
              ))}
            </span>
          )}
          {window.weeks.map((week, column) =>
            week.map((key, row) => {
              if (!key) return null;
              const count = days[key] ?? 0;
              const name = `${names.get(key)}: ${countPhrase(count, unit)}`;
              const place = { gridColumn: column + firstColumn, gridRow: row + 2 };
              const level = intensityLevel(count, thresholds);
              return interactive ? (
                <button
                  key={key}
                  type="button"
                  className="fn-tool-activity-day"
                  data-day={key}
                  data-level={level}
                  style={place}
                  title={name}
                  aria-label={name}
                  aria-pressed={selected === key}
                  tabIndex={key === tabStop ? 0 : -1}
                  onClick={() => {
                    setCursor(key);
                    onSelect?.(selected === key ? null : key);
                  }}
                />
              ) : (
                <span
                  key={key}
                  aria-hidden
                  className="fn-tool-activity-day"
                  data-level={level}
                  style={place}
                  title={name}
                />
              );
            }),
          )}
        </div>
      </div>
      {!compact && (
        <div className="fn-tool-activity-legend">
          {interactive && <span className="fn-tool-activity-hint">Pick a day to see what was written on it.</span>}
          <span aria-hidden className="fn-tool-activity-scale">
            Less
            {LEVELS.map((level) => (
              <span key={level} className="fn-tool-activity-day" data-level={level} />
            ))}
            More
          </span>
        </div>
      )}
    </div>
  );
}
