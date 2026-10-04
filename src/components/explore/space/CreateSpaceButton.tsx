'use client';

import { useCallback, useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Plus } from 'lucide-react';
import { isValidNsid, isValidRecordKey, parseSpaceAtUri } from '@/utils/atproto/spaceUri';
import { encodeRepo, spaceExplorePath } from '@/utils/atproto/urls';
import { createSimpleSpace, type SpaceTransport } from '@/utils/atproto/spaceClient';
import SpaceConfigFields from './SpaceConfigFields';
import SpaceDialog, { DialogButton, DialogField, dialogNoteStyle } from './SpaceDialog';
import {
  appAccessDraftToInput,
  DEFAULT_APP_ACCESS_DRAFT,
  DEFAULT_POLICY_DRAFT,
  describeSpaceManageError,
  policyDraftToInput,
  type AppAccessDraft,
  type PolicyDraft,
} from '@/utils/atproto/simpleSpaceConfig';

/**
 * "New space", and the form behind it.
 *
 * Rendered only for the account whose page this is, and only when its grant
 * carries the `create` manage op — the two are separate conditions and both are
 * the caller's to check. There is no `did` parameter on `createSpace`: a space
 * is always anchored on the caller's own DID, so a button offered on somebody
 * else's page could only ever make a space somewhere other than where it was
 * clicked.
 *
 * On success the new space's page is where you land. `createSpace` is the one
 * administrative method that answers with a body, because when the key was left
 * blank it is the only thing that knows what the space is called.
 */
export default function CreateSpaceButton({
  transport,
  /**
   * The authority as the visitor is browsing it — a handle where there is one,
   * a DID otherwise. Raw rather than pre-encoded: the path builders own the
   * encoding, and handing them an already-encoded segment would make the two
   * call sites below disagree about whose job it is.
   */
  authority,
}: {
  transport: SpaceTransport;
  authority: string;
}) {
  const router = useRouter();
  const typeId = useId();
  const typeHintId = useId();
  const skeyId = useId();
  const skeyHintId = useId();

  const [open, setOpen] = useState(false);
  const [type, setType] = useState('');
  const [skey, setSkey] = useState('');
  const [policy, setPolicy] = useState<PolicyDraft>(DEFAULT_POLICY_DRAFT);
  const [appAccess, setAppAccess] = useState<AppAccessDraft>(DEFAULT_APP_ACCESS_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmedType = type.trim();
  const trimmedSkey = skey.trim();
  const typeValid = isValidNsid(trimmedType);
  const skeyValid = trimmedSkey === '' || isValidRecordKey(trimmedSkey);
  const policyInput = policyDraftToInput(policy);
  const appAccessInput = appAccessDraftToInput(appAccess);
  const submittable = typeValid && skeyValid && policyInput !== null && appAccessInput !== null;

  const close = useCallback(() => {
    setOpen(false);
    setError(null);
  }, []);

  async function submit() {
    if (!submittable || !policyInput || !appAccessInput) return;
    setBusy(true);
    setError(null);
    try {
      const { uri } = await createSimpleSpace(transport, {
        type: trimmedType,
        skey: trimmedSkey || undefined,
        policy: policyInput,
        appAccess: appAccessInput,
      });
      // The authority in the returned URI is always a DID; the page is reached
      // through whichever identifier the visitor is already browsing under, so a
      // handle stays a handle rather than the address bar switching to a DID
      // mid-session.
      const parts = parseSpaceAtUri(uri);
      setOpen(false);
      router.push(
        parts
          ? spaceExplorePath({ ...parts, authority })
          : `/explore/${encodeRepo(authority)}/space`,
      );
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
        style={{
          alignSelf: 'flex-start',
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.4rem',
          padding: '0.4rem 0.75rem',
          background: 'var(--accent-moss)',
          color: 'var(--text-on-accent)',
          border: '1px solid var(--accent-moss)',
          fontFamily: 'var(--font-serif)',
          fontSize: '0.8125rem',
          cursor: 'pointer',
        }}
      >
        <Plus size={12} /> New space
      </button>

      <SpaceDialog
        open={open}
        onClose={close}
        busy={busy}
        title="Create a space"
        description="A space is anchored on your account, which becomes its authority. Nothing in it is public, and nothing is announced to the network."
        error={error}
        footer={
          <>
            <DialogButton tone="quiet" onClick={close} disabled={busy}>
              Cancel
            </DialogButton>
            <DialogButton onClick={submit} disabled={!submittable || busy} busy={busy}>
              {busy ? 'Creating…' : 'Create'}
            </DialogButton>
          </>
        }
      >
        <DialogField
          label="Space type"
          htmlFor={typeId}
          hintId={typeHintId}
          hint={
            trimmedType && !typeValid
              ? 'That is not an NSID. A space type is a lexicon name in reverse-domain form, like app.example.group.'
              : 'The NSID describing what kind of space this is. Its lexicon declares the collections apps should expect to find here.'
          }
        >
          <input
            id={typeId}
            className="explore-input"
            aria-describedby={typeHintId}
            aria-invalid={Boolean(trimmedType) && !typeValid ? true : undefined}
            disabled={busy}
            placeholder="app.example.group"
            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}
            value={type}
            onChange={(e) => setType(e.target.value)}
          />
        </DialogField>

        <DialogField
          label="Space key (optional)"
          htmlFor={skeyId}
          hintId={skeyHintId}
          hint={
            !skeyValid
              ? 'That is not a record key. Letters, digits and . _ : ~ - only, up to 512 characters.'
              : 'Distinguishes spaces of the same type under your account. Left blank, your server generates a TID.'
          }
        >
          <input
            id={skeyId}
            className="explore-input"
            aria-describedby={skeyHintId}
            aria-invalid={!skeyValid ? true : undefined}
            disabled={busy}
            placeholder="Generated TID"
            style={{ fontFamily: 'var(--font-mono)', fontSize: '0.8125rem' }}
            value={skey}
            onChange={(e) => setSkey(e.target.value)}
          />
        </DialogField>

        <SpaceConfigFields
          policy={policy}
          onPolicyChange={setPolicy}
          appAccess={appAccess}
          onAppAccessChange={setAppAccess}
          disabled={busy}
        />

        <p style={dialogNoteStyle}>
          Both rules can be changed afterwards from the space’s own page.
        </p>
      </SpaceDialog>
    </>
  );
}
