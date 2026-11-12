'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { LoaderCircle, ScanSearch, Square, Tags, User } from 'lucide-react';
import { toolHref } from '@/lib/tools/catalog';
import {
  BLUESKY_MODERATION_DID,
  LABELERS_PER_REQUEST,
  MAX_ADDED_LABELERS,
  SCAN_CONCURRENCY,
  batchLabelers,
  cleanLabelerDids,
  describeLabel,
  formatCount,
  groupLabels,
  isExpired,
  labelEffect,
  labelScope,
  mergeLabels,
  parseLabelersParam,
  parseSubjectInput,
  scanPercent,
  subjectFor,
  targetKey,
  type Label,
  type LabelGroup,
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
import { parseAccountToken } from '@/lib/streamMonitor';
import { searchActorsTypeahead, shouldQueryHandleTypeahead } from '@/utils/atproto/appview';
import { explorePathFromAtUri, shortDid } from '@/utils/atproto/urls';
import TokenField, { type FieldToken, type Suggestion } from './TokenField';
import {
  ToolCard,
  ToolEmpty,
  ToolError,
  ToolFact,
  ToolFacts,
  ToolForm,
  ToolIntro,
  ToolSection,
  ToolShell,
  ToolSkeleton,
  ToolVerdict,
} from './ToolFrame';
import { useToolQuery, useToolRun } from './useToolQuery';

const SLUG = 'labels';
const EXAMPLES = [{ value: 'bsky.app' }, { value: 'atproto.com' }, { value: 'aturi.to' }];

/** A labeler someone added by hand, and what became of it. */
type AddedLabeler = {
  /** As typed: a handle or a DID. */
  value: string;
  /** Null when the handle did not resolve. */
  did: string | null;
};

/** The first answer: Bluesky's labeler, the subject's own labels, and any labelers added. */
type BaseResult = {
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
type ScanResult = {
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

// Suggestions for the labeler field: the AppView typeahead the stream
// monitor's account filter uses. It offers any account, not only labelers;
// one that is not a labeler is marked as such once it has been asked.
async function suggestAccounts(query: string, signal: AbortSignal): Promise<Suggestion[]> {
  if (!shouldQueryHandleTypeahead(query)) return [];
  const actors = await searchActorsTypeahead(query.replace(/^@/, ''), { limit: 6, signal });
  return actors.map((a) => ({
    value: a.handle,
    title: a.displayName?.trim() || a.handle,
    detail: a.handle,
    avatar: a.avatar ?? '',
    did: a.did,
  }));
}

const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });

function formatDate(iso: string | undefined): string | null {
  if (!iso) return null;
  const at = Date.parse(iso);
  return Number.isFinite(at) ? dateFormat.format(at) : null;
}

const SCOPE_WORDS = {
  account: 'On the account',
  profile: 'On the profile record',
  post: 'On the post',
  record: 'On a record',
} as const;

function Avatar({ src }: { src: string | null | undefined }) {
  if (!src) return <span className="fn-tool-avatar" aria-hidden />;
  // A plain <img>, as the typeahead draws its avatars: next/image would route
  // every labeler's avatar through the image optimizer.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="" width={32} height={32} loading="lazy" className="fn-tool-avatar" />;
}

function LabelRow({
  label,
  labeler,
  self,
  languages,
  now,
}: {
  label: Label;
  labeler: LabelerInfo | undefined;
  self: boolean;
  languages: readonly string[];
  now: number;
}) {
  const meaning = describeLabel(label.val, self ? [] : (labeler?.definitions ?? []), languages);
  const effect = labelEffect(meaning.blurs, meaning.severity);
  const applied = formatDate(label.cts);
  const expires = formatDate(label.exp);
  const expired = isExpired(label, now);
  const state = label.neg ? 'Withdrawn' : expired ? 'Expired' : meaning.severity === 'alert' ? 'Alert' : null;
  const facts = [
    SCOPE_WORDS[labelScope(label)],
    applied ? `Applied ${applied}` : null,
    expires ? (expired ? `Expired ${expires}` : `Expires ${expires}`) : null,
    effect,
    meaning.defaultSetting ? `Subscribers get “${meaning.defaultSetting}” by default` : null,
    meaning.adultOnly ? 'Adults only' : null,
  ].filter(Boolean);

  return (
    <li className="fn-tool-labels-item" data-inactive={label.neg || expired || undefined}>
      <div className="fn-tool-labels-head">
        <span className="fn-tool-labels-name">{meaning.name}</span>
        {meaning.name !== label.val && <code className="fn-tool-labels-val">{label.val}</code>}
        {state && (
          <span className="fn-tool-labels-state" data-tone={state === 'Alert' ? 'warn' : undefined}>
            {state}
          </span>
        )}
      </div>
      {meaning.description ? (
        <p className="fn-tool-labels-desc">{meaning.description}</p>
      ) : (
        <p className="fn-tool-labels-desc" data-quiet>
          {self
            ? 'This value is not one the protocol defines for self-labels, so apps ignore it.'
            : 'The labeler publishes no description for this value.'}
        </p>
      )}
      <p className="fn-tool-labels-meta">
        {facts.map((fact, index) => (
          <span key={index}>{fact}</span>
        ))}
        {meaning.source === 'protocol' && <span>Defined by the protocol</span>}
      </p>
    </li>
  );
}

function LabelGroupCard({
  group,
  labeler,
  view,
  languages,
  now,
}: {
  group: LabelGroup;
  labeler: LabelerInfo | undefined;
  view: SubjectView | null;
  languages: readonly string[];
  now: number;
}) {
  const name = group.self
    ? 'Set by the account itself'
    : labeler?.displayName || (labeler?.handle ? `@${labeler.handle}` : shortDid(group.src));
  const sub = group.self
    ? 'Self-labels, written into its own records'
    : labeler?.handle
      ? `@${labeler.handle}`
      : labeler
        ? group.src
        : 'Bluesky has no labeler profile for this DID';
  return (
    <ToolCard flush className="fn-tool-labels-group">
      <div className="fn-tool-row fn-tool-labels-source">
        <Avatar src={group.self ? view?.avatar : labeler?.avatar} />
        <div className="fn-tool-row-main">
          <Link href={`/explore/${group.src}`} prefetch={false} className="fn-tool-row-title">
            {name}
          </Link>
          <span className="fn-tool-row-sub">{sub}</span>
        </div>
        <span className="fn-tool-row-end">
          {group.labels.length === 1 ? '1 label' : `${group.labels.length} labels`}
        </span>
      </div>
      <ul className="fn-tool-rows">
        {group.labels.map((label) => (
          <LabelRow
            key={`${label.uri} ${label.val}`}
            label={label}
            labeler={labeler}
            self={group.self}
            languages={languages}
            now={now}
          />
        ))}
      </ul>
    </ToolCard>
  );
}

/**
 * Shows the labels on an account or a post, who applied each one and what
 * it means. The logic is in src/lib/tools/labels.ts and the requests in
 * labelsClient.ts; this runs them and draws the result.
 *
 * Two runs. The first is automatic and small: Bluesky's own labeler, the
 * subject's self-labels and any labelers added by hand. The second, a scan
 * of every labeler on the network, is several dozen requests, so it only
 * starts on a button press and is never kept in the link.
 */
export default function LabelChecker() {
  const [{ subject: raw, labelers: rawLabelers }, setQuery] = useToolQuery(['subject', 'labelers'] as const);
  const input = raw ? parseSubjectInput(raw) : null;
  const target = input?.ok ? input.target : null;
  const addedValues = parseLabelersParam(rawLabelers);
  const baseKey = target ? `${targetKey(target)}|${addedValues.join(',')}` : null;

  const base = useToolRun<BaseResult>(baseKey, ({ signal }) =>
    checkBase(target as LabelTarget, addedValues, signal),
  );

  // The scan belongs to the subject it was started for: change the subject
  // or the added labelers and it is no longer running, with nothing to reset.
  const [scanRequest, setScanRequest] = useState<{ key: string; n: number } | null>(null);
  const stopRef = useRef<AbortController | null>(null);
  const baseData = base.status === 'done' ? base.data : null;
  const scanKey =
    scanRequest && scanRequest.key === baseKey && baseData && !baseData.unavailable
      ? `${scanRequest.key}#${scanRequest.n}`
      : null;
  const scan = useToolRun<ScanResult>(scanKey, ({ signal, publish }) => {
    const stop = new AbortController();
    stopRef.current = stop;
    return scanEveryLabeler(baseData as BaseResult, signal, stop, publish);
  });

  const [now] = useState(() => Date.now());
  const languages = typeof navigator === 'undefined' ? ['en'] : navigator.languages;

  const labels = baseData ? mergeLabels(baseData.labels, scan.data?.labels ?? []) : [];
  const labelers = new Map<string, LabelerInfo>([...(baseData?.labelers ?? []), ...(scan.data?.labelers ?? [])]);
  const groups = baseData ? groupLabels(labels, baseData.subject.did) : [];
  const active = labels.filter((label) => !label.neg && !isExpired(label, now)).length;
  const view = baseData?.view ?? null;
  const isPost = baseData?.subject.kind === 'post';
  const who = view?.handle ? `@${view.handle}` : baseData ? shortDid(baseData.subject.did) : '';
  const subjectName = isPost ? `this post by ${who}` : who;

  const scanning = scan.status === 'loading';
  const progress = scan.data?.progress ?? null;
  const scanDone = scan.status === 'done' ? scan.data : null;

  const tokens: FieldToken[] = addedValues.map((value) => {
    const resolved = baseData?.added.find((a) => a.value === value);
    if (!baseData || !resolved) return { value, state: 'pending' };
    if (!resolved.did) return { value, state: 'error', note: 'not found', title: 'This handle does not resolve to an account.' };
    if (!baseData.labelers.has(resolved.did)) {
      return { value, state: 'error', note: 'not a labeler', title: 'Bluesky has no labeler service for this account.' };
    }
    return { value };
  });

  const setLabelers = (values: string[]) => setQuery({ labelers: values.join(',') }, { replace: true });

  let coverage = '';
  if (baseData) {
    const extra = baseData.asked.length - 1;
    if (scanning && progress) {
      coverage = `Asking every labeler: ${formatCount(progress.checked + progress.failed)} of ${formatCount(progress.total)} so far.`;
    } else if (scanDone?.stopped) {
      coverage = `Stopped after ${formatCount(scanDone.progress.checked)} of ${formatCount(scanDone.progress.total)} labelers.`;
    } else if (scanDone) {
      coverage = `Asked all ${formatCount(scanDone.progress.total)} labelers that publish a service record.`;
    } else {
      coverage = `Asked Bluesky’s moderation service${extra > 0 ? ` and ${extra === 1 ? 'one labeler' : `${extra} labelers`} you added` : ''}. Self-labels are included. Scan every labeler to ask the rest.`;
    }
  }

  return (
    <ToolShell
      slug={SLUG}
      share={
        target
          ? `${toolHref(SLUG)}?subject=${encodeURIComponent(raw.trim())}${
              addedValues.length ? `&labelers=${encodeURIComponent(addedValues.join(','))}` : ''
            }`
          : undefined
      }
      form={
        <ToolForm
          value={raw}
          onSubmit={(value) => setQuery({ subject: value })}
          label="Account or post to check"
          placeholder="Handle, DID, or a link to a post"
          busy={base.status === 'loading'}
          examples={EXAMPLES}
          icon={<Tags size={17} />}
        />
      }
    >
      {input && !input.ok && <ToolError>{input.reason}</ToolError>}
      {base.status === 'error' && <ToolError onRetry={base.rerun}>{base.error}</ToolError>}

      {base.status === 'loading' && (
        <>
          <ToolVerdict tone="info" title={`Checking ${raw.trim()}`} icon={<LoaderCircle size={18} className="fn-tool-spin" />}>
            Asking Bluesky’s moderation service.
          </ToolVerdict>
          <ToolSkeleton rows={3} />
        </>
      )}

      {baseData?.unavailable && (
        <ToolVerdict tone="warn" title="Bluesky will not show this" icon={<Tags size={18} />}>
          The AppView answered “{baseData.unavailable}”. That is not a label: it means there is no
          {isPost ? ' post' : ' profile'} here for labels to appear on.
        </ToolVerdict>
      )}

      {baseData && !baseData.unavailable && (
        <>
          <ToolVerdict
            tone="info"
            title={
              active === 0
                ? `No labels on ${subjectName}`
                : `${active === 1 ? 'One label' : `${active} labels`} on ${subjectName}`
            }
            icon={<Tags size={18} />}
          >
            {coverage}
          </ToolVerdict>

          <ToolSection
            title="Labels"
            meta={labels.length > 0 ? `${labels.length} from ${groups.length === 1 ? 'one source' : `${groups.length} sources`}` : null}
          >
            {groups.length === 0 ? (
              <ToolEmpty>
                {scanDone && !scanDone.stopped
                  ? 'No labeler has a label on this.'
                  : 'None from the labelers asked so far.'}
              </ToolEmpty>
            ) : (
              <div className="fn-tool-labels-groups">
                {groups.map((group) => (
                  <LabelGroupCard
                    key={group.src}
                    group={group}
                    labeler={labelers.get(group.src)}
                    view={view}
                    languages={languages}
                    now={now}
                  />
                ))}
              </div>
            )}
          </ToolSection>

          <ToolSection title="Labelers">
            <ToolCard className="fn-tool-labels-scan">
              <p>
                Anyone can run a labeler, and an app only shows labels from the ones its user
                subscribes to. A scan asks every labeler the relay lists, {LABELERS_PER_REQUEST} at a time.
              </p>

              <div className="fn-tool-labels-scanbar" aria-live="polite">
                {scanning ? (
                  <>
                    <button type="button" className="fx-btn fx-btn-sm" onClick={() => stopRef.current?.abort()}>
                      <Square size={12} aria-hidden /> Stop
                    </button>
                    <div
                      className="fn-tool-progress"
                      role="progressbar"
                      aria-label="Labelers asked"
                      aria-valuemin={0}
                      aria-valuemax={100}
                      aria-valuenow={progress ? scanPercent(progress) : 0}
                    >
                      <span style={{ width: `${progress ? scanPercent(progress) : 0}%` }} />
                    </div>
                    <span className="fn-tool-labels-count">
                      {progress
                        ? `${formatCount(progress.checked + progress.failed)} of ${formatCount(progress.total)}`
                        : 'Listing labelers…'}
                    </span>
                  </>
                ) : (
                  <>
                    <button
                      type="button"
                      className="fx-btn fx-btn-sm"
                      onClick={() => setScanRequest((prev) => ({ key: baseKey as string, n: (prev?.n ?? 0) + 1 }))}
                    >
                      <ScanSearch size={14} aria-hidden /> {scanDone || scan.status === 'error' ? 'Scan again' : 'Scan every labeler'}
                    </button>
                    {scanDone && (
                      <span className="fn-tool-labels-count">
                        {scanDone.stopped ? 'Stopped at ' : 'Asked '}
                        {formatCount(scanDone.progress.checked)} of {formatCount(scanDone.progress.total)}
                        {scanDone.progress.failed > 0 &&
                          `. ${formatCount(scanDone.progress.failed)} could not be asked`}
                      </span>
                    )}
                  </>
                )}
              </div>
              {scan.status === 'error' && (
                <p className="fn-tool-labels-problem" role="alert">
                  The scan could not start: {scan.error}.
                </p>
              )}

              <div className="fn-tool-labels-add">
                <span className="fn-dt">Ask a particular labeler</span>
                <TokenField
                  label="Labelers to ask"
                  icon={<User size={14} />}
                  placeholder="Handle or DID of a labeler"
                  hint="Handles or DIDs of labelers to ask along with Bluesky’s."
                  tokens={tokens}
                  max={MAX_ADDED_LABELERS}
                  parse={(entry) => {
                    const token = parseAccountToken(entry);
                    if (!token) return { error: `“${entry}” isn’t a handle or DID.` };
                    return { value: token.kind === 'did' ? token.did : token.handle };
                  }}
                  onChange={setLabelers}
                  suggest={suggestAccounts}
                />
              </div>
            </ToolCard>
          </ToolSection>

          <ToolSection title="Checked">
            <ToolCard>
              <ToolFacts>
                <ToolFact label={isPost ? 'Author' : 'Account'} plain>
                  {view?.displayName ? `${view.displayName} (${who})` : who}
                </ToolFact>
                <ToolFact label="DID" copy={baseData.subject.did}>
                  {baseData.subject.did}
                </ToolFact>
                {baseData.subject.kind === 'post' && (
                  <ToolFact label="Post" copy={baseData.subject.uri} wide>
                    {baseData.subject.uri}
                  </ToolFact>
                )}
                {isPost && view?.text && (
                  <ToolFact label="Text" wide plain>
                    {view.text.length > 280 ? `${view.text.slice(0, 280)}…` : view.text}
                  </ToolFact>
                )}
              </ToolFacts>
              <div className="fn-tool-actions">
                <Link
                  href={
                    explorePathFromAtUri(
                      baseData.subject.kind === 'post' ? baseData.subject.uri : baseData.subject.did,
                    ) ?? `/explore/${baseData.subject.did}`
                  }
                  prefetch={false}
                  className="fx-btn fx-btn-sm"
                >
                  Open in the Explorer
                </Link>
                {isPost && (
                  <button
                    type="button"
                    className="fx-btn fx-btn-sm"
                    onClick={() => setQuery({ subject: baseData.subject.did })}
                  >
                    Check the author
                  </button>
                )}
              </div>
            </ToolCard>
          </ToolSection>
        </>
      )}

      {!raw && (
        <ToolIntro
          items={[
            {
              term: 'Bluesky’s own labeler',
              text: 'Asked first, because every Bluesky user is subscribed to it. Its answer comes with the labels the account put on itself.',
            },
            {
              term: 'Every other labeler',
              text: (
                <>
                  A scan lists every account with an <code>app.bsky.labeler.service</code> record and
                  asks Bluesky’s AppView which of them have labelled this.
                </>
              ),
            },
            {
              term: 'What each label means',
              text: 'A label is a short value such as spam. Its name, description and what it hides come from the definitions its labeler publishes.',
            },
            {
              term: 'What it leaves out',
              text: 'Only labels the AppView has indexed are found, which is what Bluesky apps show. A suspension is not a label and is reported separately.',
            },
          ]}
        />
      )}
    </ToolShell>
  );
}
