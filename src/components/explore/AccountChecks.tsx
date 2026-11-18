'use client';

import type { CSSProperties, ReactNode } from 'react';
import Link from 'next/link';
import { Check, ChevronRight, Eye, EyeOff, LoaderCircle, Tags, TriangleAlert, X } from 'lucide-react';
import { labelSourceWords, type DotState, type VisibilitySummary } from '@/lib/tools/accountChecks';
import { formatCount, scanPercent, type ScanProgress } from '@/lib/tools/labels';
import type { IdentityBundle } from '@/utils/atproto/identity';
import { encodeRepo } from '@/utils/atproto/urls';
import { SkeletonBar } from './skeletons/primitives';
import {
  keptFor,
  useAccountChecks,
  useNow,
  type LabelCheckState,
  type VisibilityCheckState,
} from './useAccountChecks';

/**
 * An account's label and visibility checks, as the Explorer shows them
 * everywhere the account is: two rows on the account card, badges on the
 * folded card, and badges beside the Labels and Visibility views in the
 * rail. All of them read useAccountChecks, which shares one run of each
 * check across the page.
 *
 * The rows show the work as it happens. Labels: a placeholder while
 * Bluesky's moderation service answers, then the count climbing as the scan
 * of every labeler answers, with its progress. Visibility: six dots, one per
 * check, each filling as its answer comes back, in whatever order they
 * finish. Then a few words for what was found.
 */

/** Where an account's views are, spelled as the explorer spells the repo. */
export function accountViewHref(identity: IdentityBundle, tab: 'labels' | 'visibility'): string {
  return `/explore/${encodeRepo(identity.handle || identity.did)}?tab=${tab}`;
}

type Tone = 'ok' | 'warn' | 'bad' | 'plain';

const VISIBILITY_TONE: Record<VisibilitySummary['tone'], Tone> = {
  pending: 'plain',
  pass: 'ok',
  info: 'plain',
  warn: 'warn',
  fail: 'bad',
};

function Pill({ tone, icon, children }: { tone: Tone; icon?: ReactNode; children: ReactNode }) {
  return (
    <span className="fx-check-pill" data-tone={tone}>
      {icon}
      {children}
    </span>
  );
}

/** The label count. Keyed by its value, so each change replays its bump. */
function Count({ n, tone }: { n: number; tone?: Tone }) {
  return (
    <span key={n} className="fx-check-count" data-tone={tone}>
      {formatCount(n)}
    </span>
  );
}

/** A count inside a ring that fills with the scan's progress. */
function Ring({ n, progress }: { n: number; progress: ScanProgress | null }) {
  const pct = progress ? scanPercent(progress) : 2;
  return (
    <span className="fx-check-ring" style={{ '--p': `${Math.max(2, pct)}%` } as CSSProperties}>
      <span>{n}</span>
    </span>
  );
}

function Spinner() {
  return <LoaderCircle size={14} className="fn-tool-spin fx-check-spin" aria-hidden />;
}

const DOT_WORDS: Record<DotState, string> = {
  run: 'checking',
  pass: 'pass',
  warn: 'worth a look',
  fail: 'something hidden',
  skip: 'nothing to check',
};

export function Dots({ summary, waiting = false }: { summary: VisibilitySummary | null; waiting?: boolean }) {
  const dots = summary?.dots ?? Array.from({ length: 6 }, () => null);
  const done = summary?.done ?? 0;
  return (
    <span className="fx-check-dots" role="img" aria-label={`${done} of ${dots.length} visibility checks back`}>
      {dots.map((dot, index) => (
        <i
          key={dot?.id ?? index}
          data-state={waiting || !dot ? 'wait' : dot.state}
          title={dot ? `${dot.title}: ${DOT_WORDS[dot.state]}` : undefined}
        />
      ))}
    </span>
  );
}

/* -------------------------------------------------------------------------- *
 * The card's rows
 * -------------------------------------------------------------------------- */

function LabelsRow({ state, href, now }: { state: LabelCheckState; href: string; now: number }) {
  let body: ReactNode;
  let label: string;
  switch (state.kind) {
    case 'asking':
      label = 'Labels: asking Bluesky’s moderation service';
      body = (
        <>
          <SkeletonBar width="56px" height="0.55rem" style={{ flex: 'none' }} />
          <span className="fx-check-sub">Asking Bluesky</span>
        </>
      );
      break;
    case 'scanning': {
      const { summary, progress } = state;
      label = `Labels: ${summary.active} so far, asking every labeler`;
      body = (
        <>
          {summary.moderation.length > 0 && (
            <Pill tone="warn" icon={<TriangleAlert size={12} aria-hidden />}>
              {summary.moderation[0]}
            </Pill>
          )}
          <Count n={summary.active} />
          <span className="fx-check-bar" aria-hidden>
            <span style={{ width: `${progress ? Math.max(2, scanPercent(progress)) : 2}%` }} />
          </span>
          <span className="fx-check-prog">
            {progress ? `${formatCount(progress.checked + progress.failed)} of ${formatCount(progress.total)}` : 'listing…'}
          </span>
        </>
      );
      break;
    }
    case 'done': {
      const { summary, progress, stopped } = state;
      const kept = keptFor(state.settledAt, now);
      const tail = [stopped ? `stopped at ${formatCount(progress.checked)}` : null, kept].filter(Boolean).join(' · ');
      const others = summary.active - 1;
      label =
        summary.active === 0
          ? `Labels: none from ${formatCount(progress.total)} labelers`
          : `Labels: ${summary.active} ${labelSourceWords(summary)}`;
      body =
        summary.moderation.length > 0 ? (
          // A label from Bluesky's own moderation service leads the row,
          // however many others there are (plan D3).
          <>
            <Pill tone="warn" icon={<TriangleAlert size={12} aria-hidden />}>
              {summary.moderation[0]}
            </Pill>
            <span className="fx-check-sub">
              {others > 0 ? `and ${others} other${others === 1 ? '' : 's'}` : 'from Bluesky'}
              {tail ? ` · ${tail}` : ''}
            </span>
          </>
        ) : summary.active === 0 ? (
          // Plain words rather than a zero badge, so nothing reads as a warning.
          <span className="fx-check-sub">
            {stopped ? 'None so far' : `None from ${formatCount(progress.total)} labelers`}
            {tail ? ` · ${tail}` : ''}
          </span>
        ) : (
          <>
            <Count n={summary.active} />
            <span className="fx-check-sub">
              {labelSourceWords(summary)}
              {tail ? ` · ${tail}` : ''}
            </span>
          </>
        );
      break;
    }
    case 'absent':
      label = `Labels: ${state.message}`;
      body =
        state.absence === 'suspended' ? (
          <Pill tone="bad" icon={<EyeOff size={12} aria-hidden />}>
            Bluesky will not show this
          </Pill>
        ) : state.absence === 'deactivated' ? (
          <Pill tone="plain">Deactivated</Pill>
        ) : (
          <span className="fx-check-sub" data-quiet>
            No Bluesky profile
          </span>
        );
      break;
    case 'error':
      label = `Labels: ${state.message}`;
      body = (
        <>
          {state.summary && state.summary.active > 0 && <Count n={state.summary.active} />}
          <span className="fx-check-sub" title={state.message}>
            {state.summary ? 'Scan stopped' : 'Couldn’t ask Bluesky'}
          </span>
        </>
      );
      break;
  }
  return (
    <>
      <Link href={href} prefetch={false} className="fx-check-link" aria-label={label}>
        {body}
        <ChevronRight size={13} className="fx-check-go" aria-hidden />
      </Link>
      {state.kind === 'error' && (
        <button type="button" className="fx-check-retry" onClick={state.retry}>
          Retry
        </button>
      )}
    </>
  );
}

function VisibilityRow({ state, href, now }: { state: VisibilityCheckState; href: string; now: number }) {
  let body: ReactNode;
  let label: string;
  switch (state.kind) {
    case 'waiting':
      label = 'Visibility: starting';
      body = (
        <>
          <Dots summary={null} waiting />
          <span className="fx-check-sub" data-quiet>
            Starting
          </span>
        </>
      );
      break;
    case 'running':
      label = `Visibility: ${state.summary.short}`;
      body = (
        <>
          <Dots summary={state.summary} />
          <span className="fx-check-sub">{state.summary.short}</span>
        </>
      );
      break;
    case 'done': {
      const { summary } = state;
      const tone = VISIBILITY_TONE[summary.tone];
      const kept = keptFor(state.settledAt, now);
      label = `Visibility: ${summary.title}`;
      body = (
        <>
          <Pill
            tone={tone}
            icon={
              tone === 'ok' ? (
                <Check size={12} strokeWidth={2.6} aria-hidden />
              ) : tone === 'warn' ? (
                <TriangleAlert size={12} aria-hidden />
              ) : tone === 'bad' ? (
                <X size={12} strokeWidth={2.6} aria-hidden />
              ) : undefined
            }
          >
            {summary.short}
          </Pill>
          {/* A finding keeps its dots, so it shows which check found it. */}
          {(tone === 'warn' || tone === 'bad') && <Dots summary={summary} />}
          <span
            className="fx-check-sub"
            data-quiet={tone !== 'ok' || undefined}
            data-optional={(tone === 'ok' && !kept) || undefined}
          >
            {[summary.more > 0 ? `+${summary.more} more` : tone === 'ok' ? 'on Bluesky' : null, kept]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </>
      );
      break;
    }
    case 'absent':
      label = state.absence === 'deactivated' ? 'Visibility: deactivated' : 'Visibility: no Bluesky profile';
      body =
        state.absence === 'deactivated' ? (
          <Pill tone="plain">Deactivated</Pill>
        ) : (
          <span className="fx-check-sub" data-quiet>
            No Bluesky profile
          </span>
        );
      break;
    case 'error':
      label = `Visibility: ${state.message}`;
      body = (
        <span className="fx-check-sub" title={state.message}>
          Couldn’t check
        </span>
      );
      break;
  }
  return (
    <>
      <Link href={href} prefetch={false} className="fx-check-link" aria-label={label}>
        {body}
        <ChevronRight size={13} className="fx-check-go" aria-hidden />
      </Link>
      {state.kind === 'error' && (
        <button type="button" className="fx-check-retry" onClick={state.retry}>
          Retry
        </button>
      )}
    </>
  );
}

/**
 * The two rows, for the account card (RepoExplorer's AccountCard), which the
 * workbench rail, the Files rail and Classic's sidebar all draw.
 */
export default function AccountChecks({ identity }: { identity: IdentityBundle }) {
  const { labels, visibility } = useAccountChecks(identity.did);
  const now = useNow();
  return (
    <dl className="fx-dl fx-checks">
      <dt>Labels</dt>
      <dd>
        <LabelsRow state={labels} href={accountViewHref(identity, 'labels')} now={now} />
      </dd>
      <dt>Visibility</dt>
      <dd>
        <VisibilityRow state={visibility} href={accountViewHref(identity, 'visibility')} now={now} />
      </dd>
    </dl>
  );
}

/* -------------------------------------------------------------------------- *
 * Badges
 * -------------------------------------------------------------------------- */

/** The label check in a badge: a spinner, a filling ring, then the count. */
export function LabelBadge({ state }: { state: LabelCheckState }) {
  switch (state.kind) {
    case 'asking':
      return <Spinner />;
    case 'scanning':
      return <Ring n={state.summary.active} progress={state.progress} />;
    case 'done':
      return <Count n={state.summary.active} tone={state.summary.moderation.length > 0 ? 'warn' : undefined} />;
    case 'error':
      return state.summary ? <Count n={state.summary.active} /> : null;
    case 'absent':
      return null;
  }
}

/** The visibility check in a badge: a spinner, then a tone. */
export function VisibilityBadge({ state, icon = 'mark' }: { state: VisibilityCheckState; icon?: 'mark' | 'eye' }) {
  switch (state.kind) {
    case 'waiting':
    case 'running':
      return <Spinner />;
    case 'done': {
      const tone = VISIBILITY_TONE[state.summary.tone];
      const glyph =
        icon === 'eye' ? (
          tone === 'bad' ? (
            <EyeOff size={12} aria-hidden />
          ) : (
            <Eye size={12} aria-hidden />
          )
        ) : tone === 'ok' ? (
          <Check size={12} strokeWidth={2.6} aria-hidden />
        ) : tone === 'warn' ? (
          <TriangleAlert size={12} aria-hidden />
        ) : tone === 'bad' ? (
          <X size={12} strokeWidth={2.6} aria-hidden />
        ) : (
          <Eye size={12} aria-hidden />
        );
      return (
        <span className="fx-check-pill" data-tone={tone} data-icon title={state.summary.title}>
          {glyph}
        </span>
      );
    }
    case 'error':
    case 'absent':
      return null;
  }
}

/**
 * Both checks on the folded account card, so their answers stay in sight on
 * every collection and record. Each opens its view.
 */
export function AccountCheckBadges({ identity, base }: { identity: IdentityBundle; base: string }) {
  const { labels, visibility } = useAccountChecks(identity.did);
  if (labels.kind === 'absent') return null;
  const moderation = labels.kind === 'done' && labels.summary.moderation.length > 0;
  return (
    <span className="fx-check-badges">
      <Link
        href={`${base}?tab=labels`}
        prefetch={false}
        className="fx-check-badge"
        data-tone={moderation ? 'warn' : undefined}
        aria-label="Labels"
        title="Labels"
      >
        <Tags size={12} aria-hidden />
        <LabelBadge state={labels} />
      </Link>
      <Link href={`${base}?tab=visibility`} prefetch={false} className="fx-check-badge" aria-label="Visibility" title="Visibility">
        <VisibilityBadge state={visibility} icon="eye" />
        {visibility.kind === 'error' || visibility.kind === 'absent' ? <Eye size={12} aria-hidden /> : null}
      </Link>
    </span>
  );
}

/** A check's badge beside its view in the rail. */
export function CheckNavBadge({ did, check }: { did: string; check: 'labels' | 'visibility' }) {
  const { labels, visibility } = useAccountChecks(did);
  return (
    <span className="fx-wb-view-end">
      {check === 'labels' ? <LabelBadge state={labels} /> : <VisibilityBadge state={visibility} />}
    </span>
  );
}
