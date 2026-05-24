'use client';

import Link from 'next/link';
import { ChevronRight, Server } from 'lucide-react';
import { encodeRepo } from '@/utils/atproto/urls';
import { pdsHostname } from '@/utils/atproto/pdsServer';

type Props = {
  handle: string | null;
  did: string;
  /** When provided, prepends a PDS-level segment to the trail. */
  pds?: string;
  collection?: string;
  rkey?: string;
};

/**
 * Hierarchical breadcrumb across the four explore levels:
 *
 *   pds host  →  repo (handle/did)  →  collection (NSID)  →  rkey
 *
 * Each upstream segment is clickable. The PDS segment is optional so older
 * call sites without a resolved PDS still render correctly.
 */
export default function Breadcrumb({ handle, did, pds, collection, rkey }: Props) {
  const repoSegment = encodeRepo(handle || did);
  const repoLabel = handle ? `@${handle}` : did;
  const pdsHost = pds ? pdsHostname(pds) : null;

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
      {pdsHost && (
        <>
          <Link
            href={`/explore/pds/${encodeURIComponent(pdsHost)}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
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
            <Server size={12} aria-hidden style={{ opacity: 0.7 }} />
            {pdsHost}
          </Link>
          <ChevronRight size={14} aria-hidden style={{ color: 'var(--text-tertiary)' }} />
        </>
      )}

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
