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
 * An outbound-link button in the Field Notes button style (sans, 8px corners,
 * hairline border; styles in globals.css under `.fn-link-btn`), sized to sit
 * beside the compact CopyButtons in the explorer's copy card. The
 * external-link icon signals "navigates away", paired with the copy buttons'
 * copy icon — which is why the row no longer needs a leading "Copy" label to
 * explain itself.
 */
export default function LinkButton({ href, label, external, title }: Props) {
  const inner = (
    <>
      <ExternalLink size={12} aria-hidden />
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
        className="fn-link-btn"
      >
        {inner}
      </a>
    );
  }

  return (
    <Link
      href={href}
      prefetch={false}
      title={title ?? label}
      className="fn-link-btn"
    >
      {inner}
    </Link>
  );
}
