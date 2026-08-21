'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, Server, User } from 'lucide-react';
import { useBreadcrumbTrail, type BreadcrumbCrumb } from './BreadcrumbContext';

/**
 * Condensed breadcrumb that drops into the bottom of the floating nav once
 * the full in-page breadcrumb has scrolled up behind it, so the explorer
 * path stays anchored at the top while you read down a long record or
 * collection. Reads the trail from BreadcrumbContext and renders nothing
 * until one is registered, so it's inert on routes that don't provide one.
 *
 * Rendered as a plain row (not a <nav> landmark) so it doesn't compete with
 * the live breadcrumb's landmark — that one stays in the DOM and reachable
 * even while scrolled off-screen.
 */

/**
 * How many crumbs fit before the middle is folded away, and how many survive
 * at each end when it is.
 *
 * A public record is four crumbs (pds → repo → collection → rkey) and fits.
 * A permissioned record is eight (pds → authority → space → type → key →
 * member → collection → rkey), most of them a full NSID or handle, and used
 * to wrap this bar onto five lines — turning the nav into a block that pushed
 * the page it was meant to sit above out of the way.
 *
 * The ends are what survive because they are what the bar is for: the head is
 * the root to get back to, and the tail is where you actually are. What folds
 * is the middle of a space address, which is also the part the page's own
 * breadcrumb is still showing in full one scroll up.
 */
const MAX_INLINE_CRUMBS = 5;
const HEAD_CRUMBS = 1;
const TAIL_CRUMBS = 3;

export default function StickyBreadcrumbBar() {
  const { trail, scrolledPast } = useBreadcrumbTrail();
  const show = scrolledPast && !!trail && trail.length > 0;

  // Folding is the default on every trail long enough to need it, including
  // one you expanded and then navigated away from: the next page's trail is a
  // new path, not a continuation of the one you opened up.
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    setExpanded(false);
  }, [trail]);

  const crumbs = trail ?? [];
  const folded = crumbs.length > MAX_INLINE_CRUMBS && !expanded;
  const hidden = folded ? crumbs.length - HEAD_CRUMBS - TAIL_CRUMBS : 0;
  const visible = folded
    ? [...crumbs.slice(0, HEAD_CRUMBS), ...crumbs.slice(-TAIL_CRUMBS)]
    : crumbs;

  return (
    <AnimatePresence initial={false}>
      {show && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          exit={{ height: 0, opacity: 0 }}
          transition={{ duration: 0.24, ease: 'easeOut' }}
          // A full-width section at the bottom of the (unpadded) nav card; its
          // border-top reads as a divider connecting it to the row above.
          style={{ overflow: 'hidden' }}
        >
          <div
            style={{
              display: 'flex',
              // Folded, the row is one line and the crumbs inside it shrink to
              // their own ellipses rather than wrapping. Expanded, it wraps
              // like it always did, because someone who opened it up is asking
              // to see the whole path.
              flexWrap: expanded ? 'wrap' : 'nowrap',
              alignItems: 'center',
              gap: '0.3rem',
              padding: '0.5rem 1rem',
              borderTop: '1px solid var(--border-subtle)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.6875rem',
              lineHeight: 1.25,
              color: 'var(--text-tertiary)',
              minWidth: 0,
            }}
          >
            {visible.map((crumb, i) => {
              // The fold sits where the head ends, and carries its own chevron
              // so the path still reads as continuous across the gap.
              const foldHere = folded && i === HEAD_CRUMBS;
              return (
                <span key={`${crumb.label}-${i}`} style={{ display: 'contents' }}>
                  {foldHere && (
                    <FoldButton count={hidden} onClick={() => setExpanded(true)} />
                  )}
                  <Segment
                    crumb={crumb}
                    first={i === 0}
                    last={i === visible.length - 1}
                  />
                </span>
              );
            })}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Stands in for the crumbs that were folded away, and opens them. A button
 * rather than a bare glyph: the segments behind it are links, so the thing
 * that reveals them has to be reachable the same way they are.
 */
function FoldButton({ count, onClick }: { count: number; onClick: () => void }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.3rem', flexShrink: 0 }}>
      <ChevronRight
        size={11}
        aria-hidden
        style={{ color: 'var(--text-tertiary)', opacity: 0.6, flexShrink: 0 }}
      />
      <button
        type="button"
        onClick={onClick}
        title={`Show ${count} hidden path ${count === 1 ? 'segment' : 'segments'}`}
        aria-label={`Show ${count} hidden path ${count === 1 ? 'segment' : 'segments'}`}
        style={{
          padding: '0 0.25rem',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-subtle)',
          color: 'var(--text-secondary)',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.6875rem',
          lineHeight: 1.25,
          cursor: 'pointer',
          transition: 'color 0.2s ease, border-color 0.2s ease',
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--text-accent)';
          e.currentTarget.style.borderColor = 'var(--text-accent)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--text-secondary)';
          e.currentTarget.style.borderColor = 'var(--border-subtle)';
        }}
      >
        …
      </button>
    </span>
  );
}

function Segment({
  crumb,
  first,
  last,
}: {
  crumb: BreadcrumbCrumb;
  first: boolean;
  last: boolean;
}) {
  const label = (
    <>
      {crumb.icon === 'server' && (
        <Server size={10} aria-hidden style={{ opacity: 0.7, flexShrink: 0 }} />
      )}
      {crumb.icon === 'user' && (
        <User size={10} aria-hidden style={{ opacity: 0.7, flexShrink: 0 }} />
      )}
      <span
        style={{
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
          // Tighter than the 13rem this used to allow: on one line a single
          // long NSID could otherwise take the width every other crumb needs.
          maxWidth: '11rem',
        }}
      >
        {crumb.label}
      </span>
    </>
  );

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.3rem',
        minWidth: 0,
        // The last crumb is the record you are looking at, so it keeps its
        // width and everything upstream gives way first. Without this the
        // shrink is spread evenly and the one crumb that says where you are
        // is clipped along with the rest.
        flexShrink: last ? 0 : 1,
      }}
    >
      {!first && (
        <ChevronRight
          size={11}
          aria-hidden
          style={{ color: 'var(--text-tertiary)', opacity: 0.6, flexShrink: 0 }}
        />
      )}
      {crumb.href && !last ? (
        <Link
          href={crumb.href}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.25rem',
            minWidth: 0,
            color: 'var(--text-secondary)',
            textDecoration: 'none',
            transition: 'color 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.color = 'var(--text-accent)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.color = 'var(--text-secondary)';
          }}
        >
          {label}
        </Link>
      ) : (
        <span
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.25rem',
            minWidth: 0,
            color: last ? 'var(--text-primary)' : 'var(--text-secondary)',
          }}
        >
          {label}
        </span>
      )}
    </span>
  );
}
