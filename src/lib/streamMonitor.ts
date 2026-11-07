/**
 * The model behind the stream monitor (/tools/stream): what kinds of event
 * it shows, how a raw Jetstream or PLC message becomes a row, how typed
 * filters are read, and how a view round-trips through the query string so a
 * filtered stream can be bookmarked or shared.
 *
 * No React here, so the rules can be tested on their own.
 */

import type { JetstreamEvent } from '@/utils/atproto/jetstream';
import type { PlcStreamEntry, PlcStreamOperation } from '@/utils/atproto/plcStream';
import { previewFor } from '@/utils/atproto/previewExtractors';
import { isValidDid, isValidNsid } from '@/utils/atproto/spaceUri';
import { explorePathFromAtUri } from '@/utils/atproto/urls';

export type StreamSource = 'jetstream' | 'plc';
export type SourceChoice = 'both' | StreamSource;

export type StreamKind =
  | 'create'
  | 'update'
  | 'delete'
  | 'identity'
  | 'account'
  | 'plc-new'
  | 'plc-update'
  | 'plc-tombstone';

export type KindMeta = {
  id: StreamKind;
  source: StreamSource;
  /** Filter chip label. */
  label: string;
  /** Row badge: short, and unique across both sources. */
  badge: string;
  hint: string;
};

export const STREAM_KINDS: KindMeta[] = [
  { id: 'create', source: 'jetstream', label: 'Create', badge: 'create', hint: 'A record was written to a repo' },
  { id: 'update', source: 'jetstream', label: 'Update', badge: 'update', hint: 'A record was replaced' },
  { id: 'delete', source: 'jetstream', label: 'Delete', badge: 'delete', hint: 'A record was removed' },
  {
    id: 'identity',
    source: 'jetstream',
    label: 'Identity',
    badge: 'identity',
    hint: 'A handle or DID document may have changed',
  },
  {
    id: 'account',
    source: 'jetstream',
    label: 'Account',
    badge: 'account',
    hint: 'An account was activated, deactivated, suspended or taken down',
  },
  { id: 'plc-new', source: 'plc', label: 'New DID', badge: 'new DID', hint: 'The first operation for a did:plc' },
  {
    id: 'plc-update',
    source: 'plc',
    label: 'DID update',
    badge: 'DID update',
    hint: 'A change to an existing DID: handle, PDS or keys',
  },
  {
    id: 'plc-tombstone',
    source: 'plc',
    label: 'Tombstone',
    badge: 'tombstone',
    hint: 'A DID was permanently deactivated',
  },
];

export const ALL_KINDS: StreamKind[] = STREAM_KINDS.map((k) => k.id);

const KIND_SOURCE = new Map(STREAM_KINDS.map((k) => [k.id, k.source]));

export function kindSource(kind: StreamKind): StreamSource {
  return KIND_SOURCE.get(kind)!;
}

export function kindsOf(source: StreamSource): StreamKind[] {
  return STREAM_KINDS.filter((k) => k.source === source).map((k) => k.id);
}

export function sourceShown(choice: SourceChoice, source: StreamSource): boolean {
  return choice === 'both' || choice === source;
}

// ─── Rows ──────────────────────────────────────────────────────────────────

export type StreamItem = {
  /** Monotonic per page load; the React key. */
  id: number;
  source: StreamSource;
  kind: StreamKind;
  did: string;
  /** Event time in ms: Jetstream's `time_us`, or the PLC entry's `createdAt`. */
  time: number;
  /** What happened, in a few words: a collection, a handle, a status. */
  primary: string;
  /** Supporting detail: a record preview, an rkey, a PDS host. */
  secondary: string;
  /** Where to look at it in the explorer. */
  href: string;
  /** Set on commits, for the "only this collection" shortcut. */
  collection?: string;
  /** The message as received, for text matching. */
  raw: string;
  data: unknown;
};

function repoHref(did: string): string {
  return explorePathFromAtUri(did) ?? `/explore/${did}`;
}

export function itemFromJetstream(
  evt: JetstreamEvent,
  raw: string,
  id: number,
): StreamItem {
  const base = { id, source: 'jetstream' as const, did: evt.did, time: evt.time_us / 1000, raw, data: evt };
  if (evt.kind === 'commit') {
    const { operation, collection, rkey, record } = evt.commit;
    // previewFor falls back to createdAt, which the row's clock already shows.
    const preview = previewFor(record);
    const recordPath = explorePathFromAtUri(`at://${evt.did}/${collection}/${rkey}`);
    const collectionPath = explorePathFromAtUri(`at://${evt.did}/${collection}`);
    return {
      ...base,
      kind: operation,
      primary: collection,
      secondary: operation !== 'delete' && preview && preview !== record?.createdAt ? preview : rkey,
      // A deleted record has nothing left to open; its collection does.
      href: (operation === 'delete' ? collectionPath : recordPath) ?? repoHref(evt.did),
      collection,
    };
  }
  if (evt.kind === 'identity') {
    return {
      ...base,
      kind: 'identity',
      primary: evt.identity.handle ?? 'identity changed',
      secondary: evt.identity.handle ? '' : 'no handle in the event',
      href: repoHref(evt.did),
    };
  }
  return {
    ...base,
    kind: 'account',
    primary: evt.account.active ? 'active' : 'inactive',
    secondary: evt.account.status ?? '',
    href: repoHref(evt.did),
  };
}

export function plcKind(op: PlcStreamOperation): StreamKind {
  if (op.type === 'plc_tombstone') return 'plc-tombstone';
  return op.prev == null ? 'plc-new' : 'plc-update';
}

/** The first handle a PLC operation claims, from either operation format. */
export function plcHandle(op: PlcStreamOperation): string | null {
  const aka = op.alsoKnownAs?.find((a) => a.startsWith('at://'));
  if (aka) return aka.slice('at://'.length);
  return op.handle ?? null;
}

/** The PDS host a PLC operation points at, without the scheme. */
export function plcPdsHost(op: PlcStreamOperation): string | null {
  const endpoint = op.services?.atproto_pds?.endpoint ?? op.service;
  if (!endpoint) return null;
  return endpoint.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

export function itemFromPlc(entry: PlcStreamEntry, raw: string, id: number): StreamItem {
  const kind = plcKind(entry.operation);
  const parsed = Date.parse(entry.createdAt);
  const tombstone = kind === 'plc-tombstone';
  return {
    id,
    source: 'plc',
    kind,
    did: entry.did,
    time: Number.isNaN(parsed) ? Date.now() : parsed,
    primary: tombstone ? 'tombstoned' : plcHandle(entry.operation) ?? 'no handle',
    secondary: tombstone ? '' : plcPdsHost(entry.operation) ?? 'no PDS',
    href: repoHref(entry.did),
    raw,
    data: entry,
  };
}

/** Case-insensitive match anywhere in the event's JSON. `needle` is lowercased. */
export function matchesText(raw: string, needle: string): boolean {
  return !needle || raw.toLowerCase().includes(needle);
}

// ─── Typed filters ─────────────────────────────────────────────────────────

export type AccountToken = { kind: 'did'; did: string } | { kind: 'handle'; handle: string };

const HANDLE_RE = /^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]([a-z0-9-]{0,61}[a-z0-9])?$/;

/**
 * Read an account the way people paste one: a DID, a handle with or without
 * the @, or an at:// URI (its authority is the account).
 */
export function parseAccountToken(input: string): AccountToken | null {
  let s = input.trim();
  if (s.startsWith('at://')) s = s.slice('at://'.length).split('/')[0];
  if (s.startsWith('@')) s = s.slice(1);
  if (s.startsWith('did:')) return isValidDid(s) ? { kind: 'did', did: s } : null;
  const handle = s.toLowerCase();
  return HANDLE_RE.test(handle) ? { kind: 'handle', handle } : null;
}

/**
 * A collection filter is a full NSID, or a namespace ending in `.*`, which
 * Jetstream expands server-side (`app.bsky.graph.*`). A prefix is accepted
 * when it could begin a valid NSID.
 */
export function parseCollectionToken(input: string): string | null {
  const s = input.trim();
  if (s.endsWith('.*')) {
    const prefix = s.slice(0, -2);
    return prefix.includes('.') && isValidNsid(`${prefix}.x`) ? s : null;
  }
  return isValidNsid(s) ? s : null;
}

// ─── Matching ──────────────────────────────────────────────────────────────

/** The parts of an event the filters look at, before a row is built. */
export type StreamProbe = {
  source: StreamSource;
  kind: StreamKind;
  did: string;
  collection?: string;
  raw: string;
};

export type CompiledFilter = {
  source: SourceChoice;
  kinds: Set<StreamKind>;
  /** null: no account filter. Empty: accounts asked for, none resolved yet. */
  dids: Set<string> | null;
  collections: string[];
  /** Lowercased. */
  needle: string;
};

export function compileFilter(view: MonitorView, dids: Set<string> | null): CompiledFilter {
  return {
    source: view.source,
    kinds: new Set(view.kinds),
    dids,
    collections: view.collections,
    needle: view.text.trim().toLowerCase(),
  };
}

/** Exact NSID, or a `.*` namespace as Jetstream reads one. */
export function collectionMatches(collection: string, filters: string[]): boolean {
  return filters.some((f) =>
    f.endsWith('.*') ? collection.startsWith(f.slice(0, -1)) : collection === f,
  );
}

/**
 * Every filter but the event type. The monitor counts what passes this per
 * type, so a switched-off chip still says how much it is holding back.
 *
 * Collections narrow commits only, as they do on Jetstream itself: identity
 * and account events carry no collection and pass through.
 */
export function matchesExceptKind(f: CompiledFilter, p: StreamProbe): boolean {
  if (!sourceShown(f.source, p.source)) return false;
  if (f.dids && !f.dids.has(p.did)) return false;
  if (f.collections.length && p.collection !== undefined && !collectionMatches(p.collection, f.collections)) {
    return false;
  }
  return matchesText(p.raw, f.needle);
}

export function matchesFilter(f: CompiledFilter, p: StreamProbe): boolean {
  return f.kinds.has(p.kind) && matchesExceptKind(f, p);
}

/** Jetstream's documented ceiling on `wantedCollections`. */
export const MAX_COLLECTIONS = 100;
/** Far below Jetstream's 10,000: the list lives in the query string. */
export const MAX_ACCOUNTS = 100;

// ─── View ⇄ query string ───────────────────────────────────────────────────

export type MonitorView = {
  source: SourceChoice;
  kinds: StreamKind[];
  /** As typed, handles included; resolved to DIDs by the page. */
  accounts: string[];
  collections: string[];
  text: string;
};

export const DEFAULT_VIEW: MonitorView = {
  source: 'both',
  kinds: ALL_KINDS,
  accounts: [],
  collections: [],
  text: '',
};

const SOURCE_CHOICES: SourceChoice[] = ['both', 'jetstream', 'plc'];

/**
 * Only the kinds of the sources on show are written to the query string, and
 * none at all when every one of them is on. Reading it back, a source the
 * view hides keeps all its kinds, so switching from "PLC" back to "Both"
 * after following a link doesn't find Jetstream switched off. `type=none`
 * records a view with every visible kind off.
 */
export function viewFromSearch(params: URLSearchParams): MonitorView {
  const sourceParam = params.get('source') as SourceChoice | null;
  const source = sourceParam && SOURCE_CHOICES.includes(sourceParam) ? sourceParam : 'both';

  const typed = params.getAll('type');
  let kinds = ALL_KINDS;
  if (typed.length) {
    const listed = new Set(typed.filter((t): t is StreamKind => ALL_KINDS.includes(t as StreamKind)));
    kinds = ALL_KINDS.filter((k) => listed.has(k) || !sourceShown(source, kindSource(k)));
  }

  const accounts = unique(params.getAll('account').filter((a) => parseAccountToken(a))).slice(0, MAX_ACCOUNTS);
  const collections = unique(
    params.getAll('collection').filter((c) => parseCollectionToken(c)),
  ).slice(0, MAX_COLLECTIONS);

  return { source, kinds, accounts, collections, text: params.get('q') ?? '' };
}

export function viewToSearch(view: MonitorView): string {
  const params = new URLSearchParams();
  if (view.source !== 'both') params.set('source', view.source);

  const visible = ALL_KINDS.filter((k) => sourceShown(view.source, kindSource(k)));
  const on = visible.filter((k) => view.kinds.includes(k));
  if (on.length === 0) params.append('type', 'none');
  else if (on.length < visible.length) for (const k of on) params.append('type', k);

  for (const a of view.accounts) params.append('account', a);
  if (view.source !== 'plc') for (const c of view.collections) params.append('collection', c);
  if (view.text.trim()) params.set('q', view.text.trim());
  return params.toString();
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

// ─── Formatting ────────────────────────────────────────────────────────────

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

export function formatCount(n: number): string {
  return n < 1000 ? String(n) : compact.format(n);
}
