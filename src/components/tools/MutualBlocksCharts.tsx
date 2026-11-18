'use client';

import { useId, useState, type CSSProperties } from 'react';
import { User } from 'lucide-react';
import type { Bin, MutualState, Person } from '@/lib/tools/mutuals';

/**
 * The mutuals' blocks tool's two charts that are not the map: the wall of
 * mutuals that fills in as each one is read, and the distribution of how
 * many mutuals block each account, which is also where the threshold is set.
 */

const nf = new Intl.NumberFormat('en-US');
const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export function who(person: Pick<Person, 'did' | 'handle'>): string {
  return person.handle ? `@${person.handle}` : person.did;
}

/** A round avatar, or a blank one with the person glyph. */
export function Face({ person, size = 32, className }: { person: Person | null; size?: number; className?: string }) {
  const style = { width: size, height: size };
  if (!person?.avatar) {
    return (
      <span className={`fn-tool-avatar fn-tool-mutuals-blank${className ? ` ${className}` : ''}`} style={style} aria-hidden>
        <User size={Math.round(size * 0.5)} />
      </span>
    );
  }
  // A plain <img>, as the other tools draw avatars: next/image would route
  // every avatar through the image optimizer.
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={person.avatar}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      className={`fn-tool-avatar${className ? ` ${className}` : ''}`}
      style={style}
    />
  );
}

/* -------------------------------------------------------------------------- *
 * The wall of mutuals
 * -------------------------------------------------------------------------- */

/** Past this many mutuals the wall is drawn in dots rather than faces. */
const FACES_UP_TO = 160;

function stateTitle(person: Person, state: MutualState): string {
  const name = who(person);
  switch (state.status) {
    case 'queued':
      return `${name}: waiting`;
    case 'reading':
      return `${name}: reading, ${nf.format(state.blocks)} blocks so far`;
    case 'done':
      return `${name}: ${nf.format(state.blocks)} ${state.blocks === 1 ? 'block' : 'blocks'}${
        state.listBlocks ? `, ${state.listBlocks} block ${state.listBlocks === 1 ? 'list' : 'lists'}` : ''
      }`;
    case 'skipped':
      return state.stopped
        ? `${name}: ${state.reason}${state.blocks ? `, ${nf.format(state.blocks)} blocks read` : ''}`
        : `${name}: not read, ${state.reason}`;
  }
}

/** How dark a finished mutual's dot is: its blocks against the most anyone has. */
function level(blocks: number, most: number): number {
  if (blocks === 0 || most === 0) return 0;
  return Math.min(4, 1 + Math.floor((Math.log(blocks + 1) / Math.log(most + 1)) * 3.999));
}

/**
 * Every mutual, in the order they were found, marked as it is read. A face
 * each while they fit; past that a dot each, shaded by how many accounts it
 * blocks. Choosing one shows only the accounts it blocks.
 */
export function MutualWall({
  mutuals,
  states,
  focus,
  onFocus,
}: {
  mutuals: readonly Person[];
  states: readonly MutualState[];
  focus: number | null;
  onFocus: (index: number | null) => void;
}) {
  const faces = mutuals.length <= FACES_UP_TO;
  let most = 0;
  for (const state of states) if (state.status !== 'queued' && state.blocks > most) most = state.blocks;

  return (
    <div className="fn-tool-mutuals-wall" data-dots={faces ? undefined : true}>
      {mutuals.map((person, index) => {
        const state = states[index] ?? { status: 'queued' };
        const blocks = state.status === 'queued' ? 0 : state.blocks;
        const title = stateTitle(person, state);
        const pressed = focus === index;
        return (
          <button
            key={person.did}
            type="button"
            className="fn-tool-mutuals-tile"
            data-status={state.status}
            data-stopped={(state.status === 'skipped' && state.stopped) || undefined}
            data-level={state.status === 'done' ? level(blocks, most) : undefined}
            aria-pressed={pressed}
            aria-label={title}
            title={title}
            disabled={state.status !== 'done' || blocks === 0}
            onClick={() => onFocus(pressed ? null : index)}
          >
            {faces ? <Face person={person} size={28} /> : null}
          </button>
        );
      })}
    </div>
  );
}

/* -------------------------------------------------------------------------- *
 * The distribution
 * -------------------------------------------------------------------------- */

function binLabel(bin: Bin): string {
  return bin.from === bin.to ? nf.format(bin.from) : `${nf.format(bin.from)}–${nf.format(bin.to)}`;
}

function binSentence(bin: Bin): string {
  const accounts = bin.count === 1 ? '1 account is' : `${nf.format(bin.count)} accounts are`;
  if (bin.from === bin.to) {
    return `${accounts} blocked by exactly ${nf.format(bin.from)} ${bin.from === 1 ? 'mutual' : 'mutuals'}`;
  }
  return `${accounts} blocked by ${binLabel(bin)} mutuals`;
}

/** Gridlines on the log scale: 1, 10, 100… up to the tallest column. */
function logTicks(max: number): number[] {
  const ticks: number[] = [];
  for (let t = 1; t <= max; t *= 10) ticks.push(t);
  return ticks;
}

/**
 * How many accounts are blocked by each number of mutuals, as columns, with
 * the threshold set on it. The counts fall away steeply, thousands blocked
 * by one and a handful by many, so the height is on a log scale and the
 * gridlines say so. Columns at or past the threshold are filled; choosing a
 * column moves the threshold to it, as does the slider underneath.
 */
export function Distribution({
  bins,
  highest,
  threshold,
  onThreshold,
  caption,
  min = 1,
}: {
  bins: readonly Bin[];
  highest: number;
  threshold: number;
  onThreshold: (value: number) => void;
  /** The line above the chart while no column is pointed at. */
  caption: string;
  /** The lowest threshold that can be chosen. */
  min?: number;
}) {
  const [hover, setHover] = useState<Bin | null>(null);
  const sliderId = useId();
  const tallest = bins.reduce((m, bin) => Math.max(m, bin.count), 0);
  const scale = (count: number) => (count <= 0 ? 0 : Math.log10(count + 1) / Math.log10(tallest + 1));
  const labelEvery = Math.max(1, Math.ceil(bins.length / 10));
  const top = Math.max(min, highest);
  const value = Math.min(threshold, top);
  // Where the thumb sits, for the filled part of the track.
  const fill = top > min ? ((value - min) / (top - min)) * 100 : 100;

  return (
    <div className="fn-tool-mutuals-dist">
      <p className="fn-tool-mutuals-dist-caption" aria-live="polite">
        {hover ? binSentence(hover) : caption}
      </p>
      <div className="fn-tool-mutuals-plot">
        <div className="fn-tool-mutuals-grid" aria-hidden>
          {logTicks(tallest).map((tick) => (
            <span key={tick} style={{ bottom: `${scale(tick) * 100}%` }}>
              <b>{compact.format(tick)}</b>
            </span>
          ))}
        </div>
        <div className="fn-tool-mutuals-cols" onPointerLeave={() => setHover(null)}>
          {bins.map((bin, i) => {
            const on = bin.to >= threshold;
            return (
              <button
                key={bin.from}
                type="button"
                className="fn-tool-mutuals-col"
                data-on={on || undefined}
                data-edge={bin.from <= threshold && threshold <= bin.to ? true : undefined}
                aria-label={`${binSentence(bin)}. Set the threshold to ${bin.from}.`}
                onPointerEnter={() => setHover(bin)}
                onFocus={() => setHover(bin)}
                onBlur={() => setHover(null)}
                onClick={() => onThreshold(Math.max(min, bin.from))}
              >
                <span className="fn-tool-mutuals-barbox">
                  <span className="fn-tool-mutuals-bar" style={{ height: `${scale(bin.count) * 100}%` }} />
                </span>
                <span className="fn-tool-mutuals-tick" aria-hidden>
                  {i % labelEvery === 0 || i === bins.length - 1 ? binLabel(bin) : ''}
                </span>
              </button>
            );
          })}
        </div>
      </div>
      <p className="fn-tool-mutuals-axis" aria-hidden>
        Mutuals blocking the account
      </p>
      <div className="fn-tool-mutuals-slider">
        <label htmlFor={sliderId}>
          Blocked by at least <strong>{nf.format(threshold)}</strong>
        </label>
        <input
          id={sliderId}
          type="range"
          min={min}
          max={top}
          step={1}
          value={value}
          style={{ '--fn-tool-mutuals-fill': `${fill}%` } as CSSProperties}
          onChange={(event) => onThreshold(Number(event.target.value))}
        />
        <span aria-hidden>{nf.format(top)}</span>
      </div>
    </div>
  );
}
