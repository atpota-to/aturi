'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { CircleCheck, ListPlus, LoaderCircle, Share2, Square } from 'lucide-react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import SignInPanel from '@/components/explore/SignInPanel';
import DeleteProgressBar from '@/components/explore/DeleteProgressBar';
import {
  DEFAULT_LIST_NAME,
  LISTBLOCK_COLLECTION,
  LISTITEM_COLLECTION,
  LIST_COLLECTION,
  bskyListUrl,
  defaultListDescription,
  listDescriptionProblem,
  listNameProblem,
  savePoints,
  scopeAllowsCreate,
} from '@/lib/tools/mutuals';
import { addMembers, blockList, createModList, type AddOutcome, type AddProgress } from '@/lib/tools/mutualsSave';
import { HOURLY_POINT_BUDGET } from '@/utils/atproto/writeThrottle';
import { explorePathFromAtUri } from '@/utils/atproto/urls';
import { ToolCard, ToolError, ToolVerdict } from './ToolFrame';

const nf = new Intl.NumberFormat('en-US');

type Saving = {
  listUri: string | null;
  progress: AddProgress | null;
  outcome: AddOutcome | null;
  blocked: boolean;
  /** Why blocking the finished list failed. */
  blockError: string | null;
  /** Why creating the list failed. */
  error: string | null;
  running: boolean;
};

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/**
 * Save the ticked accounts as a moderation list on the signed-in account.
 *
 * Signing in leaves the page and comes back to it; the scan is kept across
 * that in session storage (mutualsClient.ts), so nobody has to scan twice.
 * The list is written by the visitor's own session, into their own
 * repository, and nothing about it passes through this site's server
 * beyond what the session proxy already relays.
 */
export default function MutualBlocksSave({
  selected,
  threshold,
  mutualsRead,
  scanned,
}: {
  selected: readonly string[];
  threshold: number;
  mutualsRead: number;
  /** The account that was scanned, for the sign-in field and the note when it is someone else. */
  scanned: { did: string; handle: string | null };
}) {
  const { agent, did, loading, grantedScope } = useAtprotoSession();
  const [name, setName] = useState(DEFAULT_LIST_NAME);
  const [description, setDescription] = useState<string | null>(null);
  const [block, setBlock] = useState(false);
  const [saving, setSaving] = useState<Saving | null>(null);
  const stopper = useRef({ stop: false });

  const text = description ?? defaultListDescription(threshold, mutualsRead, new Date());
  const nameProblem = listNameProblem(name);
  const descriptionProblem = listDescriptionProblem(text);
  const collections = block ? [LIST_COLLECTION, LISTITEM_COLLECTION, LISTBLOCK_COLLECTION] : [LIST_COLLECTION, LISTITEM_COLLECTION];
  const allowed = scopeAllowsCreate(grantedScope, collections);
  const points = savePoints(selected.length, block);

  /**
   * Write the list, or add to one already made. A failed batch wrote
   * nothing, so `outcome.remaining` is exactly what is left to add.
   */
  async function run(subjects: string[], listUri: string | null) {
    if (!agent || !did) return;
    const already = saving?.blocked ?? false;
    stopper.current = { stop: false };
    setSaving({
      listUri,
      progress: null,
      outcome: null,
      blocked: already,
      blockError: null,
      error: null,
      running: true,
    });
    let uri = listUri;
    if (!uri) {
      try {
        uri = await createModList(agent, did, name, text);
      } catch (err) {
        setSaving((prev) => (prev ? { ...prev, error: message(err), running: false } : prev));
        return;
      }
      const made = uri;
      setSaving((prev) => (prev ? { ...prev, listUri: made } : prev));
    }
    const listAt = uri;
    const outcome = await addMembers(agent, did, listAt, subjects, {
      stopper: stopper.current,
      onProgress: (progress) => setSaving((prev) => (prev ? { ...prev, progress } : prev)),
    });
    let blocked = already;
    let blockError: string | null = null;
    if (block && !already && outcome.remaining.length === 0) {
      try {
        await blockList(agent, did, listAt);
        blocked = true;
      } catch (err) {
        blockError = message(err);
      }
    }
    setSaving((prev) => (prev ? { ...prev, listUri: listAt, outcome, blocked, blockError, running: false } : prev));
  }

  if (loading) {
    return (
      <ToolCard>
        <p className="fn-tool-note">Checking whether you are signed in…</p>
      </ToolCard>
    );
  }

  if (!did || !agent) {
    return (
      <ToolCard>
        <div className="fn-tool-mutuals-save">
          <p>
            Sign in to save the {nf.format(selected.length)} ticked {selected.length === 1 ? 'account' : 'accounts'} as a
            moderation list on your account. Signing in leaves this page and comes back to it; the scan is kept, so
            nothing is read again. Allow <strong>Create</strong> when asked which permissions to grant.
          </p>
          <SignInPanel defaultInput={scanned.handle ?? scanned.did} />
        </div>
      </ToolCard>
    );
  }

  // After a save has started: its progress, or how it ended.
  if (saving) {
    const listUrl = saving.listUri ? bskyListUrl(saving.listUri) : null;
    const explorer = saving.listUri ? explorePathFromAtUri(saving.listUri) : null;
    const outcome = saving.outcome;
    const finished = outcome && outcome.remaining.length === 0;
    const share = listUrl
      ? `https://bsky.app/intent/compose?text=${encodeURIComponent(
          `I made a moderation list of accounts many of my mutuals block. ${listUrl}`,
        )}`
      : null;
    return (
      <ToolCard>
        <div className="fn-tool-mutuals-save">
          {saving.running ? (
            <>
              <ToolVerdict
                tone="info"
                icon={<LoaderCircle size={18} className="fn-tool-spin" />}
                title={saving.listUri ? `Adding accounts to “${name.trim()}”` : `Creating “${name.trim()}”`}
              >
                {saving.progress?.waitingSec
                  ? `Waiting ${saving.progress.waitingSec}s for your PDS’s write budget, then carrying on. Keep this page open.`
                  : 'Writing to your repository in batches of 200.'}
              </ToolVerdict>
              {saving.progress && (
                <div className="fn-tool-mutuals-save-progress">
                  <DeleteProgressBar done={saving.progress.done} total={saving.progress.total} />
                  <button type="button" className="fx-btn fx-btn-sm" onClick={() => (stopper.current.stop = true)}>
                    <Square size={12} aria-hidden /> Stop
                  </button>
                </div>
              )}
            </>
          ) : finished ? (
            <ToolVerdict tone="pass" icon={<CircleCheck size={18} />} title="Your list is live">
              {nf.format(outcome.added)} {outcome.added === 1 ? 'account' : 'accounts'} on “{name.trim()}”.
              {saving.blocked
                ? ' You are blocking everyone on it.'
                : saving.blockError
                  ? ` Blocking it failed (${saving.blockError}); subscribe to it in Bluesky instead.`
                  : ' Subscribe to it in Bluesky to mute or block everyone on it.'}
            </ToolVerdict>
          ) : (
            <ToolVerdict
              tone="warn"
              icon={<ListPlus size={18} />}
              title={saving.listUri ? 'The list is not finished' : 'The list was not made'}
            >
              {saving.error
                ? `The list could not be created: ${saving.error}`
                : outcome?.endedBy === 'rate-limit'
                  ? `Your PDS’s write limit was reached after ${nf.format(outcome.added)}.${
                      outcome.resetMinutes ? ` It resets in about ${outcome.resetMinutes} minutes.` : ''
                    }`
                  : outcome?.endedBy === 'stop'
                    ? `Stopped after ${nf.format(outcome.added)}.`
                    : `${nf.format(outcome?.added ?? 0)} added before a write failed${outcome?.error ? `: ${outcome.error}` : '.'}`}
              {outcome && outcome.remaining.length > 0 && ` ${nf.format(outcome.remaining.length)} still to add.`}
            </ToolVerdict>
          )}

          {!saving.running && (
            <div className="fn-tool-actions">
              {listUrl && (
                <a href={listUrl} target="_blank" rel="noopener noreferrer" className="fx-btn fx-btn-sm">
                  Open in Bluesky
                </a>
              )}
              {explorer && (
                <Link href={explorer} prefetch={false} className="fx-btn fx-btn-sm">
                  Open in the Explorer
                </Link>
              )}
              {finished && share && (
                <a href={share} target="_blank" rel="noopener noreferrer" className="fx-btn fx-btn-sm">
                  <Share2 size={13} aria-hidden /> Share it
                </a>
              )}
              {saving.listUri && outcome && outcome.remaining.length > 0 && (
                <button type="button" className="fx-btn fx-btn-sm" onClick={() => run(outcome.remaining, saving.listUri)}>
                  Add the remaining {nf.format(outcome.remaining.length)}
                </button>
              )}
              {(finished || !saving.listUri) && (
                <button type="button" className="fx-btn fx-btn-sm" onClick={() => setSaving(null)}>
                  Make another list
                </button>
              )}
            </div>
          )}
        </div>
      </ToolCard>
    );
  }

  const ready = selected.length > 0 && !nameProblem && !descriptionProblem && allowed !== false;
  return (
    <ToolCard>
      <form
        className="fn-tool-mutuals-save"
        onSubmit={(event) => {
          event.preventDefault();
          if (ready) void run([...selected], null);
        }}
      >
        {did !== scanned.did && (
          <p className="fn-tool-note">
            The list will be made on the account you are signed in with, not the one that was scanned.
          </p>
        )}
        <label className="fn-tool-mutuals-field">
          <span>Name</span>
          <input type="text" value={name} maxLength={64} onChange={(event) => setName(event.target.value)} />
        </label>
        {nameProblem && <p className="fn-tool-mutuals-problem">{nameProblem}</p>}
        <label className="fn-tool-mutuals-field">
          <span>Description</span>
          <textarea rows={3} value={text} onChange={(event) => setDescription(event.target.value)} />
        </label>
        {descriptionProblem && <p className="fn-tool-mutuals-problem">{descriptionProblem}</p>}
        <label className="fn-tool-mutuals-check">
          <input type="checkbox" checked={block} onChange={(event) => setBlock(event.target.checked)} />
          <span>Block everyone on it once it is made</span>
        </label>

        {allowed === false && (
          <ToolError>
            This sign-in did not grant permission to create records, so the list cannot be written. Sign out and sign
            in again with <strong>Create</strong> ticked.
          </ToolError>
        )}

        <div className="fn-tool-mutuals-save-row">
          <p className="fn-tool-note">
            {selected.length === 0
              ? 'Tick at least one account above.'
              : `${nf.format(selected.length)} ${selected.length === 1 ? 'account' : 'accounts'}, ${nf.format(points)} write points.`}
            {points > HOURLY_POINT_BUDGET * 0.9 &&
              ` Your PDS allows ${nf.format(HOURLY_POINT_BUDGET)} an hour, so this pauses partway and carries on by itself while the page stays open.`}
          </p>
          <button type="submit" className="fn-searchbox-submit fn-tool-mutuals-save-button" disabled={!ready}>
            <ListPlus size={16} aria-hidden /> Create list
          </button>
        </div>
      </form>
    </ToolCard>
  );
}
