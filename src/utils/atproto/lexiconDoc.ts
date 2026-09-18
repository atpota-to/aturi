/**
 * Resolve any NSID to the Lexicon document that defines it.
 *
 * This is the general case of what `spaceLexicon.ts` does for one narrow
 * purpose: that module resolves an NSID and then only keeps it if `main` is a
 * `space` definition. The record composer needs the document itself — for a
 * `record` definition, whose `record` object it turns into a form — so the two
 * share the hard part (finding the publisher) and diverge at the parse.
 *
 * Resolution follows the same convention, in the same order:
 *   1. `_lexicon.<authority domain>` TXT → the publisher's DID.
 *   2. Failing that, this app's publisher heuristic, so an NSID whose
 *      authority hasn't published a TXT record still resolves the way the
 *      lexicons explorer resolves it.
 *   3. Read `com.atproto.lexicon.schema/<nsid>` from that repo.
 *
 * Everything on the path is public and CORS-open, so this runs in the browser.
 * A failure at any hop is `null`, never a throw: a missing schema is the
 * ordinary case for the long tail of NSIDs, and the composer's answer to it is
 * to stay in JSON mode rather than to show an error.
 */

import { TTLMap } from './cache';
import { resolveIdentifier } from './identity';
import { getRecord } from './pdsClient';
import { isValidNsid } from './spaceUri';
import { lexiconAuthorityDomain, resolveLexiconDid } from './spaceLexicon';
import { publisherForNsid } from '../ufos/nsid';

const LEXICON_SCHEMA_COLLECTION = 'com.atproto.lexicon.schema';

/**
 * A fetched Lexicon document, kept as the untyped JSON it arrived as.
 *
 * Deliberately not modelled further here. The schema language has a dozen
 * definition types and this app understands one of them; a type that claimed
 * otherwise would push every consumer into casts. `lexiconForm.ts` narrows it
 * where it needs to and reports what it could not read.
 */
export type ResolvedLexicon = {
  nsid: string;
  doc: Record<string, unknown>;
  source: { did: string; pds: string; uri: string };
};

const DOC_TTL = 30 * 60_000;
const docCache = new TTLMap<string, ResolvedLexicon>(DOC_TTL);
/**
 * Negative results are cached too, and for the same length of time.
 *
 * The composer resolves on every keystroke that completes a valid NSID, so an
 * unpublished lexicon — the common case across the network's long tail — would
 * otherwise re-run a DNS query and a PDS read each time the user typed past it
 * and came back. A `null` here means "we looked recently and found nothing",
 * which is exactly as good an answer as a hit.
 */
const missCache = new TTLMap<string, true>(DOC_TTL);
const inflight = new Map<string, Promise<ResolvedLexicon | null>>();

/**
 * Fetch the Lexicon document for an NSID, or null if there isn't one to be
 * found. Concurrent callers for the same NSID share one resolution.
 */
export async function resolveLexiconDocument(nsid: string): Promise<ResolvedLexicon | null> {
  if (!isValidNsid(nsid)) return null;

  const cached = docCache.get(nsid);
  if (cached) return cached;
  if (missCache.get(nsid)) return null;
  const existing = inflight.get(nsid);
  if (existing) return existing;

  const pending = (async (): Promise<ResolvedLexicon | null> => {
    const domain = lexiconAuthorityDomain(nsid);
    const identifier = (domain ? await resolveLexiconDid(domain) : null) ?? publisherForNsid(nsid);

    const { did, pds } = await resolveIdentifier(identifier);
    const record = await getRecord(pds, {
      repo: did,
      collection: LEXICON_SCHEMA_COLLECTION,
      rkey: nsid,
    });

    const doc = record.value;
    if (typeof doc !== 'object' || doc === null || Array.isArray(doc)) return null;

    const resolved: ResolvedLexicon = {
      nsid,
      doc: doc as Record<string, unknown>,
      source: { did, pds, uri: `at://${did}/${LEXICON_SCHEMA_COLLECTION}/${nsid}` },
    };
    docCache.set(nsid, resolved);
    return resolved;
  })()
    .catch(() => null)
    .then((result) => {
      if (!result) missCache.set(nsid, true);
      return result;
    })
    .finally(() => {
      inflight.delete(nsid);
    });

  inflight.set(nsid, pending);
  return pending;
}
