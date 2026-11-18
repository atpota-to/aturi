'use client';

import { useCallback, useId, useState } from 'react';
import { UserMinus, UserPlus } from 'lucide-react';
import HandleTypeaheadInput from '@/components/oauth/HandleTypeaheadInput';
import { resolveIdentifier } from '@/utils/atproto/identity';
import { isValidDid } from '@/utils/atproto/spaceUri';
import { shortDid } from '@/utils/atproto/urls';
import {
  addSimpleSpaceMember,
  removeSimpleSpaceMember,
  SIMPLESPACE_POLICY,
  type SimpleSpaceConfig,
  type SpaceTransport,
} from '@/utils/atproto/spaceClient';
import SpaceDialog, { DialogButton, DialogField } from './SpaceDialog';
import { describeSpaceManageError } from '@/utils/atproto/simpleSpaceConfig';

/**
 * Adding and removing members, for the authority and nobody else.
 *
 * Two things about the member list shape everything here, and both are said on
 * screen rather than assumed:
 *
 *   - **It is consulted only under the member-list policy.** Under `public`
 *     everyone already qualifies and under `managingApp` the app decides, so an
 *     entry added in either case is stored and never read. That is not an error
 *     and the methods do not refuse it — which is exactly why a UI that stayed
 *     quiet about it would be misleading.
 *   - **It is a permission, not an invitation.** Nobody is notified, nothing
 *     appears in the new member's repo, and their permissioned repo is created
 *     by their own server the first time they write. Removing someone works the
 *     same way in reverse: it governs future credential mints, leaves any
 *     credential already issued valid until it expires, and does not touch what
 *     they have already written.
 */

/** Whether this space's policy actually reads the member list. */
export function policyUsesMemberList(config: SimpleSpaceConfig | null): boolean {
  return config?.policy?.$type === SIMPLESPACE_POLICY.memberList;
}

export function AddMemberButton({
  space,
  transport,
  config,
  onAdded,
}: {
  space: string;
  transport: SpaceTransport;
  /** Null when the configuration could not be read; the note is skipped then. */
  config: SimpleSpaceConfig | null;
  onAdded: () => void;
}) {
  const inputId = useId();
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setError(null);
  }, []);

  const trimmed = input.trim().replace(/^@/, '');
  const advisory = config && !policyUsesMemberList(config);

  async function submit() {
    if (!trimmed) return;
    setBusy(true);
    setError(null);
    try {
      // A DID is taken as given; anything else is resolved first, because
      // `addMember` takes a DID and a handle can be re-pointed at another
      // account. Storing what someone typed would make membership follow the
      // name rather than the person.
      const did = isValidDid(trimmed) ? trimmed : (await resolveIdentifier(trimmed)).did;
      await addSimpleSpaceMember(transport, { space, did });
      setInput('');
      setOpen(false);
      setBusy(false);
      onAdded();
    } catch (err) {
      // A resolver failure and a host refusal both land here. The resolver's
      // own message ("Could not resolve …") passes through unchanged, which is
      // the more useful half when a handle is the thing that was wrong.
      setError(describeSpaceManageError(err));
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="fx-btn fx-btn-sm">
        <UserPlus size={13} /> Add
      </button>

      <SpaceDialog
        open={open}
        onClose={close}
        busy={busy}
        title="Add member"
        description="Membership is permission to read the space, not an invitation: nobody is notified, and their repository appears the first time they write."
        error={error}
        onSubmit={submit}
        hasPopover
        footer={
          <>
            <DialogButton tone="quiet" onClick={close} disabled={busy}>
              Cancel
            </DialogButton>
            <DialogButton type="submit" disabled={!trimmed || busy} busy={busy}>
              {busy ? 'Adding…' : 'Add'}
            </DialogButton>
          </>
        }
      >
        <DialogField label="Handle or DID" htmlFor={inputId}>
          <HandleTypeaheadInput
            id={inputId}
            value={input}
            onChange={setInput}
            placeholder="alice.example.com"
            disabled={busy}
            listLabel="Matching accounts"
            inputStyle={{
              width: '100%',
              height: '36px',
              boxSizing: 'border-box',
              padding: '0 10px',
              background: 'var(--bg-secondary)',
              border: '1px solid var(--border-strong)',
              borderRadius: 'var(--radius-control)',
              color: 'var(--text-primary)',
              fontFamily: 'var(--font-mono)',
              fontSize: '13px',
              outline: 'none',
            }}
          />
        </DialogField>

        {advisory && (
          <p className="fx-sp-dialog-note fx-sp-dialog-warn">
            This space’s user access isn’t set to the member list, so the list is
            kept but never consulted. Adding someone here grants them nothing
            until you switch the space to “Member list”.
          </p>
        )}
      </SpaceDialog>
    </>
  );
}

export function RemoveMemberButton({
  space,
  did,
  handle,
  transport,
  onRemoved,
}: {
  space: string;
  did: string;
  handle: string | null;
  transport: SpaceTransport;
  onRemoved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const label = handle ? `@${handle}` : shortDid(did);

  const close = useCallback(() => {
    setOpen(false);
    setError(null);
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await removeSimpleSpaceMember(transport, { space, did });
      setOpen(false);
      setBusy(false);
      onRemoved();
    } catch (err) {
      setError(describeSpaceManageError(err));
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Remove ${label} from this space`}
        title={`Remove ${label}`}
        className="fx-btn fx-btn-sm fx-btn-quiet fx-sp-icon-btn"
      >
        <UserMinus size={13} />
      </button>

      <SpaceDialog
        open={open}
        onClose={close}
        busy={busy}
        title={`Remove ${label}?`}
        error={error}
        footer={
          <>
            <DialogButton tone="quiet" onClick={close} disabled={busy}>
              Cancel
            </DialogButton>
            <DialogButton tone="danger" onClick={submit} disabled={busy} busy={busy}>
              {busy ? 'Removing…' : 'Remove'}
            </DialogButton>
          </>
        }
      >
        <p className="fx-sp-dialog-note">
          They stop qualifying for a credential from now on. One already in their
          hands keeps working until it expires, and anything they have written
          stays in their own repository — this ends their access, it doesn’t
          retract their records.
        </p>
        <p className="fx-sp-dialog-note fx-sp-mono">
          {did}
        </p>
      </SpaceDialog>
    </>
  );
}
