'use client';

import { Fragment, useMemo } from 'react';
import Link from 'next/link';
import { Radio } from 'lucide-react';
import { SkeletonBar } from '../../skeletons/primitives';
import { homeScopeFor } from '@/lib/lexiconExplorer';
import {
  baseFor,
  MAX_USAGE_DEPTH,
  measureFieldUsage,
  mergeSamples,
  percentText,
  usageByPath,
  type DeclaredField,
  type FieldUsage,
  type FieldUsageSample,
} from '@/lib/lexiconFieldUsage';
import { parseLexiconRef } from '@/lib/lexiconSchema';
import { formatTidRelative } from '@/utils/atproto/tid';
import type { AddressFor } from './LexiconRail';
import { useRecentRecords } from './useLexiconData';
import { LIVE_MAX, LIVE_SECONDS, useLiveSample, type LiveSample } from './useLiveSample';

/**
 * Field usage in the schema tab: how often records set each field, measured
 * over the newest records UFOs sampled from the firehose (useRecentRecords,
 * the same ones the Records tab lists, so this asks for nothing new when
 * that has loaded). A few dozen records is a small sample, so the visitor
 * can widen it with records Jetstream sends as they're written
 * (useLiveSample). Every number says what it was counted over, and a share
 * is never rounded to 0% or 100% when it isn't one.
 */

export type UsageState = (
  | { status: 'loading' }
  /** UFOs didn't answer, and Jetstream hasn't added anything. */
  | { status: 'failed'; error: string }
  | {
      status: 'ready';
      sample: FieldUsageSample;
      byPath: Map<string, FieldUsage>;
      /** Where the sample's records came from, each counted once. */
      sources: { ufos: number; jetstream: number };
    }
) & { live: LiveSample; ufosError: string | null };

/** Field usage for a lexicon, or null when `enabled` is off and nothing is asked for. */
export function useFieldUsage(nsid: string, enabled: boolean): UsageState | null {
  const recent = useRecentRecords(enabled ? nsid : null);
  const live = useLiveSample(nsid);
  const data = recent.key === `records|${nsid}` ? recent.data : null;
  const ufosError = data ? null : recent.error;
  const settled = data !== null || ufosError !== null;
  const measured = useMemo(() => {
    if (!settled || (!data && live.records.length === 0)) return null;
    const merged = mergeSamples(data ?? [], live.records);
    const sample = measureFieldUsage(merged);
    return {
      sample,
      byPath: usageByPath(sample.fields),
      sources: { ufos: merged.length - live.records.length, jetstream: live.records.length },
    };
  }, [settled, data, live.records]);
  if (!enabled) return null;
  if (measured) return { status: 'ready', ...measured, live, ufosError };
  if (ufosError) return { status: 'failed', error: ufosError, live, ufosError };
  return { status: 'loading', live, ufosError };
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;
}

/** `4m ago`, or `on 2026-10-02` past a fortnight, when formatTidRelative gives a date. */
function seenWhen(ms: number): string {
  const text = formatTidRelative(new Date(ms));
  return text.endsWith('ago') ? text : `on ${text}`;
}

function secondsText(seconds: number): string {
  return `${Math.max(1, Math.round(seconds))}s`;
}

/** What the shares were counted over, above the fields they're shown on, with the way to widen it. */
export function UsageNote({ state }: { state: UsageState }) {
  if (state.status === 'loading') {
    return (
      <div className="fx-lx-use-note" aria-hidden>
        <SkeletonBar width="min(22rem, 80%)" height="0.6rem" />
      </div>
    );
  }
  return (
    <div className="fx-lx-use-head">
      <p className="fx-lx-use-note">
        <SampleText state={state} />
      </p>
      <LiveControl live={state.live} />
    </div>
  );
}

function SampleText({ state }: { state: Exclude<UsageState, { status: 'loading' }> }) {
  if (state.status === 'failed') {
    return <>Field usage needs records, and the UFOs API didn’t answer ({state.error}). Jetstream can still catch new ones.</>;
  }
  const { sample, sources, live } = state;
  if (sample.records === 0) {
    return <>UFOs hasn’t sampled any records of this lexicon recently. Jetstream can catch new ones as they’re written.</>;
  }
  const tail = (
    <>
      , from {plural(sample.accounts, 'account')}
      {sample.oldest !== null && <>, the oldest seen {seenWhen(sample.oldest)}</>}.
    </>
  );
  if (sources.jetstream === 0) {
    return (
      <>
        Usage is the share of the {plural(sample.records, 'newest record')} UFOs sampled that set each field{tail}
      </>
    );
  }
  return (
    <>
      Usage is the share of {plural(sample.records, 'record')} that set each field:{' '}
      {sources.ufos > 0 ? `${sources.ufos.toLocaleString('en-US')} UFOs sampled and ` : ''}
      {sources.jetstream.toLocaleString('en-US')} from Jetstream over {secondsText(live.seconds)}
      {state.ufosError ? ' (UFOs didn’t answer)' : ''}
      {tail}
    </>
  );
}

/**
 * Listen to Jetstream for more records, or stop listening. What the last
 * run found is said beside it, politely, for a screen reader.
 */
function LiveControl({ live }: { live: LiveSample }) {
  const status =
    live.phase === 'listening'
      ? `${plural(live.records.length, 'record')} from Jetstream so far`
      : live.last
        ? live.last.added > 0
          ? `Added ${plural(live.last.added, 'record')} in ${secondsText(live.last.seconds)}.`
          : live.last.errored
            ? 'Jetstream didn’t connect.'
            : `Nothing new was written in ${secondsText(live.last.seconds)}.`
        : null;
  return (
    <div className="fx-lx-use-live">
      {live.phase === 'listening' ? (
        <button type="button" className="fx-btn fx-btn-sm" aria-pressed onClick={live.stop} title="Stop and keep what arrived">
          <span className="fx-dot" data-live aria-hidden />
          Stop listening
        </button>
      ) : (
        <button
          type="button"
          className="fx-btn fx-btn-sm"
          onClick={live.start}
          title={`Add the records written in the next ${LIVE_SECONDS} seconds, up to ${LIVE_MAX.toLocaleString('en-US')}, as Jetstream sends them`}
        >
          <Radio size={13} aria-hidden />
          {live.last ? `Listen ${LIVE_SECONDS}s more` : `Sample Jetstream for ${LIVE_SECONDS}s`}
        </button>
      )}
      {status && (
        <span className="fx-lx-use-live-status" aria-live="polite">
          {status}
        </span>
      )}
    </div>
  );
}

function parentOf(path: string): string | null {
  const dot = path.lastIndexOf('.');
  return dot === -1 ? null : path.slice(0, dot);
}

/**
 * A field's share of the records that could have set it, as a bar and a
 * percentage. A required field some records leave out says how many, since
 * those records don't match the schema.
 */
export function UsageMeter({ state, path, required = false }: { state: UsageState; path: string; required?: boolean }) {
  if (state.status === 'loading') {
    return (
      <span className="fx-lx-use" aria-hidden>
        <SkeletonBar width="5.5rem" height="0.5rem" />
      </span>
    );
  }
  // Deeper than anything is counted, so a missing count is not a zero.
  if (state.status === 'failed' || state.sample.records === 0 || path.split('.').length > MAX_USAGE_DEPTH) return null;
  const { sample, byPath } = state;
  const usage = byPath.get(path);
  const records = usage?.records ?? 0;
  const of = baseFor(path, sample, byPath);
  const parent = parentOf(path);
  // A nested field whose object no sampled record sets has nothing to be a share of.
  if (of === 0) {
    return (
      <span className="fx-lx-use" data-none title={`No sampled record sets ${parent}`}>
        <span className="fx-lx-use-pct">–</span>
      </span>
    );
  }
  const missing = required ? of - records : 0;
  const over = parent ? `${plural(of, 'sampled record')} with ${parent}` : plural(of, 'sampled record');
  const label =
    records === 0
      ? `Set in none of the ${over}`
      : `Set in ${records.toLocaleString('en-US')} of the ${over}, from ${plural(usage?.accounts ?? 0, 'account')}` +
        (missing > 0 ? `. Required, but missing from ${missing.toLocaleString('en-US')}` : '');
  return (
    <span className="fx-lx-use" data-none={records === 0 || undefined} data-gap={missing > 0 || undefined} title={label}>
      <span className="fn-sr-only">{label}</span>
      <span className="fx-lx-use-bar" aria-hidden>
        <span style={{ width: `${(records / of) * 100}%` }} />
      </span>
      <span className="fx-lx-use-pct" aria-hidden>
        {percentText(records, of)}
      </span>
      {missing > 0 && (
        <span className="fx-lx-use-gap" aria-hidden>
          missing from {missing.toLocaleString('en-US')}
        </span>
      )}
    </span>
  );
}

/** The kinds of value a field held, an object's `$type` opening that lexicon. */
function Kinds({ kinds, nsid, addressFor }: { kinds: string[]; nsid: string; addressFor: AddressFor }) {
  return (
    <span className="fx-lx-field-type">
      {kinds.map((kind, i) => {
        const ref = kind.includes('.') || kind.startsWith('#') ? parseLexiconRef(kind, nsid) : null;
        return (
          <Fragment key={kind}>
            {i > 0 && <span className="fx-lx-type-word">or</span>}
            {ref && !ref.local ? (
              <Link
                href={addressFor({ scope: homeScopeFor(ref.nsid), nsid: ref.nsid })}
                prefetch={false}
                className="fx-lx-reflink"
                title={`Open ${ref.nsid}`}
              >
                {ref.label}
              </Link>
            ) : (
              <code className="fx-lx-type">{ref ? ref.label : kind}</code>
            )}
          </Fragment>
        );
      })}
    </span>
  );
}

/** Rows for fields seen in records, with what they held and how often, nested objects inside their field. */
function ObservedTable({
  fields,
  state,
  nsid,
  addressFor,
}: {
  fields: FieldUsage[];
  state: UsageState;
  nsid: string;
  addressFor: AddressFor;
}) {
  return (
    <dl className="fx-lx-fields">
      {fields.map((field) => (
        <div key={field.path} className="fx-lx-field">
          <dt>
            <code className="fx-lx-field-name">{field.name}</code>
            <UsageMeter state={state} path={field.path} />
          </dt>
          <dd>
            <Kinds kinds={field.kinds} nsid={nsid} addressFor={addressFor} />
            {field.children.length > 0 && (
              <div className="fx-lx-nested">
                <ObservedTable fields={field.children} state={state} nsid={nsid} addressFor={addressFor} />
              </div>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Top-level fields records set that the published schema doesn't declare:
 * left over from an older version, ahead of the published one, or one
 * client's own additions.
 */
export function UndeclaredFields({
  state,
  declared,
  nsid,
  addressFor,
}: {
  state: UsageState;
  declared: Map<string, DeclaredField>;
  nsid: string;
  addressFor: AddressFor;
}) {
  if (state.status !== 'ready') return null;
  const extra = state.sample.fields.filter((f) => !declared.has(f.path));
  if (extra.length === 0) return null;
  return (
    <div className="fx-lx-section fx-lx-undeclared">
      <h4 className="fx-lx-section-title">
        Not in the schema <span className="fx-lx-h-count">{extra.length}</span>
      </h4>
      <p className="fx-lx-use-note">Sampled records set these, but the published schema doesn’t declare them.</p>
      <ObservedTable fields={extra} state={state} nsid={nsid} addressFor={addressFor} />
    </div>
  );
}

/**
 * With no schema to read, the fields records actually set: the only
 * description of the lexicon there is.
 */
export function FieldsInPractice({ state, nsid, addressFor }: { state: UsageState; nsid: string; addressFor: AddressFor }) {
  const count = state.status === 'ready' ? state.sample.fields.length : null;
  return (
    <section className="fx-lx-def fx-lx-practice" aria-label="Fields in practice">
      <header className="fx-lx-def-head">
        <h3 className="fx-lx-def-name">Fields in practice</h3>
        {count !== null && count > 0 && <span className="fx-lx-h-count">{count}</span>}
      </header>
      <UsageNote state={state} />
      {state.status === 'loading' ? (
        <div aria-hidden>
          {['40%', '55%', '35%', '50%'].map((w, i) => (
            <div key={i} className="fx-lx-field">
              <SkeletonBar width="5rem" height="0.65rem" />
              <SkeletonBar width={w} height="0.65rem" />
            </div>
          ))}
        </div>
      ) : state.status === 'ready' && state.sample.fields.length > 0 ? (
        <ObservedTable fields={state.sample.fields} state={state} nsid={nsid} addressFor={addressFor} />
      ) : null}
    </section>
  );
}
