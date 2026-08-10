'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import type { Agent } from '@atproto/api';
import { ArrowLeft, Lock, Loader2, Pin, Send } from 'lucide-react';
import ModerationBar from './ModerationBar';
import StatusChip from './StatusChip';
import VoteButtons from './VoteButtons';
import { AuthorLine, TagChip } from './DiscussionCard';
import { fallbackAuthor, useAuthors } from './useAuthors';
import { useVoting } from './useVoting';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import SignInPanel from '@/components/explore/SignInPanel';
import { Skeleton } from '@/components/SkeletonLoader';
import { getBlobUrl } from '@/utils/recordImages';
import { resolveMiniDoc } from '@/utils/atproto/slingshot';
import { sanitizeUrl } from '@/utils/sanitize';
import {
  EMPTY_VOTES,
  loadSpaceContext,
  loadThread,
  loadViewerVotes,
  resolveSpace,
  spaceRef,
  type SpaceContext,
  type Thread,
  type ThreadReply,
  type ViewerVotes,
} from '@/utils/userinput/client';
import type { StrongRef } from '@/utils/userinput/lexicons';
import { createReply } from '@/utils/userinput/writes';

/**
 * A single discussion with its replies.
 *
 * The thread re-resolves the space rather than receiving it from the board,
 * because a thread URL is shareable — someone arriving from a link never
 * passed through the board, and the space is what says who may moderate this
 * discussion and whether it's been hidden.
 */
export default function ThreadView({ did, rkey }: { did: string; rkey: string }) {
  const session = useAtprotoSession();
  const uri = `at://${did}/app.userinput.discussion/${rkey}`;

  const [ctx, setCtx] = useState<SpaceContext | null>(null);
  const [thread, setThread] = useState<Thread | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [votes, setVotes] = useState<ViewerVotes>(EMPTY_VOTES);
  const [nonce, setNonce] = useState(0);
  const [replyingTo, setReplyingTo] = useState<StrongRef | null>(null);
  const [imageHost, setImageHost] = useState<string | null>(null);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    (async () => {
      try {
        const space = await resolveSpace();
        if (cancelled) return;
        if (!space) {
          setError('This board has no space configured yet.');
          return;
        }
        const context = await loadSpaceContext(space);
        if (cancelled) return;
        setCtx(context);

        const loaded = await loadThread(context, uri);
        if (cancelled) return;
        setThread(loaded);
        if (!loaded) setError('That discussion is gone, hidden, or was never here.');
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [uri, nonce]);

  useEffect(() => {
    let cancelled = false;
    if (!session.did) {
      setVotes(EMPTY_VOTES);
      return undefined;
    }
    loadViewerVotes(session.did).then((v) => {
      if (!cancelled) setVotes(v);
    });
    return () => {
      cancelled = true;
    };
  }, [session.did, nonce]);

  // Images are blobs served by the author's PDS, so rendering them needs that
  // host. Only resolved when the discussion actually carries images.
  const hasImages = Boolean(thread?.discussion.record.images?.length);
  useEffect(() => {
    let cancelled = false;
    if (!hasImages) return undefined;
    resolveMiniDoc(did).then((doc) => {
      if (!cancelled) setImageHost(doc?.pds ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [did, hasImages]);

  // Scores live in two places here — the discussion and each reply — so the
  // optimistic delta is routed to whichever the vote was cast on.
  const onDelta = useCallback((subjectUri: string, delta: number) => {
    setThread((prev) => {
      if (!prev) return prev;
      if (subjectUri === prev.discussion.uri) {
        return {
          ...prev,
          discussion: {
            ...prev.discussion,
            counts: {
              ...prev.discussion.counts,
              score: prev.discussion.counts.score + delta,
            },
          },
        };
      }
      return {
        ...prev,
        replies: prev.replies.map((r) =>
          r.uri === subjectUri
            ? { ...r, counts: { ...r.counts, score: r.counts.score + delta } }
            : r,
        ),
      };
    });
  }, []);

  const voting = useVoting({ votes, setVotes, onDelta });

  const authorDids = useMemo(() => {
    if (!thread) return [];
    return [thread.discussion.authorDid, ...thread.replies.map((r) => r.authorDid)];
  }, [thread]);
  const authors = useAuthors(authorDids);

  const tagLabels = useMemo(
    () => new Map((ctx?.space.record.tags ?? []).map((t) => [t.value, t])),
    [ctx],
  );

  if (loading) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <Skeleton width="40%" height="1.75rem" />
        <Skeleton width="100%" height="6rem" />
        <Skeleton width="100%" height="4rem" />
      </div>
    );
  }

  if (error || !thread || !ctx) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
        <BackLink />
        <p className="explore-error">{error ?? 'Discussion not found.'}</p>
      </div>
    );
  }

  const { discussion, replies, lockedAt } = thread;
  const isModerator = Boolean(session.did && ctx.moderatorDids.has(session.did));
  const canReply = Boolean(session.did) && !lockedAt;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      <BackLink />

      <article
        style={{
          display: 'flex',
          gap: '1rem',
          padding: '1.25rem',
          background: 'var(--bg-secondary)',
          border: '1px solid var(--border-medium)',
        }}
      >
        <VoteButtons
          score={discussion.counts.score}
          vote={voting.directionFor(discussion.uri)}
          disabled={!session.did || voting.pending.has(discussion.uri)}
          disabledReason={session.did ? 'Saving…' : 'Sign in to vote'}
          onVote={(next) => voting.cast({ uri: discussion.uri, cid: discussion.cid }, next)}
        />

        <div style={{ minWidth: 0, flex: 1 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'baseline',
              flexWrap: 'wrap',
              gap: '0.5rem',
              marginBottom: '0.5rem',
            }}
          >
            {discussion.pinned ? <Pin size={14} style={{ color: 'var(--text-accent)' }} /> : null}
            <h1
              style={{
                margin: 0,
                fontFamily: 'var(--font-serif)',
                fontSize: '1.375rem',
                lineHeight: 1.25,
                color: 'var(--text-primary)',
              }}
            >
              {discussion.title}
            </h1>
            <StatusChip state={discussion.status} showOpen />
          </div>

          {discussion.body ? <Body text={discussion.body} /> : null}

          {imageHost && discussion.record.images?.length ? (
            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '0.5rem',
                margin: '0.75rem 0',
              }}
            >
              {discussion.record.images.map((img, i) => {
                const url = sanitizeUrl(
                  getBlobUrl(imageHost, discussion.authorDid, img.image.ref.$link),
                );
                if (!url) return null;
                return (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={img.image.ref.$link + i}
                    src={url}
                    alt={img.alt || ''}
                    style={{
                      maxWidth: '100%',
                      maxHeight: '320px',
                      border: '1px solid var(--border-subtle)',
                    }}
                  />
                );
              })}
            </div>
          ) : null}

          {discussion.statusNote ? (
            <blockquote
              style={{
                margin: '0.75rem 0',
                padding: '0.6rem 0.875rem',
                borderLeft: '2px solid var(--text-accent)',
                background: 'var(--bg-tertiary)',
                color: 'var(--text-secondary)',
                fontSize: '0.875rem',
                lineHeight: 1.6,
              }}
            >
              <span className="explore-small-caps" style={{ display: 'block', marginBottom: '0.25rem' }}>
                Note from the team
              </span>
              {discussion.statusNote}
            </blockquote>
          ) : null}

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: '0.5rem 0.75rem',
              marginTop: '0.75rem',
            }}
          >
            <AuthorLine
              author={authors.get(discussion.authorDid) ?? fallbackAuthor(discussion.authorDid)}
              at={discussion.createdAt}
              edited={discussion.editedAt}
            />
            {discussion.tags.map((value) => (
              <TagChip key={value} label={tagLabels.get(value)?.label ?? value} />
            ))}
            <Link
              href={`/explore/${discussion.uri.replace('at://', '')}`}
              style={{
                color: 'var(--text-tertiary)',
                fontSize: '0.75rem',
                fontFamily: 'var(--font-mono)',
              }}
            >
              view record →
            </Link>
          </div>
        </div>
      </article>

      {isModerator ? (
        <ModerationBar
          space={spaceRef(ctx.space)}
          subject={{ uri: discussion.uri, cid: discussion.cid }}
          currentStatus={discussion.status}
          pinned={discussion.pinned}
          locked={Boolean(lockedAt)}
          onChanged={() => setTimeout(refresh, 1500)}
        />
      ) : null}

      {lockedAt ? (
        <p
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.4rem',
            margin: 0,
            padding: '0.6rem 0.875rem',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-tertiary)',
            fontSize: '0.8125rem',
          }}
        >
          <Lock size={13} />
          This thread was locked. Replies posted after{' '}
          <time dateTime={lockedAt}>{new Date(lockedAt).toLocaleDateString()}</time> aren&rsquo;t
          shown.
        </p>
      ) : null}

      <section style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        <span className="explore-small-caps">
          {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
        </span>

        {replies.length === 0 ? (
          <p className="explore-placeholder">No replies yet.</p>
        ) : (
          replies.map((reply) => (
            <ReplyRow
              key={reply.uri}
              reply={reply}
              author={authors.get(reply.authorDid) ?? fallbackAuthor(reply.authorDid)}
              vote={voting.directionFor(reply.uri)}
              canVote={Boolean(session.did) && !voting.pending.has(reply.uri)}
              canReply={canReply}
              onVote={(next) => voting.cast({ uri: reply.uri, cid: reply.cid }, next)}
              onReply={() => setReplyingTo({ uri: reply.uri, cid: reply.cid })}
              replying={replyingTo?.uri === reply.uri}
            />
          ))
        )}
      </section>

      {/* A locked thread takes no replies from anyone, so a signed-out visitor
          gets the lock notice above and no invitation to sign in for nothing. */}
      {!session.did && !lockedAt ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            padding: '1rem 1.125rem',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <span className="explore-small-caps">Sign in to reply</span>
          <SignInPanel />
        </div>
      ) : canReply ? (
        <ReplyComposer
          subject={{ uri: discussion.uri, cid: discussion.cid }}
          parent={replyingTo}
          onCancelParent={() => setReplyingTo(null)}
          onPosted={() => {
            setReplyingTo(null);
            setTimeout(refresh, 1500);
          }}
        />
      ) : null}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/feedback"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        alignSelf: 'flex-start',
        color: 'var(--text-tertiary)',
        fontSize: '0.8125rem',
        textDecoration: 'none',
      }}
    >
      <ArrowLeft size={14} />
      All feedback
    </Link>
  );
}

/** Plain-text body, preserving the author's line breaks. */
function Body({ text }: { text: string }) {
  return (
    <p
      style={{
        margin: 0,
        color: 'var(--text-secondary)',
        fontSize: '0.9375rem',
        lineHeight: 1.65,
        whiteSpace: 'pre-wrap',
        overflowWrap: 'anywhere',
      }}
    >
      {text}
    </p>
  );
}

function ReplyRow({
  reply,
  author,
  vote,
  canVote,
  canReply,
  onVote,
  onReply,
  replying,
}: {
  reply: ThreadReply;
  author: ReturnType<typeof fallbackAuthor>;
  vote: ReturnType<ReturnType<typeof useVoting>['directionFor']>;
  canVote: boolean;
  canReply: boolean;
  onVote: (next: typeof vote) => void;
  onReply: () => void;
  replying: boolean;
}) {
  return (
    <div
      style={{
        // Indent by depth, with a rule marking the nesting so a deep reply
        // still reads as a response to something.
        marginLeft: `${reply.depth * 1.25}rem`,
        padding: '0.75rem 1rem',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-subtle)',
        borderLeft: reply.depth > 0 ? '2px solid var(--border-medium)' : undefined,
      }}
    >
      <div style={{ marginBottom: '0.4rem' }}>
        <AuthorLine author={author} at={reply.createdAt} edited={reply.editedAt} size="sm" />
      </div>
      <Body text={reply.body} />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          marginTop: '0.5rem',
        }}
      >
        <VoteButtons
          score={reply.counts.score}
          vote={vote}
          onVote={onVote}
          disabled={!canVote}
          orientation="horizontal"
        />
        {canReply ? (
          <button
            type="button"
            onClick={onReply}
            style={{
              padding: 0,
              background: 'none',
              border: 'none',
              color: replying ? 'var(--text-accent)' : 'var(--text-tertiary)',
              fontSize: '0.75rem',
              cursor: 'pointer',
            }}
          >
            {replying ? 'Replying…' : 'Reply'}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ReplyComposer({
  subject,
  parent,
  onCancelParent,
  onPosted,
}: {
  subject: StrongRef;
  parent: StrongRef | null;
  onCancelParent: () => void;
  onPosted: () => void;
}) {
  const { agent } = useAtprotoSession();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit = Boolean(agent) && body.trim().length > 0 && !busy;

  const submit = async () => {
    if (!agent || !canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      await createReply(agent as unknown as Agent & { assertDid: string }, {
        subject,
        parent: parent ?? undefined,
        body,
      });
      setBody('');
      onPosted();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.6rem',
        padding: '1rem',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-medium)',
      }}
    >
      {parent ? (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '0.5rem',
            color: 'var(--text-tertiary)',
            fontSize: '0.75rem',
          }}
        >
          <span>Replying to a comment in this thread</span>
          <button
            type="button"
            onClick={onCancelParent}
            style={{
              padding: 0,
              background: 'none',
              border: 'none',
              color: 'var(--text-tertiary)',
              textDecoration: 'underline',
              cursor: 'pointer',
              fontSize: '0.75rem',
            }}
          >
            reply to the discussion instead
          </button>
        </div>
      ) : null}

      <textarea
        className="explore-input explore-textarea"
        rows={3}
        value={body}
        maxLength={10_000}
        placeholder="Add to the discussion…"
        onChange={(e) => setBody(e.target.value)}
      />

      {error ? <p className="explore-error">{error}</p> : null}

      <button
        type="submit"
        disabled={!canSubmit}
        style={{
          alignSelf: 'flex-start',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: '0.45rem 0.9rem',
          background: 'var(--accent-moss)',
          border: '1px solid var(--accent-moss)',
          color: 'var(--text-on-accent)',
          fontFamily: 'var(--font-serif)',
          fontSize: '0.875rem',
          cursor: canSubmit ? 'pointer' : 'not-allowed',
          opacity: canSubmit ? 1 : 0.55,
        }}
      >
        {busy ? <Loader2 size={14} className="explore-spin" /> : <Send size={14} />}
        Post reply
      </button>
    </form>
  );
}
