'use client';

import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { encodeRepo } from '@/utils/atproto/urls';

type Props = {
  handle: string | null;
  did: string;
  collection?: string;
  rkey?: string;
};

export default function Breadcrumb({ handle, did, collection, rkey }: Props) {
  const repoSegment = encodeRepo(handle || did);
  const repoLabel = handle ? `@${handle}` : did;

  return (
    <nav
      aria-label="Breadcrumb"
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: '0.5rem',
        marginBottom: '1.5rem',
        fontFamily: 'var(--font-mono)',
        fontSize: '0.875rem',
        color: 'var(--text-tertiary)',
      }}
    >
      <Link
        href={`/explore/${repoSegment}`}
        style={{
          color: 'var(--text-primary)',
          textDecoration: 'none',
          transition: 'color 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--text-accent)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--text-primary)';
        }}
      >
        {repoLabel}
      </Link>

      {collection && (
        <>
          <ChevronRight size={14} aria-hidden style={{ color: 'var(--text-tertiary)' }} />
          <Link
            href={`/explore/${repoSegment}/${collection}`}
            style={{
              color: 'var(--text-primary)',
              textDecoration: 'none',
              transition: 'color 0.2s ease',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-accent)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
          >
            {collection}
          </Link>
        </>
      )}

      {rkey && (
        <>
          <ChevronRight size={14} aria-hidden style={{ color: 'var(--text-tertiary)' }} />
          <span style={{ color: 'var(--text-tertiary)' }}>{rkey}</span>
        </>
      )}
    </nav>
  );
}
