'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Check, EyeOff, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { toolHref } from '@/lib/tools/catalog';
import {
  APPVIEWS,
  DEFAULT_APPVIEW,
  POST_COLLECTION,
  SEARCH_GRACE_MS,
  authorOf,
  buildAccountChecks,
  buildPostChecks,
  parseShadowbanInput,
  postPresence,
  readAppViewParam,
  readReply,
  shadowbanVerdict,
  targetKey,
  type AppView,
  type Evidence,
  type PostPresence,
  type RepoPost,
  type ReplyProbe,
  type ReplyReading,
  type ShadowbanCheck,
} from '@/lib/tools/shadowban';
import { investigate } from '@/lib/tools/shadowbanClient';
import { formatTidRelative } from '@/utils/atproto/tid';
import { explorePathFromAtUri, shortDid } from '@/utils/atproto/urls';
import { CheckList, type CheckItem } from './Checks';
import {
  ToolCard,
  ToolError,
  ToolFact,
  ToolFacts,
  ToolForm,
  ToolIntro,
  ToolSection,
  ToolShell,
  ToolVerdict,
  type ToolTone,
} from './ToolFrame';
import { useToolQuery, useToolRun } from './useToolQuery';

const SLUG = 'shadowban';
const EXAMPLES = [{ value: 'bsky.app' }, { value: 'atproto.com' }, { value: 'aturi.to' }];

const VERDICT_ICON = {
  pass: <Check size={18} strokeWidth={2.6} />,
  warn: <TriangleAlert size={18} />,
  fail: <X size={18} strokeWidth={2.6} />,
  pending: <LoaderCircle size={18} className="fn-tool-spin" />,
};

/** A typed host, kept as typed until it is submitted. Keyed by the host in use, so it follows the link. */
function HostField({ initial, onSubmit }: { initial: string; onSubmit: (host: string) => void }) {
  const [draft, setDraft] = useState(initial);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (draft.trim()) onSubmit(draft.trim());
  }
  return (
    <form className="fn-tool-shadowban-host" onSubmit={submit}>
      <span className="fx-field">
        <input
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="appview.example.com"
          aria-label="AppView host"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </span>
      <button type="submit" className="fx-btn fx-btn-sm">
        Use
      </button>
    </form>
  );
}

/**
 * Which AppView to ask: the listed ones as chips, and any other by host.
 * "Other" only opens the field; nothing changes until a host is submitted.
 */
function AppViewPicker({
  current,
  problem,
  onChange,
}: {
  current: AppView | null;
  problem: string | null;
  onChange: (param: string) => void;
}) {
  const [typing, setTyping] = useState(false);
  const custom = Boolean(current && !current.listed) || problem !== null;
  const open = typing || custom;
  return (
    <div className="fn-tool-shadowban-appview">
      <span className="fn-tool-shadowban-appview-label">AppView</span>
      <div className="fn-tool-choices" role="group" aria-label="AppView to check">
        {APPVIEWS.map((appview) => {
          const mine = !open && current?.param === appview.param;
          return (
            <button
              key={appview.param}
              type="button"
              className={`fn-chip${mine ? ' fn-chip-mine' : ''}`}
              aria-pressed={mine}
              title={appview.origin.replace(/^https:\/\//, '')}
              onClick={() => {
                setTyping(false);
                onChange(appview.param);
              }}
            >
              {appview.name}
            </button>
          );
        })}
        <button
          type="button"
          className={`fn-chip${open ? ' fn-chip-mine' : ''}`}
          aria-pressed={open}
          onClick={() => setTyping(true)}
        >
          Other
        </button>
      </div>
      {open && (
        <HostField
          key={current && !current.listed ? current.param : ''}
          initial={current && !current.listed ? current.param : ''}
          onSubmit={(host) => {
            // A listed AppView's host selects its chip; any other keeps the field open.
            setTyping(false);
            onChange(host);
          }}
        />
      )}
      {problem && (
        <p className="fn-tool-shadowban-problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

const PRESENCE: Record<PostPresence, { tone: ToolTone | 'outline'; words: (name: string) => string; title: string }> = {
  shown: { tone: 'pass', words: (name) => `On ${name}`, title: 'The AppView returns this post.' },
  missing: { tone: 'fail', words: () => 'Missing', title: 'The PDS has this post, but the AppView won’t return it.' },
  new: { tone: 'outline', words: () => 'Too new to tell', title: 'Posted less than two minutes ago. The AppView may not have it yet.' },
  pending: { tone: 'outline', words: () => '…', title: 'Not compared yet.' },
};

const REPLY_TONE: Record<ReplyReading['outcome'], ToolTone | 'outline'> = {
  shown: 'pass',
  hidden: 'fail',
  explained: 'warn',
  unknown: 'outline',
};

function postKind(post: RepoPost): string {
  if (!post.reply) return 'Post';
  return authorOf(post.reply.root) === authorOf(post.uri) ? 'Reply in its own thread' : 'Reply';
}

/** How a post came out, for its pills: on the AppView or not, in its thread or not, in search or not. */
type PostOutcome = {
  presence: PostPresence;
  reply: ReplyReading | null;
  notInSearch: boolean;
};

function postOutcome(
  post: RepoPost,
  evidence: Evidence,
  shown: Evidence['shown'],
  replyProbe: ReplyProbe | undefined,
  now: number,
): PostOutcome {
  const presence = postPresence(post, shown, now);
  const reply = replyProbe ? readReply(replyProbe, evidence.identity?.did ?? '') : null;
  // Post search returns the author's latest posts, so only a post among the
  // recent ones can be said to be missing from it.
  const recent = evidence.posts?.ok && evidence.posts.value.some((p) => p.uri === post.uri);
  const searchable =
    recent &&
    presence === 'shown' &&
    evidence.postSearch?.ok &&
    post.writtenAt !== null &&
    now - post.writtenAt >= SEARCH_GRACE_MS;
  const notInSearch = Boolean(searchable && evidence.postSearch?.ok && !evidence.postSearch.value.includes(post.uri));
  return { presence, reply, notInSearch };
}

function PostPills({ outcome, evidence, isTarget = false }: { outcome: PostOutcome; evidence: Evidence; isTarget?: boolean }) {
  const shownPill = PRESENCE[outcome.presence];
  return (
    <span className="fn-tool-shadowban-pills">
      {isTarget && (
        <span className="fn-tool-pill" data-tone="outline" title="The post you entered.">
          This post
        </span>
      )}
      <span className="fn-tool-pill" data-tone={shownPill.tone} title={shownPill.title}>
        {outcome.presence === 'pending' && evidence.done ? 'Not compared' : shownPill.words(evidence.appview.name)}
      </span>
      {outcome.reply && (
        <span className="fn-tool-pill" data-tone={REPLY_TONE[outcome.reply.outcome]} title={outcome.reply.reason}>
          {outcome.reply.label}
        </span>
      )}
      {outcome.notInSearch && (
        <span className="fn-tool-pill" data-tone="warn" title="Searching this author’s posts doesn’t find it.">
          Not in search
        </span>
      )}
    </span>
  );
}

function When({ post }: { post: RepoPost }) {
  if (post.writtenAt === null) return null;
  const date = new Date(post.writtenAt);
  return (
    <>
      {' · '}
      <time dateTime={date.toISOString()} title={date.toISOString()}>
        {formatTidRelative(date)}
      </time>
    </>
  );
}

function PostRow({ post, evidence, now, isTarget }: { post: RepoPost; evidence: Evidence; now: number; isTarget: boolean }) {
  const replyProbe = evidence.replies?.ok ? evidence.replies.value.find((r) => r.uri === post.uri) : undefined;
  const outcome = postOutcome(post, evidence, evidence.shown, replyProbe, now);
  const text = post.text.trim();
  return (
    <li className="fn-tool-row fn-tool-shadowban-post" data-target={isTarget || undefined}>
      <div className="fn-tool-row-main">
        <Link
          href={explorePathFromAtUri(post.uri) ?? `/explore/${authorOf(post.uri)}`}
          prefetch={false}
          className="fn-tool-row-title"
          data-quiet={text ? undefined : true}
        >
          {text ? (text.length > 140 ? `${text.slice(0, 140)}…` : text) : 'No text'}
        </Link>
        <span className="fn-tool-row-sub">
          {postKind(post)}
          <When post={post} />
          {outcome.reply && outcome.reply.outcome !== 'shown' ? ` · ${outcome.reply.reason}` : ''}
        </span>
      </div>
      <PostPills outcome={outcome} evidence={evidence} isTarget={isTarget} />
    </li>
  );
}

/** The post that was asked about: its full text, how it came out, and its address. */
function TargetPost({ evidence, uri, now }: { evidence: Evidence; uri: string; now: number }) {
  const { post } = evidence;
  const labels = `${toolHref('labels')}?subject=${encodeURIComponent(uri)}`;
  if (!post) {
    return (
      <ToolCard>
        <p className="fn-tool-shadowban-target-missing">Reading the post from the PDS…</p>
      </ToolCard>
    );
  }
  if (!post.ok || !post.value) {
    return (
      <ToolCard>
        <p className="fn-tool-shadowban-target-missing">
          {post.ok ? 'There’s no post at this address on the PDS.' : 'The post couldn’t be read from the PDS.'}
        </p>
        <ToolFacts>
          <ToolFact label="Post" copy={uri} wide>
            {uri}
          </ToolFact>
        </ToolFacts>
      </ToolCard>
    );
  }
  const record = post.value;
  const replyProbe = evidence.postThread?.ok ? evidence.postThread.value : undefined;
  const outcome = postOutcome(record, evidence, evidence.postShown, replyProbe, now);
  const text = record.text.trim();
  return (
    <ToolCard className="fn-tool-shadowban-target">
      <p className="fn-tool-shadowban-target-text" data-quiet={text ? undefined : true}>
        {text || 'No text'}
      </p>
      <div className="fn-tool-shadowban-target-meta">
        <span className="fn-tool-row-sub">
          {postKind(record)}
          <When post={record} />
        </span>
        <PostPills outcome={outcome} evidence={evidence} />
      </div>
      <ToolFacts>
        <ToolFact label="Post" copy={record.uri} wide>
          {record.uri}
        </ToolFact>
      </ToolFacts>
      <div className="fn-tool-actions">
        <Link
          href={explorePathFromAtUri(record.uri) ?? `/explore/${authorOf(record.uri)}`}
          prefetch={false}
          className="fx-btn fx-btn-sm"
        >
          Open the post in the Explorer
        </Link>
        <Link href={labels} className="fx-btn fx-btn-sm">
          Check the post’s labels
        </Link>
      </div>
    </ToolCard>
  );
}

function toItems(checks: ShadowbanCheck[]): CheckItem[] {
  return checks.map((check) => ({
    id: check.id,
    status: check.status,
    title: check.title,
    summary: check.summary,
    detail: check.detail?.map((line, index) => <div key={index}>{line}</div>),
  }));
}

/**
 * Compares an account's repository on its PDS with what an AppView shows
 * of it, and says what the AppView leaves out. A post that was entered is
 * checked on its own, and its author in full. The logic is in
 * src/lib/tools/shadowban.ts and the requests in shadowbanClient.ts; this
 * runs them and draws the result.
 */
export default function ShadowbanChecker() {
  const [{ subject: raw, appview: rawAppview }, setQuery] = useToolQuery(['subject', 'appview'] as const);
  const input = raw ? parseShadowbanInput(raw) : null;
  const target = input?.ok ? input.target : null;
  const choice = readAppViewParam(rawAppview);
  const appview = choice.ok ? choice.appview : null;
  const runKey = target && appview ? `${targetKey(target)}|${appview.origin}` : null;

  const run = useToolRun<Evidence>(runKey, ({ signal, publish }) =>
    investigate(target as NonNullable<typeof target>, appview as AppView, signal, publish),
  );

  const evidence: Evidence | null = run.data ?? (target && appview ? { target, appview } : null);
  const now = evidence?.checkedAt ?? 0;
  const live = evidence && run.status !== 'error' ? evidence : null;
  const postChecks = live ? buildPostChecks(live, now) : [];
  const accountChecks = live ? buildAccountChecks(live, now) : [];
  const verdict = live ? shadowbanVerdict(live, [...postChecks, ...accountChecks]) : null;

  const identity = evidence?.identity;
  const profile = evidence?.profile?.state === 'found' ? evidence.profile : null;
  const handle = profile?.handle ?? identity?.handle ?? null;
  const who = handle ? `@${handle}` : identity ? shortDid(identity.did) : '';
  const posts = evidence?.posts?.ok ? evidence.posts.value : [];
  const postUri =
    target?.kind === 'post' ? `at://${identity?.did ?? target.actor}/${POST_COLLECTION}/${target.rkey}` : null;
  const appviewParam = appview && appview.param !== DEFAULT_APPVIEW.param ? appview.param : '';

  const share = target
    ? `${toolHref(SLUG)}?subject=${encodeURIComponent(raw.trim())}${
        appviewParam ? `&appview=${encodeURIComponent(appviewParam)}` : ''
      }`
    : undefined;

  const again =
    run.status === 'loading' ? (
      'Checking…'
    ) : (
      <button type="button" className="fn-tool-link" onClick={run.rerun}>
        Check again
      </button>
    );

  return (
    <ToolShell
      slug={SLUG}
      share={share}
      form={
        <>
          <ToolForm
            value={raw}
            onSubmit={(value) => setQuery({ subject: value })}
            label="Account or post to check"
            placeholder="Handle, DID, or a link to a post"
            busy={run.status === 'loading'}
            examples={EXAMPLES}
            icon={<EyeOff size={17} />}
          />
          <AppViewPicker
            current={appview}
            problem={choice.ok ? null : choice.reason}
            onChange={(param) => {
              // Written to the link in its canonical form, so a typed host for
              // a listed AppView reads as that AppView, and Bluesky as nothing.
              const read = readAppViewParam(param);
              const value = read.ok ? read.appview.param : param;
              setQuery({ appview: value === DEFAULT_APPVIEW.param ? '' : value }, { replace: true });
            }}
          />
        </>
      }
    >
      {input && !input.ok && <ToolError>{input.reason}</ToolError>}
      {run.status === 'error' && <ToolError onRetry={run.rerun}>{run.error}</ToolError>}

      {verdict && live && (
        <>
          <ToolVerdict
            tone={verdict.tone === 'pending' ? 'info' : verdict.tone}
            title={verdict.title}
            icon={VERDICT_ICON[verdict.tone]}
          >
            {verdict.text}
          </ToolVerdict>

          {postUri && (
            <ToolSection title="This post" meta={again}>
              <div className="fn-tool-shadowban-stack">
                <TargetPost evidence={live} uri={postUri} now={now} />
                <CheckList checks={toItems(postChecks)} label={`Checks on this post on ${live.appview.name}`} />
              </div>
            </ToolSection>
          )}

          <ToolSection title={postUri ? 'Account checks' : 'Checks'} meta={postUri ? undefined : again}>
            <CheckList checks={toItems(accountChecks)} label={`Checks on the account on ${live.appview.name}`} />
          </ToolSection>

          {identity && (
            <ToolSection title="Account">
              <ToolCard>
                <ToolFacts>
                  <ToolFact label="Account" plain>
                    {profile?.displayName ? `${profile.displayName} (${who})` : who}
                  </ToolFact>
                  <ToolFact label="DID" copy={identity.did}>
                    {identity.did}
                  </ToolFact>
                  <ToolFact label="PDS">
                    <Link
                      href={`/explore/pds/${encodeURIComponent(identity.pds.replace(/^https?:\/\//, ''))}`}
                      prefetch={false}
                    >
                      {identity.pds.replace(/^https?:\/\//, '')}
                    </Link>
                  </ToolFact>
                  <ToolFact label="AppView">{live.appview.origin.replace(/^https?:\/\//, '')}</ToolFact>
                </ToolFacts>
                <div className="fn-tool-actions">
                  <Link href={`/explore/${identity.did}`} prefetch={false} className="fx-btn fx-btn-sm">
                    Open the account in the Explorer
                  </Link>
                  <Link href={`${toolHref('labels')}?subject=${encodeURIComponent(identity.did)}`} className="fx-btn fx-btn-sm">
                    Check the account’s labels
                  </Link>
                </div>
              </ToolCard>
            </ToolSection>
          )}

          {posts.length > 0 && (
            <ToolSection title="Recent posts" meta={`${posts.length} from the PDS, newest first`}>
              <ToolCard flush>
                <ul className="fn-tool-rows">
                  {posts.map((post) => (
                    <PostRow key={post.uri} post={post} evidence={live} now={now} isTarget={post.uri === postUri} />
                  ))}
                </ul>
              </ToolCard>
            </ToolSection>
          )}
        </>
      )}

      {!raw && (
        <ToolIntro
          items={[
            {
              term: 'Posts on the PDS',
              text: 'Reads the account’s 25 latest posts directly from its PDS, the server that stores them. AppViews can’t change this copy.',
            },
            {
              term: 'Posts on the AppView',
              text: 'Asks the AppView for each of those posts. If the PDS has a post and the AppView won’t return it, the AppView is hiding it. If you enter a link to a post, that post is checked as well.',
            },
            {
              term: 'Replies in threads',
              text: 'Looks for each recent reply under the post it replies to. This is where Bluesky’s “needs review” status shows up now that it’s no longer a label. The reply opens on its own but is missing from the thread. Blocks and reply limits can also hide a reply, so the tool checks for those first.',
            },
            {
              term: 'Search',
              text: 'Searches for the account by its handle and for its posts by author. If typeahead (the suggestions that appear as you type) finds the account but full search doesn’t, the AppView is leaving it out of search.',
            },
          ]}
        />
      )}
    </ToolShell>
  );
}
