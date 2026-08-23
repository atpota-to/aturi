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
  const log = await fetchJson<PlcAuditEntry[]>(
    `${PLC_DIRECTORY}/${encodeURIComponent(did)}/log/audit`,
  );
  auditCache.set(did, log);
  return log;
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
