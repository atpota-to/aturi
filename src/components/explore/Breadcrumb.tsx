'use client';

import { useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { ChevronRight, Server } from 'lucide-react';
import { encodeRepo } from '@/utils/atproto/urls';
import { pdsHostname } from '@/utils/atproto/pdsServer';
import { useBreadcrumbTrail, type BreadcrumbCrumb } from './BreadcrumbContext';
import ShareLinkChip from './ShareLinkChip';

// Approximate height of the sticky compact nav. The condensed breadcrumb
// reveals the moment the full one slips up behind the nav, so the top ~96px
// of the viewport counts as occluded when deciding "scrolled past".
const NAV_OFFSET_PX = 96;
// Dead band between the reveal and retract points. The condensed bar lives
// inside the sticky nav, so showing it grows the nav and nudges the page
// (and this breadcrumb) down; a band taller than the bar keeps that nudge
// from carrying the breadcrumb back across the line and strobing the reveal.
const REVEAL_HYSTERESIS_PX = 72;

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

  // Reveal the condensed copy once this breadcrumb sits behind the sticky
  // nav, and retract it only after scrolling well back up. Two thresholds (a
  // dead band) rather than one keep the reveal from oscillating at the
  // boundary — see REVEAL_HYSTERESIS_PX. rAF-throttled, passive listeners.
  useEffect(() => {
    const node = navRef.current;
    if (!node) return;

    let shown = false;
    let frame = 0;

    const evaluate = () => {
      frame = 0;
      const { bottom } = node.getBoundingClientRect();
      if (!shown && bottom <= NAV_OFFSET_PX) {
        shown = true;
        setScrolledPast(true);
      } else if (shown && bottom >= NAV_OFFSET_PX + REVEAL_HYSTERESIS_PX) {
        shown = false;
        setScrolledPast(false);
      }
    };

    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(evaluate);
    };

    evaluate();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
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
