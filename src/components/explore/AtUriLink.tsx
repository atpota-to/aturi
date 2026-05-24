'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { explorePathFromAtUri } from '@/utils/atproto/urls';

/**
 * Renders an at:// URI (or DID) as a `<Link>` to the explorer page for that
 * record / collection / repo. Falls back to plain text when the URI isn't
 * parseable.
 */
export default function AtUriLink({
  uri,
  children,
  className,
  style,
}: {
  uri: string;
  children?: ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  const path = explorePathFromAtUri(uri);
  const label = children ?? uri;
  if (!path) {
    return (
      <span className={className} style={style}>
        {label}
      </span>
    );
  }
  return (
    <Link href={path} className={className} style={style}>
      {label}
    </Link>
  );
}
