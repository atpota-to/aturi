/**
 * PLC directory client.
 *
 *   - getPlcDocument(did)    — full DID document with services, keys, AKAs.
 *   - getPlcAuditLog(did)    — raw operation log (oldest → newest).
 *
 * Both responses are cached for 30s to keep multi-tab exploration cheap.
 */

import { withIdentification } from '../requestDeadline';
import { PLC_DIRECTORY } from './config';
import { TTLMap } from './cache';

export type PlcDocument = {
  id: string;
  '@context'?: string[];
  alsoKnownAs?: string[];
  verificationMethod?: Array<{
    id: string;
    type: string;
    controller?: string;
    publicKeyMultibase?: string;
  }>;
  service?: Array<{
    id: string;
    type: string;
    serviceEndpoint: string;
  }>;
};

export type PlcOperation = {
  type?: string;
  prev?: string | null;
  alsoKnownAs?: string[];
  services?: Record<string, { type: string; endpoint: string }>;
  rotationKeys?: string[];
  verificationMethods?: Record<string, string>;
  sig?: string;
};

export type PlcAuditEntry = {
  did: string;
  operation: PlcOperation;
  cid?: string;
  nullified?: boolean;
  createdAt: string;
};

const PLC_TTL = 30_000;
const docCache = new TTLMap<string, PlcDocument>(PLC_TTL);
const auditCache = new TTLMap<string, PlcAuditEntry[]>(PLC_TTL);
/**
 * Audit-log requests still on the wire. The account card's Created row, the
 * Repo at a glance tile and the Log tab all ask for the same log as a repo
 * page opens, before the first answer can reach the TTL cache, so they share
 * one request rather than each making their own.
 */
const auditInflight = new Map<string, Promise<PlcAuditEntry[]>>();

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, withIdentification());
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} :: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

export async function getPlcDocument(did: string): Promise<PlcDocument> {
  if (!did) throw new Error('getPlcDocument: missing did');
  const cached = docCache.get(did);
  if (cached) return cached;
  const doc = await fetchJson<PlcDocument>(`${PLC_DIRECTORY}/${encodeURIComponent(did)}`);
  docCache.set(did, doc);
  return doc;
}

export async function getPlcAuditLog(did: string): Promise<PlcAuditEntry[]> {
  if (!did) throw new Error('getPlcAuditLog: missing did');
  const cached = auditCache.get(did);
  if (cached) return cached;
  const pending = auditInflight.get(did);
  if (pending) return pending;
  const request = fetchJson<PlcAuditEntry[]>(
    `${PLC_DIRECTORY}/${encodeURIComponent(did)}/log/audit`,
  )
    .then((log) => {
      auditCache.set(did, log);
      return log;
    })
    .finally(() => auditInflight.delete(did));
  auditInflight.set(did, request);
  return request;
}

/**
 * When a did:plc was created: the timestamp of its first operation, or null
 * when the log is empty or the timestamp doesn't parse.
 */
export function plcCreatedAt(log: PlcAuditEntry[]): Date | null {
  const first = log[0]?.createdAt;
  if (!first) return null;
  const date = new Date(first);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Convert a Date in the past into a single coarse phrase ("3 years old",
 * "2 months old", "12 days old"). Returns the largest unit that fits;
 * keeps it terse so it can sit beside or beneath the absolute date.
 * `suffix: 'ago'` gives the same span as a time ("3 yr 8 mo ago"), for a
 * row labelled "Created".
 *
 * Months and years are counted on the calendar (whole months since the same
 * day of the month), not as 30- and 365-day blocks: mixing those two block
 * sizes once gave "0 yr 12 mo" in the last days before a first anniversary.
 */
export function relativeAge(
  then: Date,
  { now = new Date(), suffix = 'old' }: { now?: Date; suffix?: 'old' | 'ago' } = {},
): string {
  const ms = now.getTime() - then.getTime();
  if (ms < 0) return 'in the future';
  let months =
    (now.getFullYear() - then.getFullYear()) * 12 + (now.getMonth() - then.getMonth());
  if (now.getDate() < then.getDate()) months -= 1;
  if (months < 1) {
    const days = Math.floor(ms / 86_400_000);
    if (days < 1) return 'today';
    return `${days} day${days === 1 ? '' : 's'} ${suffix}`;
  }
  if (months < 12) return `${months} month${months === 1 ? '' : 's'} ${suffix}`;
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  if (remMonths > 0) {
    return `${years} yr ${remMonths} mo ${suffix}`;
  }
  return `${years} year${years === 1 ? '' : 's'} ${suffix}`;
}

/**
 * Compute a list of human-readable changes between two PLC operations.
 * Returns short strings like "+ handle alice.bsky.social", "services updated",
 * "keys rotated". Used by the audit log UI.
 */
export function diffOps(
  prev: PlcOperation | undefined,
  next: PlcOperation | undefined,
): string[] {
  if (!next) return [];
  const changes: string[] = [];

  const prevAka = prev?.alsoKnownAs || [];
  const nextAka = next.alsoKnownAs || [];
  const addedAka = nextAka.filter((h) => !prevAka.includes(h));
  const removedAka = prevAka.filter((h) => !nextAka.includes(h));
  for (const h of addedAka) changes.push(`+ handle ${h}`);
  for (const h of removedAka) changes.push(`− handle ${h}`);

  const prevSvc = JSON.stringify(prev?.services || {});
  const nextSvc = JSON.stringify(next?.services || {});
  if (prevSvc !== nextSvc) changes.push('services updated');

  const prevKeys = JSON.stringify(
    prev?.rotationKeys || prev?.verificationMethods || {},
  );
  const nextKeys = JSON.stringify(
    next?.rotationKeys || next?.verificationMethods || {},
  );
  if (prevKeys !== nextKeys) changes.push('keys rotated');

  return changes;
}

export function formatPlcTime(iso: string | null | undefined): string {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}

/**
 * Extract the PDS endpoint from a PLC document.
 */
export function extractPdsFromDoc(doc: PlcDocument): string | null {
  const services = doc.service || [];
  const pds =
    services.find((s) => s.id === '#atproto_pds')?.serviceEndpoint ||
    services.find((s) => s.type === 'AtprotoPersonalDataServer')?.serviceEndpoint ||
    services[0]?.serviceEndpoint;
  if (!pds) return null;
  return pds.replace(/\/$/, '');
}
