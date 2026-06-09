'use client';

import Link from 'next/link';
import { ExternalLink } from 'lucide-react';

type Props = {
  href: string;
  label: string;
  /** External target (opens in a new tab) vs internal Next navigation. */
  external?: boolean;
  title?: string;
};

/**
 * An outbound-link button styled to match CopyButton (variant="subtle",
 * compact) so the explorer's copy row reads as one consistent set of
 * pill buttons. The external-link icon signals "navigates away", paired
 * with the copy buttons' copy icon — which is why the row no longer needs
 * a leading "Copy" label to explain itself.
 */
export default function LinkButton({ href, label, external, title }: Props) {
  const style: React.CSSProperties = {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '0.4rem',
    padding: '0.25rem 0.5rem',
    background: 'transparent',
    border: '1px solid var(--border-subtle)',
    color: 'var(--text-secondary)',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.75rem',
    textDecoration: 'none',
    cursor: 'pointer',
    transition: 'color 0.2s ease, border-color 0.2s ease',
  };
  const onMouseEnter = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.color = 'var(--text-primary)';
    e.currentTarget.style.borderColor = 'var(--border-medium)';
  };
  const onMouseLeave = (e: React.MouseEvent<HTMLElement>) => {
    e.currentTarget.style.color = 'var(--text-secondary)';
    e.currentTarget.style.borderColor = 'var(--border-subtle)';
  };

  const inner = (
    <>
      <ExternalLink size={12} />
      <span>{label}</span>
    </>
  );

  if (external) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        title={title ?? label}
        style={style}
        onMouseEnter={onMouseEnter}
        onMouseLeave={onMouseLeave}
      >
        {inner}
      </a>
    );
  }

  return (
    <Link
      href={href}
      title={title ?? label}
      style={style}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
    >
      {inner}
    </Link>
  );
}
