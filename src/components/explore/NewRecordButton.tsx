'use client';

import { useState } from 'react';
import { FilePlus2 } from 'lucide-react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import NewRecordDialog from './NewRecordDialog';

/**
 * The way into <NewRecordDialog>, plus the two questions every call site would
 * otherwise answer for itself: whether there's a session to write with, and
 * what the button should say when you're standing on someone else's repo.
 *
 * Signed out it renders nothing. The pages that host it already offer sign-in
 * for their own reasons, and a second prompt on the same screen — differently
 * worded, in a different place — reads as two different things to do.
 *
 * Writes always land in the signed-in account's repo, so the button stays on
 * someone else's collection page and changes its label instead: finding a
 * lexicon on another repo and wanting one of your own is the ordinary way
 * anyone meets a lexicon they haven't used.
 */
export default function NewRecordButton({
  collection,
  repoDid,
  compact,
}: {
  /** Pre-fills the collection. Omit on a page that isn't inside one. */
  collection?: string;
  /** The repo being viewed, so the label can tell you when it isn't yours. */
  repoDid?: string;
  /** Icon-only, for a row that's already full. */
  compact?: boolean;
}) {
  const { did, loading } = useAtprotoSession();
  const [open, setOpen] = useState(false);
  // The dialog resolves the signed-in handle and lists your own collections
  // when it mounts, so it stays unmounted until the button is first pressed.
  // After that it sticks around, because every open resets itself anyway and
  // remounting would repeat those lookups.
  const [mounted, setMounted] = useState(false);

  if (loading || !did) return null;

  const elsewhere = Boolean(repoDid && repoDid !== did);
  const label = elsewhere ? 'New in yours' : 'New';
  const title = collection
    ? elsewhere
      ? `Create a ${collection} record in your own repository`
      : `Create a ${collection} record`
    : 'Create a record in your repository';

  return (
    <>
      <button
        type="button"
        onClick={() => {
          setMounted(true);
          setOpen(true);
        }}
        title={title}
        aria-label={title}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: compact ? 0 : '0.4rem',
          padding: compact ? '0.45rem' : '0.4rem 0.75rem',
          background: 'var(--bg-tertiary)',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border-medium)',
          fontFamily: 'var(--font-serif)',
          fontSize: '0.8125rem',
          cursor: 'pointer',
          flexShrink: 0,
        }}
      >
        <FilePlus2 size={12} aria-hidden />
        {!compact && label}
      </button>
      {mounted && (
        <NewRecordDialog
          open={open}
          onClose={() => setOpen(false)}
          collection={collection}
        />
      )}
    </>
  );
}
