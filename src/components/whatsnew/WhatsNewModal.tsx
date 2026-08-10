'use client';

import { useEffect, useMemo, useRef } from 'react';
import { X } from 'lucide-react';
import { usePreferences } from '@/components/PreferencesProvider';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { LATEST_RELEASE_ID, unseenReleases } from '@/utils/releaseNotes';
import WhatsNewContent from './WhatsNewContent';

/**
 * "What's new" modal, mounted once globally and self-triggering.
 *
 * Fires on the first visit after a release the reader hasn't acknowledged. It
 * is deliberately impossible for a first-time visitor to see:
 * `DEFAULT_PREFERENCES.lastSeenReleaseId` is the newest release, so someone
 * with no stored preferences has nothing unseen.
 *
 * Two subtleties worth keeping:
 *
 * Timing — `loading` goes false as soon as localStorage is read, then true
 * again while a signed-in reader's PDS record loads. Child effects run before
 * parent ones, so gating on `loading` could fire the modal inside that window,
 * at someone whose PDS record already says they're caught up. `pdsSync` is the
 * signal that survives it.
 *
 * Closing — the reader closes the dialog, and the dialog's own `close` event
 * advances the cursor. Doing it in that order (rather than flipping a
 * preference and letting the modal disappear underneath itself) means Escape,
 * the X, the backdrop, and Done all take exactly the same path, and the
 * contents stay stable while the dialog is on screen.
 */
export default function WhatsNewModal() {
  const { prefs, update, loading, pdsSync } = usePreferences();
  const { did, loading: sessionLoading } = useAtprotoSession();
  const ref = useRef<HTMLDialogElement>(null);
  /** Set by "Don't show these again" so the shared close handler can read it. */
  const optingOut = useRef(false);

  const releases = useMemo(
    () => unseenReleases(prefs.lastSeenReleaseId),
    [prefs.lastSeenReleaseId],
  );

  // Anonymous readers are ready once local prefs load. Signed-in readers wait
  // for `pdsSync` to leave 'syncing' so the cursor is authoritative.
  const ready = sessionLoading
    ? false
    : did
      ? pdsSync === 'idle' || pdsSync === 'error'
      : !loading;

  const shouldOpen = ready && prefs.announceReleases && releases.length > 0;

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    if (shouldOpen && !dlg.open) dlg.showModal();
  }, [shouldOpen]);

  useEffect(() => {
    const dlg = ref.current;
    if (!dlg) return;
    const onClose = () => {
      const optOut = optingOut.current;
      optingOut.current = false;
      update((p) => ({
        ...p,
        lastSeenReleaseId: LATEST_RELEASE_ID,
        announceReleases: optOut ? false : p.announceReleases,
      }));
    };
    dlg.addEventListener('close', onClose);
    return () => dlg.removeEventListener('close', onClose);
  }, [update]);

  // Always rendered, even with nothing to say. A closed <dialog> is invisible,
  // and keeping it mounted means the ref — and therefore the `close` listener
  // above — exists from the first render. Bailing out early here instead would
  // attach that listener to nothing: on the very first pass `prefs` is still
  // defaults, so there is never anything unseen, and the effect would not re-run
  // once the stored preferences arrive and the dialog appeared.
  return (
    <dialog
      ref={ref}
      aria-label="What's new"
      className="cmdk-dialog"
      onClick={(e) => {
        if (e.target === ref.current) ref.current?.close();
      }}
    >
      <div className="cmdk-panel whats-new-panel">
        <div className="whats-new-head">
          <div>
            <h2 className="whats-new-title">What&rsquo;s new since you were here</h2>
            <p className="whats-new-date">{releases[0]?.label}</p>
          </div>
          <button
            type="button"
            onClick={() => ref.current?.close()}
            aria-label="Close what's new"
            className="whats-new-close"
          >
            <X size={18} aria-hidden />
          </button>
        </div>

        <WhatsNewContent releases={releases} />

        <div className="whats-new-foot">
          <button
            type="button"
            className="whats-new-optout"
            onClick={() => {
              optingOut.current = true;
              ref.current?.close();
            }}
          >
            Don&rsquo;t show these again
          </button>
          <button
            type="button"
            className="whats-new-btn"
            onClick={() => ref.current?.close()}
          >
            Done
          </button>
        </div>
      </div>
    </dialog>
  );
}
