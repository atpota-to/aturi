'use client';

import { useEffect, useState } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import {
  buildScopeString,
  DEFAULT_SCOPE_IDS,
  GRANULAR_SCOPES,
  SPACE_SCOPE_IDS,
  type GranularScope,
  type ScopeId,
} from '@/lib/oauth/scopes';
import { resolveIdentifier } from '@/utils/atproto/identity';
import { pdsSupportsSpaces } from '@/utils/atproto/spaceIdentity';

interface Props {
  account: string;
  busy?: boolean;
  error?: string | null;
  /**
   * Rows to tick on top of the defaults. Lets a surface that already knows
   * what the user is about to do — the space explorer's "your sign-in didn't
   * include space access" prompt, say — send them into the picker with the
   * relevant row already on instead of asking them to find it.
   */
  preselect?: ScopeId[];
  onBack: () => void;
  onContinue: (scopeString: string) => void | Promise<void>;
}

const WRITE_SCOPES = GRANULAR_SCOPES.filter((s) => !SPACE_SCOPE_IDS.has(s.id));
const SPACE_SCOPES = GRANULAR_SCOPES.filter((s) => SPACE_SCOPE_IDS.has(s.id));

/**
 * Step 2 of the sign-in flow: granular permission picker.
 *
 * The write-side actions default to checked; users can opt out of individual
 * ones to grant a narrower scope than `repo:*`. The atproto OAuth consent
 * screen at the user's PDS will then only show / authorize the subset they
 * actually requested.
 *
 * The permissioned-data rows are the exception: they start unticked, so the
 * scope string this form submits with nothing touched is byte-identical to
 * the one it submitted before spaces existed. See the block comment above
 * SPACE_READ_SELF_SCOPE in `@/lib/oauth/scopes` for why that matters.
 *
 * That default is a hedge against not knowing whether the account's server
 * understands `space:` at all. `_health` answers that before any of this
 * reaches an authorization server, so the group is shown at all only for
 * accounts whose PDS reports the spaces build — and on those it arrives
 * ticked, because an account on the alpha host is there for exactly this.
 *
 * Accounts on every other server never see the rows. There is nothing behind
 * them on a server that can't serve spaces, and a permission you can grant but
 * not use is worse than one that isn't offered: it asks people to reason about
 * a capability that would do nothing. It also means the scope string those
 * accounts submit stays byte-identical to the pre-spaces one, which is the
 * property the group's default was protecting in the first place.
 *
 * This is deliberately the narrow rollout. When more servers run the build,
 * the check keeps working and the group simply appears for more people.
 */
export default function ScopeSelector({
  account,
  busy,
  error,
  preselect,
  onBack,
  onContinue,
}: Props) {
  // Seeded once: the picker is a form, so later prop changes shouldn't reach
  // in and re-tick boxes underneath someone who is mid-decision.
  const [selected, setSelected] = useState<Set<ScopeId>>(() => {
    const initial = new Set<ScopeId>(DEFAULT_SCOPE_IDS);
    for (const id of preselect ?? []) initial.add(id);
    return initial;
  });

  // Whether this account's PDS runs the spaces build. `null` while unknown —
  // the check is one public request and the form stays usable throughout.
  //
  // The tick happens here rather than in a second effect watching the result,
  // so it lands inside the async callback: it runs exactly once per account,
  // and only ever adds. A visitor who unticks the row afterwards keeps it
  // unticked, because nothing re-runs to put it back.
  const [spacesServer, setSpacesServer] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    if (!account) return undefined;
    (async () => {
      try {
        const identity = await resolveIdentifier(account);
        const supported = await pdsSupportsSpaces(identity.pds);
        if (cancelled) return;
        setSpacesServer(supported);
        if (!supported) return;
        setSelected((prev) => {
          const next = new Set(prev);
          for (const id of SPACE_SCOPE_IDS) next.add(id);
          return next;
        });
      } catch {
        if (!cancelled) setSpacesServer(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [account]);

  function toggle(id: ScopeId) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void onContinue(buildScopeString(selected));
      }}
      style={{ display: 'flex', flexDirection: 'column', gap: '0.625rem' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          aria-label="Back"
          style={backButtonStyle()}
        >
          <ArrowLeft size={14} />
        </button>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontSize: '0.875rem', color: 'var(--text-primary)' }}>
            Select permissions
          </div>
          <div
            style={{
              fontSize: '0.75rem',
              color: 'var(--text-tertiary)',
              fontFamily: 'var(--font-mono)',
              wordBreak: 'break-all',
            }}
          >
            for {account}
          </div>
        </div>
      </div>

      <ul style={listStyle()}>
        {WRITE_SCOPES.map((scope) => (
          <ScopeRow
            key={scope.id}
            scope={scope}
            checked={selected.has(scope.id)}
            busy={busy}
            onToggle={toggle}
          />
        ))}
      </ul>

      {spacesServer === true && (
      <div
        style={{ display: 'flex', flexDirection: 'column', gap: '0.375rem' }}
      >
        <div className="explore-small-caps">Permissioned data (Spaces)</div>
        <p
          style={{
            margin: 0,
            fontSize: '0.7rem',
            color: 'var(--text-tertiary)',
            lineHeight: 1.4,
          }}
        >
          Records kept outside your public repo. Your server runs the spaces
          build, so these are on. Reading a whole space lets this app ask any
          space authority (including one named by a link you open) for a
          credential on your behalf; untick it if you only want your own
          records. Editing only ever reaches your own records: a space write
          is attributed to its author, so this grant cannot touch anyone
          else&rsquo;s.
        </p>
        <ul style={listStyle()}>
          {SPACE_SCOPES.map((scope) => (
            <ScopeRow
              key={scope.id}
              scope={scope}
              checked={selected.has(scope.id)}
              busy={busy}
              onToggle={toggle}
            />
          ))}
        </ul>
      </div>
      )}

      <button
        type="submit"
        disabled={busy}
        style={{
          padding: '0.55rem 1rem',
          background: 'var(--accent-moss)',
          color: 'var(--text-on-accent)',
          border: '1px solid var(--accent-moss)',
          fontFamily: 'var(--font-serif)',
          fontSize: '0.875rem',
          cursor: busy ? 'wait' : 'pointer',
          opacity: busy ? 0.6 : 1,
        }}
      >
        {busy ? 'Redirecting…' : 'Continue →'}
      </button>

      <p
        style={{
          margin: 0,
          fontSize: '0.7rem',
          color: 'var(--text-tertiary)',
          lineHeight: 1.4,
        }}
      >
        Reading records is always allowed: your repo is public.
      </p>

      {error && (
        <p
          style={{
            margin: 0,
            color: 'var(--danger)',
            fontSize: '0.75rem',
          }}
        >
          {error}
        </p>
      )}
    </form>
  );
}

function ScopeRow({
  scope,
  checked,
  busy,
  onToggle,
}: {
  scope: GranularScope;
  checked: boolean;
  busy?: boolean;
  onToggle: (id: ScopeId) => void;
}) {
  return (
    <li>
      <label style={rowStyle(checked, busy)}>
        <input
          type="checkbox"
          className="scope-checkbox"
          checked={checked}
          onChange={() => onToggle(scope.id)}
          disabled={busy}
        />
        <span className="scope-checkbox-box" aria-hidden="true">
          <Check size={12} strokeWidth={3} />
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-primary)' }}>
            {scope.label}
          </div>
          <div
            style={{
              fontSize: '0.7rem',
              color: 'var(--text-tertiary)',
              lineHeight: 1.4,
            }}
          >
            {scope.hint}
          </div>
        </div>
      </label>
    </li>
  );
}

function listStyle(): React.CSSProperties {
  return {
    listStyle: 'none',
    padding: 0,
    margin: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.375rem',
  };
}

function backButtonStyle(): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: 24,
    background: 'var(--bg-tertiary)',
    border: '1px solid var(--border-subtle)',
    color: 'var(--text-secondary)',
    cursor: 'pointer',
    flexShrink: 0,
  };
}

function rowStyle(checked: boolean, busy?: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    padding: '0.625rem 0.75rem',
    background: checked ? 'var(--bg-tertiary)' : 'transparent',
    border: '1px solid',
    borderColor: checked ? 'var(--border-medium)' : 'var(--border-subtle)',
    cursor: busy ? 'wait' : 'pointer',
  };
}
