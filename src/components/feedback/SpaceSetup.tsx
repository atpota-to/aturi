'use client';

import { useEffect, useState } from 'react';
import type { Agent } from '@atproto/api';
import { Loader2, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import SignInPanel from '@/components/explore/SignInPanel';
import { resolveMiniDoc } from '@/utils/atproto/slingshot';
import { FEEDBACK_OWNER } from '@/utils/userinput/config';
import type { SpaceTag } from '@/utils/userinput/lexicons';
import { createSpace } from '@/utils/userinput/writes';

const DEFAULT_TAGS: SpaceTag[] = [
  { value: 'bug', label: 'Bug' },
  { value: 'feature', label: 'Feature request' },
  { value: 'extension', label: 'Extension' },
  { value: 'explorer', label: 'Explorer' },
  { value: 'waypoint', label: 'New waypoint' },
  { value: 'question', label: 'Question' },
];

/**
 * Shown when no `app.userinput.space` exists yet for the configured owner.
 *
 * A space is a record, not a database row, so the board can't create one on
 * anyone's behalf — it has to be written by the owner's own account. Signing in
 * as that account turns this into a one-click setup; for everyone else it
 * explains why the board is empty rather than showing a broken page.
 *
 * Once the record exists, `resolveSpace()` discovers it on the next load with
 * no configuration change, because discovery scans the owner's repo.
 */
export default function SpaceSetup({ onCreated }: { onCreated: () => void }) {
  const { agent, did } = useAtprotoSession();
  const [ownerDid, setOwnerDid] = useState<string | null>(null);
  const [name, setName] = useState('aturi.to feedback');
  const [description, setDescription] = useState(
    'Bugs, feature requests, and ideas for the extension, the explorer, and universal links.',
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    resolveMiniDoc(FEEDBACK_OWNER).then((doc) => {
      if (!cancelled) setOwnerDid(doc?.did ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const isOwner = Boolean(did && ownerDid && did === ownerDid);

  const create = async () => {
    if (!agent || !name.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await createSpace(agent as unknown as Agent & { assertDid: string }, {
        name: name.trim(),
        description: description.trim(),
        tags: DEFAULT_TAGS,
      });
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setBusy(false);
    }
  };

  return (
    <section className="fn-fb-card" data-tone="setup">
      <div>
        <h2 className="fn-fb-card-title">
          No feedback space yet
        </h2>
        <p className="fn-fb-card-text">
          This board reads an <code>app.userinput.space</code> record from{' '}
          <Link href={`/explore/${FEEDBACK_OWNER}`} prefetch={false}>
            {FEEDBACK_OWNER}
          </Link>
          &rsquo;s repo. There isn&rsquo;t one yet, and only that account can write it.
        </p>
      </div>

      {!did ? (
        <div className="fn-fb-field">
          <span className="explore-small-caps">Sign in as {FEEDBACK_OWNER} to create it</span>
          <SignInPanel defaultInput={FEEDBACK_OWNER} />
        </div>
      ) : !isOwner ? (
        <p className="explore-placeholder">
          You&rsquo;re signed in as a different account. Only {FEEDBACK_OWNER} can create this
          board&rsquo;s space.
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <div className="fn-fb-field">
            <label className="explore-small-caps" htmlFor="space-name">
              Space name
            </label>
            <input
              id="space-name"
              className="explore-input"
              value={name}
              maxLength={100}
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div className="fn-fb-field">
            <label className="explore-small-caps" htmlFor="space-description">
              Description
            </label>
            <textarea
              id="space-description"
              className="explore-input explore-textarea"
              rows={3}
              value={description}
              maxLength={1500}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
          <p className="fn-fb-hint">
            Ships with categories: {DEFAULT_TAGS.map((t) => t.label).join(', ')}. Edit them later in
            the record editor.
          </p>
          {error ? <p className="explore-error">{error}</p> : null}
          <button
            type="button"
            onClick={create}
            disabled={busy || !name.trim()}
            className="fn-c-btn fn-c-btn-primary"
            data-wait={busy ? '' : undefined}
            style={{ alignSelf: 'flex-start' }}
          >
            {busy ? <Loader2 size={14} className="explore-spin" /> : <Sparkles size={14} />}
            Create the space
          </button>
        </div>
      )}
    </section>
  );
}
