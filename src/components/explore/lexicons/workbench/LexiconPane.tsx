'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight, Check, Copy, Pin, Radio } from 'lucide-react';
import { Skeleton } from '@/components/SkeletonLoader';
import AppearIn from '../../AppearIn';
import { SkeletonBar } from '../../skeletons/primitives';
import LexiconFavicon from '../../tabs/LexiconFavicon';
import { AppSiteLink, Credit, DeltaPill, Nsid, Segmented, Sparkline } from '../primitives';
import { homeScopeFor, type LexiconLocation } from '@/lib/lexiconExplorer';
import { statForMetric, type Metric } from '@/utils/ufos/config';
import { formatCount } from '@/utils/ufos/format';
import { appDomainFor, groupPrefix, namespaceKey } from '@/utils/ufos/nsid';
import { WINDOWS } from '@/utils/ufos/windows';
import { useLexiconPins, type AddressFor } from './LexiconRail';
import { METRIC_WORD, METRICS } from './LexiconLists';
import { peekKeyOf, RecordRow, RecordRowsSkeleton } from './LexiconRecords';
import SchemaView, { schemaKind, useSchema } from './SchemaView';
import { useProfiles } from './useDidLabel';
import { changePct, useLexiconStats, useNamespace, useRecentRecords } from './useLexiconData';

export const LEXICON_TABS = ['overview', 'schema', 'records'] as const;
export type LexiconTab = (typeof LEXICON_TABS)[number];
const TAB_LABELS: Record<LexiconTab, string> = { overview: 'Overview', schema: 'Schema', records: 'Records' };

/** How wide each chart bucket is, by window step (utils/ufos/windows.ts). */
const BUCKET_LABEL: Record<number, string> = { 7200: '2h', 43200: '12h', 86400: 'day' };
const SIBLINGS = 8;
const RECORD_PREVIEW = 8;

/**
 * One lexicon in the workbench's inspector: what it's used for and how
 * much (Overview), what it is (Schema, from the published lexicon) and what
 * people are writing with it (Records). With the full width the three sit
 * side by side rather than behind tabs.
 *
 * The frame is the record inspector's (RecordPane): the NSID and the host's
 * stepping controls in the head, the tabs with the actions beside them, and
 * a body that scrolls.
 */
export default function LexiconPane({
  nsid,
  loc,
  addressFor,
  controls,
  wide,
  tab,
  onTab,
  recordsHref,
}: {
  nsid: string;
  loc: LexiconLocation;
  addressFor: AddressFor;
  controls: ReactNode;
  wide: boolean;
  tab: LexiconTab;
  onTab: (tab: LexiconTab) => void;
  /** The lexicon's recent records, in the main pane. */
  recordsHref: string;
}) {
  const schema = useSchema(nsid);
  const kind = schemaKind(schema);
  const { isPinned, toggle } = useLexiconPins();
  const pinned = isPinned(nsid);

  const actions = (
    <div className="fn-rec-actions">
      <button
        type="button"
        className="fn-rec-btn"
        aria-pressed={pinned}
        data-variant={pinned ? 'primary' : undefined}
        onClick={() => toggle(nsid)}
        aria-label={pinned ? 'Unpin this lexicon' : 'Pin this lexicon'}
        title={pinned ? 'Unpin' : 'Pin, here and in every account’s collections'}
      >
        <Pin size={14} aria-hidden />
        {pinned ? 'Pinned' : 'Pin'}
      </button>
      <CopyNsid nsid={nsid} />
      <Link
        href={`/tools/stream?collection=${encodeURIComponent(nsid)}`}
        prefetch={false}
        className="fn-rec-btn"
        aria-label="Watch in the stream monitor"
        title="Every create, update and delete for this lexicon, live"
      >
        <Radio size={14} aria-hidden />
        Watch
      </Link>
    </div>
  );

  const overview = <Overview nsid={nsid} loc={loc} addressFor={addressFor} schemaDescription={describe(schema)} />;
  const schemaView = <SchemaView nsid={nsid} lookup={schema} addressFor={addressFor} />;
  const records = <RecentRecords nsid={nsid} recordsHref={recordsHref} />;

  return (
    <div className="fn-rec fx-wb-rec fx-lx-insp" data-wide={wide || undefined}>
      <div className="fx-wb-insp-head">
        <LexiconFavicon prefix={namespaceKey(nsid)} />
        <h2 className="fx-wb-insp-rkey fx-lx-insp-nsid" title={nsid}>
          {nsid}
        </h2>
        {kind && (
          <span className="fn-rec-pill fx-lx-kind-pill" data-kind={kind}>
            {kind}
          </span>
        )}
        {wide && actions}
        <div className="fx-wb-insp-ctl">{controls}</div>
      </div>
      {!wide && (
        <div className="fx-wb-insp-bar">
          <Segmented
            ariaLabel="Lexicon sections"
            options={LEXICON_TABS.map((t) => ({ value: t, label: TAB_LABELS[t] }))}
            value={tab}
            onChange={onTab}
          />
          {actions}
        </div>
      )}
      <div className="fx-wb-insp-body">
        {wide ? (
          <div className="fx-lx-wide">
            <div className="fx-lx-wide-col">
              {overview}
              <section className="fx-lx-card" aria-label="Recent records">
                <h3 className="fx-lx-h">Recent records</h3>
                {records}
              </section>
            </div>
            <div className="fx-lx-wide-col">
              <section className="fx-lx-card" aria-label="Schema">
                <h3 className="fx-lx-h">Schema</h3>
                {schemaView}
              </section>
            </div>
          </div>
        ) : (
          <AppearIn key={tab} className="fx-lx-tabpanel">
            {tab === 'overview' ? overview : tab === 'schema' ? schemaView : records}
          </AppearIn>
        )}
      </div>
    </div>
  );
}

function describe(schema: ReturnType<typeof useSchema>): string | null {
  if (schema?.status !== 'found') return null;
  const doc = schema.doc as { description?: unknown; defs?: { main?: { description?: unknown } } } | null;
  const text = doc?.defs?.main?.description ?? doc?.description;
  return typeof text === 'string' && text.trim() ? text.trim() : null;
}

function CopyNsid({ nsid }: { nsid: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="fn-rec-btn"
      data-copied={copied || undefined}
      aria-label={copied ? 'NSID copied' : 'Copy NSID'}
      title="Copy the NSID"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(nsid);
        } catch {
          return;
        }
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1400);
      }}
    >
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      {copied ? 'Copied' : 'Copy'}
    </button>
  );
}

// ─── Overview ────────────────────────────────────────────────────────────────

function Overview({
  nsid,
  loc,
  addressFor,
  schemaDescription,
}: {
  nsid: string;
  loc: LexiconLocation;
  addressFor: AddressFor;
  schemaDescription: string | null;
}) {
  const stats = useLexiconStats(nsid, loc.window);
  const [metric, setMetric] = useState<Metric>(loc.metric);
  const data = stats.key === `stats|${loc.window}|${nsid}` ? stats.data : null;
  const cfg = WINDOWS[loc.window];
  const series = useMemo(() => (data ? data.buckets.map((b) => statForMetric(b, metric)) : null), [data, metric]);
  const group = groupPrefix(nsid);
  const domain = appDomainFor(group);
  const namespaceHref = group.includes('.') ? addressFor({ scope: { kind: 'namespace', prefix: group } }) : null;

  return (
    <div className="fx-lx-overview">
      {schemaDescription && <p className="fx-lx-lead">{schemaDescription}</p>}

      <dl className="fx-lx-facts">
        {namespaceHref && (
          <div>
            <dt>Namespace</dt>
            <dd>
              <Link href={namespaceHref} prefetch={false}>
                <Nsid value={group} />
              </Link>
            </dd>
          </div>
        )}
        {domain && (
          <div>
            <dt>Site</dt>
            <dd>
              <AppSiteLink domain={domain} />
            </dd>
          </div>
        )}
      </dl>

      <div className="fx-lx-window">
        Last {cfg.label} · change against the {cfg.label} before
      </div>
      <div className="fn-stat-grid fx-lx-stats">
        {METRICS.map((m) => {
          const current = data ? statForMetric(data.current, m) : null;
          const prior = data ? statForMetric(data.prior, m) : null;
          const pct = current !== null ? changePct(current, prior) : null;
          return (
            <button
              key={m}
              type="button"
              className="fn-stat fx-lx-stat"
              aria-pressed={metric === m}
              onClick={() => setMetric(m)}
              title={`Chart ${METRIC_WORD[m].toLowerCase()}`}
            >
              <span className="fn-stat-label">{METRIC_WORD[m]}</span>
              <span className="fn-stat-value" title={current !== null ? current.toLocaleString() : undefined}>
                {current === null ? (
                  <Skeleton width="3rem" height="1.1rem" style={{ display: 'inline-block', verticalAlign: 'middle' }} />
                ) : (
                  formatCount(current)
                )}
              </span>
              <span className="fx-lx-stat-delta">
                {current === null ? (
                  <SkeletonBar width="3rem" height="0.5rem" />
                ) : pct !== null ? (
                  <DeltaPill pct={pct} />
                ) : current > 0 ? (
                  <DeltaPill pct={null} />
                ) : null}
              </span>
            </button>
          );
        })}
      </div>

      <div className="fx-lx-chart">
        <div className="fx-lx-chart-head">
          <span>
            {METRIC_WORD[metric]} per {BUCKET_LABEL[cfg.step] ?? `${cfg.step / 3600}h`}
          </span>
        </div>
        <div className="fx-lx-chart-plot">
          {series === null ? (
            <Skeleton width="100%" height="100%" shape="block" />
          ) : series.some((v) => v > 0) ? (
            <Sparkline
              data={series}
              width={600}
              height={120}
              fullWidth
              strokeWidth={2}
              ariaLabel={`${METRIC_WORD[metric]} over the last ${cfg.label}`}
            />
          ) : (
            <p className="fx-lx-chart-empty">No recorded activity in this window.</p>
          )}
        </div>
        {series && series.some((v) => v > 0) ? (
          <div className="fn-chart-axis">
            <span>{cfg.label} ago</span>
            <span>
              low {formatCount(Math.min(...series))} · high {formatCount(Math.max(...series))}
            </span>
            <span>now</span>
          </div>
        ) : (
          series === null && (
            <div className="fn-chart-axis" aria-hidden>
              <SkeletonBar width="2.5rem" height="0.5rem" />
              <SkeletonBar width="7rem" height="0.5rem" />
              <SkeletonBar width="1.75rem" height="0.5rem" />
            </div>
          )
        )}
      </div>

      {group.includes('.') && <Siblings nsid={nsid} group={group} loc={loc} addressFor={addressFor} />}
      <Credit />
    </div>
  );
}

/** The busiest other lexicons beside this one, from the same listing the main pane uses. */
function Siblings({
  nsid,
  group,
  loc,
  addressFor,
}: {
  nsid: string;
  group: string;
  loc: LexiconLocation;
  addressFor: AddressFor;
}) {
  const ns = useNamespace(group, loc.window);
  const siblings = ns.listing?.entries
    .filter((e) => e.kind === 'lexicon' && e.name !== nsid)
    .sort((a, b) => b.counts.dids_estimate - a.counts.dids_estimate)
    .slice(0, SIBLINGS);
  // Already listed beside the inspector, and stepped through with J and K.
  const shownBeside = loc.scope.kind === 'namespace' && loc.scope.prefix === group;
  if (shownBeside || (siblings && siblings.length === 0)) return null;
  return (
    <section className="fx-lx-card" aria-label={`Also in ${group}`}>
      <h3 className="fx-lx-h">
        Also in <code>{group}</code>
      </h3>
      {!siblings ? (
        <SkeletonBar width="60%" height="0.6rem" />
      ) : (
        <ul className="fx-lx-mini">
          {siblings.map((s) => (
            <li key={s.name}>
              <Link href={addressFor({ scope: homeScopeFor(s.name), nsid: s.name })} prefetch={false}>
                <span className="fx-lx-mini-name">{s.name.slice(group.length + 1)}</span>
                <span className="fx-lx-mini-count">
                  {formatCount(s.counts.dids_estimate)} {s.counts.dids_estimate === 1 ? 'account' : 'accounts'}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
      <Link href={addressFor({ scope: { kind: 'namespace', prefix: group } })} prefetch={false} className="fx-lx-more">
        All of {group}
        <ArrowRight size={13} aria-hidden />
      </Link>
    </section>
  );
}

// ─── Records ─────────────────────────────────────────────────────────────────

function RecentRecords({ nsid, recordsHref }: { nsid: string; recordsHref: string }) {
  const recent = useRecentRecords(nsid);
  const shown = recent.key === `records|${nsid}` ? (recent.data?.slice(0, RECORD_PREVIEW) ?? null) : null;
  const profiles = useProfiles(useMemo(() => shown?.map((r) => r.did) ?? [], [shown]));
  return (
    <div className="fx-lx-records">
      {recent.error && !shown ? (
        <p className="explore-error" style={{ margin: 0 }}>
          Couldn’t reach the UFOs API: {recent.error}
        </p>
      ) : !shown ? (
        <RecordRowsSkeleton rows={5} />
      ) : shown.length === 0 ? (
        <p className="fx-lx-schema-note">UFOs hasn’t sampled any records of this lexicon recently.</p>
      ) : (
        <ul className="fx-lx-recs" data-compact>
          {shown.map((r) => (
            <RecordRow key={peekKeyOf(r)} record={r} current={false} profile={profiles(r.did)} />
          ))}
        </ul>
      )}
      <Link href={recordsHref} prefetch={false} className="fx-btn fx-lx-records-all">
        Recent records, with Live
        <ArrowRight size={14} aria-hidden />
      </Link>
    </div>
  );
}
