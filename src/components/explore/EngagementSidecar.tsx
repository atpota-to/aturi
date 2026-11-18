'use client';

import { useEffect, useState } from 'react';
import { FileText, Heart, MessageCircle, Quote, Repeat2, UserPlus, Users } from 'lucide-react';
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
  if (counts.replyCount != null) items.push({ icon: <MessageCircle size={15} />, label: 'replies', value: counts.replyCount });
  if (counts.repostCount != null) items.push({ icon: <Repeat2 size={15} />, label: 'reposts', value: counts.repostCount });
  if (counts.likeCount != null) items.push({ icon: <Heart size={15} />, label: 'likes', value: counts.likeCount });
  if (counts.quoteCount != null) items.push({ icon: <Quote size={15} />, label: 'quotes', value: counts.quoteCount });

  if (counts.followersCount != null) items.push({ icon: <Users size={15} />, label: 'followers', value: counts.followersCount });
  if (counts.followsCount != null) items.push({ icon: <UserPlus size={15} />, label: 'following', value: counts.followsCount });
  if (counts.postsCount != null) items.push({ icon: <FileText size={15} />, label: 'posts', value: counts.postsCount });

  if (items.length === 0) return null;

  return (
    <div className="fn-rec-card fn-engage">
      {items.map((item) => (
        <span key={item.label} className="fn-engage-item" title={item.label}>
          {item.icon}
          <strong>{item.value.toLocaleString()}</strong>
          {item.label}
        </span>
      ))}
    </div>
  );
}
