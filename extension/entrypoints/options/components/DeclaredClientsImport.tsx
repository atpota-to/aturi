import { useState } from 'react';
import { COMPAT_FAMILIES } from '@aturi/waypoints.data';
import type { Prefs } from '../../../lib/prefs';
import {
  applyDeclaredFavorites,
  currentPlatform,
  fetchDeclaration,
  planDeclaredFavorites,
  type DeclaredFavoritePlan,
} from '../../../lib/declaredClients';

type Props = {
  prefs: Prefs;
  onChange: (partial: Partial<Prefs>) => void;
};

type State =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'none'; who: string }
  | { status: 'ready'; who: string; plan: DeclaredFavoritePlan[] }
  | { status: 'applied'; who: string; count: number };

const REASON: Record<NonNullable<DeclaredFavoritePlan['reason']>, string> = {
  'not-in-catalog': 'not in the catalog, so there is no rule to redirect to it',
  'needs-did': 'its links need a DID, which a redirect rule can’t supply',
};

/**
 * "Import from your declared clients": the extension's way into a
 * `to.aturi.client.declaration` record. One fetch, when Import is
 * pressed, then a preview of the favorites it would set and a button to set
 * them. See `lib/declaredClients.ts` for why it is an import and not a sync.
 */
export default function DeclaredClientsImport({ prefs, onChange }: Props) {
  const [identifier, setIdentifier] = useState('');
  const [state, setState] = useState<State>({ status: 'idle' });

  async function lookUp() {
    const input = identifier.trim();
    if (!input) return;
    setState({ status: 'loading' });
    try {
      const found = await fetchDeclaration(input);
      const who = found.handle ? `@${found.handle}` : found.did;
      if (!found.record) {
        setState({ status: 'none', who });
        return;
      }
      const plan = planDeclaredFavorites(found.record, currentPlatform());
      setState(plan.length > 0 ? { status: 'ready', who, plan } : { status: 'none', who });
    } catch (err) {
      setState({
        status: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  function apply(who: string, plan: DeclaredFavoritePlan[]) {
    const next = applyDeclaredFavorites(prefs, plan);
    onChange({
      favoriteByFamily: next.favoriteByFamily,
      waypointGroups: next.waypointGroups,
      knownWaypointIds: next.knownWaypointIds,
    });
    setState({ status: 'applied', who, count: plan.filter(p => p.waypointId).length });
  }

  const usable = state.status === 'ready' ? state.plan.filter(p => p.waypointId) : [];

  return (
    <>
      <div className="options-card-subhead">
        <h3>Import your declared clients</h3>
        <p>
          Published your preferred clients on aturi.to, or in another app that writes
          them? Look them up by handle and use them as your favorites here. The
          extension only fetches them when you press Look up, and keeps nothing but
          the favorites you choose to set.
        </p>
      </div>

      <form
        className="options-row defaults-import-form"
        onSubmit={e => {
          e.preventDefault();
          void lookUp();
        }}
      >
        <input
          id="declared-identifier"
          aria-label="Handle or DID"
          className="aturi-input is-mono"
          value={identifier}
          placeholder="alice.bsky.social or did:plc:…"
          autoComplete="off"
          spellCheck={false}
          onChange={e => setIdentifier(e.target.value)}
        />
        <button
          type="submit"
          className="aturi-btn"
          disabled={!identifier.trim() || state.status === 'loading'}
        >
          {state.status === 'loading' ? 'Looking up…' : 'Look up'}
        </button>
      </form>

      {state.status === 'error' && (
        <div className="options-row defaults-import-error" role="alert">
          Couldn’t read that account’s declaration: {state.message}
        </div>
      )}

      {state.status === 'none' && (
        <div className="options-row aturi-subtle">
          {state.who} hasn’t declared any clients.
        </div>
      )}

      {state.status === 'applied' && (
        <div className="options-row aturi-subtle" role="status">
          Set {state.count} {state.count === 1 ? 'favorite' : 'favorites'} from {state.who}’s
          declaration.
        </div>
      )}

      {state.status === 'ready' && (
        <>
          {state.plan.map(item => (
            <div className="options-row defaults-family-row" key={item.family}>
              <div className="defaults-family-meta">
                <div className="defaults-family-name">
                  {COMPAT_FAMILIES[item.family]?.name ?? item.family}: {item.clientName}
                </div>
                <div className="defaults-family-desc">
                  {item.reason ? `Skipped: ${REASON[item.reason]}.` : 'Will be set as your favorite.'}
                </div>
              </div>
            </div>
          ))}
          <div className="options-row">
            <button
              type="button"
              className="aturi-btn aturi-btn-primary"
              disabled={usable.length === 0}
              onClick={() => apply(state.who, state.plan)}
            >
              Use as my favorites
            </button>
            <span className="aturi-subtle">From {state.who}’s declaration.</span>
          </div>
        </>
      )}
    </>
  );
}
