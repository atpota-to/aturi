'use client';

import Link from 'next/link';
import { Ban, Pin, X } from 'lucide-react';
import { relativeAge } from '@/utils/atproto/plc';
import { encodeRepo } from '@/utils/atproto/urls';
import { BLUESKY_MODERATION_DID } from '@/lib/tools/labels';
import type { AuthorFacts, CutReading, CutReply } from '@/lib/threadInsights';
import { PinMark } from './ThreadToolbar';
import { fmt, thumb } from './shared';

/** Someone this account is in a block with, and which way it runs. */
export type BlockRow = { did: string; name: string; theyBlock: boolean; blockedBy: boolean };

export type BlocksState = 'reading' | 'done' | 'unread';

const toolHref = (tool: 'shadowban' | 'labels', who: { handle?: string; did: string }) =>
  `/tools/${tool}?subject=${encodeURIComponent(who.handle || who.did)}`;

/** When the AppView first saw the profile, if it says, as a date and an age. */
function since(createdAt?: string): { date: string; age: string } | null {
  const at = createdAt ? new Date(createdAt) : null;
  // Bluesky's network opened in 2023; anything earlier is a placeholder date.
  if (!at || Number.isNaN(at.getTime()) || at.getFullYear() < 2022) return null;
  return { date: at.toLocaleDateString(undefined, { month: 'short', year: 'numeric' }), age: relativeAge(at) };
}

function blockWordsFor(row: BlockRow): string {
  if (row.theyBlock && row.blockedBy) return 'Blocks each other with';
  return row.theyBlock ? 'Blocks' : 'Blocked by';
}

/**
 * What the explorer knows about one account, under a post's or a person's
 * details: what they did in this thread (posts, blocks, replies left out or
 * folded away), the account itself, and the tools that look further.
 */
export function AccountInsight({
  did,
  facts,
  name,
  isOp,
  postsHere,
  blocks,
  blocksState,
  folded,
  cut,
  pinSlot,
  canPin,
  onPin,
  onGo,
  profileLinks,
}: {
  did: string;
  facts?: AuthorFacts;
  name: string;
  isOp: boolean;
  postsHere: number;
  blocks: BlockRow[];
  blocksState: BlocksState;
  folded: { author: number; bluesky: number };
  cut: number;
  pinSlot: number;
  canPin: boolean;
  onPin: () => void;
  onGo: (did: string) => void;
  /** Their graph and repo, for a post's details, which don't link them already. */
  profileLinks: boolean;
}) {
  const who = { did, handle: facts?.handle };
  const joined = since(facts?.createdAt);
  const outside = (facts?.labels ?? []).filter((l) => l.src !== did);
  const selfLabels = (facts?.labels ?? []).filter((l) => l.src === did);
  const pinned = pinSlot >= 0;
  const hidden = [
    cut ? `${cut === 1 ? 'One reply' : `${cut} replies`} by ${name} ${cut === 1 ? 'is' : 'are'} left out of this thread on Bluesky.` : '',
    folded.author ? `The thread’s author hid ${folded.author === 1 ? 'one of their replies' : `${folded.author} of their replies`}.` : '',
    folded.bluesky ? `Bluesky folds ${folded.bluesky === 1 ? 'one of their replies' : `${folded.bluesky} of their replies`} away behind “show more”.` : '',
  ].filter(Boolean);

  return (
    <section className="fx-tx-insight" aria-label={`${name} in this thread`}>
      <div className="fx-tx-insight-row">
        <h3 className="fx-tx-insight-h">In this thread</h3>
        <button
          type="button"
          className="fx-graph-tool fx-tx-toggle"
          aria-pressed={pinned}
          data-on={pinned || undefined}
          disabled={!pinned && !canPin}
          title={!pinned && !canPin ? 'Unpin someone first' : undefined}
          onClick={onPin}
        >
          {pinned ? <PinMark slot={pinSlot} /> : <Pin size={14} aria-hidden />}
          {pinned ? 'Pinned' : 'Pin to trace'}
        </button>
      </div>
      <p className="fx-graph-detail-text">
        {postsHere ? `${fmt(postsHere)} ${postsHere === 1 ? 'post' : 'posts'} here` : 'No posts in the thread itself'}
        {isOp ? ', and started it.' : '.'}
      </p>

      <div className="fx-tx-insight-blocks">
        {blocksState === 'reading' && !blocks.length && <p className="fx-graph-detail-text">Reading blocks…</p>}
        {blocksState === 'unread' && (
          <p className="fx-graph-detail-text">Their blocks weren’t read: a big thread has only its most active people checked.</p>
        )}
        {blocksState === 'done' && !blocks.length && <p className="fx-graph-detail-text">No blocks with anyone else here.</p>}
        {blocks.length > 0 && (
          <ul className="fx-tx-blocklist" aria-label="Blocks in this thread">
            {blocks.map((b) => (
              <li key={b.did}>
                <Ban size={13} aria-hidden />
                <span>{blockWordsFor(b)}</span>
                <button type="button" className="fx-tx-link" onClick={() => onGo(b.did)}>
                  {b.name}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {hidden.map((line) => (
        <p key={line} className="fx-graph-detail-text">
          {line}
        </p>
      ))}

      <h3 className="fx-tx-insight-h">Account</h3>
      {facts ? (
        <>
          <dl className="fx-graph-facts">
            {joined && (
              <div title={joined.age}>
                <dt>Joined</dt>
                <dd>{joined.date}</dd>
              </div>
            )}
            {facts.followers != null && (
              <div>
                <dt>Followers</dt>
                <dd>{fmt(facts.followers)}</dd>
              </div>
            )}
            {facts.follows != null && (
              <div>
                <dt>Following</dt>
                <dd>{fmt(facts.follows)}</dd>
              </div>
            )}
            {facts.posts != null && (
              <div>
                <dt>Posts</dt>
                <dd>{fmt(facts.posts)}</dd>
              </div>
            )}
          </dl>
          {joined && (
            <p className="fx-graph-detail-text">
              {joined.age === 'today' ? 'Joined Bluesky today.' : `The account is ${joined.age}.`}
            </p>
          )}
          {outside.length > 0 && (
            <ul className="fx-tx-labels" aria-label="Labels on the account">
              {outside.map((l) => (
                <li key={`${l.src} ${l.val}`} data-mod={l.src === BLUESKY_MODERATION_DID || undefined}>
                  {l.val}
                  <span>{l.src === BLUESKY_MODERATION_DID ? 'Bluesky moderation' : 'labeler'}</span>
                </li>
              ))}
            </ul>
          )}
          {selfLabels.length > 0 && (
            <p className="fx-graph-detail-text">
              Labelled by themselves: {selfLabels.map((l) => l.val).join(', ')}.
            </p>
          )}
        </>
      ) : (
        <p className="fx-graph-detail-text">Bluesky doesn’t describe this account.</p>
      )}
      <p className="fx-graph-links">
        <Link href={toolHref('shadowban', who)} prefetch={false}>
          Check visibility
        </Link>
        <Link href={toolHref('labels', who)} prefetch={false}>
          Labels
        </Link>
        {profileLinks && (
          <>
            <Link href={`/explore/${encodeRepo(who.handle || did)}?tab=graph`} prefetch={false}>
              Their graph
            </Link>
            <Link href={`/explore/${encodeRepo(who.handle || did)}`} prefetch={false}>
              Their repo
            </Link>
          </>
        )}
      </p>
    </section>
  );
}

/** A left-out reply's details: what it says, and why Bluesky leaves it out, as far as anyone can tell. */
export function CutDetail({
  cut,
  reading,
  name,
  parentName,
  onClose,
}: {
  cut: CutReply;
  reading: CutReading;
  name: string;
  parentName: string;
  onClose: () => void;
}) {
  const display = cut.author?.displayName || name;
  const rkey = cut.uri.split('/').pop() ?? '';
  const written = cut.createdAt ? new Date(cut.createdAt) : null;
  return (
    <aside className="fx-graph-detail" aria-live="polite" aria-label="Details">
      <button type="button" className="fx-graph-detail-close" onClick={onClose} aria-label="Close details">
        <X size={16} aria-hidden />
      </button>
      <div className="fx-graph-who">
        {cut.author?.avatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img className="fx-graph-avatar" src={thumb(cut.author.avatar)} alt="" loading="lazy" />
        ) : (
          <span className="fx-graph-avatar fx-graph-avatar-blank" aria-hidden>
            {display.replace(/^@/, '').slice(0, 1).toUpperCase()}
          </span>
        )}
        <div className="fx-graph-names">
          <span className="fx-graph-dn">{display}</span>
          <span className="fx-graph-hd">{cut.author?.handle ? `@${cut.author.handle}` : cut.did}</span>
        </div>
      </div>
      <div className="fx-tx-cut-head">
        <span className="fx-tx-insight-h">Left out on Bluesky</span>
        <p className="fx-tx-cut-tag" data-tone={reading.tone} title={reading.label}>
          {reading.label}
        </p>
      </div>
      <p className="fx-graph-post-text">
        {cut.text === null ? (
          <em>Its text couldn’t be read.</em>
        ) : (
          cut.text || (cut.hasMedia ? 'An image or video, no text.' : 'No text.')
        )}
      </p>
      <p className="fx-graph-detail-text">
        A reply to {parentName}. {reading.reason}
      </p>
      {reading.also.map((line) => (
        <p key={line} className="fx-graph-detail-text">
          {line}
        </p>
      ))}
      <dl className="fx-graph-facts">
        {written && !Number.isNaN(written.getTime()) && (
          <div>
            <dt>Written</dt>
            <dd>{written.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })}</dd>
          </div>
        )}
        {cut.likes != null && (
          <div>
            <dt>Likes</dt>
            <dd>{fmt(cut.likes)}</dd>
          </div>
        )}
      </dl>
      <p className="fx-graph-links">
        <Link href={`/explore/${encodeRepo(cut.did)}/app.bsky.feed.post/${encodeURIComponent(rkey)}`} prefetch={false}>
          Open this record
        </Link>
        <Link href={toolHref('shadowban', { did: cut.did, handle: cut.author?.handle })} prefetch={false}>
          Check {name}’s visibility
        </Link>
      </p>
    </aside>
  );
}
