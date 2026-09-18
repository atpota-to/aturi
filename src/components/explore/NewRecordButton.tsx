'use client';

import Link from 'next/link';
import { FilePlus2 } from 'lucide-react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';

/**
 * The way into the record composer, plus the two questions every call site
 * would otherwise answer for itself: whether there is a session to write with,
 * and what to say when you are standing on somebody else's repo.
 *
 * A link, not a button that opens something. The composer is a page, so this is
 * middle-clickable, openable in a new tab, and the browser's back button
 * returns you here — none of which a dialog trigger gives you.
 *
 * Signed out it renders nothing. The composer's own page asks for a sign-in
 * with the context to explain why, and a second prompt on this screen —
 * differently worded, in a different place — reads as two different things to
 * do. Writes always land in the signed-in account's repo, so the link stays on
 * other people's collection pages and changes its label instead: finding a
 * lexicon on another repo and wanting one of your own is the ordinary way
 * anyone meets a lexicon they have not used.
 */
export default function NewRecordButton({
  collection,
  repoDid,
}: {
  /** Pre-fills the collection. Omit on a page that isn't inside one. */
  collection?: string;
  /** The repo being viewed, so the label can tell you when it isn't yours. */
  repoDid?: string;
}) {
  const { did, loading } = useAtprotoSession();

  if (loading || !did) return null;

  const elsewhere = Boolean(repoDid && repoDid !== did);
  const label = elsewhere ? 'New in yours' : 'New record';
  const title = collection
    ? elsewhere
      ? `Write a ${collection} record in your own repository`
      : `Write a ${collection} record`
    : 'Write a record in your repository';

  const href = collection
    ? `/explore/compose?collection=${encodeURIComponent(collection)}`
    : '/explore/compose';

  return (
    <Link
      href={href}
      title={title}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        padding: '0.4rem 0.75rem',
        background: 'var(--bg-tertiary)',
        color: 'var(--text-secondary)',
        border: '1px solid var(--border-medium)',
        fontFamily: 'var(--font-serif)',
        fontSize: '0.8125rem',
        textDecoration: 'none',
        cursor: 'pointer',
        flexShrink: 0,
        whiteSpace: 'nowrap',
      }}
    >
      <FilePlus2 size={12} aria-hidden />
      {label}
    </Link>
  );
}
