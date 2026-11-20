'use client';

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Check, ChevronDown, Search } from 'lucide-react';
import { appsMatching, foldApps, type RelationApp } from '@/utils/atproto/backlinkRelations';
import { formatCount } from '@/utils/ufos/format';
import { AppMark } from './BacklinkRows';

/**
 * Narrowing a relationship's list to one app. "All" and the apps holding
 * most of the links are chips; the long tail folds behind a "N more" chip
 * that opens a searchable list under the row (foldApps has the numbers).
 * Once an app from that list is chosen, the chip names it, so the row
 * still says what the list is narrowed to.
 *
 * The list opens in the flow rather than floating over the page: the
 * panel is hosted in scrolling panes and in a card that clips its
 * overflow, where a popover would be cut off.
 */
export default function BacklinkAppFilter({
  apps,
  total,
  selected,
  whole,
  onSelect,
}: {
  /** The relationship's apps, most links first. */
  apps: readonly RelationApp[];
  /** Links in the whole relationship, for the All chip. */
  total: number;
  /** The app the list is narrowed to, by key. */
  selected: string | null;
  /** Nothing is narrowed: the All chip is pressed. */
  whole: boolean;
  onSelect: (app: string | null) => void;
}) {
  const { shown, folded } = useMemo(() => foldApps(apps), [apps]);
  const picked = folded.find((a) => a.app.key === selected) ?? null;
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const matches = useMemo(() => appsMatching(folded, query), [folded, query]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const moreRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelId = useId();
  const listId = useId();

  function close(refocus: boolean) {
    setOpen(false);
    setQuery('');
    setActive(0);
    if (refocus) moreRef.current?.focus();
  }

  function choose(app: string | null) {
    onSelect(app);
    close(true);
  }

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  // A click anywhere else puts the list away, as it would a menu.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current?.contains(e.target as Node)) return;
      setOpen(false);
      setQuery('');
      setActive(0);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  // Keep the option the arrows reached in view inside the scrolling list.
  useEffect(() => {
    if (open) document.getElementById(`${listId}-${active}`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active, listId]);

  function onKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    const n = matches.length;
    if (e.key === 'Escape') {
      e.preventDefault();
      close(true);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (matches[active]) choose(matches[active].app.key);
    } else if (n && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      e.preventDefault();
      setActive((i) => (e.key === 'ArrowDown' ? (i + 1) % n : (i - 1 + n) % n));
    } else if (n && (e.key === 'Home' || e.key === 'End') && !query) {
      e.preventDefault();
      setActive(e.key === 'Home' ? 0 : n - 1);
    }
  }

  return (
    <div ref={wrapRef} className="fx-bl-filter">
      <div className="fx-bl-apps" role="group" aria-label="Filter by app">
        {/* Where the panel is narrow, the chips scroll sideways in one line
            and "N more" stays put at its end, so the way to the rest of
            the apps never scrolls out of sight. */}
        <div className="fx-bl-apps-scroll">
          <button type="button" className="fx-chip" aria-pressed={whole} onClick={() => choose(null)}>
            All <span className="fx-bl-chip-count">{formatCount(total)}</span>
          </button>
          {shown.map(({ app, count }) => (
            <button
              key={app.key}
              type="button"
              className="fx-chip"
              aria-pressed={selected === app.key}
              onClick={() => choose(app.key)}
            >
              <AppMark app={app} />
              {app.name} <span className="fx-bl-chip-count">{formatCount(count)}</span>
            </button>
          ))}
        </div>
        {folded.length > 0 && (
          <button
            ref={moreRef}
            type="button"
            className="fx-chip fx-bl-more-apps"
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            data-picked={picked ? '' : undefined}
            title={picked ? `Narrowed to ${picked.app.name}. Choose another app.` : `${folded.length} more apps`}
            onClick={() => (open ? close(false) : setOpen(true))}
          >
            {picked ? (
              <>
                <AppMark app={picked.app} />
                {picked.app.name} <span className="fx-bl-chip-count">{formatCount(picked.count)}</span>
              </>
            ) : (
              <>{folded.length} more</>
            )}
            <ChevronDown size={13} aria-hidden className="fx-bl-more-apps-chev" />
          </button>
        )}
      </div>

      {open && (
        <div id={panelId} className="fx-bl-picker">
          <label className="fx-field">
            <Search size={14} aria-hidden />
            <span className="fx-sr">Find an app</span>
            <input
              ref={inputRef}
              type="search"
              role="combobox"
              aria-expanded
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={matches[active] ? `${listId}-${active}` : undefined}
              placeholder={`Find among ${folded.length} more apps`}
              value={query}
              autoComplete="off"
              spellCheck={false}
              onChange={(e) => {
                setQuery(e.target.value);
                setActive(0);
              }}
              onKeyDown={onKeyDown}
            />
          </label>
          {matches.length ? (
            <ul id={listId} role="listbox" className="fx-bl-picker-list" aria-label="More apps">
              {matches.map(({ app, count }, i) => (
                <li
                  key={app.key}
                  id={`${listId}-${i}`}
                  role="option"
                  aria-selected={i === active}
                  data-current={app.key === selected || undefined}
                  className="fx-bl-picker-item"
                  onMouseDown={(e) => e.preventDefault()}
                  onMouseEnter={() => setActive(i)}
                  onClick={() => choose(app.key)}
                >
                  <AppMark app={app} />
                  <span className="fx-bl-picker-name">{app.name}</span>
                  {app.key === selected && <Check size={13} aria-label="current" className="fx-bl-picker-check" />}
                  <span className="fx-bl-picker-count">{formatCount(count)}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="fx-bl-picker-empty">No app matches “{query.trim()}”.</p>
          )}
        </div>
      )}
    </div>
  );
}
