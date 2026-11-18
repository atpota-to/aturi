/**
 * Finds the published schema for an NSID, from the browser: the
 * com.atproto.lexicon.schema record that defines it, in its authority's
 * repository. The MCP get_lexicon_schema tool answers the same question on
 * the server, by the same two steps:
 *
 *   1. The authority. The `_lexicon` TXT record on the NSID's domain names
 *      its DID (the lexicon resolution spec). Failing that, the reversed
 *      NSID as a handle (`app.bsky.feed.post` -> `bsky.app`), the
 *      convention the rest of the lexicons explorer already leans on.
 *   2. The record, at `com.atproto.lexicon.schema/{nsid}` in that repo.
 *      Slingshot first, since it is a cache and quick; the authority's own
 *      PDS before declaring the schema unpublished, since Slingshot misses
 *      records it has never been asked for.
 *
 * Each answer says how far it got, because "nobody claims this namespace"
 * and "its owner never published a schema" are different things to tell a
 * reader, and neither is an error: plenty of busy lexicons have no schema
 * record.
 */

import { TTLMap } from './cache';
import { getRecord } from './pdsClient';
import { getRecordByUri, resolveMiniDoc } from './slingshot';
import { lexiconAuthorityDomain, resolveLexiconDid } from './spaceLexicon';
import { isValidNsid } from './spaceUri';
import { publisherForNsid } from '../ufos/nsid';

export const LEXICON_SCHEMA_COLLECTION = 'com.atproto.lexicon.schema';

export type SchemaAuthority = {
  did: string;
  /** How the DID was found: the spec's DNS record, or the handle convention. */
  via: 'dns' | 'handle';
};

export type SchemaLookup =
  | { status: 'found'; nsid: string; authority: SchemaAuthority; uri: string; cid: string; doc: unknown }
  /** Nobody answers for the namespace: no TXT record, and no such handle. */
  | { status: 'no-authority'; nsid: string; domain: string | null; publisher: string }
  /** Somebody does, and has published no schema record for this NSID. */
  | { status: 'unpublished'; nsid: string; authority: SchemaAuthority }
  | { status: 'invalid'; nsid: string };

/**
 * Schemas change rarely, so a found one is kept an hour, which keeps
 * stepping back and forth through a namespace quick. Every other answer is
 * kept five minutes: the lookups underneath answer a network failure the
 * way they answer "not there", and an hour is a long time to repeat one.
 */
const found = new TTLMap<string, SchemaLookup>(60 * 60_000);
const missing = new TTLMap<string, SchemaLookup>(5 * 60_000);
const inflight = new Map<string, Promise<SchemaLookup>>();

async function lookup(nsid: string): Promise<SchemaLookup> {
  if (!isValidNsid(nsid)) return { status: 'invalid', nsid };

  const domain = lexiconAuthorityDomain(nsid);
  const publisher = publisherForNsid(nsid);
  let authority: SchemaAuthority | null = null;
  const fromDns = domain ? await resolveLexiconDid(domain) : null;
  if (fromDns) {
    authority = { did: fromDns, via: 'dns' };
  } else {
    const doc = await resolveMiniDoc(publisher);
    if (doc) authority = { did: doc.did, via: 'handle' };
  }
  if (!authority) return { status: 'no-authority', nsid, domain, publisher };

  const uri = `at://${authority.did}/${LEXICON_SCHEMA_COLLECTION}/${nsid}`;
  const cached = await getRecordByUri(uri);
  if (cached) return { status: 'found', nsid, authority, uri: cached.uri, cid: cached.cid, doc: cached.value };

  const host = await resolveMiniDoc(authority.did);
  if (host?.pds) {
    try {
      const record = await getRecord(host.pds.replace(/\/$/, ''), {
        repo: authority.did,
        collection: LEXICON_SCHEMA_COLLECTION,
        rkey: nsid,
      });
      if (record?.value) {
        return { status: 'found', nsid, authority, uri: record.uri, cid: record.cid, doc: record.value };
      }
    } catch {
      // A 400 RecordNotFound is the usual answer here: nothing published.
    }
  }
  return { status: 'unpublished', nsid, authority };
}

/** The schema for an NSID, shared between concurrent callers and kept an hour. */
export function lookupLexiconSchema(nsid: string): Promise<SchemaLookup> {
  const hit = cachedLexiconSchema(nsid);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(nsid);
  if (pending) return pending;
  const next = lookup(nsid)
    .then((answer) => {
      (answer.status === 'found' ? found : missing).set(nsid, answer);
      return answer;
    })
    .finally(() => inflight.delete(nsid));
  inflight.set(nsid, next);
  return next;
}

/** An answer already in hand, so a pane opened again draws it at once. */
export function cachedLexiconSchema(nsid: string): SchemaLookup | undefined {
  return found.get(nsid) ?? missing.get(nsid);
}
