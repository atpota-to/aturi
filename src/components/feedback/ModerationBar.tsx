'use client';

import { useState } from 'react';
import type { Agent } from '@atproto/api';
import { Lock, Loader2, Pin, EyeOff } from 'lucide-react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import {
  UI_STATE_META,
  UI_STATES,
  type StrongRef,
  type UiState,
} from '@/utils/userinput/lexicons';
import {
  createHide,
  createLock,
  createPin,
  setStatus,
} from '@/utils/userinput/writes';

/**
 * Owner / moderator actions on a discussion.
 *
 * Each of these is a record written to the *moderator's* repo, not a mutation
 * of the discussion — the discussion's author still owns their record and
 * nothing here can change or delete it. What a moderator controls is what this
 * board chooses to render, which is why hiding removes a discussion from
 * aturi.to's view while leaving it readable in its author's repo.
 *
 * Actions are one-way here on purpose: undoing means deleting the moderation
 * record, which is a repo operation better done in the explorer's record
 * editor than behind a toggle that has to guess which of several records to
 * remove.
 */
export default function ModerationBar({
  space,
  subject,
  currentStatus,
  pinned,
  locked,
  onChanged,
}: {
  space: StrongRef;
  subject: StrongRef;
  currentStatus: UiState;
  pinned: boolean;
  locked: boolean;
  onChanged: () => void;
}) {
  const { agent } = useAtprotoSession();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);

  const run = async (key: string, fn: (a: Agent & { assertDid: string }) => Promise<unknown>) => {
    if (!agent) return;
    setBusy(key);
    setError(null);
    try {
      await fn(agent as unknown as Agent & { assertDid: string });
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const applyStatus = (state: UiState) =>
    run('status', (a) => setStatus(a, { subject, state, note }));

  return (
    <div className="fn-fb-card" data-tone="mod">
      <span className="explore-small-caps">Moderator actions</span>

      <div className="fn-fb-chips">
        {UI_STATES.map((state) => {
          const active = state === currentStatus;
          return (
            <button
              key={state}
              type="button"
              disabled={busy !== null || active}
              onClick={() => applyStatus(state)}
              className="fn-fb-modstate"
              data-active={active ? '' : undefined}
            >
              {UI_STATE_META[state].label}
            </button>
          );
        })}
      </div>

      {showNote ? (
        <textarea
          className="explore-input explore-textarea"
          rows={2}
          value={note}
          maxLength={1500}
          placeholder="Optional note attached to the next status you set."
          onChange={(e) => setNote(e.target.value)}
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowNote(true)}
          className="fn-fb-linkbtn"
          style={{ alignSelf: 'flex-start' }}
        >
          Add a note to the next status
        </button>
      )}

      <div className="fn-fb-chips">
        <ActionButton
          icon={busy === 'pin' ? <Loader2 size={13} className="explore-spin" /> : <Pin size={13} />}
          label={pinned ? 'Pinned' : 'Pin to top'}
          disabled={busy !== null || pinned}
          onClick={() => run('pin', (a) => createPin(a, { space, subject }))}
        />
        <ActionButton
          icon={busy === 'lock' ? <Loader2 size={13} className="explore-spin" /> : <Lock size={13} />}
          label={locked ? 'Locked' : 'Lock replies'}
          disabled={busy !== null || locked}
          onClick={() => run('lock', (a) => createLock(a, { subject }))}
        />
        <ActionButton
          icon={
            busy === 'hide' ? <Loader2 size={13} className="explore-spin" /> : <EyeOff size={13} />
          }
          label="Hide"
          danger
          disabled={busy !== null}
          onClick={() => run('hide', (a) => createHide(a, { space, subject }))}
        />
      </div>

      {error ? <p className="explore-error">{error}</p> : null}
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
  danger = false,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled: boolean;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`fn-c-btn fn-c-btn-sm${danger ? ' fn-c-btn-danger' : ''}`}
    >
      {icon}
      {label}
    </button>
  );
}
