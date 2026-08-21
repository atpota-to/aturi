'use client';

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
export default function StickyBreadcrumbBar() {
  const { trail, scrolledPast } = useBreadcrumbTrail();
  const show = scrolledPast && !!trail && trail.length > 0;

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
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: '0.3rem',
              padding: '0.5rem 1rem',
              borderTop: '1px solid var(--border-subtle)',
              fontFamily: 'var(--font-mono)',
              fontSize: '0.6875rem',
              lineHeight: 1.25,
              color: 'var(--text-tertiary)',
            }}
          >
            {trail!.map((crumb, i) => (
              <Segment
                key={`${crumb.label}-${i}`}
                crumb={crumb}
                first={i === 0}
                last={i === trail!.length - 1}
              />
            ))}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
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
          maxWidth: '13rem',
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
