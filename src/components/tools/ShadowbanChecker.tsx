'use client';

import { useState, type FormEvent } from 'react';
import Link from 'next/link';
import { Check, EyeOff, LoaderCircle, TriangleAlert, X } from 'lucide-react';
import { toolHref } from '@/lib/tools/catalog';
import { targetKey } from '@/lib/tools/labels';
import {
  APPVIEWS,
  DEFAULT_APPVIEW,
  SEARCH_GRACE_MS,
  authorOf,
  buildChecks,
  parseShadowbanInput,
  postPresence,
  readAppViewParam,
  readReply,
  shadowbanVerdict,
  type AppView,
  type Evidence,
  type PostPresence,
  type RepoPost,
  type ReplyReading,
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
  missing: {
    tone: 'fail',
    words: () => 'Missing',
    title: 'In the repository, but the AppView will not return it.',
  },
  new: { tone: 'outline', words: () => 'Too new to tell', title: 'Written under two minutes ago; it may not be indexed yet.' },
  pending: { tone: 'outline', words: () => '…', title: 'Not compared yet.' },
};

const REPLY_TONE: Record<ReplyReading['outcome'], ToolTone | 'outline'> = {
  shown: 'pass',
  hidden: 'fail',
  explained: 'warn',
  unknown: 'outline',
};

function PostRow({
  post,
  evidence,
  now,
}: {
  post: RepoPost;
  evidence: Evidence;
  now: number;
}) {
  const presence = postPresence(post, evidence.shown, now);
  const shownPill = PRESENCE[presence];
  const replyProbe = evidence.replies?.ok ? evidence.replies.value.find((r) => r.uri === post.uri) : undefined;
  const reply = replyProbe ? readReply(replyProbe, evidence.identity?.did ?? '') : null;
  const searchable =
    presence === 'shown' &&
    evidence.postSearch?.ok &&
    post.writtenAt !== null &&
    now - post.writtenAt >= SEARCH_GRACE_MS;
  const notInSearch = searchable && evidence.postSearch?.ok && !evidence.postSearch.value.includes(post.uri);
  const text = post.text.trim();
  const when = post.writtenAt !== null ? formatTidRelative(new Date(post.writtenAt)) : null;
  const kind = post.reply
    ? authorOf(post.reply.root) === authorOf(post.uri)
      ? 'Reply in its own thread'
      : 'Reply'
    : 'Post';

  return (
    <li className="fn-tool-row fn-tool-shadowban-post">
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
          {kind}
          {when && (
            <>
              {' · '}
              <time dateTime={new Date(post.writtenAt as number).toISOString()}>{when}</time>
            </>
          )}
          {reply && reply.outcome !== 'shown' ? ` · ${reply.reason}` : ''}
        </span>
      </div>
      <span className="fn-tool-shadowban-pills">
        <span className="fn-tool-pill" data-tone={shownPill.tone} title={shownPill.title}>
          {presence === 'pending' && evidence.done ? 'Not compared' : shownPill.words(evidence.appview.name)}
        </span>
        {reply && (
          <span className="fn-tool-pill" data-tone={REPLY_TONE[reply.outcome]} title={reply.reason}>
            {reply.label}
          </span>
        )}
        {notInSearch && (
          <span className="fn-tool-pill" data-tone="warn" title="Post search by this author does not return it.">
            Not in search
          </span>
        )}
      </span>
    </li>
  );
}

/**
 * Compares an account's repository on its PDS with what an AppView shows
 * of it, and says what the AppView leaves out. The logic is in
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
  const checks = evidence && run.status !== 'error' ? buildChecks(evidence, now) : [];
  const verdict = evidence && run.status !== 'error' ? shadowbanVerdict(evidence, checks) : null;
  const items: CheckItem[] = checks.map((check) => ({
    id: check.id,
    status: check.status,
    title: check.title,
    summary: check.summary,
    detail: check.detail?.map((line, index) => <div key={index}>{line}</div>),
  }));

  const identity = evidence?.identity;
  const profile = evidence?.profile?.state === 'found' ? evidence.profile : null;
  const handle = profile?.handle ?? identity?.handle ?? null;
  const who = handle ? `@${handle}` : identity ? shortDid(identity.did) : '';
  const isPost = target?.kind === 'post';
  const posts = evidence?.posts?.ok ? evidence.posts.value : [];
  const appviewParam = appview && appview.param !== DEFAULT_APPVIEW.param ? appview.param : '';

  const share = target
    ? `${toolHref(SLUG)}?subject=${encodeURIComponent(raw.trim())}${
        appviewParam ? `&appview=${encodeURIComponent(appviewParam)}` : ''
      }`
    : undefined;

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
            <CheckList checks={items} label={`Checks on ${evidence.appview.name}`} />
          </ToolSection>

          {!isPost && posts.length > 0 && (
            <ToolSection title="Recent posts" meta={`${posts.length} from the repository, newest first`}>
              <ToolCard flush>
                <ul className="fn-tool-rows">
                  {posts.map((post) => (
                    <PostRow key={post.uri} post={post} evidence={evidence} now={now} />
                  ))}
                </ul>
              </ToolCard>
            </ToolSection>
          )}

          {identity && (
            <ToolSection title="Checked">
              <ToolCard>
                <ToolFacts>
                  <ToolFact label={isPost ? 'Author' : 'Account'} plain>
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
                  <ToolFact label="AppView">{evidence.appview.origin.replace(/^https?:\/\//, '')}</ToolFact>
                  {isPost && posts[0] && (
                    <ToolFact label="Post" copy={posts[0].uri} wide>
                      {posts[0].uri}
                    </ToolFact>
                  )}
                </ToolFacts>
                <div className="fn-tool-actions">
                  <Link
                    href={(isPost && posts[0] ? explorePathFromAtUri(posts[0].uri) : null) ?? `/explore/${identity.did}`}
                    prefetch={false}
                    className="fx-btn fx-btn-sm"
                  >
                    Open in the Explorer
                  </Link>
                  {isPost && (
                    <button
                      type="button"
                      className="fx-btn fx-btn-sm"
                      onClick={() => setQuery({ subject: identity.did })}
                    >
                      Check the author
                    </button>
                  )}
                  <Link
                    href={`${toolHref('labels')}?subject=${encodeURIComponent(isPost && posts[0] ? posts[0].uri : identity.did)}`}
                    className="fx-btn fx-btn-sm"
                  >
                    Check labels
                  </Link>
                </div>
              </ToolCard>
            </ToolSection>
          )}
        </>
      )}

      {!raw && (
        <ToolIntro
          items={[
            {
              term: 'The repository, from its PDS',
              text: 'The account’s posts as they are, read from the server that hosts them. Nothing an AppView decides changes this copy.',
            },
            {
              term: 'The same posts, from the AppView',
              text: 'Each of the most recent posts is asked for by its address. One the repository has and the AppView will not return is hidden.',
            },
            {
              term: 'Replies, in their threads',
              text: (
                <>
                  Each recent reply is looked for under the post it answers. This is where Bluesky’s
                  unlabelled <q>needs review</q> shows: the reply exists and loads on its own, but is left
                  out of the thread. A block or the thread’s reply rules can keep a reply out too, so both
                  are looked up first.
                </>
              ),
            },
            {
              term: 'Search',
              text: 'The account is searched for by its handle, with typeahead as the control, and its posts by author. Typeahead finding it where search does not means it was indexed and then left out.',
            },
          ]}
        >
          <p className="fn-tool-note fn-tool-shadowban-caveat">
            Everything is asked logged out, as anyone could. What an AppView does only for signed-in
            people (ranking replies, folding some under “hidden replies”, feeds) is out of sight here.
            A difference is a sign rather than proof: an AppView also drops a post it cannot read.
          </p>
        </ToolIntro>
      )}
    </ToolShell>
  );
}
