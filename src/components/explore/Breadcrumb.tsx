'use client';

import { useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { ChevronRight, Server } from 'lucide-react';
import { encodeRepo } from '@/utils/atproto/urls';
import { pdsHostname } from '@/utils/atproto/pdsServer';
import { useBreadcrumbTrail, type BreadcrumbCrumb } from './BreadcrumbContext';
import ShareLinkChip from './ShareLinkChip';

// Approximate height of the sticky compact nav. The condensed breadcrumb
// reveals the moment the full one slips up behind the nav, so we treat the
// top ~96px of the viewport as occluded when deciding "scrolled past".
const NAV_OFFSET_PX = 96;

type Props = {
  handle: string | null;
  did: string;
  /** When provided, prepends a PDS-level segment to the trail. */
  pds?: string;
  collection?: string;
  rkey?: string;
  /**
   * When provided, renders a "Copy link" chip at the end of the breadcrumb
   * row. Path or full URL; bare paths get aturi.to prepended.
   */
  shareUrl?: string;
};

/**
 * Hierarchical breadcrumb across the four explore levels:
 *
 *   pds host  →  repo (handle/did)  →  collection (NSID)  →  rkey
 *
 * Each upstream segment is clickable. The PDS segment is optional so older
 * call sites without a resolved PDS still render correctly.
 */
export default function Breadcrumb({
  handle,
  did,
  pds,
  collection,
  rkey,
  shareUrl,
}: Props) {
  const repoSegment = encodeRepo(handle || did);
  const repoLabel = handle ? `@${handle}` : did;
  const pdsHost = pds ? pdsHostname(pds) : null;

  const navRef = useRef<HTMLElement>(null);
  const { setTrail, setScrolledPast } = useBreadcrumbTrail();

  // Mirror the visible trail into shared context so the floating nav can
  // re-render it in miniature once this breadcrumb scrolls away. The share
  // chip is intentionally left out — the condensed copy is a path, not a row
  // of actions.
  const trail = useMemo<BreadcrumbCrumb[]>(() => {
    const crumbs: BreadcrumbCrumb[] = [];
    if (pdsHost) {
      crumbs.push({
        label: pdsHost,
        href: `/explore/pds/${encodeURIComponent(pdsHost)}`,
        icon: 'server',
      });
    }
    crumbs.push({ label: repoLabel, href: `/explore/${repoSegment}` });
    if (collection) {
      crumbs.push({ label: collection, href: `/explore/${repoSegment}/${collection}` });
    }
    if (rkey) {
      crumbs.push({ label: rkey });
    }
    return crumbs;
  }, [pdsHost, repoLabel, repoSegment, collection, rkey]);

  useEffect(() => {
    setTrail(trail);
    return () => setTrail(null);
  }, [trail, setTrail]);

  // Watch the live breadcrumb; once it sits fully behind the sticky nav the
  // condensed copy takes over. The negative top rootMargin pulls the trigger
  // line down to the nav's lower edge so the handoff lines up with the
  // breadcrumb actually disappearing rather than leaving the viewport.
  useEffect(() => {
    const node = navRef.current;
    if (!node || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => setScrolledPast(!entry.isIntersecting),
      { rootMargin: `-${NAV_OFFSET_PX}px 0px 0px 0px`, threshold: 0 },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [setScrolledPast]);

  return (
    <nav
      ref={navRef}
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

      {shareUrl && (
        <span style={{ marginLeft: 'auto' }}>
          <ShareLinkChip url={shareUrl} />
        </span>
      )}
    </nav>
  );
}
