'use client';

import { useState } from 'react';
import { ArrowLeft, Check } from 'lucide-react';
import {
  ALL_SCOPE_IDS,
  buildScopeString,
  GRANULAR_SCOPES,
  type ScopeId,
} from '@/lib/oauth/scopes';

interface Props {
  account: string;
  busy?: boolean;
  error?: string | null;
  onBack: () => void;
  onContinue: (scopeString: string) => void | Promise<void>;
}

/**
 * Step 2 of the sign-in flow: granular permission picker.
 *
 * All four write-side actions default to checked; users can opt out of
 * individual ones to grant a narrower scope than `repo:*`. The atproto
 * OAuth consent screen at the user's PDS will then only show / authorize
 * the subset they actually requested.
 */
export default function ScopeSelector({
  account,
  busy,
  error,
  onBack,
  onContinue,
}: Props) {
  const [selected, setSelected] = useState<Set<ScopeId>>(
    new Set(ALL_SCOPE_IDS),
  );

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

      <ul
        style={{
          listStyle: 'none',
          padding: 0,
          margin: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.375rem',
        }}
      >
        {GRANULAR_SCOPES.map((scope) => {
          const checked = selected.has(scope.id);
          return (
            <li key={scope.id}>
              <label style={rowStyle(checked, busy)}>
                <input
                  type="checkbox"
                  className="scope-checkbox"
                  checked={checked}
                  onChange={() => toggle(scope.id)}
                  disabled={busy}
                />
                <span className="scope-checkbox-box" aria-hidden="true">
                  <Check size={12} strokeWidth={3} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: '0.85rem',
                      color: 'var(--text-primary)',
                    }}
                  >
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
        })}
      </ul>

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
        Reading records is always allowed — your repo is public.
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
