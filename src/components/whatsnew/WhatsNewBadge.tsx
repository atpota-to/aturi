'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Bell } from 'lucide-react';
import { usePreferences } from '@/components/PreferencesProvider';
import {
  LATEST_RELEASE_ID,
  countEntries,
  unseenReleases,
  type Release,
} from '@/utils/releaseNotes';
import WhatsNewContent from './WhatsNewContent';

/**
 * Header bell with an unread dot, opening the same notes the modal shows.
 *
 * This is the passive half of the pair: it never interrupts, works on every
 * page, and stays available after the modal has been dismissed — or turned
 * off entirely via `announceReleases`. It is also the seam for other kinds of
 * notification later, which is why the dot is driven by a count rather than a
 * boolean.
 *
 * Renders nothing when there is nothing unread, so the header doesn't carry a
 * permanently dead button.
 */
export default function WhatsNewBadge() {
  const { prefs, update } = usePreferences();
  const [open, setOpen] = useState(false);
  /**
   * Notes captured at open time. Opening also marks them read, which empties
   * the derived list — without this snapshot the panel would blank out the
   * instant it appeared.
   */
  const [shown, setShown] = useState<Release[]>([]);
  const wrapRef = useRef<HTMLDivElement>(null);
  const btnRef = useRef<HTMLButtonElement>(null);

  const releases = useMemo(
    () => unseenReleases(prefs.lastSeenReleaseId),
    [prefs.lastSeenReleaseId],
  );
  const count = countEntries(releases);

  const close = useCallback(() => {
    setOpen(false);
    btnRef.current?.focus();
  }, []);

  const toggle = useCallback(() => {
    if (open) {
      close();
      return;
    }
    setShown(releases);
    setOpen(true);
    // Opening is the acknowledgement: the dot clears and the modal won't fire
    // on the next visit.
    update((p) =>
      p.lastSeenReleaseId === LATEST_RELEASE_ID
        ? p
        : { ...p, lastSeenReleaseId: LATEST_RELEASE_ID },
    );
  }, [open, close, releases, update]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, close]);

  // Hidden until there's something to say, so the header keeps its two buttons
  // for a reader who is caught up. Once it has appeared, `shown` keeps it
  // mounted for the rest of the page — reading the notes shouldn't make the
  // way back to them disappear mid-thought.
  if (releases.length === 0 && shown.length === 0) return null;

  return (
    <div className="whats-new-badge-wrap" ref={wrapRef}>
      <button
        ref={btnRef}
        type="button"
        className="whats-new-badge-btn"
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={count > 0 ? `What's new — ${count} unread` : "What's new"}
        onClick={toggle}
      >
        <Bell size={16} aria-hidden />
        {count > 0 && <span className="whats-new-badge-dot" aria-hidden />}
      </button>

      {open && (
        <div className="whats-new-popover" role="dialog" aria-label="What's new">
          <div className="whats-new-head">
            <div>
              <h2 className="whats-new-title">What&rsquo;s new</h2>
              <p className="whats-new-date">{shown[0]?.label}</p>
            </div>
          </div>
          <WhatsNewContent releases={shown} />
          <div className="whats-new-foot">
            <span />
            <button type="button" className="whats-new-btn" onClick={close}>
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
