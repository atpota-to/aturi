'use client';

import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { Ban, ChevronDown, ChevronUp, ChevronsDownUp, ChevronsUpDown, Crosshair, EyeOff, Pin, Search, Users, X } from 'lucide-react';
import { PIN_SLOTS, REPLY_ORDER_LABELS, postMatches, type ReplyOrder } from '@/lib/threadInsights';
import { fmt, thumb } from './shared';

/** One account in the People list. */
export type PersonRow = {
  did: string;
  name: string;
  handle?: string;
  avatar?: string;
  /** Posts by them in the thread. */
  posts: number;
  /** People in the thread they're in a block with, either way. */
  blocks: number;
  /** Their replies left out of the thread. */
  cut: number;
  op: boolean;
};

export type Layers = {
  /** Every block between people in the thread, drawn as a line, not only a pinned or picked account's. */
  blocks: boolean;
  /** Replies left out of the thread, drawn where they would be. */
  cut: boolean;
  /** While searching or with someone pinned, everything else is faded back. */
  spotlight: boolean;
};

export const pinColor = (slot: number) => `var(--g-pin-${slot + 1})`;

/** A pinned account's mark: its colour and number, so the colour is never the only cue. */
export function PinMark({ slot }: { slot: number }) {
  return (
    <span className="fx-tx-pinmark" style={{ background: pinColor(slot) }} aria-hidden>
      {slot + 1}
    </span>
  );
}

const ORDERS = Object.keys(REPLY_ORDER_LABELS) as ReplyOrder[];

/**
 * The thread explorer's toolbar: search the thread, pin the people to
 * trace, reorder and fold the tree, and choose what the drawing adds on
 * top of it. Everything it changes is the explorer's own state; this only
 * draws the controls.
 */
export default function ThreadToolbar({
  searchRef,
  query,
  onQuery,
  matches,
  matchAt,
  onStep,
  people,
  pins,
  onTogglePin,
  onJumpPin,
  order,
  onOrder,
  onExpandAll,
  onCollapseAll,
  layers,
  onLayer,
  summary,
}: {
  searchRef: RefObject<HTMLInputElement | null>;
  query: string;
  onQuery: (q: string) => void;
  matches: number;
  /** The match being shown, from 0, or -1 before the first step. */
  matchAt: number;
  onStep: (by: 1 | -1) => void;
  people: PersonRow[];
  pins: string[];
  onTogglePin: (did: string) => void;
  onJumpPin: (did: string) => void;
  order: ReplyOrder;
  onOrder: (o: ReplyOrder) => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  layers: Layers;
  onLayer: (key: keyof Layers, on: boolean) => void;
  summary: ReactNode;
}) {
  const byDid = useMemo(() => new Map(people.map((p) => [p.did, p])), [people]);
  const searching = query.trim().length > 0;
  return (
    <div className="fx-tx-bar" role="toolbar" aria-label="Thread tools">
      <div className="fx-tx-search" data-active={searching || undefined}>
        <Search size={14} aria-hidden className="fx-tx-search-icon" />
        <input
          ref={searchRef}
          type="search"
          value={query}
          placeholder="Search posts and people"
          aria-label="Search the thread’s posts, names and handles. Start with @ for handles only."
          onChange={(e) => onQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              if (matches) onStep(e.shiftKey ? -1 : 1);
            } else if (e.key === 'Escape' && query) {
              // Clears the search first; a second Esc closes the explorer.
              e.stopPropagation();
              onQuery('');
            }
          }}
        />
        {searching && (
          <>
            <span className="fx-tx-search-count" role="status" aria-live="polite">
              {matches ? `${matchAt < 0 ? '–' : fmt(matchAt + 1)} of ${fmt(matches)}` : 'No matches'}
            </span>
            <button type="button" className="fx-tx-icon" onClick={() => onStep(-1)} disabled={!matches} aria-label="Previous match">
              <ChevronUp size={14} aria-hidden />
            </button>
            <button type="button" className="fx-tx-icon" onClick={() => onStep(1)} disabled={!matches} aria-label="Next match">
              <ChevronDown size={14} aria-hidden />
            </button>
          </>
        )}
      </div>

      <PeoplePicker people={people} pins={pins} onTogglePin={onTogglePin} />

      {pins.length > 0 && (
        <ul className="fx-tx-pins" aria-label="Pinned">
          {pins.map((did, slot) => {
            const p = byDid.get(did);
            const name = p?.handle ? `@${p.handle}` : (p?.name ?? did);
            return (
              <li key={did} className="fx-tx-pin" style={{ borderColor: pinColor(slot) }}>
                <button
                  type="button"
                  className="fx-tx-pin-go"
                  onClick={() => onJumpPin(did)}
                  title={`Go to ${name}’s next post`}
                >
                  <PinMark slot={slot} />
                  <span>{name}</span>
                </button>
                <button type="button" className="fx-tx-icon" onClick={() => onTogglePin(did)} aria-label={`Unpin ${name}`}>
                  <X size={12} aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <span className="fx-tx-bar-group">
        <label className="fx-tx-select">
          <span className="fx-tx-visually-hidden">Order replies by</span>
          <select value={order} onChange={(e) => onOrder(e.target.value as ReplyOrder)}>
            {ORDERS.map((o) => (
              <option key={o} value={o}>
                {REPLY_ORDER_LABELS[o]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className="fx-graph-tool" onClick={onExpandAll} title="Open every reply in the thread">
          <ChevronsUpDown size={14} aria-hidden />
          <span className="fx-tx-tool-label">Expand all</span>
        </button>
        <button type="button" className="fx-graph-tool" onClick={onCollapseAll} title="Fold the thread to its first replies">
          <ChevronsDownUp size={14} aria-hidden />
          <span className="fx-tx-tool-label">Collapse</span>
        </button>
      </span>

      <span className="fx-tx-bar-group" role="group" aria-label="Show">
        <Toggle on={layers.blocks} onChange={(on) => onLayer('blocks', on)} label="Blocks" title="Draw every block between people in the thread, not only a pinned or picked account’s">
          <Ban size={14} aria-hidden />
        </Toggle>
        <Toggle on={layers.cut} onChange={(on) => onLayer('cut', on)} label="Left out" title="Show the replies Bluesky leaves out of this thread, where they would be">
          <EyeOff size={14} aria-hidden />
        </Toggle>
        <Toggle
          on={layers.spotlight}
          onChange={(on) => onLayer('spotlight', on)}
          label="Spotlight"
          title="While searching or with someone pinned, fade back everything else"
        >
          <Crosshair size={14} aria-hidden />
        </Toggle>
      </span>

      <div className="fx-tx-summary">{summary}</div>
    </div>
  );
}

function Toggle({
  on,
  onChange,
  label,
  title,
  children,
}: {
  on: boolean;
  onChange: (on: boolean) => void;
  label: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <button type="button" className="fx-graph-tool fx-tx-toggle" aria-pressed={on} data-on={on || undefined} onClick={() => onChange(!on)} title={title}>
      {children}
      <span className="fx-tx-tool-label">{label}</span>
    </button>
  );
}

/**
 * Everyone who posted, most posts first, to pin. A pinned account keeps a
 * colour and a number while it's pinned; up to PIN_SLOTS at once.
 */
function PeoplePicker({
  people,
  pins,
  onTogglePin,
}: {
  people: PersonRow[];
  pins: string[];
  onTogglePin: (did: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const boxRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  useEffect(() => {
    if (!open) return undefined;
    filterRef.current?.focus();
    const onDown = (e: PointerEvent) => {
      if (!boxRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  const shown = useMemo(
    () => (filter.trim() ? people.filter((p) => postMatches({ text: '', handle: p.handle, displayName: p.name }, filter)) : people),
    [people, filter],
  );
  const full = pins.length >= PIN_SLOTS;

  return (
    <div
      ref={boxRef}
      className="fx-tx-people"
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.stopPropagation();
          setOpen(false);
        }
      }}
    >
      <button
        type="button"
        className="fx-graph-tool"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        onClick={() => setOpen((o) => !o)}
      >
        <Users size={14} aria-hidden />
        <span className="fx-tx-tool-label">People</span>
        <span className="fx-tx-count">{fmt(people.length)}</span>
      </button>
      {open && (
        <div className="fx-tx-pop" id={listId}>
          <input
            ref={filterRef}
            type="search"
            className="fx-tx-pop-filter"
            value={filter}
            placeholder="Find someone"
            aria-label="Find someone in the thread"
            onChange={(e) => setFilter(e.target.value)}
          />
          <p className="fx-tx-pop-note">
            Pin up to {PIN_SLOTS} people to trace their posts through the thread.
          </p>
          <ul className="fx-tx-pop-list">
            {shown.map((p) => {
              const slot = pins.indexOf(p.did);
              const pinned = slot >= 0;
              return (
                <li key={p.did}>
                  <button
                    type="button"
                    className="fx-tx-person"
                    aria-pressed={pinned}
                    disabled={!pinned && full}
                    title={!pinned && full ? `Unpin someone first: up to ${PIN_SLOTS} at once` : undefined}
                    onClick={() => onTogglePin(p.did)}
                  >
                    {p.avatar ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img className="fx-tx-person-face" src={thumb(p.avatar)} alt="" loading="lazy" />
                    ) : (
                      <span className="fx-tx-person-face" aria-hidden>
                        {p.name.replace(/^@/, '').slice(0, 1).toUpperCase()}
                      </span>
                    )}
                    <span className="fx-tx-person-names">
                      <span className="fx-tx-person-name">
                        {p.name}
                        {p.op && <span className="fx-tx-op">OP</span>}
                      </span>
                      <span className="fx-tx-person-sub">
                        {p.handle ? `@${p.handle}` : p.did} · {p.posts} {p.posts === 1 ? 'post' : 'posts'}
                        {p.blocks > 0 && (
                          <span className="fx-tx-person-blocks">
                            {' '}
                            · <Ban size={11} aria-hidden /> {p.blocks} {p.blocks === 1 ? 'block' : 'blocks'}
                          </span>
                        )}
                        {p.cut > 0 && ` · ${p.cut} left out`}
                      </span>
                    </span>
                    {pinned ? <PinMark slot={slot} /> : <Pin size={14} aria-hidden className="fx-tx-person-pin" />}
                  </button>
                </li>
              );
            })}
            {!shown.length && <li className="fx-tx-pop-note">Nobody by that name.</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
