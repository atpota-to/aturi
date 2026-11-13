'use client';

import { useState, type FormEvent, type ReactNode } from 'react';
import Link from 'next/link';
import { Check, EyeOff, Info, LoaderCircle, Minus, Search, TriangleAlert, X } from 'lucide-react';
import AppearIn from '@/components/explore/AppearIn';
import CopyButton from '@/components/explore/CopyButton';
import ShareLinkChip from '@/components/explore/ShareLinkChip';
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
  targetKey,
  type AppView,
  type CheckStatus,
  type Evidence,
  type PostPresence,
  type RepoPost,
  type ReplyReading,
  type ShadowbanCheck,
} from '@/lib/tools/shadowban';
import { investigate } from '@/lib/tools/shadowbanClient';
import { formatTidRelative } from '@/utils/atproto/tid';
import { explorePathFromAtUri, shortDid } from '@/utils/atproto/urls';
import { useToolQuery, useToolRun } from './useToolQuery';

/**
 * The shadowban checker in the current site's design: the Explorer's
 * landing header (kicker, headline, search field, try-chips) over the PDS
 * page's sections of bordered rows. Its look lives in globals.css under
 * shadowban-. The logic is in src/lib/tools/shadowban.ts and the requests
 * in shadowbanClient.ts; this runs them and draws the result.
 */

const PATH = '/tools/shadowban';
const EXAMPLES = ['bsky.app', 'atproto.com', 'aturi.to'];

type Tone = 'pass' | 'warn' | 'fail' | 'info' | 'pending';

/** The word beside each mark, so a status never rests on colour alone. */
const STATUS_WORD: Record<CheckStatus, string> = {
  pass: 'Pass',
  warn: 'Warning',
  fail: 'Fail',
  info: 'Note',
  skip: 'Skipped',
  pending: 'Checking',
};

function Mark({ status, size = 13 }: { status: CheckStatus; size?: number }) {
  const glyph =
    status === 'pass' ? (
      <Check size={size} strokeWidth={2.6} />
    ) : status === 'warn' ? (
      <TriangleAlert size={size} />
    ) : status === 'fail' ? (
      <X size={size} strokeWidth={2.6} />
    ) : status === 'info' ? (
      <Info size={size} />
    ) : status === 'skip' ? (
      <Minus size={size} />
    ) : (
      <LoaderCircle size={size} className="shadowban-spin" />
    );
  return (
    <span aria-hidden className="shadowban-mark" data-status={status}>
      {glyph}
    </span>
  );
}

/** The search field and its button, as the Explorer's. Typing is kept here until it is submitted. */
function SearchForm({ value, busy, onSubmit }: { value: string; busy: boolean; onSubmit: (value: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    setDraft(value);
  }
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(draft.trim());
  }
  return (
    <form className="shadowban-search" onSubmit={submit}>
      <div className="shadowban-search-field">
        <Search size={16} aria-hidden />
        <input
          type="text"
          autoComplete="off"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          placeholder="handle, DID, or a link to a post"
          aria-label="Account or post to check"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
      <button type="submit" className="shadowban-submit" disabled={busy}>
        {busy ? 'Checking…' : 'Check'}
      </button>
    </form>
  );
}

/** A typed host, kept as typed until it is submitted. Keyed by the host in use, so it follows the link. */
function HostField({ initial, onSubmit }: { initial: string; onSubmit: (host: string) => void }) {
  const [draft, setDraft] = useState(initial);
  function submit(event: FormEvent) {
    event.preventDefault();
    if (draft.trim()) onSubmit(draft.trim());
  }
  return (
    <form className="shadowban-host" onSubmit={submit}>
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
      <button type="submit" className="shadowban-button">
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
    <div className="shadowban-appview">
      <span className="shadowban-chips-label">AppView:</span>
      <div className="shadowban-chips" role="group" aria-label="AppView to check">
        {APPVIEWS.map((appview) => {
          const mine = !open && current?.param === appview.param;
          return (
            <button
              key={appview.param}
              type="button"
              className="shadowban-chip"
              data-mine={mine || undefined}
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
          className="shadowban-chip"
          data-mine={open || undefined}
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
        <p className="explore-error shadowban-appview-problem" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

function Verdict({ tone, title, children }: { tone: Tone; title: string; children: ReactNode }) {
  const status: CheckStatus = tone === 'pending' ? 'pending' : tone;
  return (
    <div className="shadowban-verdict" data-tone={tone} role="status">
      <Mark status={status} size={16} />
      <div>
        <strong>{title}</strong>
        {children ? <p>{children}</p> : null}
      </div>
    </div>
  );
}

function Section({ title, meta, children }: { title: string; meta?: ReactNode; children: ReactNode }) {
  return (
    <section className="shadowban-section">
      <header className="shadowban-section-head">
        <h2>{title}</h2>
        {meta != null && meta !== false && <span>{meta}</span>}
      </header>
      {children}
    </section>
  );
}

function CheckRow({ check }: { check: ShadowbanCheck }) {
  return (
    <li className="shadowban-check" data-status={check.status}>
      <Mark status={check.status} />
      <div className="shadowban-check-body">
        <div className="shadowban-check-head">
          <span className="shadowban-check-title">{check.title}</span>
          <span className="explore-small-caps shadowban-check-state">{STATUS_WORD[check.status]}</span>
        </div>
        <p className="shadowban-check-summary">{check.summary}</p>
        {check.detail?.map((line, index) => (
          <p key={index} className="shadowban-check-detail">
            {line}
          </p>
        ))}
      </div>
    </li>
  );
}

const PRESENCE: Record<PostPresence, { tone: Tone; words: (name: string) => string; title: string }> = {
  shown: { tone: 'pass', words: (name) => `on ${name}`, title: 'The AppView returns this post.' },
  missing: { tone: 'fail', words: () => 'missing', title: 'In the repository, but the AppView will not return it.' },
  new: { tone: 'info', words: () => 'too new to tell', title: 'Written under two minutes ago; it may not be indexed yet.' },
  pending: { tone: 'info', words: () => '…', title: 'Not compared yet.' },
};

const REPLY_TONE: Record<ReplyReading['outcome'], Tone> = {
  shown: 'pass',
  hidden: 'fail',
  explained: 'warn',
  unknown: 'info',
};

function Tag({ tone, title, children }: { tone: Tone; title: string; children: ReactNode }) {
  return (
    <span className="shadowban-tag" data-tone={tone} title={title}>
      {children}
    </span>
  );
}

function PostRow({ post, evidence, now }: { post: RepoPost; evidence: Evidence; now: number }) {
  const presence = postPresence(post, evidence.shown, now);
  const shownTag = PRESENCE[presence];
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
      ? 'reply in its own thread'
      : 'reply'
    : 'post';

  return (
    <li className="shadowban-post">
      <div className="shadowban-post-main">
        <Link
          href={explorePathFromAtUri(post.uri) ?? `/explore/${authorOf(post.uri)}`}
          prefetch={false}
          className="shadowban-post-text"
          data-quiet={text ? undefined : true}
        >
          {text ? (text.length > 140 ? `${text.slice(0, 140)}…` : text) : 'No text'}
        </Link>
        <span className="shadowban-post-sub">
          {kind}
          {when && (
            <>
              {' · '}
              <time dateTime={new Date(post.writtenAt as number).toISOString()}>{when}</time>
            </>
          )}
        </span>
        {reply && reply.outcome !== 'shown' && <span className="shadowban-post-reason">{reply.reason}</span>}
      </div>
      <span className="shadowban-tags">
        <Tag tone={shownTag.tone} title={shownTag.title}>
          {presence === 'pending' && evidence.done ? 'not compared' : shownTag.words(evidence.appview.name)}
        </Tag>
        {reply && (
          <Tag tone={REPLY_TONE[reply.outcome]} title={reply.reason}>
            {reply.label.toLowerCase()}
          </Tag>
        )}
        {notInSearch && (
          <Tag tone="warn" title="Post search by this author does not return it.">
            not in search
          </Tag>
        )}
      </span>
    </li>
  );
}

function Fact({ label, children, copy, wide }: { label: string; children: ReactNode; copy?: string; wide?: boolean }) {
  return (
    <div className="shadowban-fact" data-wide={wide || undefined}>
      <dt className="explore-small-caps">{label}</dt>
      <dd>
        <span>{children}</span>
        {copy ? <CopyButton value={copy} label="Copy" compact variant="subtle" /> : null}
      </dd>
    </div>
  );
}

const INTRO = [
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
    text: 'Each recent reply is looked for under the post it answers. This is where Bluesky’s unlabelled “needs review” shows: the reply exists and loads on its own, but is left out of the thread. A block or the thread’s reply rules can keep a reply out too, so both are looked up first.',
  },
  {
    term: 'Search',
    text: 'The account is searched for by its handle, with typeahead as the control, and its posts by author. Typeahead finding it where search does not means it was indexed and then left out.',
  },
];

/**
 * The kicker, headline and lead. Exported for the page's Suspense fallback,
 * so the static HTML carries them before the query string has been read.
 */
export function ShadowbanHeading({ share = PATH }: { share?: string }) {
  return (
    <>
      <div className="shadowban-head-top">
        <div className="shadowban-kicker">
          <EyeOff size={12} aria-hidden /> Shadowban checker
        </div>
        <ShareLinkChip url={share} />
      </div>
      <h1 className="shadowban-title">Is an AppView hiding it?</h1>
      <p className="shadowban-lead">
        An AppView can hide an account without a label: its replies left out of threads, its posts
        or profile left out of search. This reads the repository from its PDS and asks an AppView
        for the same things.
      </p>
    </>
  );
}

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

  const identity = evidence?.identity;
  const profile = evidence?.profile?.state === 'found' ? evidence.profile : null;
  const handle = profile?.handle ?? identity?.handle ?? null;
  const who = handle ? `@${handle}` : identity ? shortDid(identity.did) : '';
  const isPost = target?.kind === 'post';
  const posts = evidence?.posts?.ok ? evidence.posts.value : [];
  const appviewParam = appview && appview.param !== DEFAULT_APPVIEW.param ? appview.param : '';
  const share = target
    ? `${PATH}?subject=${encodeURIComponent(raw.trim())}${appviewParam ? `&appview=${encodeURIComponent(appviewParam)}` : ''}`
    : PATH;

  return (
    <div className="shadowban">
      <AppearIn rise>
        <header>
          <ShadowbanHeading share={share} />
          <SearchForm value={raw} busy={run.status === 'loading'} onSubmit={(value) => setQuery({ subject: value })} />
          <div className="shadowban-tries">
            <span className="shadowban-chips-label">Try:</span>
            {EXAMPLES.map((example) => (
              <button key={example} type="button" className="shadowban-try" onClick={() => setQuery({ subject: example })}>
                {example}
              </button>
            ))}
          </div>
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
        </header>
      </AppearIn>

      {(input && !input.ok) || run.status === 'error' || verdict || !raw ? (
        <AppearIn delay={0.08} className="shadowban-body">
          {input && !input.ok && (
            <p className="explore-error" role="alert">
              {input.reason}
            </p>
          )}
          {run.status === 'error' && (
            <div className="shadowban-failed" role="alert">
              <p className="explore-error">{run.error}</p>
              <button type="button" className="shadowban-button" onClick={run.rerun}>
                Try again
              </button>
            </div>
          )}

          {verdict && evidence && (
            <>
              <Verdict tone={verdict.tone} title={verdict.title}>
                {verdict.text}
              </Verdict>

              <Section
                title="Checks"
                meta={
                  run.status === 'loading' ? (
                    'checking…'
                  ) : (
                    <button type="button" className="shadowban-link" onClick={run.rerun}>
                      check again
                    </button>
                  )
                }
              >
                <ul className="shadowban-list" aria-label={`Checks on ${evidence.appview.name}`}>
                  {checks.map((check) => (
                    <CheckRow key={check.id} check={check} />
                  ))}
                </ul>
              </Section>

              {!isPost && posts.length > 0 && (
                <Section title="Recent posts" meta={`${posts.length} from the repository, newest first`}>
                  <ul className="shadowban-list">
                    {posts.map((post) => (
                      <PostRow key={post.uri} post={post} evidence={evidence} now={now} />
                    ))}
                  </ul>
                </Section>
              )}

              {identity && (
                <Section title="Checked">
                  <div className="shadowban-card">
                    <dl className="shadowban-facts">
                      <Fact label={isPost ? 'Author' : 'Account'}>
                        {profile?.displayName ? `${profile.displayName} (${who})` : who}
                      </Fact>
                      <Fact label="DID" copy={identity.did}>
                        {identity.did}
                      </Fact>
                      <Fact label="PDS">
                        <Link
                          href={`/explore/pds/${encodeURIComponent(identity.pds.replace(/^https?:\/\//, ''))}`}
                          prefetch={false}
                        >
                          {identity.pds.replace(/^https?:\/\//, '')}
                        </Link>
                      </Fact>
                      <Fact label="AppView">{evidence.appview.origin.replace(/^https?:\/\//, '')}</Fact>
                      {isPost && posts[0] && (
                        <Fact label="Post" copy={posts[0].uri} wide>
                          {posts[0].uri}
                        </Fact>
                      )}
                    </dl>
                    <div className="shadowban-actions">
                      <Link
                        href={(isPost && posts[0] ? explorePathFromAtUri(posts[0].uri) : null) ?? `/explore/${identity.did}`}
                        prefetch={false}
                        className="shadowban-button"
                      >
                        Open in the Explorer
                      </Link>
                      {isPost && (
                        <button
                          type="button"
                          className="shadowban-button"
                          onClick={() => setQuery({ subject: identity.did })}
                        >
                          Check the author
                        </button>
                      )}
                    </div>
                  </div>
                </Section>
              )}
            </>
          )}

          {!raw && (
            <Section title="What it checks">
              <div className="shadowban-card">
                <ol className="shadowban-steps">
                  {INTRO.map((item, index) => (
                    <li key={item.term}>
                      <span aria-hidden className="shadowban-step-n">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div>
                        <strong>{item.term}</strong>
                        <p>{item.text}</p>
                      </div>
                    </li>
                  ))}
                </ol>
                <p className="shadowban-caveat">
                  Everything is asked logged out, as anyone could. What an AppView does only for
                  signed-in people (ranking replies, folding some under “hidden replies”, feeds) is out
                  of sight here. A difference is a sign rather than proof: an AppView also drops a post
                  it cannot read.
                </p>
              </div>
            </Section>
          )}
        </AppearIn>
      ) : null}
    </div>
  );
}
