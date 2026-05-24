'use client';

import { useEffect, useState } from 'react';
import { Heart, MessageCircle, Quote, Repeat2 } from 'lucide-react';
import { getPostThread, getProfile } from '@/utils/atproto/appview';

type Counts = {
  replyCount?: number;
  repostCount?: number;
  likeCount?: number;
  quoteCount?: number;
  followsCount?: number;
  followersCount?: number;
  postsCount?: number;
};

type Props = {
  did: string;
  collection: string;
  atUri: string;
};

export default function EngagementSidecar({ did, collection, atUri }: Props) {
  const [counts, setCounts] = useState<Counts | null>(null);

  useEffect(() => {
    let cancelled = false;
    setCounts(null);

    if (collection.startsWith('app.bsky.feed.')) {
      getPostThread(atUri).then((thread) => {
        if (cancelled) return;
        const p = thread?.thread?.post;
        if (!p) return;
        setCounts({
          replyCount: p.replyCount,
          repostCount: p.repostCount,
          likeCount: p.likeCount,
          quoteCount: p.quoteCount,
        });
      });
    } else if (collection === 'app.bsky.actor.profile') {
      getProfile(did).then((profile) => {
        if (cancelled) return;
        if (!profile) return;
        setCounts({
          followsCount: profile.followsCount,
          followersCount: profile.followersCount,
          postsCount: profile.postsCount,
        });
      });
    }

    return () => {
      cancelled = true;
    };
  }, [did, collection, atUri]);

  if (!counts) return null;

  const items: Array<{ icon: React.ReactNode; label: string; value: number }> = [];
  if (counts.replyCount != null) items.push({ icon: <MessageCircle size={14} />, label: 'replies', value: counts.replyCount });
  if (counts.repostCount != null) items.push({ icon: <Repeat2 size={14} />, label: 'reposts', value: counts.repostCount });
  if (counts.likeCount != null) items.push({ icon: <Heart size={14} />, label: 'likes', value: counts.likeCount });
  if (counts.quoteCount != null) items.push({ icon: <Quote size={14} />, label: 'quotes', value: counts.quoteCount });

  if (counts.followersCount != null) items.push({ icon: <Heart size={14} />, label: 'followers', value: counts.followersCount });
  if (counts.followsCount != null) items.push({ icon: <Heart size={14} />, label: 'following', value: counts.followsCount });
  if (counts.postsCount != null) items.push({ icon: <MessageCircle size={14} />, label: 'posts', value: counts.postsCount });

  if (items.length === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '1.5rem',
        padding: '0.875rem 1rem',
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-secondary)',
        fontSize: '0.875rem',
        color: 'var(--text-secondary)',
      }}
    >
      {items.map((item) => (
        <div
          key={item.label}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
          title={item.label}
        >
          <span style={{ color: 'var(--text-tertiary)' }}>{item.icon}</span>
          <span style={{ fontVariantNumeric: 'tabular-nums', color: 'var(--text-primary)' }}>
            {item.value.toLocaleString()}
          </span>
          <span style={{ color: 'var(--text-tertiary)', fontSize: '0.8125rem' }}>
            {item.label}
          </span>
        </div>
      ))}
    </div>
  );
}
