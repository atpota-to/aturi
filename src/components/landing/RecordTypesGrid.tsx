'use client';

import Link from 'next/link';
import {
  BookOpen,
  Camera,
  FileText,
  GitBranch,
  Highlighter,
  List,
  MessageSquare,
  Rss,
  User,
} from 'lucide-react';

type RecordType = {
  icon: React.ReactNode;
  label: string;
  collection: string;
  example: string;
  href: string;
};

const TYPES: RecordType[] = [
  {
    icon: <MessageSquare size={16} />,
    label: 'Posts',
    collection: 'app.bsky.feed.post',
    example: 'aturi.to/aturi.to/post/3lq…',
    href: '/profile/aturi.to',
  },
  {
    icon: <User size={16} />,
    label: 'Profiles',
    collection: 'app.bsky.actor.profile',
    example: 'aturi.to/aturi.to',
    href: '/profile/aturi.to',
  },
  {
    icon: <List size={16} />,
    label: 'Lists',
    collection: 'app.bsky.graph.list',
    example: 'aturi.to/aturi.to/lists/…',
    href: '/profile/aturi.to',
  },
  {
    icon: <Rss size={16} />,
    label: 'Feeds',
    collection: 'app.bsky.feed.generator',
    example: 'aturi.to/aturi.to/feed/…',
    href: '/profile/aturi.to',
  },
  {
    icon: <FileText size={16} />,
    label: 'Documents',
    collection: 'pub.leaflet.document',
    example: 'aturi.to/h/pub.leaflet.…',
    href: '/profile/aturi.to',
  },
  {
    icon: <GitBranch size={16} />,
    label: 'Repositories',
    collection: 'sh.tangled.repo',
    example: 'aturi.to/h/sh.tangled.repo/…',
    href: '/profile/aturi.to',
  },
  {
    icon: <Camera size={16} />,
    label: 'Photo galleries',
    collection: 'social.grain.gallery',
    example: 'aturi.to/h/social.grain.…',
    href: '/profile/aturi.to',
  },
  {
    icon: <Highlighter size={16} />,
    label: 'Annotations',
    collection: 'at.margin.annotation',
    example: 'aturi.to/h/at.margin.…',
    href: '/profile/aturi.to',
  },
  {
    icon: <BookOpen size={16} />,
    label: 'Any other lexicon',
    collection: 'collection.nsid',
    example: 'aturi.to/h/<collection>/<rkey>',
    href: '/explore',
  },
];

/**
 * Grid of supported record types on the universal links landing page.
 * Communicates breadth without forcing the visitor to skim a long
 * categorized list — each tile names a record type, its lexicon NSID,
 * and what a universal link to one looks like.
 */
export default function RecordTypesGrid() {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(15rem, 1fr))',
        gap: '0.75rem',
      }}
    >
      {TYPES.map((t) => (
        <Link
          key={t.collection}
          href={t.href}
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
            padding: '1rem',
            background: 'var(--bg-secondary)',
            border: '1px solid var(--border-medium)',
            textDecoration: 'none',
            color: 'var(--text-primary)',
            transition: 'border-color 0.2s ease, background 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.borderColor = 'var(--text-accent)';
            e.currentTarget.style.background = 'var(--bg-tertiary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.borderColor = 'var(--border-medium)';
            e.currentTarget.style.background = 'var(--bg-secondary)';
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: 'var(--text-accent)',
            }}
          >
            {t.icon}
            <span
              style={{
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-serif)',
                fontSize: '0.95rem',
              }}
            >
              {t.label}
            </span>
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.7rem',
              color: 'var(--text-tertiary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {t.collection}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.72rem',
              color: 'var(--text-secondary)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {t.example}
          </div>
        </Link>
      ))}
    </div>
  );
}
