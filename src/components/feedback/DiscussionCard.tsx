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

function relative(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  return formatTidRelative(date);
}

export function TagChip({ label }: { label: string }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        padding: '0.1rem 0.4rem',
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-subtle)',
        color: 'var(--text-tertiary)',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.6875rem',
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  );
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
  const px = size === 'sm' ? 14 : 16;
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        color: 'var(--text-tertiary)',
        fontSize: size === 'sm' ? '0.75rem' : '0.8125rem',
        minWidth: 0,
      }}
    >
      {avatar ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatar}
          alt=""
          width={px}
          height={px}
          style={{ width: px, height: px, objectFit: 'cover', flexShrink: 0 }}
        />
      ) : null}
      <span
        style={{
          fontFamily: 'var(--font-mono)',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {authorLabel(author)}
      </span>
      <span aria-hidden>·</span>
      <time dateTime={at} title={at} style={{ whiteSpace: 'nowrap' }}>
        {relative(at)}
      </time>
      {edited ? (
        <span title={`Edited ${edited}`} style={{ fontStyle: 'italic' }}>
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
    <article
      style={{
        display: 'flex',
        gap: '0.875rem',
        padding: '1rem 1.125rem',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border-subtle)',
        borderLeft: discussion.pinned
          ? '2px solid var(--text-accent)'
          : '1px solid var(--border-subtle)',
      }}
    >
      <VoteButtons
        score={discussion.counts.score}
        vote={vote}
        onVote={onVote}
        disabled={!canVote}
        disabledReason={voteDisabledReason}
      />

      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            display: 'flex',
            alignItems: 'baseline',
            flexWrap: 'wrap',
            gap: '0.5rem',
            marginBottom: '0.35rem',
          }}
        >
          {discussion.pinned ? (
            <Pin
              size={13}
              aria-label="Pinned"
              style={{ color: 'var(--text-accent)', flexShrink: 0 }}
            />
          ) : null}
          <Link
            href={discussionPath(discussion.uri)}
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: '1.0625rem',
              lineHeight: 1.3,
              color: 'var(--text-primary)',
              textDecoration: 'none',
            }}
          >
            {discussion.title}
          </Link>
          <StatusChip state={discussion.status} size="sm" />
        </div>

        {excerpt ? (
          <p
            style={{
              margin: '0 0 0.5rem',
              color: 'var(--text-secondary)',
              fontSize: '0.875rem',
              lineHeight: 1.5,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {excerpt}
          </p>
        ) : null}

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            flexWrap: 'wrap',
            gap: '0.5rem 0.75rem',
          }}
        >
          <AuthorLine
            author={author ?? fallbackAuthor(discussion.authorDid)}
            at={discussion.createdAt}
            edited={discussion.editedAt}
          />
          <Link
            href={discussionPath(discussion.uri)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
              color: 'var(--text-tertiary)',
              fontSize: '0.8125rem',
              textDecoration: 'none',
            }}
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
