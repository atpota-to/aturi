'use client';

import { useEffect, useMemo, useRef } from 'react';
import Link from 'next/link';
import { ChevronRight, Server, User } from 'lucide-react';
import { encodeRepo, shortDid } from '@/utils/atproto/urls';
import { SPACE_MARKER } from '@/utils/atproto/spaceUri';
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
   * True on any page under the `/space` marker. Switches the trail into
   * permissioned-space mode, where `collection` and `rkey` describe a record
   * inside a member's permissioned repo rather than one in the public repo
   * above. Set independently of `spaceType` so the marker page itself — which
   * names no type yet — still shows where it sits.
   */
  spaceRoot?: boolean;
  /** Space type NSID. Only meaningful alongside `spaceRoot`. */
  spaceType?: string;
  /** Space key. Only meaningful alongside `spaceType`. */
  skey?: string;
  /** DID of the member whose permissioned repo holds the record. */
  author?: string;
  /**
   * The member's handle, when the caller has resolved it. The space trail
   * shows the authority as a handle, so leaving the member as a raw DID made
   * two identities in the same trail read as different kinds of thing.
   */
  authorHandle?: string | null;
  /**
   * When provided, renders a "Copy link" chip at the end of the breadcrumb
   * row. Path or full URL; bare paths get aturi.to prepended.
   */
  shareUrl?: string;
};

/**
 * Hierarchical breadcrumb across the explore levels:
 *
 *   pds host  →  repo (handle/did)  →  collection (NSID)  →  rkey
 *
 * and, for a permissioned space address, the deeper trail:
 *
 *   pds  →  authority  →  space  →  type  →  key  →  member  →  collection  →  rkey
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
  spaceRoot,
  spaceType,
  skey,
  author,
  authorHandle,
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

    // Permissioned-space trail. `space` is a literal path marker rather than a
    // collection NSID, and everything under it is addressed relative to it —
    // so a collection and rkey in this mode hang off the member's path inside
    // the space, never off the public repo path.
    if (spaceRoot || spaceType) {
      const markerPath = `/explore/${repoSegment}/${SPACE_MARKER}`;
      crumbs.push({ label: SPACE_MARKER, href: markerPath });
      if (!spaceType) return crumbs;
      const typePath = `${markerPath}/${spaceType}`;
      crumbs.push({ label: spaceType, href: typePath });
      if (!skey) return crumbs;
      const spacePath = `${typePath}/${encodeURIComponent(skey)}`;
      crumbs.push({ label: skey, href: spacePath });
      if (!author) return crumbs;
      const authorPath = `${spacePath}/${encodeRepo(author)}`;
      // Carries the person glyph for the same reason the PDS crumb carries the
      // server one: everything either side of it in this trail is an address
      // component, and without the marker a member reads as one more path
      // segment rather than as whose records these are.
      crumbs.push({
        label: authorHandle ? `@${authorHandle}` : shortDid(author),
        href: authorPath,
        icon: 'user',
      });
      if (!collection) return crumbs;
      crumbs.push({ label: collection, href: `${authorPath}/${collection}` });
      if (rkey) crumbs.push({ label: rkey });
      return crumbs;
    }

    if (collection) {
      crumbs.push({ label: collection, href: `/explore/${repoSegment}/${collection}` });
    }
    if (rkey) {
      crumbs.push({ label: rkey });
    }
    return crumbs;
  }, [pdsHost, repoLabel, repoSegment, spaceRoot, spaceType, skey, author, authorHandle, collection, rkey]);

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
      {/* Rendered straight off the mirrored trail so the visible row and its
          condensed twin can never drift apart as levels are added. A crumb
          without an href is terminal — today only a record key. */}
      {trail.map((crumb, i) => (
        <span
          key={`${i}-${crumb.href ?? crumb.label}`}
          style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', minWidth: 0 }}
        >
          {i > 0 && (
            <ChevronRight size={14} aria-hidden style={{ color: 'var(--text-tertiary)' }} />
          )}
          {crumb.href ? (
            <Link
              href={crumb.href}
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
              {crumb.icon === 'server' && (
                <Server size={12} aria-hidden style={{ opacity: 0.7 }} />
              )}
              {crumb.icon === 'user' && (
                <User size={12} aria-hidden style={{ opacity: 0.7 }} />
              )}
              {crumb.label}
            </Link>
          ) : (
            <span style={{ color: 'var(--text-tertiary)' }}>{crumb.label}</span>
          )}
        </span>
      ))}

      {shareUrl && (
        <span style={{ marginLeft: 'auto' }}>
          <ShareLinkChip url={shareUrl} />
        </span>
      )}
    </nav>
  );
}
