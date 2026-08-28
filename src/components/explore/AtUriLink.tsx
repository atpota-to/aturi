'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { explorePathFromAtUri } from '@/utils/atproto/urls';

/**
 * Renders an at:// URI (or DID) as a `<Link>` to the explorer page for that
 * record / collection / repo. Falls back to plain text when the URI isn't
 * parseable.
 *
 * `rel="nofollow"` + `prefetch={false}`, for the reason spelled out on
 * <LinkifiedJson>: the destination is whatever DID or at:// URI happened to be
 * inside a record, so every one of these is an edge into an unbounded slice of
 * the network rather than a page of this site. Both flags are needed. `rel`
 * only tells a crawler not to *queue* the URL; the prefetch is a fetch the
 * browser makes on its own once the link is in the viewport, and a crawler
 * running JavaScript makes it too.
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
    <Link
      href={path}
      className={className}
      style={style}
      prefetch={false}
      rel="nofollow"
    >
      {label}
    </Link>
  );
}
