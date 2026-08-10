'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { MessageSquarePlus, RefreshCw } from 'lucide-react';
import Composer from './Composer';
import DiscussionCard from './DiscussionCard';
import SpaceSetup from './SpaceSetup';
import { useAuthors } from './useAuthors';
import { useBoard } from './useBoard';
import { useVoting } from './useVoting';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import SignInPanel from '@/components/explore/SignInPanel';
import { Skeleton } from '@/components/SkeletonLoader';
import { sanitizeUrl } from '@/utils/sanitize';
import { spaceRef, sortDiscussions, type DiscussionSort } from '@/utils/userinput/client';
import { USERINPUT_HOME, USERINPUT_LEXICONS_PATH } from '@/utils/userinput/config';
import { UI_STATE_META, type UiState } from '@/utils/userinput/lexicons';

const SORTS: { id: DiscussionSort; label: string }[] = [
  { id: 'top', label: 'Top' },
  { id: 'new', label: 'New' },
  { id: 'discussed', label: 'Discussed' },
];

/** Statuses that mean "this is resolved", collapsed behind one filter. */
const CLOSED_STATES: ReadonlySet<UiState> = new Set([
  'implemented',
  'declined',
  'duplicate',
  'closed',
]);

export default function FeedbackBoard() {
  const { did } = useAtprotoSession();
  const board = useBoard();
  const { space, ctx, discussions, loading, error, votes, setVotes, bumpScore, refresh } = board;

  const [sort, setSort] = useState<DiscussionSort>('top');
  const [tagFilter, setTagFilter] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<'open' | 'all' | UiState>('open');
  const [composing, setComposing] = useState(false);

  const voting = useVoting({ votes, setVotes, onDelta: bumpScore });
  const authors = useAuthors(useMemo(() => discussions.map((d) => d.authorDid), [discussions]));

  const tagLabels = useMemo(
    () => new Map((space?.record.tags ?? []).map((t) => [t.value, t])),
    [space],
  );

  const visible = useMemo(() => {
    const filtered = discussions.filter((d) => {
      if (tagFilter && !d.tags.includes(tagFilter)) return false;
      if (statusFilter === 'all') return true;
      if (statusFilter === 'open') return !CLOSED_STATES.has(d.status);
      return d.status === statusFilter;
    });
    return sortDiscussions(filtered, sort);
  }, [discussions, sort, statusFilter, tagFilter]);

  if (loading && !space) return <BoardSkeleton rows={4} />;

  if (!space) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
        <BoardIntro />
        {error ? <p className="explore-error">{error}</p> : null}
        <SpaceSetup onCreated={refresh} />
      </div>
    );
  }

  const icon = space.iconUrl ? sanitizeUrl(space.iconUrl) : '';
  const statusCounts = countByStatus(discussions);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
      <header style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start' }}>
        {icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={icon}
            alt=""
            width={44}
            height={44}
            style={{ width: 44, height: 44, objectFit: 'cover', flexShrink: 0 }}
          />
        ) : null}
        <div style={{ minWidth: 0 }}>
          <h1
            style={{
              margin: '0 0 0.35rem',
              fontFamily: 'var(--font-serif)',
              fontSize: '1.75rem',
              lineHeight: 1.2,
              color: 'var(--text-primary)',
            }}
          >
            {/* The page is titled by what it's for, not by the space record's
                own name: on aturi.to that name would just read "Aturi". */}
            Feedback
          </h1>
          {space.record.description ? (
            <p
              style={{
                margin: 0,
                color: 'var(--text-secondary)',
                fontSize: '0.9375rem',
                lineHeight: 1.6,
              }}
            >
              {space.record.description}
            </p>
          ) : null}
        </div>
      </header>

      <BoardIntro spaceUri={space.uri} />

      {did ? (
        composing ? (
          <Composer
            space={spaceRef(space)}
            tags={space.record.tags ?? []}
            onPosted={() => {
              setComposing(false);
              // Give Constellation a beat to index the new record before the
              // board asks for the list again.
              setTimeout(refresh, 1500);
            }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setComposing(true)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              alignSelf: 'flex-start',
              padding: '0.55rem 1rem',
              background: 'var(--accent-moss)',
              border: '1px solid var(--accent-moss)',
              color: 'var(--text-on-accent)',
              fontFamily: 'var(--font-serif)',
              fontSize: '0.9rem',
              cursor: 'pointer',
            }}
          >
            <MessageSquarePlus size={15} />
            Share feedback
          </button>
        )
      ) : (
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
          <span className="explore-small-caps">Sign in to post and vote</span>
          <p style={{ margin: 0, color: 'var(--text-tertiary)', fontSize: '0.8125rem' }}>
            Your feedback is written to your own repo, so it travels with you and you can delete it
            any time.
          </p>
          <SignInPanel />
        </div>
      )}

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <div style={{ display: 'flex', gap: '0.35rem' }}>
          {SORTS.map((option) => (
            <FilterButton
              key={option.id}
              active={sort === option.id}
              onClick={() => setSort(option.id)}
            >
              {option.label}
            </FilterButton>
          ))}
        </div>
        <button
          type="button"
          onClick={refresh}
          disabled={loading}
          aria-label="Refresh"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            padding: '0.25rem 0.6rem',
            background: 'transparent',
            border: '1px solid var(--border-subtle)',
            color: 'var(--text-tertiary)',
            fontSize: '0.75rem',
            cursor: loading ? 'wait' : 'pointer',
          }}
        >
          <RefreshCw size={12} className={loading ? 'explore-spin' : undefined} />
          Refresh
        </button>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
        <FilterButton active={statusFilter === 'open'} onClick={() => setStatusFilter('open')}>
          Open
        </FilterButton>
        <FilterButton active={statusFilter === 'all'} onClick={() => setStatusFilter('all')}>
          All
        </FilterButton>
        {(Object.keys(UI_STATE_META) as UiState[])
          .filter((state) => state !== 'open' && (statusCounts.get(state) ?? 0) > 0)
          .map((state) => (
            <FilterButton
              key={state}
              active={statusFilter === state}
              onClick={() => setStatusFilter(state)}
            >
              {UI_STATE_META[state].label} ({statusCounts.get(state)})
            </FilterButton>
          ))}
      </div>

      {(space.record.tags ?? []).length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
          <FilterButton active={tagFilter === null} onClick={() => setTagFilter(null)}>
            All categories
          </FilterButton>
          {(space.record.tags ?? []).map((tag) => (
            <FilterButton
              key={tag.value}
              active={tagFilter === tag.value}
              onClick={() => setTagFilter(tagFilter === tag.value ? null : tag.value)}
            >
              {tag.label}
            </FilterButton>
          ))}
        </div>
      ) : null}

      {error ? <p className="explore-error">{error}</p> : null}
      {voting.error ? <p className="explore-error">{voting.error}</p> : null}

      {loading ? (
        <BoardSkeleton rows={3} />
      ) : visible.length === 0 ? (
        <p className="explore-placeholder">
          {discussions.length === 0
            ? 'No feedback yet. Be the first to post something.'
            : 'Nothing matches these filters.'}
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {visible.map((discussion) => (
            <DiscussionCard
              key={discussion.uri}
              discussion={discussion}
              author={authors.get(discussion.authorDid)}
              tagLabels={tagLabels}
              vote={voting.directionFor(discussion.uri)}
              canVote={Boolean(did) && !voting.pending.has(discussion.uri)}
              voteDisabledReason={did ? 'Saving…' : 'Sign in to vote'}
              onVote={(next) =>
                voting.cast({ uri: discussion.uri, cid: discussion.cid }, next)
              }
            />
          ))}
        </div>
      )}

      {ctx && discussions.length > 0 ? (
        <p style={{ margin: 0, color: 'var(--text-tertiary)', fontSize: '0.75rem' }}>
          {discussions.length} discussion{discussions.length === 1 ? '' : 's'} ·{' '}
          {ctx.moderatorDids.size} moderator{ctx.moderatorDids.size === 1 ? '' : 's'}
          {ctx.hiddenUris.size ? ` · ${ctx.hiddenUris.size} hidden` : ''}
        </p>
      ) : null}
    </div>
  );
}

/** Placeholder rows shaped like the real ones, so the list doesn't jump. */
function BoardSkeleton({ rows }: { rows: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {Array.from({ length: rows }, (_, i) => (
        <div
          key={i}
          style={{
            display: 'flex',
            gap: '0.875rem',
            padding: '1rem 1.125rem',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-subtle)',
          }}
        >
          <Skeleton width="1.75rem" height="3rem" />
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <Skeleton width="60%" height="1.125rem" />
            <Skeleton width="90%" height="0.75rem" />
            <Skeleton width="35%" height="0.75rem" />
          </div>
        </div>
      ))}
    </div>
  );
}

function countByStatus(list: { status: UiState }[]): Map<UiState, number> {
  const counts = new Map<UiState, number>();
  for (const item of list) counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
  return counts;
}

function FilterButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      style={{
        padding: '0.25rem 0.65rem',
        background: active ? 'var(--bg-elevated)' : 'transparent',
        border: `1px solid ${active ? 'var(--border-strong)' : 'var(--border-subtle)'}`,
        color: active ? 'var(--text-primary)' : 'var(--text-tertiary)',
        fontFamily: 'var(--font-serif)',
        fontSize: '0.8125rem',
        cursor: 'pointer',
      }}
    >
      {children}
    </button>
  );
}

/**
 * One line on where the data goes, because it isn't where a visitor would
 * assume: posting here writes to their repo, not ours.
 */
function BoardIntro({ spaceUri }: { spaceUri?: string }) {
  return (
    <p
      style={{
        margin: 0,
        padding: '0.75rem 1rem',
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-subtle)',
        color: 'var(--text-tertiary)',
        fontSize: '0.8125rem',
        lineHeight: 1.65,
      }}
    >
      Every post, reply and vote is a record in your repo, not ours. Built on the{' '}
      <a
        href={USERINPUT_HOME}
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: 'var(--text-accent)' }}
      >
        userinput.app
      </a>{' '}
      <Link href={USERINPUT_LEXICONS_PATH} style={{ color: 'var(--text-accent)' }}>
        lexicons
      </Link>
      , counted by{' '}
      <a
        href="https://constellation.microcosm.blue"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: 'var(--text-accent)' }}
      >
        Constellation
      </a>
      , read through{' '}
      <a
        href="https://slingshot.microcosm.blue"
        target="_blank"
        rel="noopener noreferrer"
        style={{ color: 'var(--text-accent)' }}
      >
        Slingshot
      </a>
      .
      {spaceUri ? (
        <>
          {' '}
          <Link
            href={`/explore/${spaceUri.replace('at://', '')}`}
            style={{ color: 'var(--text-accent)' }}
          >
            Inspect the space record →
          </Link>
        </>
      ) : null}
    </p>
  );
}
