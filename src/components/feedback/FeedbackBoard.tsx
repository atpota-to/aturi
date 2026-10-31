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
import { Skeleton, SkeletonLine } from '@/components/SkeletonLoader';
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

  // While the space is first loading, the board below renders with what it
  // already knows (the title, the intro, sign-in, the sort bar) and holds
  // skeletons only where the space's own data goes, so the page doesn't
  // swap a column of bars for a different layout when it lands.
  if (!space && !loading) {
    return (
      <div className="fn-fb">
        <BoardIntro />
        {error ? <p className="explore-error">{error}</p> : null}
        <SpaceSetup onCreated={refresh} />
      </div>
    );
  }

  const icon = space?.iconUrl ? sanitizeUrl(space.iconUrl) : '';
  const statusCounts = countByStatus(discussions);
  const tags = space?.record.tags ?? [];

  return (
    <div className="fn-fb">
      <header className="fn-fb-head">
        {icon ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={icon} alt="" width={48} height={48} className="fn-fb-icon" />
        ) : null}
        <div className="fn-fb-head-text">
          <h1 className="fn-c-title">
            {/* The page is titled by what it's for, not by the space record's
                own name: on aturi.to that name would just read "Aturi". */}
            Feedback
          </h1>
          {space?.record.description ? (
            <p className="fn-c-lede">{space.record.description}</p>
          ) : null}
        </div>
      </header>

      <BoardIntro spaceUri={space?.uri} />

      {did ? (
        composing && space ? (
          <Composer
            space={spaceRef(space)}
            tags={tags}
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
            disabled={!space}
            className="fn-c-btn fn-c-btn-primary"
            style={{ alignSelf: 'flex-start' }}
          >
            <MessageSquarePlus size={15} />
            Share feedback
          </button>
        )
      ) : (
        <div className="fn-fb-card">
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <span className="explore-small-caps">Sign in to post and vote</span>
            <p className="fn-fb-hint">
              Your feedback is written to your own repo, so it travels with you and you can delete
              it any time.
            </p>
          </div>
          <SignInPanel />
        </div>
      )}

      {error ? <p className="explore-error">{error}</p> : null}
      {voting.error ? <p className="explore-error">{voting.error}</p> : null}

      <section className="fn-fb-board" aria-label="Discussions">
        <div className="fn-fb-tools">
          {/* A sort re-orders one list rather than opening another, so it is
              the segmented control (explore.css), not a tab row. */}
          <div className="fn-segmented" role="group" aria-label="Sort discussions">
            {SORTS.map((option) => (
              <button
                key={option.id}
                type="button"
                aria-pressed={sort === option.id}
                onClick={() => setSort(option.id)}
                className="fn-segmented-option"
              >
                {option.label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={refresh}
            disabled={loading}
            aria-label="Refresh"
            className="fn-c-btn fn-c-btn-sm"
            data-wait={loading ? '' : undefined}
          >
            <RefreshCw size={13} className={loading ? 'explore-spin' : undefined} />
            Refresh
          </button>
        </div>

        <div className="fn-fb-filters">
          <div className="fn-fb-chips">
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

          {!space ? (
            <div className="fn-fb-chips" aria-hidden>
              {['6.75rem', '2.75rem', '4rem', '3rem', '4.75rem'].map((width) => (
                <Skeleton key={width} width={width} height="28px" />
              ))}
            </div>
          ) : tags.length ? (
            <div className="fn-fb-chips">
              <FilterButton active={tagFilter === null} onClick={() => setTagFilter(null)}>
                All categories
              </FilterButton>
              {tags.map((tag) => (
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
        </div>

        {loading ? (
          <BoardSkeleton rows={3} />
        ) : visible.length === 0 ? (
          <p className="explore-placeholder">
            {discussions.length === 0
              ? 'No feedback yet. Be the first to post something.'
              : 'Nothing matches these filters.'}
          </p>
        ) : (
          <ul className="fn-fb-list">
            {visible.map((discussion) => (
              <li key={discussion.uri}>
                <DiscussionCard
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
              </li>
            ))}
          </ul>
        )}

        {ctx && discussions.length > 0 ? (
          <p className="fn-fb-foot">
            {discussions.length} discussion{discussions.length === 1 ? '' : 's'} ·{' '}
            {ctx.moderatorDids.size} moderator{ctx.moderatorDids.size === 1 ? '' : 's'}
            {ctx.hiddenUris.size ? ` · ${ctx.hiddenUris.size} hidden` : ''}
          </p>
        ) : null}
      </section>
    </div>
  );
}

/**
 * Placeholder rows shaped like the real ones (DiscussionCard), so the list
 * doesn't jump: the vote column's box, the title, two lines of excerpt and
 * the author line with its avatar, each a line of that text tall.
 */
function BoardSkeleton({ rows }: { rows: number }) {
  return (
    <ul className="fn-fb-list" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <li key={i}>
          <div className="fn-fb-row">
            <Skeleton width="44px" height="78px" shape="control" style={{ flex: 'none' }} />
            <div className="fn-fb-row-main">
              <SkeletonLine className="fn-fb-skel-title" width={['58%', '44%', '66%', '50%'][i % 4]} height="0.8rem" />
              {/* The excerpt's type, without its line clamp. */}
              <div style={{ fontSize: '13.5px', lineHeight: 1.5 }}>
                <SkeletonLine width="100%" />
                <SkeletonLine width={['72%', '48%', '81%', '60%'][i % 4]} />
              </div>
              {/* As tall as the tag chip the real line usually carries. */}
              <div className="fn-fb-meta" style={{ minHeight: '22px' }}>
                <Skeleton width="18px" height="18px" shape="circle" />
                <Skeleton width="9rem" height="0.55rem" />
                <Skeleton width="2.5rem" height="0.55rem" />
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
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
    <button type="button" aria-pressed={active} onClick={onClick} className="fn-fb-chip">
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
    <p className="fn-fb-intro">
      Every post, reply and vote is a record in your repo, not ours. Built on the{' '}
      <a href={USERINPUT_HOME} target="_blank" rel="noopener noreferrer">
        userinput.app
      </a>{' '}
      <Link href={USERINPUT_LEXICONS_PATH} prefetch={false}>
        lexicons
      </Link>
      , counted by{' '}
      <a href="https://constellation.microcosm.blue" target="_blank" rel="noopener noreferrer">
        Constellation
      </a>
      , read through{' '}
      <a href="https://slingshot.microcosm.blue" target="_blank" rel="noopener noreferrer">
        Slingshot
      </a>
      .
      {spaceUri ? (
        <>
          {' '}
          <Link href={`/explore/${spaceUri.replace('at://', '')}`} prefetch={false}>
            Inspect the space record →
          </Link>
        </>
      ) : null}
    </p>
  );
}
