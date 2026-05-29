'use client';

import Link from 'next/link';
import { Globe } from 'lucide-react';

type Props = {
  /**
   * Internal path to the universal link page, e.g.
   * `/profile/<handle>/<collection>/<rkey>` or `/profile/<handle>`.
   */
  href: string;
  /** Override the link text. Defaults to "Universal link page". */
  label?: string;
};

/**
 * The inverse of the "View full record in Explorer →" CTA on universal link
 * pages: a navigation link from inside the explorer back out to the
 * shareable, client-agnostic universal link page for the same record/profile.
 *
 * Styled to match the "View on PDS" anchor in the explorer's copy row so the
 * two outbound affordances read as a pair.
 */
export default function UniversalLinkChip({
  href,
  label = 'Universal link page',
}: Props) {
  return (
    <Link
      href={href}
      title="Open the universal link page for this"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.3rem',
        padding: '0.3rem 0.6rem',
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-medium)',
        color: 'var(--text-secondary)',
        fontFamily: 'var(--font-serif)',
        fontSize: '0.8125rem',
        textDecoration: 'none',
        transition: 'color 0.2s ease, border-color 0.2s ease',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.color = 'var(--text-primary)';
        e.currentTarget.style.borderColor = 'var(--text-accent)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.color = 'var(--text-secondary)';
        e.currentTarget.style.borderColor = 'var(--border-medium)';
      }}
    >
      <Globe size={12} />
      {label}
    </Link>
  );
}
