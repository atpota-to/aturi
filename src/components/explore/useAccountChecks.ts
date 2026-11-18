'use client';

import { useEffect, useState } from 'react';
import {
  labelSummary,
  profileAbsence,
  visibilityApplies,
  visibilitySummary,
  type LabelSummary,
  type ProfileAbsence,
  type VisibilitySummary,
} from '@/lib/tools/accountChecks';
import { mergeLabels, type LabelTarget, type ScanProgress } from '@/lib/tools/labels';
import { DEFAULT_APPVIEW, type ShadowbanTarget } from '@/lib/tools/shadowban';
import { useLabelCheck, useVisibilityCheck } from '@/components/tools/checkRuns';

/** Where the label check of an account has got to, for its row and badges. */
export type LabelCheckState =
  | { kind: 'asking' }
  | { kind: 'scanning'; summary: LabelSummary; progress: ScanProgress | null }
  | { kind: 'done'; summary: LabelSummary; progress: ScanProgress; stopped: boolean; settledAt: number | null }
  /** Bluesky would not describe the account at all. */
  | { kind: 'absent'; absence: ProfileAbsence; message: string }
  | { kind: 'error'; message: string; summary: LabelSummary | null; retry: () => void };

/** Where the visibility check of an account has got to. */
export type VisibilityCheckState =
  /** Waiting for the label check's first answer, which says whether to run. */
  | { kind: 'waiting' }
  /** Nothing for an AppView to hide (no Bluesky profile, or deactivated). */
  | { kind: 'absent'; absence: ProfileAbsence }
  | { kind: 'running'; summary: VisibilitySummary }
  | { kind: 'done'; summary: VisibilitySummary; settledAt: number | null }
  | { kind: 'error'; message: string; retry: () => void };

const NO_ADDED: readonly string[] = [];

/** The time, moved on every half minute, for "4 min ago" and label expiry. */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);
  return now;
}

/**
 * The label and visibility checks of an account, as the Explorer shows them
 * on the account card and in the rail. Both run by themselves, through the
 * shared runs (src/lib/tools/runCache.ts), so every caller on the page joins
 * the same two runs, and so does the account's Labels or Visibility view.
 *
 * The visibility check waits for the label check's first answer: it costs a
 * few hundred milliseconds, keeps the twenty or so visibility requests out of
 * the way of the page's own first ones, and says whether Bluesky has the
 * account at all (docs/explorer-account-checks-plan.md, D4 and D5).
 */
export function useAccountChecks(did: string): { labels: LabelCheckState; visibility: VisibilityCheckState } {
  const now = useNow();
  const labelTarget: LabelTarget = { kind: 'account', actor: did };
  const { base, baseData, scan } = useLabelCheck(labelTarget, NO_ADDED);

  const absence = baseData?.unavailable ? profileAbsence(baseData.unavailable) : null;
  const baseSettled = base.status === 'done' || base.status === 'error';
  const visibilityTarget: ShadowbanTarget | null =
    baseSettled && visibilityApplies(absence) ? { kind: 'account', actor: did } : null;
  const visibility = useVisibilityCheck(visibilityTarget, DEFAULT_APPVIEW);

  let labels: LabelCheckState;
  if (base.status === 'error') {
    labels = { kind: 'error', message: base.error, summary: null, retry: base.rerun };
  } else if (!baseData) {
    labels = { kind: 'asking' };
  } else if (baseData.unavailable) {
    labels = { kind: 'absent', absence: absence ?? 'missing', message: baseData.unavailable };
  } else {
    const summary = labelSummary(mergeLabels(baseData.labels, scan.data?.labels ?? []), did, now);
    if (scan.status === 'error') {
      labels = { kind: 'error', message: scan.error, summary, retry: scan.rerun };
    } else if (scan.status === 'done') {
      labels = {
        kind: 'done',
        summary,
        progress: scan.data.progress,
        stopped: scan.data.stopped,
        settledAt: scan.settledAt,
      };
    } else {
      labels = { kind: 'scanning', summary, progress: scan.data?.progress ?? null };
    }
  }

  let visibilityState: VisibilityCheckState;
  if (absence && !visibilityApplies(absence)) {
    visibilityState = { kind: 'absent', absence };
  } else if (visibility.status === 'idle') {
    visibilityState = { kind: 'waiting' };
  } else if (visibility.status === 'error') {
    visibilityState = { kind: 'error', message: visibility.error, retry: visibility.rerun };
  } else {
    // The checker measures its grace periods from when the run started;
    // the summary does the same, so the card and the tool agree.
    const evidence = visibility.data ?? { target: { kind: 'account', actor: did }, appview: DEFAULT_APPVIEW };
    const summary = visibilitySummary(evidence, evidence.checkedAt ?? now);
    visibilityState =
      visibility.status === 'done'
        ? { kind: 'done', summary, settledAt: visibility.settledAt }
        : { kind: 'running', summary };
  }

  return { labels, visibility: visibilityState };
}

/** "4 min ago" for a result kept from earlier, or null when it is fresh. */
export function keptFor(settledAt: number | null, now: number): string | null {
  if (settledAt === null) return null;
  const minutes = Math.floor((now - settledAt) / 60_000);
  if (minutes < 1) return null;
  return `${minutes} min ago`;
}
