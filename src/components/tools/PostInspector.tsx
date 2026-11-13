'use client';

import { Fragment } from 'react';
import Link from 'next/link';
import { Check, LoaderCircle, ScanText, TriangleAlert, X } from 'lucide-react';
import { getPosts, type AppViewPostView } from '@/utils/atproto/appview';
import { SLINGSHOT } from '@/utils/atproto/config';
import { getRecord } from '@/utils/atproto/pdsClient';
import { getRecordByUri, resolveMiniDoc } from '@/utils/atproto/slingshot';
import { explorePathFromAtUri } from '@/utils/atproto/urls';
import { toolHref } from '@/lib/tools/catalog';
import {
  POSTGATE_COLLECTION,
  POST_COLLECTION,
  POST_LIMITS,
  THREADGATE_COLLECTION,
  buildPostFindings,
  decodeBytes,
  gateUri,
  measureText,
  parsePostInput,
  postVerdict,
  readFacets,
  segmentText,
  threadRoot,
  type FacetFeature,
  type FacetReading,
  type GateProbe,
  type PostEvidence,
} from '@/lib/tools/post';
import { CheckList, type CheckItem } from './Checks';
import {
  ToolCard,
  ToolError,
  ToolFact,
  ToolFacts,
  ToolForm,
  ToolIntro,
  ToolJson,
  ToolSection,
  ToolShell,
  ToolVerdict,
} from './ToolFrame';
import { useToolQuery, useToolRun } from './useToolQuery';

const SLUG = 'post';
const EXAMPLES = [
  { label: 'Mentions and a link', value: 'https://bsky.app/profile/atproto.com/post/3mzebbdw64s27' },
  { label: 'Hidden replies', value: 'https://bsky.app/profile/atproto.com/post/3mxuffv57ks2g' },
  { label: 'A reply with a quote', value: 'https://bsky.app/profile/bsky.app/post/3mzg7ufzqwc2u' },
];

/** The AppView's view of a post, with the two fields the shared type leaves out. */
type PostView = AppViewPostView & {
  labels?: { val?: string; src?: string; neg?: boolean }[];
};

type PostRun = { evidence: PostEvidence; view?: PostView | null };

/**
 * A gate record, read from Slingshot with its answer kept apart: "there is
 * no such record" is the ordinary case and means the post has no rule, while
 * a failed lookup means nothing is known. The shared client folds both into
 * null, which is right for hydrating a list and wrong here.
 */
async function readGate(uri: string | null, signal: AbortSignal): Promise<GateProbe> {
  if (!uri) return { status: 'none' };
  try {
    const res = await fetch(
      `${SLINGSHOT}/xrpc/blue.microcosm.repo.getRecordByUri?at_uri=${encodeURIComponent(uri)}`,
      { signal },
    );
    if (res.status === 400 || res.status === 404) return { status: 'none' };
    if (!res.ok) return { status: 'error' };
    const body = (await res.json()) as { uri?: string; value?: Record<string, unknown> };
    return body.value ? { status: 'found', uri: body.uri ?? uri, value: body.value } : { status: 'none' };
  } catch {
    return { status: 'error' };
  }
}

/**
 * Fetch the record, then everything that hangs off it, publishing as each
 * part arrives. The record is the one thing the tool cannot do without, so a
 * post that cannot be read is thrown rather than recorded.
 */
async function investigate(
  target: { authority: string; rkey: string },
  signal: AbortSignal,
  publish: (run: PostRun) => void,
): Promise<PostRun> {
  const asked = `at://${target.authority}/${POST_COLLECTION}/${target.rkey}`;
  let record = await getRecordByUri(asked, signal);
  if (signal.aborted) throw new Error('aborted');

  // The cache misses on brand-new records and unusual hosts, and cannot say
  // a record is gone; the repository's own PDS can.
  if (!record) {
    const identity = await resolveMiniDoc(target.authority, signal);
    if (!identity) throw new Error(`${target.authority} did not resolve to an account.`);
    try {
      record = await getRecord(identity.pds.replace(/\/$/, ''), {
        repo: identity.did,
        collection: POST_COLLECTION,
        rkey: target.rkey,
      });
    } catch (err) {
      const status = (err as { status?: number }).status;
      throw new Error(
        status === 400 || status === 404
          ? 'There is no post at this address. It may have been deleted.'
          : 'The post could not be read: its PDS did not answer.',
      );
    }
  }

  let run: PostRun = { evidence: { uri: record.uri, rkey: target.rkey, record: record.value } };
  const update = (patch: Partial<PostEvidence>, view?: PostView | null) => {
    run = { evidence: { ...run.evidence, ...patch }, view: view === undefined ? run.view : view };
    if (!signal.aborted) publish(run);
  };
  publish(run);

  const { uri } = run.evidence;
  await Promise.all([
    getPosts([uri], { signal }).then((page) => {
      const view = (page?.posts?.[0] as PostView | undefined) ?? null;
      update({ view: view ? { indexedAt: view.indexedAt, labels: view.labels } : null }, view);
    }),
    readGate(gateUri(threadRoot(run.evidence), THREADGATE_COLLECTION), signal).then((threadgate) =>
      update({ threadgate }),
    ),
    readGate(gateUri(uri, POSTGATE_COLLECTION), signal).then((postgate) => update({ postgate })),
  ]);
  return run;
}

const VERDICT_ICON = {
  pass: <Check size={18} strokeWidth={2.6} />,
  warn: <TriangleAlert size={18} />,
  fail: <X size={18} strokeWidth={2.6} />,
  pending: <LoaderCircle size={18} className="fn-tool-spin" />,
};

const FEATURE_WORD: Record<FacetFeature['kind'], string> = {
  mention: 'Mention',
  link: 'Link',
  tag: 'Tag',
  unknown: 'Unknown',
};

function FeatureTarget({ feature }: { feature: FacetFeature }) {
  if (feature.kind === 'mention') {
    return feature.did.startsWith('did:') ? (
      <Link href={`/explore/${feature.did}`} prefetch={false}>
        {feature.did}
      </Link>
    ) : (
      <>{feature.did || 'no DID'}</>
    );
  }
  if (feature.kind === 'link') {
    return /^https?:\/\//i.test(feature.uri) ? (
      <a href={feature.uri} target="_blank" rel="noreferrer noopener nofollow">
        {feature.uri}
      </a>
    ) : (
      <>{feature.uri || 'no uri'}</>
    );
  }
  if (feature.kind === 'tag') return <>#{feature.tag}</>;
  return <>{feature.type}</>;
}

/** The post's text with each facet's stretch marked and numbered. */
function MarkedText({ text, readings }: { text: string; readings: FacetReading[] }) {
  if (!text) return <p className="fn-tool-post-text" data-empty>The text is empty.</p>;
  const kinds = new Map(readings.map((r) => [r.position, r.features[0]?.kind ?? 'unknown']));
  // A range that can be cut but covers the wrong text is still drawn, since
  // seeing where it lands is the point; it is marked as misplaced.
  const misplaced = new Set(readings.filter((r) => r.problems.some((p) => p.level === 'error')).map((r) => r.position));
  return (
    <p className="fn-tool-post-text">
      {segmentText(text, readings).map((segment, index) =>
        segment.facet === null ? (
          <Fragment key={index}>{segment.text}</Fragment>
        ) : (
          <mark
            key={index}
            className="fn-tool-post-mark"
            data-kind={kinds.get(segment.facet)}
            data-misplaced={misplaced.has(segment.facet) || undefined}
          >
            {segment.text}
            <sup aria-label={`facet ${segment.facet + 1}`}>{segment.facet + 1}</sup>
          </mark>
        ),
      )}
    </p>
  );
}

function FacetTable({ text, readings }: { text: string; readings: FacetReading[] }) {
  return (
    <ToolCard flush>
      <div className="fn-tool-table-wrap">
        <table className="fn-tool-table fn-tool-post-facets">
          <thead>
            <tr>
              <th data-num>#</th>
              <th>Bytes</th>
              <th>Covers</th>
              <th>Marks it as</th>
              <th>Check</th>
            </tr>
          </thead>
          <tbody>
            {readings.map((reading) => {
              const broken = reading.problems.some((p) => p.level === 'error');
              const hasRange = reading.byteStart !== null && reading.byteEnd !== null;
              return (
                <Fragment key={reading.position}>
                  <tr data-problem={reading.problems.length ? true : undefined}>
                    <td data-num data-mono>
                      {reading.position + 1}
                    </td>
                    <td data-mono className="fn-tool-post-bytes">
                      {hasRange ? `${reading.byteStart} to ${reading.byteEnd}` : 'none'}
                    </td>
                    <td className="fn-tool-post-covers">
                      {reading.covered !== null ? (
                        <q>{reading.covered}</q>
                      ) : hasRange && (reading.byteStart as number) < (reading.byteEnd as number) ? (
                        <q data-broken>{decodeBytes(text, reading.byteStart as number, reading.byteEnd as number) || 'nothing'}</q>
                      ) : (
                        <span className="fn-tool-post-none">nothing</span>
                      )}
                    </td>
                    <td>
                      {reading.features.length === 0 && <span className="fn-tool-post-none">no feature</span>}
                      {reading.features.map((feature, index) => (
                        <div key={index} className="fn-tool-post-feature">
                          <span className="fn-tool-pill" data-tone="outline">
                            {FEATURE_WORD[feature.kind]}
                          </span>
                          <span className="fn-tool-post-target">
                            <FeatureTarget feature={feature} />
                          </span>
                        </div>
                      ))}
                    </td>
                    <td>
                      <span className="fn-tool-pill" data-tone={broken ? 'fail' : reading.problems.length ? 'warn' : 'pass'}>
                        {broken ? 'Does not fit' : reading.problems.length ? 'Look at' : 'Fits'}
                      </span>
                    </td>
                  </tr>
                  {reading.problems.length > 0 && (
                    <tr className="fn-tool-post-problems" data-level={broken ? 'error' : 'warn'}>
                      <td />
                      <td colSpan={4}>
                        {reading.problems.map((problem, index) => (
                          <p key={index}>{problem.message}</p>
                        ))}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </ToolCard>
  );
}

function Stat({ label, value }: { label: string; value: number | undefined }) {
  return (
    <div className="fn-stat">
      <span className="fn-stat-label">{label}</span>
      <span className="fn-stat-value">{(value ?? 0).toLocaleString('en-US')}</span>
    </div>
  );
}

/**
 * Opens a post's record: its facets against its text, its timestamps, and
 * the reply and quote rules beside it. The logic is in
 * src/lib/tools/post.ts; this fetches the parts and draws them.
 */
export default function PostInspector() {
  const [{ post: raw }, setQuery] = useToolQuery(['post'] as const);
  const input = raw ? parsePostInput(raw) : null;
  const target = input?.ok ? input : null;

  const run = useToolRun<PostRun>(target ? `${target.authority}/${target.rkey}` : null, ({ signal, publish }) =>
    investigate(target as { authority: string; rkey: string }, signal, publish),
  );

  const evidence = run.data?.evidence;
  const view = run.data?.view;
  const text = typeof evidence?.record.text === 'string' ? evidence.record.text : '';
  const readings = evidence ? readFacets(text, evidence.record.facets) : [];
  const measure = measureText(text);
  const findings = evidence ? buildPostFindings(evidence) : [];
  const verdict = evidence ? postVerdict(findings) : null;
  const items: CheckItem[] = findings
    // The facets have a section of their own, with the table.
    .filter((finding) => finding.id !== 'facets')
    .map((finding) => ({
      id: finding.id,
      status: finding.status,
      title: finding.title,
      summary: finding.summary,
      // The three counts are already set out in the text's own card.
      detail:
        finding.id === 'length' ? undefined : finding.detail?.map((line, index) => <div key={index}>{line}</div>),
    }));
  const facets = findings.find((finding) => finding.id === 'facets');
  const explorePath = evidence ? explorePathFromAtUri(evidence.uri) : null;
  const did = evidence?.uri.slice('at://'.length).split('/')[0];
  const author = view?.author;

  return (
    <ToolShell
      slug={SLUG}
      share={raw ? `${toolHref(SLUG)}?post=${encodeURIComponent(raw)}` : undefined}
      form={
        <ToolForm
          value={raw}
          onSubmit={(value) => setQuery({ post: value })}
          label="Post link or at:// URI"
          placeholder="bsky.app/profile/…/post/… or at://…"
          submitLabel="Inspect"
          busy={run.status === 'loading'}
          examples={EXAMPLES}
          icon={<ScanText size={17} />}
        />
      }
    >
      {input && !input.ok && <ToolError>{input.reason}</ToolError>}
      {run.status === 'error' && !evidence && <ToolError onRetry={run.rerun}>{run.error}</ToolError>}
      {run.status === 'loading' && !evidence && (
        <ToolVerdict tone="info" title="Reading the record" icon={VERDICT_ICON.pending}>
          Fetching the post from its repository.
        </ToolVerdict>
      )}

      {verdict && evidence && (
        <>
          <ToolVerdict
            tone={verdict.tone === 'pending' ? 'info' : verdict.tone}
            title={verdict.title}
            icon={VERDICT_ICON[verdict.tone]}
          >
            {verdict.text}
          </ToolVerdict>

          <ToolSection
            title="Text"
            meta={`${measure.graphemes} of ${POST_LIMITS.graphemes} graphemes`}
          >
            <ToolCard>
              <div className="fn-tool-post-author">
                {author?.avatar ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={author.avatar} alt="" className="fn-tool-avatar" />
                ) : (
                  <span aria-hidden className="fn-tool-avatar" />
                )}
                <div className="fn-tool-post-author-text">
                  <strong>{author?.displayName?.trim() || author?.handle || did}</strong>
                  {did && (
                    <Link href={`/explore/${did}`} prefetch={false}>
                      {author?.handle ? `@${author.handle}` : did}
                    </Link>
                  )}
                </div>
              </div>
              <MarkedText text={text} readings={readings} />
              <ToolFacts>
                <ToolFact label="Graphemes" plain>
                  {measure.graphemes.toLocaleString('en-US')} of {POST_LIMITS.graphemes}
                </ToolFact>
                <ToolFact label="UTF-8 bytes" plain>
                  {measure.bytes.toLocaleString('en-US')} of {POST_LIMITS.bytes.toLocaleString('en-US')}
                </ToolFact>
                <ToolFact label="UTF-16 code units" plain>
                  {measure.utf16.toLocaleString('en-US')}
                </ToolFact>
                <ToolFact label="Post URI" copy={evidence.uri} wide>
                  {evidence.uri}
                </ToolFact>
              </ToolFacts>
              {explorePath && (
                <div className="fn-tool-actions">
                  <Link href={explorePath} prefetch={false} className="fx-btn fx-btn-sm">
                    Open the record in the Explorer
                  </Link>
                </div>
              )}
            </ToolCard>
          </ToolSection>

          <ToolSection
            title="Facets"
            meta={readings.length ? `${readings.length} ${readings.length === 1 ? 'facet' : 'facets'}` : 'None'}
          >
            {facets && (
              <p className="fn-tool-post-summary" data-status={facets.status}>
                {facets.summary}
              </p>
            )}
            {readings.length > 0 && <FacetTable text={text} readings={readings} />}
          </ToolSection>

          <ToolSection
            title="What the record says"
            meta={
              run.status === 'loading' ? (
                'Checking…'
              ) : (
                <button type="button" className="fn-tool-link" onClick={run.rerun}>
                  Check again
                </button>
              )
            }
          >
            <CheckList checks={items} label="What the record says" />
          </ToolSection>

          {view && (
            <ToolSection title="On Bluesky" meta="Counts from the AppView">
              <div className="fn-stat-grid">
                <Stat label="Likes" value={view.likeCount} />
                <Stat label="Reposts" value={view.repostCount} />
                <Stat label="Replies" value={view.replyCount} />
                <Stat label="Quotes" value={view.quoteCount} />
              </div>
            </ToolSection>
          )}

          <ToolSection title="Record">
            <ToolCard>
              <ToolJson value={evidence.record} label="record" />
            </ToolCard>
          </ToolSection>
        </>
      )}

      {!raw && (
        <ToolIntro
          title="What it reads"
          items={[
            {
              term: 'Facets against the text',
              text: (
                <>
                  Each link, mention and tag says where it is in <code>byteStart</code> and <code>byteEnd</code>,
                  counted in UTF-8 bytes. The ranges are cut from the text and checked, and offsets counted in the
                  wrong unit are named.
                </>
              ),
            },
            {
              term: 'Three ways of counting',
              text: 'The text’s length in graphemes, UTF-8 bytes and UTF-16 code units, against the limits in the lexicon.',
            },
            {
              term: 'When it was written',
              text: (
                <>
                  <code>createdAt</code> is whatever the client put there. It is compared with the time inside the
                  record key and the time Bluesky indexed the post.
                </>
              ),
            },
            {
              term: 'The rules beside it',
              text: 'Who can reply and who can quote are separate records under the same key. Both are looked up, along with the embed, languages, tags and labels.',
            },
          ]}
        />
      )}
    </ToolShell>
  );
}
