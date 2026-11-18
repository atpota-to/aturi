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
      className="oauth-scopes"
    >
      <div className="oauth-scopes-head">
        <button
          type="button"
          onClick={onBack}
          disabled={busy}
          aria-label="Back"
          className="oauth-scopes-back"
        >
          <ArrowLeft size={14} />
        </button>
        <div style={{ minWidth: 0 }}>
          <div className="oauth-scopes-title">Select permissions</div>
          <div className="oauth-scopes-account">for {account}</div>
        </div>
      </div>

      {/* One list, not two with a heading and a paragraph between them. This
          form is the whole popover on a phone, and the group's explainer ran
          to six lines there — pushing Continue off the screen on the step
          whose entire job is to reach Continue. The rows say what they grant,
          and the one warning that paragraph carried (a whole-space read lets
          this app ask any authority, including one a link names, for a
          credential) now lives in that row's own hint. */}
      <ul className="oauth-scopes-list">
        {(spacesServer === true ? [...WRITE_SCOPES, ...SPACE_SCOPES] : WRITE_SCOPES).map(
          (scope) => (
            <ScopeRow
              key={scope.id}
              scope={scope}
              checked={selected.has(scope.id)}
              busy={busy}
              onToggle={toggle}
            />
          ),
        )}
      </ul>

      <button
        type="submit"
        disabled={busy}
        className="settings-btn is-primary oauth-scopes-submit"
        style={busy ? { cursor: 'wait' } : undefined}
      >
        {busy ? 'Redirecting…' : 'Continue →'}
      </button>

      <p className="oauth-scopes-note">
        Reading records is always allowed: your repo is public.
      </p>

      {error && <p className="oauth-scopes-error">{error}</p>}
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
      <label
        className={`oauth-scope-row ${checked ? 'is-checked' : ''}`}
        style={busy ? { cursor: 'wait' } : undefined}
      >
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
          <div className="oauth-scope-label">{scope.label}</div>
          <div className="oauth-scope-hint">{scope.hint}</div>
        </div>
      </label>
    </li>
  );
}
