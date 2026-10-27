'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, CircleAlert, CircleDashed, Loader2 } from 'lucide-react';
import { useAtprotoSession } from '@/components/AtprotoSessionProvider';
import { usePreferences } from '@/components/PreferencesProvider';
import {
  usePreferredClients,
  type PreferredClientsLoad,
} from '@/components/PreferredClientsProvider';
import {
  CLIENT_PLATFORMS,
  PREFERRED_CLIENTS_NSID,
  PREFERRED_CLIENTS_RKEY,
  PREFERRED_CLIENT_CATEGORIES,
  clientFromWaypoint,
  type ClientLinkTemplates,
  type ClientPlatform,
  type ClientPreference,
  type DeclaredClient,
  type PreferredClientCategory,
  type PreferredClientsRecord,
} from '@/utils/preferredClients';
import {
  deletePreferredClientsFromPds,
  writePreferredClientsToPds,
} from '@/utils/atproto/preferredClientsPds';
import { WAYPOINT_DESTINATIONS_DATA, WAYPOINT_ORDER } from '@/utils/waypoints.data';
import type { CustomWaypoint, Preferences } from '@/utils/preferences';
import { encodeRepo } from '@/utils/atproto/urls';
import Toggle from '../Toggle';

/**
 * Preferred clients: the public `to.aturi.actor.preferredClients/self`
 * declaration, which other apps read to open this person's links in the
 * clients they use. See `src/utils/preferredClients.ts` for the record.
 *
 * This is deliberately not the Redirects tab. Those favorites are Aturi's own
 * settings, saved as you change them; this is a statement to every other app,
 * so it is drafted here and only written when Publish is pressed. The draft
 * starts from the published record, or, when there isn't one, from the
 * Redirects favorites, since those are usually the same answer.
 *
 * The record itself is read once per session by `PreferredClientsProvider`,
 * and a publish goes back through it, so auto-redirect follows the new
 * declaration on the very next link.
 */

const CATEGORY_COPY: Record<PreferredClientCategory, { title: string; sub: string; split: string }> = {
  'bluesky-social': {
    title: 'Bluesky client',
    sub: 'Where Bluesky posts, profiles and lists open.',
    split: 'A different Bluesky client on mobile or desktop',
  },
  'atproto-explorer': {
    title: 'Atmosphere explorer',
    sub: 'Where any record or repository opens, raw.',
    split: 'A different explorer on mobile or desktop',
  },
};

const PLATFORM_LABEL: Record<ClientPlatform, string> = {
  mobile: 'on mobile',
  desktop: 'on desktop',
};

type Option = { key: string; label: string; client: DeclaredClient; source: 'catalog' | 'custom' | 'record' };

type Slots = { client: string; mobile: string; desktop: string; split: boolean };

type Draft = Record<PreferredClientCategory, Slots>;

const EMPTY_SLOTS: Slots = { client: '', mobile: '', desktop: '', split: false };

export default function ClientsTab({ onSignIn }: { onSignIn: () => void }) {
  const { agent, did, loading } = useAtprotoSession();
  const { prefs } = usePreferences();
  const { load, setPublished } = usePreferredClients();
  // Tagged with the account it was drafted for, so signing in as someone else
  // starts a fresh draft rather than offering to publish the last one's.
  const [drafted, setDrafted] = useState<{ did: string; draft: Draft } | null>(null);
  const draft = drafted && drafted.did === did ? drafted.draft : null;
  const [busy, setBusy] = useState(false);
  const [writeError, setWriteError] = useState<string | null>(null);

  const published = load.status === 'ok' ? load.record : null;
  const settled = load.status !== 'idle' && load.status !== 'loading' && load.status !== 'error';

  const options = useMemo(
    () => buildOptions(prefs.customWaypoints, published),
    [prefs.customWaypoints, published],
  );

  // Seed the draft once per load. Later changes to the Redirects favorites
  // must not reach in and rewrite a form someone is halfway through.
  useEffect(() => {
    if (draft || !did || !settled) return;
    setDrafted({ did, draft: seedDraft(published, options, prefs.favoriteByFamily) });
  }, [draft, did, settled, published, options, prefs.favoriteByFamily]);

  if (!did) {
    return (
      <section className="settings-card">
        <div className="settings-card-head">
          <h2 className="settings-card-title">Sign in to publish</h2>
          <p className="settings-card-sub">
            Your preferred clients are published to your own repository, where
            other Atmosphere apps can read them. That needs you signed in;
            nothing on this tab is kept in the browser.
          </p>
        </div>
        <div>
          <button type="button" className="settings-btn is-primary" onClick={onSignIn}>
            Sign in
          </button>
        </div>
      </section>
    );
  }

  if (loading || (load.status !== 'error' && !draft)) {
    return (
      <section className="settings-card">
        <div>
          <div className="settings-sync">
            <Loader2 size={13} className="explore-spin" />
            <span>Reading your declaration…</span>
          </div>
        </div>
      </section>
    );
  }

  if (load.status === 'error' || !draft) {
    return (
      <section className="settings-card">
        <div className="settings-card-head">
          <h2 className="settings-card-title">Couldn&rsquo;t read your declaration</h2>
          <p className="settings-card-sub">
            Your PDS didn&rsquo;t answer, so the form stays closed rather than
            risk publishing over a declaration it couldn&rsquo;t see. Reload to
            try again.
          </p>
        </div>
        {load.status === 'error' && <p className="settings-error">{load.error}</p>}
      </section>
    );
  }

  const next = draftToPreferences(draft, options, published);
  const dirty = !samePreferences(next, published?.preferences ?? []);
  const exists = load.status === 'ok' || load.status === 'invalid';
  const recordPath = `/explore/${encodeRepo(did)}/${PREFERRED_CLIENTS_NSID}/${PREFERRED_CLIENTS_RKEY}`;

  function setSlots(category: PreferredClientCategory, patch: Partial<Slots>) {
    setDrafted((d) =>
      d ? { ...d, draft: { ...d.draft, [category]: { ...d.draft[category], ...patch } } } : d,
    );
    setWriteError(null);
  }

  async function publish() {
    if (!agent || !did) return;
    setBusy(true);
    setWriteError(null);
    try {
      if (next.length === 0) {
        await deletePreferredClientsFromPds(agent, did);
        setPublished(null);
      } else {
        setPublished(await writePreferredClientsToPds(agent, did, next));
      }
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!agent || !did) return;
    setBusy(true);
    setWriteError(null);
    try {
      await deletePreferredClientsFromPds(agent, did);
      setPublished(null);
      setDrafted({ did, draft: emptyDraft() });
    } catch (err) {
      setWriteError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="settings-card">
      <div className="settings-card-head">
        <h2 className="settings-card-title">Preferred clients</h2>
        <p className="settings-card-sub">
          Tell every Atmosphere app which clients you use. Apps that read
          this open your Bluesky links and record links straight in your
          choice instead of a default or a list. Apps that can tell your
          device apart use the mobile and desktop choices; the rest use the
          one above them.
        </p>
      </div>

      {/* Every child of a card is a padded band; the pill sits inside one. */}
      <div>
        <PublishStatus load={load} dirty={dirty} />
      </div>

      {PREFERRED_CLIENT_CATEGORIES.map((category) => (
        <CategoryRows
          key={category}
          category={category}
          slots={draft[category]}
          options={options[category]}
          onChange={(patch) => setSlots(category, patch)}
        />
      ))}

      {writeError && <p className="settings-error">{writeError}</p>}

      <div className="settings-list-actions">
        <button
          type="button"
          className="settings-btn is-primary"
          disabled={busy || !dirty}
          onClick={() => void publish()}
        >
          {busy && <Loader2 size={14} className="explore-spin" />}
          Publish
        </button>
        {exists && (
          <button
            type="button"
            className="settings-btn is-danger"
            disabled={busy}
            onClick={() => void remove()}
          >
            Remove declaration
          </button>
        )}
      </div>

      <p className="settings-card-note">
        Publishing writes a public record,{' '}
        {exists ? (
          <Link href={recordPath} prefetch={false}>
            <code>{PREFERRED_CLIENTS_NSID}/{PREFERRED_CLIENTS_RKEY}</code>
          </Link>
        ) : (
          <code>{PREFERRED_CLIENTS_NSID}/{PREFERRED_CLIENTS_RKEY}</code>
        )}
        , to your repository. It doesn&rsquo;t change where aturi.to sends
        you; that&rsquo;s the Redirects tab.
      </p>
    </section>
  );
}

function PublishStatus({ load, dirty }: { load: PreferredClientsLoad; dirty: boolean }) {
  let icon: React.ReactNode;
  let label: string;
  let tone: string;
  if (load.status === 'invalid') {
    icon = <CircleAlert size={13} />;
    label = 'Your existing record couldn’t be read. Publishing replaces it.';
    tone = 'is-error';
  } else if (dirty) {
    icon = <CircleDashed size={13} />;
    label = load.status === 'ok' ? 'Unpublished changes.' : 'Not published yet.';
    tone = 'is-pending';
  } else if (load.status === 'ok') {
    icon = <CheckCircle2 size={13} />;
    const when = load.record.updatedAt ? formatWhen(load.record.updatedAt) : null;
    label = when ? `Published ${when}.` : 'Published.';
    tone = 'is-ok';
  } else {
    icon = <CircleDashed size={13} />;
    label = 'Nothing declared.';
    tone = 'is-pending';
  }
  return (
    <div className={`settings-sync ${tone}`}>
      {icon}
      <span>{label}</span>
    </div>
  );
}

function CategoryRows({
  category,
  slots,
  options,
  onChange,
}: {
  category: PreferredClientCategory;
  slots: Slots;
  options: Option[];
  onChange: (patch: Partial<Slots>) => void;
}) {
  const copy = CATEGORY_COPY[category];
  return (
    <>
      <div className="settings-toggle-row">
        <label className="settings-toggle-label" htmlFor={`clients-${category}`}>
          <span className="settings-toggle-label-text">{copy.title}</span>
          <span className="settings-toggle-label-sub">{copy.sub}</span>
        </label>
        <ClientSelect
          id={`clients-${category}`}
          value={slots.client}
          options={options}
          emptyLabel="Not declared"
          onChange={(client) => onChange({ client })}
        />
      </div>
      <Toggle
        id={`clients-${category}-split`}
        label={copy.split}
        checked={slots.split}
        onChange={(split) => onChange({ split })}
      />
      {slots.split &&
        CLIENT_PLATFORMS.map((platform) => (
          <div className="settings-toggle-row" key={platform}>
            <label className="settings-toggle-label" htmlFor={`clients-${category}-${platform}`}>
              <span className="settings-toggle-label-text">
                {copy.title} {PLATFORM_LABEL[platform]}
              </span>
            </label>
            <ClientSelect
              id={`clients-${category}-${platform}`}
              value={slots[platform]}
              options={options}
              emptyLabel={slots.client ? 'Same as above' : 'Not declared'}
              onChange={(value) => onChange({ [platform]: value })}
            />
          </div>
        ))}
    </>
  );
}

function ClientSelect({
  id,
  value,
  options,
  emptyLabel,
  onChange,
}: {
  id: string;
  value: string;
  options: Option[];
  emptyLabel: string;
  onChange: (value: string) => void;
}) {
  const groups: { label: string; source: Option['source'] }[] = [
    { label: 'Clients', source: 'catalog' },
    { label: 'Your custom waypoints', source: 'custom' },
    { label: 'From your record', source: 'record' },
  ];
  return (
    <select
      id={id}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="settings-select"
    >
      <option value="">{emptyLabel}</option>
      {groups.map(({ label, source }) => {
        const members = options.filter((o) => o.source === source);
        if (members.length === 0) return null;
        return (
          <optgroup key={source} label={label}>
            {members.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </optgroup>
        );
      })}
    </select>
  );
}

// --- Draft <-> record ------------------------------------------------------

function emptyDraft(): Draft {
  return {
    'bluesky-social': { ...EMPTY_SLOTS },
    'atproto-explorer': { ...EMPTY_SLOTS },
  };
}

/**
 * What can be chosen per category: every catalog client in the family, the
 * person's custom waypoints that opted into it, and any client their record
 * already names that is neither, so that publishing a change to one category
 * never silently swaps out a client another app wrote into another slot.
 */
function buildOptions(
  customWaypoints: CustomWaypoint[],
  published: PreferredClientsRecord | null,
): Record<PreferredClientCategory, Option[]> {
  const out = {} as Record<PreferredClientCategory, Option[]>;
  for (const category of PREFERRED_CLIENT_CATEGORIES) {
    const options: Option[] = [];
    for (const id of WAYPOINT_ORDER) {
      if (!WAYPOINT_DESTINATIONS_DATA[id]?.redirectCompat.includes(category)) continue;
      const client = clientFromWaypoint(id);
      if (client) options.push({ key: `waypoint:${id}`, label: client.name ?? id, client, source: 'catalog' });
    }
    for (const custom of customWaypoints) {
      if (!custom.redirectCompat?.includes(category)) continue;
      const client = clientFromCustomWaypoint(custom);
      if (client) options.push({ key: `custom:${custom.id}`, label: custom.name, client, source: 'custom' });
    }
    // Keyed by content rather than by slot, so the option keeps its key when
    // it moves to another slot and the record is republished.
    const entry = published?.preferences.find((p) => p.category === category);
    for (const slot of ['client', ...CLIENT_PLATFORMS] as const) {
      const client = entry?.[slot];
      if (!client || matchOption(client, options)) continue;
      options.push({
        key: `record:${JSON.stringify(normalizeClient(client))}`,
        label: client.name ?? hostOf(client.url),
        client,
        source: 'record',
      });
    }
    out[category] = options;
  }
  return out;
}

function seedDraft(
  published: PreferredClientsRecord | null,
  options: Record<PreferredClientCategory, Option[]>,
  favorites: Preferences['favoriteByFamily'],
): Draft {
  const draft = emptyDraft();
  for (const category of PREFERRED_CLIENT_CATEGORIES) {
    const choices = options[category];
    if (published) {
      const entry = published.preferences.find((p) => p.category === category);
      const keyFor = (client?: DeclaredClient) =>
        (client && matchOption(client, choices)?.key) ?? '';
      draft[category] = {
        client: keyFor(entry?.client),
        mobile: keyFor(entry?.mobile),
        desktop: keyFor(entry?.desktop),
        split: Boolean(entry?.mobile || entry?.desktop),
      };
      continue;
    }
    // No declaration yet: start from the Redirects favorite for the family,
    // when it is something a declaration can name.
    const favorite = favorites[category];
    const seeded = favorite
      ? choices.find((o) => o.key === `waypoint:${favorite}` || o.key === `custom:${favorite}`)
      : undefined;
    if (seeded) draft[category] = { ...EMPTY_SLOTS, client: seeded.key };
  }
  return draft;
}

function draftToPreferences(
  draft: Draft,
  options: Record<PreferredClientCategory, Option[]>,
  published: PreferredClientsRecord | null,
): ClientPreference[] {
  const out: ClientPreference[] = [];
  for (const category of PREFERRED_CLIENT_CATEGORIES) {
    const slots = draft[category];
    const pick = (key: string) => options[category].find((o) => o.key === key)?.client;
    const entry: ClientPreference = { category };
    const client = pick(slots.client);
    if (client) entry.client = client;
    if (slots.split) {
      for (const platform of CLIENT_PLATFORMS) {
        const forPlatform = pick(slots[platform]);
        if (forPlatform) entry[platform] = forPlatform;
      }
    }
    if (entry.client || entry.mobile || entry.desktop) out.push(entry);
  }
  // Categories this tab doesn't offer are carried through untouched: another
  // app may have declared them, and they aren't this form's to drop.
  const shown = new Set<string>(PREFERRED_CLIENT_CATEGORIES);
  for (const entry of published?.preferences ?? []) {
    if (!shown.has(entry.category)) out.push(entry);
  }
  return out;
}

function matchOption(client: DeclaredClient, options: Option[]): Option | undefined {
  if (client.waypoint) {
    const byId = options.find((o) => o.source === 'catalog' && o.client.waypoint === client.waypoint);
    if (byId) return byId;
  }
  return options.find((o) => sameClient(o.client, client));
}

function sameClient(a: DeclaredClient, b: DeclaredClient): boolean {
  return JSON.stringify(normalizeClient(a)) === JSON.stringify(normalizeClient(b));
}

/**
 * Whether two preference lists declare the same thing. Compared by category,
 * first entry winning as readers do, so a record another app wrote in a
 * different order doesn't read as an unpublished change.
 */
function samePreferences(a: ClientPreference[], b: ClientPreference[]): boolean {
  const byCategory = (list: ClientPreference[]) => {
    const map = new Map<string, ClientPreference>();
    for (const entry of list) if (!map.has(entry.category)) map.set(entry.category, entry);
    return map;
  };
  const left = byCategory(a);
  const right = byCategory(b);
  if (left.size !== right.size) return false;
  for (const [category, entry] of left) {
    const other = right.get(category);
    if (!other) return false;
    const slotsMatch = (['client', ...CLIENT_PLATFORMS] as const).every((slot) => {
      const x = entry[slot];
      const y = other[slot];
      return x && y ? sameClient(x, y) : !x && !y;
    });
    if (!slotsMatch) return false;
  }
  return true;
}

/** Fixed key order, so two equal clients stringify the same. */
function normalizeClient(client: DeclaredClient) {
  const templates = client.templates ?? {};
  return [
    client.url,
    client.name ?? null,
    client.waypoint ?? null,
    templates.profile ?? null,
    templates.post ?? null,
    templates.list ?? null,
    templates.record ?? null,
  ];
}

/**
 * A custom waypoint as a declared client. It already is one in all but name:
 * same placeholders, same template kinds. `url` comes from the first template
 * that parses as an http(s) URL once its placeholders are filled.
 */
function clientFromCustomWaypoint(custom: CustomWaypoint): DeclaredClient | null {
  const templates: ClientLinkTemplates = {};
  for (const kind of ['profile', 'post', 'list', 'record'] as const) {
    const template = custom.templates[kind];
    if (template && custom.supportedTypes.includes(kind)) templates[kind] = template;
  }
  for (const template of Object.values(templates)) {
    try {
      const url = new URL(template.replace(/\{[a-z]+\}/g, 'x'));
      if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
      return { url: url.origin, name: custom.name, templates };
    } catch {
      // Not a URL even with the placeholders filled; try the next one.
    }
  }
  return null;
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function formatWhen(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}
