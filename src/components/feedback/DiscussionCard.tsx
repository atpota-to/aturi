'use client';

import Link from 'next/link';
import { MessageSquare, Pin } from 'lucide-react';
import StatusChip from './StatusChip';
import VoteButtons from './VoteButtons';
import { authorLabel, fallbackAuthor, type Author } from './useAuthors';
import { formatTidRelative } from '@/utils/atproto/tid';
import { rkeyFromAtUri } from '@/utils/atproto/urls';
import { sanitizeUrl } from '@/utils/sanitize';
import type { Discussion } from '@/utils/userinput/client';
import type { SpaceTag } from '@/utils/userinput/lexicons';
import type { VoteDirection } from '@/utils/userinput/writes';

/** `/feedback/<author did>/<rkey>` — the thread route for a discussion. */
export function discussionPath(uri: string): string {
  const did = uri.replace('at://', '').split('/')[0] ?? '';
  const rkey = rkeyFromAtUri(uri) ?? '';
  return `/feedback/${encodeURIComponent(did)}/${encodeURIComponent(rkey)}`;
}

/**
 * "5m ago" for recent activity, then a written date ("Aug 12, 2026") once
 * it's two weeks old. The shared helper falls back to an ISO date there,
 * which read as a different format from every other date on the site.
 */
function relative(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const ageMs = Date.now() - date.getTime();
  if (ageMs < 0 || ageMs >= 14 * 24 * 60 * 60 * 1000) {
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }
  return formatTidRelative(date);
}

export function TagChip({ label }: { label: string }) {
  return <span className="fn-fb-tag">{label}</span>;
}

export function AuthorLine({
  author,
  at,
  edited,
  size = 'md',
}: {
  author: Author;
  at: string;
  edited?: string | null;
  size?: 'sm' | 'md';
}) {
  const avatar = author.avatar ? sanitizeUrl(author.avatar) : '';
  const px = size === 'sm' ? 18 : 20;
  return (
    <span className="fn-fb-author">
      {avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatar} alt="" width={px} height={px} style={{ width: px, height: px }} />
      ) : null}
      <span className="fn-fb-author-name">{authorLabel(author)}</span>
      <span aria-hidden>·</span>
      <time dateTime={at} title={at}>
        {relative(at)}
      </time>
      {edited ? (
        <span title={`Edited ${edited}`} className="fn-fb-author-edited">
          edited
        </span>
      ) : null}
    </span>
  );
}

/**
 * One row on the board: score on the left, the discussion on the right.
 *
 * The whole row is a link to the thread except the vote control, which sits
 * outside it — nesting a button inside an anchor makes voting navigate.
 */
export default function DiscussionCard({
  discussion,
  author,
  tagLabels,
  vote,
  onVote,
  canVote,
  voteDisabledReason,
}: {
  discussion: Discussion;
  author: Author | undefined;
  tagLabels: Map<string, SpaceTag>;
  vote: VoteDirection;
  onVote: (next: VoteDirection) => void;
  canVote: boolean;
  voteDisabledReason?: string;
}) {
  const excerpt = discussion.body.trim().replace(/\s+/g, ' ');

  return (
    <article className="fn-fb-row" data-pinned={discussion.pinned ? '' : undefined}>
      <VoteButtons
        score={discussion.counts.score}
        vote={vote}
        onVote={onVote}
        disabled={!canVote}
        disabledReason={voteDisabledReason}
      />

      <div className="fn-fb-row-main">
        <div className="fn-fb-row-title">
          {discussion.pinned ? (
            <Pin size={14} aria-label="Pinned" className="fn-fb-pin" />
          ) : null}
          <Link href={discussionPath(discussion.uri)} prefetch={false}>
            {discussion.title}
          </Link>
          <StatusChip state={discussion.status} size="sm" />
        </div>

        {excerpt ? <p className="fn-fb-excerpt">{excerpt}</p> : null}

        <div className="fn-fb-meta">
          <AuthorLine
            author={author ?? fallbackAuthor(discussion.authorDid)}
            at={discussion.createdAt}
            edited={discussion.editedAt}
          />
          <Link
            href={discussionPath(discussion.uri)}
            prefetch={false}
            className="fn-fb-replies"
          >
            <MessageSquare size={13} />
            {discussion.counts.replies}
          </Link>
          {discussion.tags.map((value) => (
            <TagChip key={value} label={tagLabels.get(value)?.label ?? value} />
          ))}
        </div>
      </div>
    </article>
  );
}
