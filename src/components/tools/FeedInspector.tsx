'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Check, Info, LoaderCircle, Rss, TriangleAlert, X } from 'lucide-react';
import { Segmented } from '@/components/explore/lexicons/primitives';
import { getPosts, type AppViewPostView } from '@/utils/atproto/appview';
import { APPVIEW } from '@/utils/atproto/config';
import { resolveHandle } from '@/utils/atproto/identity';
import { explorePathFromAtUri } from '@/utils/atproto/urls';
import { toolHref } from '@/lib/tools/catalog';
import {
  FEED_COLLECTION,
  buildFeedChecks,
  feedUri,
  feedVerdict,
  needsViewer,
  parseFeedInput,
  reasonLabel,
  type FeedEvidence,
  type FeedProbe,
  type FeedSkeletonProbe,
} from '@/lib/tools/feed';
import { CheckList, type CheckItem } from './Checks';
import {
  ToolCard,
  ToolEmpty,
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

const SLUG = 'feed';
const EXAMPLES = [
  { label: 'Discover', value: 'https://bsky.app/profile/bsky.app/feed/whats-hot' },
  { label: 'For You', value: 'at://did:plc:3guzzweuqraryl3rdkimjamk/app.bsky.feed.generator/for-you' },
  { label: 'Science', value: 'https://bsky.app/profile/did:plc:jfhpnnst6flqway4eaeqzj2a/feed/for-science' },
];

/** The AppView's view of a feed generator, as much of it as the card shows. */
type GeneratorView = {
  uri: string;
  did?: string;
  displayName?: string;
  description?: string;
  avatar?: string;
  likeCount?: number;
  acceptsInteractions?: boolean;
  creator?: { did: string; handle?: string; displayName?: string };
};

type FeedRun = {
  evidence: FeedEvidence;
  view?: GeneratorView;
  /** The skeleton's posts as the AppView hydrates them, by URI. Absent until asked. */
  posts?: Record<string, AppViewPostView>;
};

/**
 * Gather the evidence for one feed, publishing as each part arrives. The
 * generator's side comes from the server route and the AppView's from here,
 * side by side, so a slow generator does not hold up what Bluesky says about
 * it. A step that could not be made is recorded as `null`, not thrown.
 */
async function investigate(
  target: { authority: string; rkey: string },
  cursor: string,
  signal: AbortSignal,
  publish: (run: FeedRun) => void,
): Promise<FeedRun> {
  let run: FeedRun = { evidence: { ...target } };
  const update = (patch: Partial<FeedEvidence>, extra?: Partial<Omit<FeedRun, 'evidence'>>) => {
    run = { ...run, ...extra, evidence: { ...run.evidence, ...patch } };
    if (!signal.aborted) publish(run);
  };
  publish(run);

  // The record lives in a repository, and a repository is named by a DID.
  const did = target.authority.startsWith('did:')
    ? target.authority
    : await resolveHandle(target.authority).catch(() => null);
  if (signal.aborted) return run;
  update({ did });
  if (!did) return run;
  const feed = feedUri(did, target.rkey);

  await Promise.all([
    (async () => {
      let probe: FeedProbe;
      try {
        const params = new URLSearchParams({ feed });
        if (cursor) params.set('cursor', cursor);
        const res = await fetch(`/api/tools/feed?${params}`, { signal });
        const body = (await res.json()) as ({ ok: true } & FeedProbe) | { ok: false; error: string };
        if (!body.ok) throw new Error(body.error);
        probe = body;
      } catch (err) {
        if (signal.aborted) throw err;
        update({ probe: null, probeError: 'The lookup service did not answer. Try again in a moment.' });
        return;
      }
      update({ probe });

      const uris = [...new Set((probe.skeleton?.items ?? []).map((item) => item.post))];
      if (uris.length === 0) return;
      const page = await getPosts(uris, { signal });
      const posts: Record<string, AppViewPostView> = {};
      for (const post of page?.posts ?? []) posts[post.uri] = post;
      update({}, { posts });
    })(),
    (async () => {
      try {
        const res = await fetch(
          `${APPVIEW}/xrpc/app.bsky.feed.getFeedGenerator?feed=${encodeURIComponent(feed)}`,
          { signal },
        );
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { message?: string } | null;
          throw new Error(body?.message ?? `HTTP ${res.status}`);
        }
        const body = (await res.json()) as { view?: GeneratorView; isOnline?: boolean; isValid?: boolean };
        update(
          {
            appview: {
              displayName: body.view?.displayName,
              likeCount: body.view?.likeCount,
              isOnline: body.isOnline,
              isValid: body.isValid,
            },
          },
          { view: body.view },
        );
      } catch (err) {
        if (!signal.aborted) update({ appview: { error: err instanceof Error ? err.message : 'no answer' } });
      }
    })(),
  ]);
  return run;
}

const VERDICT_ICON = {
  pass: <Check size={18} strokeWidth={2.6} />,
  warn: <TriangleAlert size={18} />,
  fail: <X size={18} strokeWidth={2.6} />,
  info: <Info size={18} />,
  pending: <LoaderCircle size={18} className="fn-tool-spin" />,
};

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined;
}

/** The skeleton as the generator returned it, back in the lexicon's shape. */
function skeletonJson(skeleton: FeedSkeletonProbe) {
  return {
    feed: (skeleton.items ?? []).map((item) => ({
      post: item.post,
      ...(item.reason
        ? { reason: { $type: item.reason.type, ...(item.reason.repost ? { repost: item.reason.repost } : {}) } }
        : {}),
      ...(item.feedContext ? { feedContext: item.feedContext } : {}),
    })),
    ...(skeleton.cursor ? { cursor: skeleton.cursor } : {}),
    ...(skeleton.reqId ? { reqId: skeleton.reqId } : {}),
  };
}

function Skeleton({
  skeleton,
  posts,
  onNext,
  onFirst,
}: {
  skeleton: FeedSkeletonProbe;
  posts: Record<string, AppViewPostView> | undefined;
  onNext: (() => void) | null;
  onFirst: (() => void) | null;
}) {
  const [view, setView] = useState<'posts' | 'json'>('posts');
  const items = skeleton.items ?? [];

  return (
    <ToolSection
      title="Skeleton"
      meta={`${items.length} ${items.length === 1 ? 'post' : 'posts'}${onFirst ? ', a later page' : ''}`}
    >
      <div className="fn-tool-bar fn-tool-feed-bar">
        <Segmented
          ariaLabel="How to show the skeleton"
          options={[
            { value: 'posts', label: 'Posts' },
            { value: 'json', label: 'JSON' },
          ]}
          value={view}
          onChange={setView}
        />
        <div className="fn-tool-bar-end">
          {onFirst && (
            <button type="button" className="fx-btn fx-btn-sm" onClick={onFirst}>
              First page
            </button>
          )}
          {onNext && (
            <button type="button" className="fx-btn fx-btn-sm" onClick={onNext}>
              Next page
            </button>
          )}
        </div>
      </div>

      {view === 'json' ? (
        <ToolCard>
          <ToolJson value={skeletonJson(skeleton)} label="skeleton" />
        </ToolCard>
      ) : (
        <ToolCard flush>
          <ol className="fn-tool-rows">
            {items.map((item, index) => {
              const post = posts?.[item.post];
              const author = post?.author;
              const excerpt = text(post?.record?.text);
              const path = explorePathFromAtUri(item.post);
              return (
                <li key={`${item.post}-${index}`} className="fn-tool-row fn-tool-feed-row">
                  <span aria-hidden className="fn-tool-feed-n">
                    {index + 1}
                  </span>
                  <div className="fn-tool-row-main">
                    {post ? (
                      <>
                        <span className="fn-tool-feed-author">
                          <strong>{author?.displayName?.trim() || author?.handle || 'Unknown author'}</strong>
                          {author?.handle && <span>@{author.handle}</span>}
                        </span>
                        <p className="fn-tool-feed-text" data-empty={excerpt ? undefined : true}>
                          {excerpt ?? 'No text: the post is an embed only.'}
                        </p>
                      </>
                    ) : (
                      <p className="fn-tool-feed-text" data-empty>
                        {posts ? 'The AppView has no post at this address. It may have been deleted.' : 'Loading the post…'}
                      </p>
                    )}
                    {path ? (
                      <Link href={path} prefetch={false} className="fn-tool-row-sub fn-tool-feed-uri" data-mono>
                        {item.post}
                      </Link>
                    ) : (
                      <span className="fn-tool-row-sub" data-mono>
                        {item.post}
                      </span>
                    )}
                    {item.feedContext && (
                      <span className="fn-tool-row-sub fn-tool-feed-context" data-mono title={item.feedContext}>
                        feedContext {item.feedContext}
                      </span>
                    )}
                  </div>
                  {item.reason && (
                    <span className="fn-tool-row-end">
                      <span className="fn-tool-pill" data-tone="outline" title={item.reason.repost ?? item.reason.type}>
                        {reasonLabel(item.reason.type)}
                      </span>
                    </span>
                  )}
                </li>
              );
            })}
          </ol>
        </ToolCard>
      )}

      {skeleton.cursor && (
        <p className="fn-tool-note fn-tool-feed-cursor">
          Cursor for the next page: <code>{skeleton.cursor}</code>
        </p>
      )}
    </ToolSection>
  );
}

/**
 * Looks inside a custom feed: the record, the service it names, what that
 * service returns, and what the AppView makes of it. The logic is in
 * src/lib/tools/feed.ts; this gathers the evidence and draws it.
 */
export default function FeedInspector() {
  const [{ feed: raw, cursor }, setQuery] = useToolQuery(['feed', 'cursor'] as const);
  const input = raw ? parseFeedInput(raw) : null;
  const target = input?.ok ? input : null;

  const run = useToolRun<FeedRun>(
    target ? `${target.authority}/${target.rkey} ${cursor}` : null,
    ({ signal, publish }) => investigate(target as { authority: string; rkey: string }, cursor, signal, publish),
  );

  const evidence = run.data?.evidence ?? (target ? { authority: target.authority, rkey: target.rkey } : null);
  const view = run.data?.view;
  const probe = evidence?.probe;
  const record = probe?.record.status === 'found' ? probe.record.value : null;
  const name =
    view?.displayName ?? text(record?.displayName) ?? (target ? `${target.authority}/${target.rkey}` : 'This feed');

  const checks = evidence ? buildFeedChecks(evidence) : [];
  const verdict = evidence ? feedVerdict(evidence, checks, name) : null;
  const items: CheckItem[] = checks.map((check) => ({
    id: check.id,
    status: check.status,
    title: check.title,
    summary: check.summary,
    detail: check.detail?.map((line, index) => <div key={index}>{line}</div>),
    fix: check.fix?.map((line, index) => <p key={index}>{line}</p>),
  }));

  const did = evidence?.did ?? null;
  const uri = did && target ? feedUri(did, target.rkey) : null;
  const description = view?.description ?? text(record?.description);
  const createdAt = text(record?.createdAt);
  const skeleton = probe?.skeleton;
  const hasSkeleton = skeleton?.status === 'answered' && skeleton.httpStatus === 200 && Boolean(skeleton.items?.length);

  return (
    <ToolShell
      slug={SLUG}
      share={raw ? `${toolHref(SLUG)}?feed=${encodeURIComponent(raw)}` : undefined}
      form={
        <ToolForm
          value={raw}
          onSubmit={(value) => setQuery({ feed: value, cursor: '' })}
          label="Feed link or at:// URI"
          placeholder="bsky.app/profile/…/feed/… or at://…"
          submitLabel="Inspect"
          busy={run.status === 'loading'}
          examples={EXAMPLES}
          icon={<Rss size={17} />}
        />
      }
    >
      {input && !input.ok && <ToolError>{input.reason}</ToolError>}

      {verdict && evidence && (
        <>
          <ToolVerdict
            tone={verdict.tone === 'pending' ? 'info' : verdict.tone}
            title={verdict.title}
            icon={VERDICT_ICON[verdict.tone]}
          >
            {verdict.text}
          </ToolVerdict>

          {uri && (record || view) && (
            <ToolSection title="Feed">
              <ToolCard>
                <div className="fn-tool-feed-card">
                  {view?.avatar ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={view.avatar} alt="" className="fn-tool-avatar fn-tool-feed-avatar" data-shape="square" />
                  ) : (
                    <span aria-hidden className="fn-tool-avatar fn-tool-feed-avatar" data-shape="square">
                      <Rss size={18} />
                    </span>
                  )}
                  <div className="fn-tool-feed-card-text">
                    <strong>{name}</strong>
                    {view?.creator && (
                      <span>
                        by{' '}
                        <Link href={`/explore/${view.creator.did}`} prefetch={false}>
                          {view.creator.handle ? `@${view.creator.handle}` : view.creator.did}
                        </Link>
                      </span>
                    )}
                  </div>
                </div>
                {description && <p className="fn-tool-feed-desc">{description}</p>}
                <ToolFacts>
                  <ToolFact label="Feed URI" copy={uri} wide>
                    {uri}
                  </ToolFact>
                  {probe?.service && (
                    <ToolFact label="Service DID" copy={probe.service.did}>
                      {probe.service.did}
                    </ToolFact>
                  )}
                  {probe?.service?.endpoint && (
                    <ToolFact label="Generator" copy={probe.service.endpoint}>
                      {probe.service.endpoint.replace(/^https?:\/\//, '')}
                    </ToolFact>
                  )}
                  {typeof view?.likeCount === 'number' && (
                    <ToolFact label="Likes" plain>
                      {view.likeCount.toLocaleString('en-US')}
                    </ToolFact>
                  )}
                  {createdAt && (
                    <ToolFact label="Created" plain>
                      <time dateTime={createdAt} title={createdAt}>
                        {createdAt.slice(0, 10)}
                      </time>
                    </ToolFact>
                  )}
                  {record && typeof record.acceptsInteractions === 'boolean' && (
                    <ToolFact label="Takes feedback" plain>
                      {record.acceptsInteractions ? 'Yes' : 'No'}
                    </ToolFact>
                  )}
                </ToolFacts>
                <div className="fn-tool-actions">
                  <Link
                    href={`/explore/${did}/${FEED_COLLECTION}/${encodeURIComponent(target?.rkey ?? '')}`}
                    prefetch={false}
                    className="fx-btn fx-btn-sm"
                  >
                    Open the record in the Explorer
                  </Link>
                </div>
              </ToolCard>
            </ToolSection>
          )}

          <ToolSection
            title="Checks"
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
            <CheckList checks={items} label={`Checks for ${name}`} />
          </ToolSection>

          {skeleton && hasSkeleton && (
            <Skeleton
              skeleton={skeleton}
              posts={run.data?.posts}
              onNext={skeleton.cursor ? () => setQuery({ cursor: skeleton.cursor as string }) : null}
              onFirst={cursor ? () => setQuery({ cursor: '' }) : null}
            />
          )}
          {skeleton && !hasSkeleton && needsViewer(skeleton) && (
            <ToolSection title="Skeleton">
              <ToolEmpty>
                No skeleton to show. The generator returns one only to a signed-in viewer, and this tool asks
                without one.
              </ToolEmpty>
            </ToolSection>
          )}
        </>
      )}

      {!raw && (
        <ToolIntro
          items={[
            {
              term: 'The record',
              text: (
                <>
                  A feed is an <code>app.bsky.feed.generator</code> record. It gives the feed its name and names
                  the service that computes it, by DID.
                </>
              ),
            },
            {
              term: 'The service',
              text: (
                <>
                  That DID has to resolve, and its document has to say where the generator is, in a{' '}
                  <code>#bsky_fg</code> service.
                </>
              ),
            },
            {
              term: 'The skeleton',
              text: (
                <>
                  The generator is asked for the feed with <code>getFeedSkeleton</code>. It answers with post
                  addresses and nothing else, shown here in the order it gave them.
                </>
              ),
            },
            {
              term: 'The AppView',
              text: 'Bluesky has to have indexed the feed before an app can open it. Its view is read too, and the skeleton’s posts are filled in from it.',
            },
          ]}
        />
      )}
    </ToolShell>
  );
}
