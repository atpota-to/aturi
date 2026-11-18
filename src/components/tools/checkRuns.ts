'use client';

/**
 * The runs behind the label and visibility checks, as hooks that every part
 * of the page asking about the same subject shares (src/lib/tools/runCache.ts).
 *
 * The label checker and the shadowban checker draw these on their pages; the
 * Explorer draws them on the account card, in the rail's badges and in its
 * Labels and Visibility views. Keys are built here and nowhere else, so a run
 * started by the card is the one the view and the tool page join.
 */

import { useCallback } from 'react';
import {
  BLUESKY_MODERATION_DID,
  SCAN_CONCURRENCY,
  batchLabelers,
  cleanLabelerDids,
  mergeLabels,
  subjectFor,
  targetKey as labelTargetKey,
  type Label,
  type LabelSubject,
  type LabelTarget,
  type ScanProgress,
} from '@/lib/tools/labels';
import {
  SubjectUnavailable,
  fetchLabelerInfo,
  fetchLabels,
  listLabelerDids,
  resolveActor,
  type LabelerInfo,
  type SubjectView,
} from '@/lib/tools/labelsClient';
import { targetKey as visibilityTargetKey, type AppView, type Evidence, type ShadowbanTarget } from '@/lib/tools/shadowban';
import { investigate } from '@/lib/tools/shadowbanClient';
import { useSharedToolRun } from './useToolQuery';

/** A labeler someone added by hand, and what became of it. */
export type AddedLabeler = {
  /** As typed: a handle or a DID. */
  value: string;
  /** Null when the handle did not resolve. */
  did: string | null;
};

/** The first answer: Bluesky's labeler, the subject's own labels, and any labelers added. */
export type BaseResult = {
  subject: LabelSubject;
  view: SubjectView | null;
  /** The AppView's wording when it would not describe the subject at all. */
  unavailable: string | null;
  labels: Label[];
  labelers: Map<string, LabelerInfo>;
  added: AddedLabeler[];
  /** The labeler DIDs that were asked. */
  asked: string[];
};

/** Where a scan of every labeler has got to. */
export type ScanResult = {
  progress: ScanProgress;
  labels: Label[];
  labelers: Map<string, LabelerInfo>;
  stopped: boolean;
  running: boolean;
};

async function checkBase(target: LabelTarget, addedValues: string[], signal: AbortSignal): Promise<BaseResult> {
  const [did, added] = await Promise.all([
    resolveActor(target.actor),
    Promise.all(
      addedValues.map(async (value): Promise<AddedLabeler> => ({ value, did: await resolveActor(value) })),
    ),
  ]);
  if (!did) {
    throw new Error(`${target.actor} does not resolve to an account. Check the spelling, or use its DID.`);
  }
  const subject = subjectFor(target, did);
  const asked = cleanLabelerDids([BLUESKY_MODERATION_DID, ...added.flatMap((a) => (a.did ? [a.did] : []))]);

  let labels: Label[] = [];
  let view: SubjectView | null = null;
  let unavailable: string | null = null;
  try {
    for (const batch of batchLabelers(asked)) {
      const answer = await fetchLabels(subject, batch, signal);
      labels = mergeLabels(labels, answer.labels);
      view = answer.view;
    }
  } catch (err) {
    if (!(err instanceof SubjectUnavailable)) throw err;
    unavailable = err.message;
  }

  // Everyone whose name will be shown: the labelers that were asked, and
  // whoever a label came from (a self-label comes from the subject, which
  // has no service view and is simply absent from the answer).
  const labelers = await fetchLabelerInfo(cleanLabelerDids([...asked, ...labels.map((l) => l.src)]), signal);
  return { subject, view, unavailable, labels, labelers, added, asked };
}

/**
 * Ask every labeler on the network, a batch per request and a few requests
 * at a time, publishing as the answers arrive.
 *
 * `stop` ends it early and keeps what was found. It is separate from the
 * run's own signal, which fires when the subject changes and throws the
 * result away.
 */
async function scanEveryLabeler(
  base: BaseResult,
  signal: AbortSignal,
  stop: AbortController,
  publish: (result: ScanResult) => void,
): Promise<ScanResult> {
  signal.addEventListener('abort', () => stop.abort(), { once: true });

  const directory = await listLabelerDids(signal);
  const batches = batchLabelers([...base.asked, ...directory]);
  const progress: ScanProgress = { total: batches.reduce((n, b) => n + b.length, 0), checked: 0, failed: 0 };
  let labels: Label[] = [];
  const labelers = new Map<string, LabelerInfo>();
  const requested = new Set<string>(base.labelers.keys());
  const lookups: Promise<void>[] = [];

  const snapshot = (running: boolean): ScanResult => ({
    progress: { ...progress },
    labels,
    labelers: new Map(labelers),
    stopped: stop.signal.aborted && !signal.aborted,
    running,
  });
  publish(snapshot(true));

  // Name a labeler as soon as it turns up with a label, rather than leaving
  // a bare DID on the page until the scan ends.
  const identify = (found: Label[]) => {
    const fresh = cleanLabelerDids(found.map((l) => l.src)).filter((did) => !requested.has(did));
    if (fresh.length === 0) return;
    fresh.forEach((did) => requested.add(did));
    lookups.push(
      fetchLabelerInfo(fresh, signal)
        .then((info) => {
          info.forEach((value, did) => labelers.set(did, value));
          if (!signal.aborted) publish(snapshot(true));
        })
        .catch(() => undefined),
    );
  };

  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(SCAN_CONCURRENCY, batches.length) }, async () => {
      for (;;) {
        if (stop.signal.aborted) return;
        const batch = batches[next++];
        if (!batch) return;
        try {
          const answer = await fetchLabels(base.subject, batch, stop.signal);
          labels = mergeLabels(labels, answer.labels);
          progress.checked += batch.length;
          identify(answer.labels);
        } catch {
          if (stop.signal.aborted) return;
          progress.failed += batch.length;
        }
        publish(snapshot(true));
      }
    }),
  );
  await Promise.all(lookups);
  return snapshot(false);
}

/**
 * The stop switch of each label scan in flight, by its key. A scan is shared,
 * so whoever presses Stop stops it for everyone watching.
 */
const scanStops = new Map<string, AbortController>();

/**
 * The label checker's two runs for a subject: the first answer (Bluesky's
 * labeler, self-labels, any labelers added by hand), and the scan of every
 * labeler that starts as soon as the first answer is in. `stop` ends the
 * scan early and keeps what it found.
 */
export function useLabelCheck(target: LabelTarget | null, addedValues: readonly string[]) {
  const baseKey = target ? `${labelTargetKey(target)}|${addedValues.join(',')}` : null;
  const base = useSharedToolRun<BaseResult>(baseKey && `labels:base:${baseKey}`, ({ signal }) =>
    checkBase(target as LabelTarget, [...addedValues], signal),
  );
  const baseData = base.status === 'done' ? base.data : null;
  const scanKey = baseKey && baseData && !baseData.unavailable ? `labels:scan:${baseKey}` : null;
  const scan = useSharedToolRun<ScanResult>(scanKey, ({ signal, publish }) => {
    const key = scanKey as string;
    const stop = new AbortController();
    scanStops.set(key, stop);
    return scanEveryLabeler(baseData as BaseResult, signal, stop, publish).finally(() => {
      if (scanStops.get(key) === stop) scanStops.delete(key);
    });
  });
  const stop = useCallback(() => {
    if (scanKey) scanStops.get(scanKey)?.abort();
  }, [scanKey]);
  return { baseKey, base, baseData, scan, stop };
}

/**
 * The shadowban checker's run for a subject on an AppView. Its evidence is
 * published step by step, which is what fills the card's six dots.
 */
export function useVisibilityCheck(target: ShadowbanTarget | null, appview: AppView | null) {
  const key = target && appview ? `visibility:${visibilityTargetKey(target)}|${appview.origin}` : null;
  return useSharedToolRun<Evidence>(key, ({ signal, publish }) =>
    investigate(target as ShadowbanTarget, appview as AppView, signal, publish),
  );
}
