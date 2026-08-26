'use client';

import { useCallback, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Settings2, Trash2 } from 'lucide-react';
import {
  createSimpleSpace,
  deleteSimpleSpace,
  updateSimpleSpace,
  type SimpleSpaceConfig,
  type SpaceTransport,
} from '@/utils/atproto/spaceClient';
import SpaceConfigFields from './SpaceConfigFields';
import SpaceDialog, { DialogButton, dialogNoteStyle } from './SpaceDialog';
import {
  appAccessDraftEquals,
  appAccessDraftFromConfig,
  appAccessDraftToInput,
  DEFAULT_APP_ACCESS_DRAFT,
  DEFAULT_POLICY_DRAFT,
  describeSpaceManageError,
  policyDraftEquals,
  policyDraftFromConfig,
  policyDraftToInput,
  type AppAccessDraft,
  type PolicyDraft,
} from '@/utils/atproto/simpleSpaceConfig';

/**
 * The three things a space's authority can do to the space itself: change its
 * rules, adopt an address that has data but no configuration, and delete it.
 *
 * Every one of these is rendered by <ConfigSection>, which already knows
 * whether the visitor is the authority and holds the OAuth transport these
 * methods require. Nothing here re-derives either: a component that decided for
 * itself whether to show a delete button would be a second answer to a question
 * the page has already answered once.
 */

/** Reconfigure an existing space. */
export function ManageSpaceButton({
  space,
  transport,
  config,
  onUpdated,
}: {
  space: string;
  transport: SpaceTransport;
  config: SimpleSpaceConfig;
  onUpdated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [policy, setPolicy] = useState<PolicyDraft>(() => policyDraftFromConfig(config.policy));
  const [appAccess, setAppAccess] = useState<AppAccessDraft>(() =>
    appAccessDraftFromConfig(config.appAccess),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seeded from the config every time the form is opened rather than once at
  // mount: an update that succeeded, or another session's, has to be what the
  // next open starts from — otherwise a stale draft would be submitted back
  // over it wholesale.
  function openForm() {
    setPolicy(policyDraftFromConfig(config.policy));
    setAppAccess(appAccessDraftFromConfig(config.appAccess));
    setError(null);
    setOpen(true);
  }

  const close = useCallback(() => {
    setOpen(false);
    setError(null);
  }, []);

  const currentPolicy = policyDraftFromConfig(config.policy);
  const currentAppAccess = appAccessDraftFromConfig(config.appAccess);
  const policyChanged = !policyDraftEquals(policy, currentPolicy);
  const appAccessChanged = !appAccessDraftEquals(appAccess, currentAppAccess);
  const policyInput = policyChanged ? policyDraftToInput(policy) : null;
  const appAccessInput = appAccessChanged ? appAccessDraftToInput(appAccess) : null;

  // A changed rule that won't convert is an incomplete one — a managing app
  // with no DID, an allow list with no entries — so it blocks the save rather
  // than being dropped from it.
  const incomplete =
    (policyChanged && policyInput === null) || (appAccessChanged && appAccessInput === null);
  const submittable = (policyChanged || appAccessChanged) && !incomplete;

  async function submit() {
    if (!submittable) return;
    setBusy(true);
    setError(null);
    try {
      await updateSimpleSpace(transport, {
        space,
        // Only what changed. `updateSpace` replaces a supplied rule wholesale,
        // so sending both would rewrite an untouched one — which for an
        // unrecognised rule means replacing it with a guess.
        ...(policyInput ? { policy: policyInput } : {}),
        ...(appAccessInput ? { appAccess: appAccessInput } : {}),
      });
      setOpen(false);
      setBusy(false);
      onUpdated();
    } catch (err) {
      setError(describeSpaceManageError(err));
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={openForm} style={quietButtonStyle}>
        <Settings2 size={12} /> Manage
      </button>

      <SpaceDialog
        open={open}
        onClose={close}
        busy={busy}
        title="Manage space"
        description="Both rules are consulted when your server is asked for a credential. Changing them governs future requests; a credential already issued stays valid until it expires."
        error={error}
        footer={
          <>
            <DialogButton tone="quiet" onClick={close} disabled={busy}>
              Cancel
            </DialogButton>
            <DialogButton onClick={submit} disabled={!submittable || busy} busy={busy}>
              {busy ? 'Saving…' : 'Save'}
            </DialogButton>
          </>
        }
      >
        <SpaceConfigFields
          policy={policy}
          onPolicyChange={setPolicy}
          appAccess={appAccess}
          onAppAccessChange={setAppAccess}
          disabled={busy}
        />
      </SpaceDialog>
    </>
  );
}

/**
 * Create the configuration for a space address that already has data.
 *
 * Writing to `at://you/space/<type>/<key>` materializes a permissioned repo
 * without creating a simplespace to govern it — there is no configuration until
 * someone asks for one, and no default to guess at. Until then `getSpace`
 * answers `SpaceNotFound` and the space cannot be administered at all, which is
 * indistinguishable from a broken page unless it is offered as the thing it is.
 */
export function AdoptSpaceButton({
  spaceType,
  skey,
  transport,
  onCreated,
}: {
  spaceType: string;
  skey: string;
  transport: SpaceTransport;
  onCreated: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [policy, setPolicy] = useState<PolicyDraft>(DEFAULT_POLICY_DRAFT);
  const [appAccess, setAppAccess] = useState<AppAccessDraft>(DEFAULT_APP_ACCESS_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setError(null);
  }, []);

  const policyInput = policyDraftToInput(policy);
  const appAccessInput = appAccessDraftToInput(appAccess);
  const submittable = policyInput !== null && appAccessInput !== null;

  async function submit() {
    if (!policyInput || !appAccessInput) return;
    setBusy(true);
    setError(null);
    try {
      await createSimpleSpace(transport, {
        type: spaceType,
        skey,
        policy: policyInput,
        appAccess: appAccessInput,
      });
      setOpen(false);
      setBusy(false);
      onCreated();
    } catch (err) {
      setError(describeSpaceManageError(err));
      setBusy(false);
    }
  }

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} style={quietButtonStyle}>
        <Settings2 size={12} /> Configure this space
      </button>

      <SpaceDialog
        open={open}
        onClose={close}
        busy={busy}
        title="Configure this space"
        description="This address holds data but has no simplespace configuration, so there are no rules to enforce and no member list to keep. Giving it one leaves what has already been written where it is."
        error={error}
        footer={
          <>
            <DialogButton tone="quiet" onClick={close} disabled={busy}>
              Cancel
            </DialogButton>
            <DialogButton onClick={submit} disabled={!submittable || busy} busy={busy}>
              {busy ? 'Configuring…' : 'Configure'}
            </DialogButton>
          </>
        }
      >
        <SpaceConfigFields
          policy={policy}
          onPolicyChange={setPolicy}
          appAccess={appAccess}
          onAppAccessChange={setAppAccess}
          disabled={busy}
        />
      </SpaceDialog>
    </>
  );
}

/**
 * Delete the space, behind a confirmation that says what that costs.
 *
 * The asymmetry is the part worth confirming and is stated in the dialog: the
 * authority's own repo in the space goes with it, because here the space host
 * and that repo's host are the same service, while every other member's repo
 * lives on their own PDS and is flagged rather than erased. So this ends the
 * space and loses your half of it, and leaves everyone else's writing on their
 * own servers.
 */
export function DeleteSpaceButton({
  space,
  transport,
  /** Where to send the visitor once the space no longer exists. */
  returnPath,
}: {
  space: string;
  transport: SpaceTransport;
  returnPath: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setError(null);
  }, []);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await deleteSimpleSpace(transport, { space });
      setOpen(false);
      // Not `setBusy(false)`: this page is about to be replaced, and the space
      // it was reading no longer exists. Leaving the dialog idle-but-open for
      // a frame would offer a second delete of nothing.
      router.push(returnPath);
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
          ...quietButtonStyle,
          background: 'var(--danger-soft)',
          color: 'var(--danger)',
          borderColor: 'var(--danger-border)',
        }}
      >
        <Trash2 size={12} /> Delete
      </button>

      <SpaceDialog
        open={open}
        onClose={close}
        busy={busy}
        title="Delete this space?"
        error={error}
        footer={
          <>
            <DialogButton tone="quiet" onClick={close} disabled={busy}>
              Cancel
            </DialogButton>
            <DialogButton tone="danger" onClick={submit} disabled={busy} busy={busy}>
              {busy ? 'Deleting…' : 'Delete space'}
            </DialogButton>
          </>
        }
      >
        <p style={dialogNoteStyle}>
          Every read and write against{' '}
          <code style={{ background: 'transparent', padding: 0, overflowWrap: 'anywhere' }}>
            {space}
          </code>{' '}
          fails afterwards, and the address cannot be brought back by re-creating
          it.
        </p>
        <p style={dialogNoteStyle}>
          Your own records in the space are deleted with it, because your server
          is both the space’s host and yours. Other members’ records stay on
          their own servers, marked as belonging to a deleted space.
        </p>
      </SpaceDialog>
    </>
  );
}

const quietButtonStyle: React.CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: '0.4rem',
  padding: '0.3rem 0.6rem',
  background: 'var(--bg-tertiary)',
  color: 'var(--text-secondary)',
  border: '1px solid var(--border-subtle)',
  fontFamily: 'var(--font-serif)',
  fontSize: '0.8rem',
  cursor: 'pointer',
};
