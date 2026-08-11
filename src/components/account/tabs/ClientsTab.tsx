'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowUp, ExternalLink, Globe, Plus, Trash2, X } from 'lucide-react';
import { usePreferences } from '@/components/PreferencesProvider';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import Toggle from '../Toggle';
import { usePreferredClientsPublisher } from '../usePreferredClientsPublisher';
import {
  removePreferredClients,
  setPreferredClients,
  SUGGESTED_CLIENT_SCOPES,
  type Preferences,
} from '@/utils/preferences';
import {
  buildPreferredClientsRecord,
  clientFromWaypointId,
  describeScope,
  isValidPreferredScope,
  PREFERRED_CLIENT_KINDS,
  PREFERRED_CLIENTS_NSID,
  PREFERRED_CLIENTS_RKEY,
  PREFERRED_SCOPE_ALL,
  recordKindForScope,
  type PreferredClient,
  type PreferredClientRule,
} from '@/utils/preferredClients';
import {
  getRecommendedWaypoints,
  getWaypointsForType,
  WAYPOINT_DESTINATIONS,
} from '@/utils/waypoints';
import { setupEntryHash } from '@/utils/onboardingQuestions';

/**
 * Clients tab — where a user declares which Atmosphere client they want their
 * records opened in, and publishes that declaration for other apps to read.
 *
 * The rules live in the synced preferences like everything else on this
 * screen; what's different is the optional public mirror
 * (`to.aturi.actor.preferredClients`), which is the whole point of the
 * feature: it's the bit other people's software can act on.
 */
export default function ClientsTab() {
  return (
    <>
      <RulesCard />
      <PublishCard />
      <DevelopersCard />
    </>
  );
}

// --- Rules -----------------------------------------------------------------

/**
 * The client a new rule starts on. A rule with no clients wouldn't survive a
 * round-trip through the record, so every new one needs a seed — and the
 * catalog already has an opinion about which client suits a given lexicon, so
 * use that instead of "whatever is first alphabetically".
 *
 * Wildcard scopes are passed through as the collection because the namespace
 * matcher walks dotted segments, so `sh.tangled.*` resolves via the
 * `sh.tangled` prefix to Tangled.
 */
function seedClientFor(scope: string): PreferredClient | null {
  const kind = recordKindForScope(scope);
  const isGeneric =
    scope === PREFERRED_SCOPE_ALL ||
    (PREFERRED_CLIENT_KINDS as readonly string[]).includes(scope);
  const recommended = getRecommendedWaypoints(kind, isGeneric ? undefined : scope);
  const first = recommended?.waypoints?.[0] ?? getWaypointsForType(kind)[0];
  return first ? clientFromWaypointId(first.id) : null;
}

function RulesCard() {
  const { prefs, update } = usePreferences();
  const rules = prefs.preferredClients;
  // Deep-link to whichever question is still unanswered rather than the
  // introduction, which someone already on this screen has no use for.
  const setupEntry = setupEntryHash(prefs);

  const usedScopes = useMemo(() => new Set(rules.map((r) => r.scope)), [rules]);

  function setClients(scope: string, clients: PreferredClient[]) {
    update((p) => setPreferredClients(p, scope, clients));
  }

  function removeRule(scope: string) {
    update((p) => removePreferredClients(p, scope));
  }

  return (
    <section className="settings-card">
      <div className="settings-card-head">
        <h2 className="settings-card-title">Preferred clients</h2>
        <p className="settings-card-sub">
          Say where you want records opened. The ecosystem default sends every
          Bluesky link to bsky.app whether or not that&rsquo;s the app you use;
          a rule here is your answer instead of that guess. Aturi&rsquo;s own
          picker follows these immediately, and publishing them (below) lets any
          other Atmosphere app do the same.
        </p>
        {/* Always available, not only while the list is empty: the guided
            version is the easier way to revisit these answers even for
            someone who already has rules. */}
        <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
          Prefer to be asked?{' '}
          <Link href={`/welcome#${setupEntry}`}>Walk through the questions</Link>{' '}
          and Aturi writes the common rules for you.
        </p>
      </div>

      {rules.length === 0 ? (
        <p
          style={{
            margin: 0,
            color: 'var(--text-tertiary)',
            fontSize: '0.85rem',
            fontStyle: 'italic',
          }}
        >
          No rules yet.
        </p>
      ) : (
        <ul
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem',
          }}
        >
          {rules.map((rule) => (
            <RuleRow
              key={rule.scope}
              rule={rule}
              customWaypoints={prefs.customWaypoints}
              onChange={(clients) => setClients(rule.scope, clients)}
              onRemove={() => removeRule(rule.scope)}
            />
          ))}
        </ul>
      )}

      <AddRule
        usedScopes={usedScopes}
        onAdd={(scope) => {
          const seed = seedClientFor(scope);
          setClients(scope, seed ? [seed] : []);
        }}
      />
    </section>
  );
}

function RuleRow({
  rule,
  customWaypoints,
  onChange,
  onRemove,
}: {
  rule: PreferredClientRule;
  customWaypoints: Preferences['customWaypoints'];
  onChange: (clients: PreferredClient[]) => void;
  onRemove: () => void;
}) {
  const kind = recordKindForScope(rule.scope);
  const catalog = useMemo(() => getWaypointsForType(kind), [kind]);
  const customs = useMemo(
    () => customWaypoints.filter((c) => c.supportedTypes.includes(kind)),
    [customWaypoints, kind],
  );

  /**
   * Select values are namespaced because the two sources can't collide
   * meaningfully otherwise: `w:<waypointId>` for the shared catalog,
   * `c:<customId>` for one of the user's own.
   */
  function valueFor(client: PreferredClient): string {
    if (client.id) return `w:${client.id}`;
    const match = customs.find((c) => c.name === client.name);
    return match ? `c:${match.id}` : '';
  }

  function clientFromValue(value: string): PreferredClient | null {
    if (value.startsWith('w:')) return clientFromWaypointId(value.slice(2));
    const custom = customWaypoints.find((c) => c.id === value.slice(2));
    if (!custom) return null;
    // Custom waypoints carry their own URL templates. Embedding them means an
    // app that has never heard of this client can still build the link — which
    // is the difference between declaring a self-hosted client and declaring
    // one everybody already knows.
    return {
      name: custom.name,
      templates: { ...custom.templates },
      ...(custom.domain ? { homepage: `https://${custom.domain}` } : {}),
    };
  }

  function replaceAt(index: number, value: string) {
    const client = clientFromValue(value);
    if (!client) return;
    onChange(rule.clients.map((c, i) => (i === index ? client : c)));
  }

  function move(index: number, delta: number) {
    const next = [...rule.clients];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  function addFallback() {
    const taken = new Set(rule.clients.map(valueFor));
    const candidate = catalog.find((w) => !taken.has(`w:${w.id}`));
    const client = candidate ? clientFromWaypointId(candidate.id) : null;
    if (client) onChange([...rule.clients, client]);
  }

  return (
    <li
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '0.5rem',
        padding: '0.75rem 0.875rem',
        background: 'var(--bg-tertiary)',
        border: '1px solid var(--border-subtle)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.625rem' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div
            style={{
              fontFamily: 'var(--font-serif)',
              fontSize: '0.95rem',
              color: 'var(--text-primary)',
            }}
          >
            {describeScope(rule.scope)}
          </div>
          <div
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.72rem',
              color: 'var(--text-tertiary)',
            }}
          >
            {rule.scope}
          </div>
        </div>
        <button
          type="button"
          onClick={onRemove}
          title="Remove this rule"
          aria-label={`Remove the rule for ${describeScope(rule.scope)}`}
          style={iconBtn({ danger: true })}
        >
          <Trash2 size={13} />
        </button>
      </div>

      {rule.clients.map((client, index) => {
        const icon = client.id ? WAYPOINT_DESTINATIONS[client.id]?.icon : null;
        return (
          <div
            key={`${client.id ?? client.name}-${index}`}
            style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}
          >
            <span
              aria-hidden
              style={{
                display: 'inline-flex',
                width: 20,
                justifyContent: 'center',
                flexShrink: 0,
              }}
            >
              {icon ?? <Globe size={16} style={{ color: 'var(--text-accent)' }} />}
            </span>
            <select
              className="explore-input"
              value={valueFor(client)}
              onChange={(e) => replaceAt(index, e.target.value)}
              aria-label={index === 0 ? 'Preferred client' : `Fallback ${index}`}
              style={{ flex: 1, minWidth: 0 }}
            >
              {/* An unrecognised entry (hand-edited record, deleted custom
                  waypoint) still needs a visible option or the select would
                  silently show the wrong client. */}
              {valueFor(client) === '' && <option value="">{client.name}</option>}
              <optgroup label="Atmosphere clients">
                {catalog.map((w) => (
                  <option key={w.id} value={`w:${w.id}`}>
                    {w.name}
                  </option>
                ))}
              </optgroup>
              {customs.length > 0 && (
                <optgroup label="My waypoints">
                  {customs.map((c) => (
                    <option key={c.id} value={`c:${c.id}`}>
                      {c.name}
                    </option>
                  ))}
                </optgroup>
              )}
            </select>
            <span
              className="explore-small-caps"
              style={{
                fontSize: '0.65rem',
                color: 'var(--text-tertiary)',
                whiteSpace: 'nowrap',
              }}
            >
              {index === 0 ? 'first choice' : `fallback ${index}`}
            </span>
            <button
              type="button"
              onClick={() => move(index, -1)}
              disabled={index === 0}
              title="Move up"
              aria-label={`Move ${client.name} up`}
              style={iconBtn({ disabled: index === 0 })}
            >
              <ArrowUp size={13} />
            </button>
            <button
              type="button"
              onClick={() => move(index, 1)}
              disabled={index === rule.clients.length - 1}
              title="Move down"
              aria-label={`Move ${client.name} down`}
              style={iconBtn({ disabled: index === rule.clients.length - 1 })}
            >
              <ArrowDown size={13} />
            </button>
            <button
              type="button"
              onClick={() => onChange(rule.clients.filter((_, i) => i !== index))}
              disabled={rule.clients.length === 1}
              title={
                rule.clients.length === 1
                  ? 'Remove the whole rule instead'
                  : 'Remove this fallback'
              }
              aria-label={`Remove ${client.name}`}
              style={iconBtn({ danger: true, disabled: rule.clients.length === 1 })}
            >
              <X size={13} />
            </button>
          </div>
        );
      })}

      {rule.clients.length < 10 && (
        <button
          type="button"
          onClick={addFallback}
          style={{
            alignSelf: 'flex-start',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.35rem',
            padding: '0.3rem 0.6rem',
            background: 'transparent',
            border: '1px solid var(--border-medium)',
            color: 'var(--text-secondary)',
            fontSize: '0.75rem',
            cursor: 'pointer',
          }}
        >
          <Plus size={12} /> Add fallback
        </button>
      )}
    </li>
  );
}

function AddRule({
  usedScopes,
  onAdd,
}: {
  usedScopes: Set<string>;
  onAdd: (scope: string) => void;
}) {
  const [custom, setCustom] = useState('');
  const [showCustom, setShowCustom] = useState(false);
  const available = SUGGESTED_CLIENT_SCOPES.filter((s) => !usedScopes.has(s));
  const customValid = isValidPreferredScope(custom.trim()) && !usedScopes.has(custom.trim());

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
        {available.map((scope) => (
          <button
            key={scope}
            type="button"
            onClick={() => onAdd(scope)}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.3rem',
              padding: '0.35rem 0.65rem',
              background: 'var(--bg-tertiary)',
              border: '1px solid var(--border-medium)',
              color: 'var(--text-secondary)',
              fontSize: '0.78rem',
              cursor: 'pointer',
            }}
          >
            <Plus size={12} /> {describeScope(scope)}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowCustom((v) => !v)}
          style={{
            padding: '0.35rem 0.65rem',
            background: 'transparent',
            border: '1px dashed var(--border-medium)',
            color: 'var(--text-tertiary)',
            fontSize: '0.78rem',
            cursor: 'pointer',
          }}
        >
          Other lexicon…
        </button>
      </div>

      {showCustom && (
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
          <input
            className="explore-input explore-mono"
            type="text"
            value={custom}
            placeholder="social.grain.photo.gallery or social.grain.*"
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && customValid) {
                onAdd(custom.trim());
                setCustom('');
                setShowCustom(false);
              }
            }}
            style={{ flex: 1, minWidth: 0 }}
          />
          <button
            type="button"
            disabled={!customValid}
            onClick={() => {
              onAdd(custom.trim());
              setCustom('');
              setShowCustom(false);
            }}
            style={{
              padding: '0.45rem 0.8rem',
              background: 'var(--accent-moss)',
              color: 'var(--text-on-accent)',
              border: '1px solid var(--accent-moss)',
              fontFamily: 'var(--font-serif)',
              fontSize: '0.8125rem',
              cursor: customValid ? 'pointer' : 'not-allowed',
              opacity: customValid ? 1 : 0.5,
            }}
          >
            Add
          </button>
        </div>
      )}
      <p style={{ margin: 0, fontSize: '0.7rem', color: 'var(--text-tertiary)' }}>
        A rule can name one collection (<code>app.bsky.feed.post</code>), a whole
        namespace (<code>sh.tangled.*</code>), or everything (<code>*</code>). The
        most specific rule wins.
      </p>
    </div>
  );
}

// --- Publishing ------------------------------------------------------------

function PublishCard() {
  const { prefs } = usePreferences();
  const { did } = useAtprotoSession();
  const { state, error, remote, setPublishing } = usePreferredClientsPublisher();
  const [showJson, setShowJson] = useState(false);

  const preview = useMemo(
    () =>
      JSON.stringify(
        buildPreferredClientsRecord(prefs.preferredClients, {
          createdAt: remote?.createdAt,
        }),
        null,
        2,
      ),
    [prefs.preferredClients, remote?.createdAt],
  );

  const uri = did ? `at://${did}/${PREFERRED_CLIENTS_NSID}/${PREFERRED_CLIENTS_RKEY}` : null;

  return (
    <section className="settings-card">
      <div className="settings-card-head">
        <h2 className="settings-card-title">Publish to your PDS</h2>
        <p className="settings-card-sub">
          Writes your rules to a public{' '}
          <code>{PREFERRED_CLIENTS_NSID}</code> record in your repo. Anyone can
          read it, which is what makes it useful and why it stays off until you
          say so. Turning it back off deletes the
          record rather than leaving a stale declaration behind.
        </p>
      </div>

      <Toggle
        id="publish-preferred-clients"
        checked={prefs.publishPreferredClients}
        onChange={setPublishing}
        disabled={!did || state === 'checking' || state === 'removing'}
        label="Publish my preferred clients"
        description={
          did
            ? 'Other Atmosphere apps can read this and open links in the client you chose.'
            : 'Sign in on the Account tab to publish. Your rules still work here in the meantime.'
        }
      />

      <StatusLine state={state} error={error} />

      {uri && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.72rem',
            color: 'var(--text-tertiary)',
            wordBreak: 'break-all',
          }}
        >
          <span style={{ flex: 1, minWidth: 0 }}>{uri}</span>
          <a
            href={`/explore/${did}/${PREFERRED_CLIENTS_NSID}/${PREFERRED_CLIENTS_RKEY}`}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.25rem',
              color: 'var(--text-accent)',
              whiteSpace: 'nowrap',
            }}
          >
            View <ExternalLink size={11} />
          </a>
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowJson((v) => !v)}
        style={{
          alignSelf: 'flex-start',
          background: 'transparent',
          border: 0,
          padding: 0,
          color: 'var(--text-accent)',
          fontSize: '0.78rem',
          cursor: 'pointer',
          textDecoration: 'underline',
        }}
      >
        {showJson ? 'Hide' : 'Show'} the record this writes
      </button>
      {showJson && (
        <pre
          style={{
            margin: 0,
            padding: '0.75rem',
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border-subtle)',
            fontFamily: 'var(--font-mono)',
            fontSize: '0.72rem',
            color: 'var(--text-secondary)',
            overflowX: 'auto',
          }}
        >
          {preview}
        </pre>
      )}
    </section>
  );
}

function StatusLine({
  state,
  error,
}: {
  state: ReturnType<typeof usePreferredClientsPublisher>['state'];
  error: string | null;
}) {
  const [text, tone] = ((): [string, string] => {
    switch (state) {
      case 'anonymous':
        return ['Not signed in. Rules are saved in this browser only.', 'var(--text-tertiary)'];
      case 'checking':
        return ['Checking your repo…', 'var(--text-tertiary)'];
      case 'publishing':
        return ['Publishing…', 'var(--text-tertiary)'];
      case 'removing':
        return ['Removing the record…', 'var(--text-tertiary)'];
      case 'empty':
        return ['Nothing to publish yet. Add a rule above.', 'var(--text-tertiary)'];
      case 'published':
        return ['Published. Other apps can read this now.', 'var(--text-accent)'];
      case 'error':
        return [error || 'Something went wrong.', 'var(--danger)'];
      default:
        return ['Not published.', 'var(--text-tertiary)'];
    }
  })();

  return (
    <p style={{ margin: 0, fontSize: '0.8rem', color: tone }} role="status">
      {text}
    </p>
  );
}

// --- Developers ------------------------------------------------------------

const READ_SNIPPET = `import { fetchPreferredClients, preferredWaypointFor } from '@aturi.to/waypoints';

const record = await fetchPreferredClients(viewerHandleOrDid);
const choice = preferredWaypointFor(record, {
  type: 'post',
  handle: 'alice.bsky.social',
  collection: 'app.bsky.feed.post',
  rkey: '3k7qw...',
});

// choice?.url — where this reader wants the post opened.
// null means they've declared nothing; use your existing default.`;

function DevelopersCard() {
  return (
    <section className="settings-card">
      <div className="settings-card-head">
        <h2 className="settings-card-title">For developers</h2>
        <p className="settings-card-sub">
          Building an Atmosphere app? Read this record for whoever you&rsquo;re
          linking on behalf of and send them where they asked to go. Two calls,
          no API key, and a null result just means &ldquo;carry on as
          before.&rdquo;
        </p>
      </div>
      <pre
        style={{
          margin: 0,
          padding: '0.75rem',
          background: 'var(--bg-tertiary)',
          border: '1px solid var(--border-subtle)',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.72rem',
          color: 'var(--text-secondary)',
          overflowX: 'auto',
        }}
      >
        {READ_SNIPPET}
      </pre>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', fontSize: '0.8rem' }}>
        <Link href="/docs#preferred-clients" style={{ color: 'var(--text-accent)' }}>
          Developer docs →
        </Link>
        <a
          href={`/lexicons/${PREFERRED_CLIENTS_NSID}.json`}
          style={{ color: 'var(--text-accent)' }}
        >
          Lexicon schema →
        </a>
        <a
          href={`/explore/lexicons/${PREFERRED_CLIENTS_NSID}`}
          style={{ color: 'var(--text-accent)' }}
        >
          Who else uses it →
        </a>
      </div>
    </section>
  );
}

function iconBtn({
  danger,
  disabled,
}: { danger?: boolean; disabled?: boolean } = {}): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 28,
    height: 28,
    flexShrink: 0,
    background: 'transparent',
    border: '1px solid var(--border-subtle)',
    color: danger ? 'var(--danger)' : 'var(--text-secondary)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.4 : 1,
  };
}
