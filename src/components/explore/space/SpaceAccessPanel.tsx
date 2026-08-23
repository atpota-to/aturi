'use client';

import { useState, type ReactNode } from 'react';
import { KeyRound, Lock, ShieldOff, TriangleAlert } from 'lucide-react';
import ScopeSelector from '@/components/oauth/ScopeSelector';
import type { ScopeId } from '@/lib/oauth/scopes';
import { useSignInFlow } from '@/components/oauth/useSignInFlow';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { classifySpaceError } from '@/utils/atproto/spaceClient';
import SignInPanel from '../SignInPanel';
import type { SpaceAccessState, SpaceRepoAccess } from './useSpaceAccess';

type Props = {
  state: SpaceAccessState;
  /**
   * Completes the sentence "Sign in as a member of this space to read …".
   * Defaults to the space itself.
   */
  what?: string;
  /** Prefill for the sign-in field, when the page already knows whose it is. */
  defaultAccount?: string;
};

/**
 * Every state a permissioned view can be in other than "readable", rendered as
 * a plain sentence plus whatever the visitor can actually do about it.
 *
 * The distinction that matters here is between a *missing permission*, which a
 * new authorization can fix, and a *verdict*, which it cannot. Offering a retry
 * against a verdict wastes the visitor's time and teaches them to distrust the
 * button, so `denied` and `gone` deliberately offer nothing.
 */
export default function SpaceAccessPanel({ state, what, defaultAccount }: Props) {
  const target = what || 'this space';

  switch (state.status) {
    case 'ready':
      return null;

    case 'resolving':
      return <p className="explore-placeholder">Checking your access…</p>;

    case 'acquiring':
      return <p className="explore-placeholder">Requesting a space credential…</p>;

    case 'anonymous':
      return (
        <Panel icon={<Lock size={13} />} eyebrow="Sign in" headline="Permissioned records aren’t public">
          <p style={bodyStyle}>
            {capitalize(target)} lives outside the public repository, so there is
            nothing here to read without an account. Sign in as a member of this
            space to read {target}.
          </p>
          <SignInPanel defaultInput={defaultAccount} />
          <p style={noteStyle}>
            Reading a space needs the permissioned-data permission. The
            permission screen offers it on servers that run the spaces build,
            already ticked.
          </p>
        </Panel>
      );

    case 'no-grant':
      return (
        <Panel
          icon={<KeyRound size={13} />}
          eyebrow="Permission needed"
          headline="Your sign-in didn’t include space access"
        >
          <p style={bodyStyle}>
            Permissioned data is a separate permission, and this session was
            authorized without it, either because it wasn’t ticked or because
            your server doesn’t support spaces yet and dropped it. Authorize
            again to try.
          </p>
          <SpaceReauthorizeButton />
        </Panel>
      );

    case 'locked':
      return (
        <Panel
          icon={<Lock size={13} />}
          eyebrow="Confirm"
          headline="Ask this space for a credential?"
        >
          <p style={bodyStyle}>
            Reading {target} means asking your own server for a token that names
            you and says you are acting for this space, then handing that token
            to the server this space is run from. That server learns your
            account either way, so nothing is sent until you say so.
          </p>
          <dl style={hostListStyle}>
            <div>
              <dt className="explore-small-caps">authority</dt>
              <dd style={hostValueStyle}>
                <code>{state.authority.did}</code>
              </dd>
            </div>
            <div>
              <dt className="explore-small-caps">receives your token</dt>
              <dd style={hostValueStyle}>
                <code>{state.authority.spaceHost}</code>
                {!state.authority.dedicatedHost && (
                  <span className="explore-muted">
                    {' '}
                    (its PDS; this DID publishes no dedicated space host)
                  </span>
                )}
              </dd>
            </div>
          </dl>
          <button type="button" onClick={state.unlock} style={unlockButtonStyle}>
            <KeyRound size={12} /> Unlock this space
          </button>
          <p style={noteStyle}>
            Applies to every space this authority runs, for as long as you stay
            signed in.
          </p>
        </Panel>
      );

    case 'self-only':
      return (
        <Panel
          icon={<KeyRound size={13} />}
          eyebrow="Permission needed"
          headline="Whole-space access not granted"
        >
          <p style={bodyStyle}>
            You granted read access to your own permissioned records, which is
            enough to read your own repository in this space but not anyone
            else’s. Reading {target} needs whole-space access.
          </p>
          <SpaceReauthorizeButton />
        </Panel>
      );

    case 'denied':
      return state.reason === 'app' ? (
        <Panel
          icon={<ShieldOff size={13} />}
          eyebrow="Not permitted"
          headline="This space restricts which applications may read it"
        >
          <p style={bodyStyle}>
            aturi.to is a public OAuth client with no published signing keys, so
            it cannot present the client attestation an allow-list space
            requires. No configuration changes that. It can’t be granted access
            here, by you or by the authority.
          </p>
          <Technical detail={state.message} />
        </Panel>
      ) : (
        <Panel
          icon={<ShieldOff size={13} />}
          eyebrow="Not permitted"
          headline="You don’t have access to this space"
        >
          <p style={bodyStyle}>
            The space authority hasn’t granted your account access. Membership
            is the authority’s decision and there is nothing to retry from here;
            ask whoever runs the space.
          </p>
          <Technical detail={state.message} />
        </Panel>
      );

    case 'missing':
      // Terminal, like `denied` and `gone`: the host answered, and it answered
      // that there is nothing here. The same copy the read-error panel uses.
      return (
        <Panel icon={<TriangleAlert size={13} />} eyebrow="Not found" headline="No such space">
          <p style={bodyStyle}>
            The space host doesn’t know this address. Either the space never
            existed, or its authority is served somewhere other than the host
            its DID document points at.
          </p>
        </Panel>
      );

    case 'gone':
      return (
        <Panel icon={<TriangleAlert size={13} />} eyebrow="Deleted" headline="This space is gone">
          <p style={bodyStyle}>
            Its authority deleted it. Records that were in it are no longer
            readable by anyone, and the address won’t come back.
          </p>
        </Panel>
      );

    case 'error':
      return (
        <Panel
          icon={<TriangleAlert size={13} />}
          eyebrow="Error"
          headline="Couldn’t reach this space"
        >
          <p style={bodyStyle}>
            {state.code
              ? `The space host answered ${state.code}.`
              : 'The space host didn’t answer as expected.'}{' '}
            It might be temporary; try again in a moment.
          </p>
          <Technical detail={state.message} />
        </Panel>
      );
  }
}

/**
 * A failed read of something the visitor *is* allowed to ask for, named in the
 * terms the protocol actually uses.
 *
 * The one that must not be paraphrased is `repo-not-found`. A member who has
 * never written, a member whose repo this credential may not open, and an
 * account that was never in the space all arrive as that single error — by
 * design, so a caller can't probe membership. Rendering it as "this account has
 * no data" would state as fact the one thing the server refused to disclose.
 */
export function SpaceReadErrorPanel({ err, what }: { err: unknown; what: string }) {
  const failure = classifySpaceError(err);
  const detail = err instanceof Error ? err.message : String(err);

  switch (failure.kind) {
    case 'not-authorized':
    case 'space-deleted':
    case 'scope-missing':
      // These are access states, not read failures — hand them to the panel
      // that knows how to explain them and what (if anything) to offer.
      return (
        <SpaceAccessPanel
          state={
            failure.kind === 'space-deleted'
              ? { status: 'gone' }
              : failure.kind === 'scope-missing'
                ? { status: 'no-grant' }
                : { status: 'denied', reason: failure.reason, message: detail }
          }
          what={what}
        />
      );

    case 'space-not-found':
      return (
        <Panel icon={<TriangleAlert size={13} />} eyebrow="Not found" headline="No such space">
          <p style={bodyStyle}>
            The space host doesn’t know this address. Either the space never
            existed, or its authority is served somewhere other than the host
            its DID document points at.
          </p>
          <Technical detail={detail} />
        </Panel>
      );

    case 'repo-not-found':
      return (
        <Panel icon={<Lock size={13} />} eyebrow="Nothing returned" headline={`Couldn’t read ${what}`}>
          <p style={bodyStyle}>
            The host answered <code>RepoNotFound</code>, which it uses for three
            different situations on purpose: this member has never written to
            the space, or their repository isn’t readable with this credential,
            or they aren’t in this space at all. It won’t say which.
          </p>
          <Technical detail={detail} />
        </Panel>
      );

    case 'repo-unavailable':
      return (
        <Panel icon={<TriangleAlert size={13} />} eyebrow="Unavailable" headline={`This repository is ${failure.state}`}>
          <p style={bodyStyle}>
            The host is holding this member’s repository in a state that doesn’t
            serve reads. Nothing is missing; it just isn’t being handed out.
          </p>
          <Technical detail={detail} />
        </Panel>
      );

    case 'record-not-found':
      return (
        <Panel icon={<TriangleAlert size={13} />} eyebrow="Not found" headline="This record doesn’t exist">
          <p style={bodyStyle}>
            There is no record at this key in that member’s permissioned
            repository. It may have been deleted, or the link may be wrong.
          </p>
          <Technical detail={detail} />
        </Panel>
      );

    default:
      return (
        <Panel icon={<TriangleAlert size={13} />} eyebrow="Error" headline={`Couldn’t read ${what}`}>
          <p style={bodyStyle}>
            {failure.kind === 'invalid-credential' || failure.kind === 'credential-stale'
              ? 'The space credential was refused. Reloading the page mints a fresh one.'
              : 'The host returned an error. It might be temporary; try again in a moment.'}
          </p>
          <Technical detail={detail} />
        </Panel>
      );
  }
}

/**
 * Re-run the sign-in flow with one permission row already ticked. Rendered as a
 * button rather than the form itself so a page that is otherwise readable isn't
 * dominated by a permission picker nobody asked for.
 *
 * `preselect` is what the caller is short of: a reader needs the whole-space
 * row, an authority who cannot administer their own space needs the management
 * row. The picker adds it on top of the defaults rather than replacing them, so
 * re-authorizing never silently drops a permission the session already had.
 */
export function SpaceReauthorizeButton({
  preselect = ['spacesAll'],
  label = 'Authorize space access',
}: {
  preselect?: ScopeId[];
  label?: string;
} = {}) {
  const { did } = useAtprotoSession();
  const [open, setOpen] = useState(false);
  const { step, pendingAccount, busy, error, proceedToScopes, backToHandle, submitScopes } =
    useSignInFlow();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          // The account is already known, so skip straight to the picker.
          if (did) proceedToScopes(did);
        }}
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
        <KeyRound size={12} /> {label}
      </button>
    );
  }

  // No session DID to seed with (signed out underneath us) — fall back to the
  // ordinary handle-first form.
  if (step !== 'scopes') {
    return <SignInPanel defaultInput={did || ''} />;
  }

  return (
    <div
      style={{
        padding: '0.75rem',
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-medium)',
        maxWidth: '24rem',
      }}
    >
      <ScopeSelector
        account={pendingAccount}
        busy={busy}
        error={error}
        preselect={preselect}
        onBack={() => {
          backToHandle();
          setOpen(false);
        }}
        onContinue={submitScopes}
      />
    </div>
  );
}

/**
 * The access story for one member's repository, which has one more step than
 * the space's own: holding a whole-space credential doesn't mean this
 * particular DID belongs to the space, and a DID out of the address bar decides
 * which server the credential would be presented to. See `useSpaceRepoAccess`.
 */
export function SpaceRepoAccessPanel({
  access,
  repo,
  what,
  defaultAccount,
}: {
  access: SpaceAccessState;
  repo: SpaceRepoAccess;
  what: string;
  defaultAccount?: string;
}) {
  switch (repo.status) {
    case 'ready':
      return null;

    case 'checking':
      return <p className="explore-placeholder">Checking this member against the space…</p>;

    case 'unlisted':
      return (
        <Panel
          icon={<ShieldOff size={13} />}
          eyebrow="Not in this space"
          headline="The space doesn’t list this account"
        >
          <p style={bodyStyle}>
            The space host’s own record of who has written here doesn’t include
            this DID, so there is nothing of theirs to read. Their server is not
            one this space vouched for either, so no credential is sent to it. If
            they are a member who has simply never written, this is what that
            looks like from outside.
          </p>
        </Panel>
      );

    case 'error':
      return <SpaceReadErrorPanel err={repo.error} what="the members of this space" />;

    case 'none':
      return <SpaceAccessPanel state={access} what={what} defaultAccount={defaultAccount} />;
  }
}

const hostListStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.5rem',
  margin: 0,
  padding: '0.75rem',
  border: '1px solid var(--border-subtle)',
  background: 'var(--bg-tertiary)',
};

const hostValueStyle: React.CSSProperties = {
  margin: 0,
  fontFamily: 'var(--font-mono)',
  fontSize: '0.8rem',
  wordBreak: 'break-all',
  color: 'var(--text-primary)',
};

const unlockButtonStyle: React.CSSProperties = {
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
};

const bodyStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.9rem',
  lineHeight: 1.6,
  color: 'var(--text-secondary)',
  maxWidth: '42rem',
};

const noteStyle: React.CSSProperties = {
  margin: 0,
  fontSize: '0.8rem',
  lineHeight: 1.5,
  color: 'var(--text-tertiary)',
  maxWidth: '42rem',
};

function Panel({
  icon,
  eyebrow,
  headline,
  children,
}: {
  icon: ReactNode;
  eyebrow: string;
  headline: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-secondary)',
        padding: '1.5rem 1.25rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '0.6rem',
      }}
    >
      <div
        className="explore-small-caps"
        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
      >
        <span style={{ color: 'var(--text-accent)', display: 'inline-flex' }}>{icon}</span>
        {eyebrow}
      </div>
      <h2
        style={{
          margin: 0,
          fontFamily: 'var(--font-serif)',
          fontWeight: 400,
          fontSize: '1.25rem',
          color: 'var(--text-primary)',
        }}
      >
        {headline}
      </h2>
      {children}
    </div>
  );
}

function Technical({ detail }: { detail: string }) {
  return (
    <details className="explore-section" style={{ marginTop: '0.35rem' }}>
      <summary>Technical details</summary>
      <p className="explore-error" style={{ marginTop: '0.5rem' }}>
        {detail}
      </p>
    </details>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}
