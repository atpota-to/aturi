/**
 * Space type declarations — the public, unauthenticated half of a space.
 *
 * A space's type is an NSID that resolves to a Lexicon document whose `main`
 * definition has `"type": "space"`. That document names the space type for
 * humans, states its recommended key type, and lists the collections a client
 * should expect. None of it is permissioned, so it renders for an anonymous
 * visitor and is the only thing a space address discloses before sign-in.
 *
 * Resolution follows the atproto lexicon-resolution convention: the NSID's
 * domain authority publishes a `_lexicon` TXT record naming the DID that holds
 * the schema, and the schema lives at `com.atproto.lexicon.schema/<nsid>` in
 * that repo. When no TXT record exists we fall back to this app's existing
 * publisher heuristic so an unpublished-but-conventional NSID still resolves
 * the same way the lexicons explorer resolves it.
 */

import { DOH_RESOLVER } from './config';
import { TTLMap } from './cache';
import { resolveIdentifier } from './identity';
import { getRecord } from './pdsClient';
import { isValidNsid } from './spaceUri';
import { upstreamFetch } from '../upstreamFetch';
import { publisherForNsid } from '../ufos/nsid';

/** Where a lexicon schema record lives in its publisher's repo. */
const LEXICON_SCHEMA_COLLECTION = 'com.atproto.lexicon.schema';

/** The `main` definition type that marks a lexicon as a space type. */
const SPACE_DEF_TYPE = 'space';

/** Consent screens show this, so the protocol bounds it. */
const MAX_NAME_LENGTH = 64;

export type SpaceTypeDeclaration = {
  nsid: string;
  /** Human-readable name shown on consent screens. 1–64 chars. Required. */
  name: string;
  /** Developer-facing. Not shown to users by the protocol; we may show it. */
  description?: string;
  /** Recommended space-key type ("any", "tid", "literal:self", …). Required. */
  key: string;
  /** Collections clients should expect. Required (may be empty). */
  collections: string[];
  nameByLang?: Record<string, string>;
  source: { did: string; pds: string; uri: string };
};

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * PURE. Validate a fetched lexicon document as a space type declaration.
 *
 * Returns null for anything that is not one — including a perfectly valid
 * record or query lexicon sitting at that NSID — so the UI can say "this NSID
 * is not a space type" rather than rendering a half-built space.
 */
export function parseSpaceTypeDeclaration(
  nsid: string,
  doc: unknown,
): Omit<SpaceTypeDeclaration, 'source'> | null {
  const root = asRecord(doc);
  const main = asRecord(asRecord(root?.defs)?.main);
  if (!main || main.type !== SPACE_DEF_TYPE) return null;

  const name = main.name;
  const key = main.key;
  if (typeof name !== 'string' || name.length < 1 || name.length > MAX_NAME_LENGTH) return null;
  if (typeof key !== 'string' || key.length < 1) return null;

  const collections = Array.isArray(main.collections)
    ? main.collections.filter((c): c is string => typeof c === 'string')
    : [];

  const declaration: Omit<SpaceTypeDeclaration, 'source'> = {
    nsid,
    name,
    key,
    collections,
  };

  if (typeof main.description === 'string' && main.description) {
    declaration.description = main.description;
  }

  // The localized-name map is keyed `name:lang` in the document — a field name
  // the schema language reserves, not one that survives as a JS identifier.
  const byLang = asRecord(main['name:lang']);
  if (byLang) {
    const entries = Object.entries(byLang).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    );
    if (entries.length) declaration.nameByLang = Object.fromEntries(entries);
  }

  return declaration;
}

/**
 * PURE. The domain that publishes a given NSID's lexicon: every segment but
 * the last, reversed. `com.atmoboards.forum` → `atmoboards.com`. Null for
 * anything that is not an NSID.
 */
export function lexiconAuthorityDomain(nsid: string): string | null {
  if (!isValidNsid(nsid)) return null;
  const segments = nsid.split('.');
  return segments.slice(0, -1).reverse().join('.');
}

type DohAnswer = { name?: string; type?: number; data?: string };

/**
 * Query the `_lexicon` TXT record for a domain and return the DID it names.
 * TXT answers arrive quoted and may be split into several character strings,
 * so the quotes are stripped and the pieces joined before matching.
 */
async function resolveLexiconDid(domain: string): Promise<string | null> {
  const url = `${DOH_RESOLVER}?name=${encodeURIComponent(`_lexicon.${domain}`)}&type=TXT`;
  try {
    const res = await upstreamFetch(url, { headers: { accept: 'application/dns-json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as { Answer?: DohAnswer[] };
    for (const answer of body.Answer ?? []) {
      const data = typeof answer.data === 'string' ? answer.data : '';
      const joined = data
        .split(/"\s+"/)
        .map((part) => part.replace(/^"|"$/g, ''))
        .join('');
      const match = joined.match(/^did=(did:[a-z]+:[^\s;]+)$/);
      if (match) return match[1];
    }
    return null;
  } catch {
    return null;
  }
}

const DECLARATION_TTL = 30 * 60_000;
const declarationCache = new TTLMap<string, SpaceTypeDeclaration>(DECLARATION_TTL);
const declarationInflight = new Map<string, Promise<SpaceTypeDeclaration | null>>();

/**
 * Resolve a space type NSID to its declaration. Public data throughout — no
 * auth on any hop — so this is what Tier 0 renders for an anonymous visitor.
 *
 * Order:
 *   1. `_lexicon.<authority domain>` TXT → the publisher's DID.
 *   2. Failing that, this app's publisher convention (`com.atmoboards.forum`
 *      → the handle `atmoboards.com`), matching the lexicons explorer.
 *   3. Resolve that identifier to `{ did, pds }`.
 *   4. Read `com.atproto.lexicon.schema/<nsid>` from that repo.
 *   5. Validate it as a space type declaration.
 *
 * Returns null at any failure, including "the record exists but is not a
 * space type".
 */
export async function resolveSpaceTypeDeclaration(
  nsid: string,
): Promise<SpaceTypeDeclaration | null> {
  if (!isValidNsid(nsid)) return null;

  const cached = declarationCache.get(nsid);
  if (cached) return cached;
  const existing = declarationInflight.get(nsid);
  if (existing) return existing;

  const pending = (async (): Promise<SpaceTypeDeclaration | null> => {
    const domain = lexiconAuthorityDomain(nsid);
    const identifier = (domain ? await resolveLexiconDid(domain) : null) ?? publisherForNsid(nsid);

    const { did, pds } = await resolveIdentifier(identifier);
    const record = await getRecord(pds, {
      repo: did,
      collection: LEXICON_SCHEMA_COLLECTION,
      rkey: nsid,
    });

    const parsed = parseSpaceTypeDeclaration(nsid, record.value);
    if (!parsed) return null;

    const declaration: SpaceTypeDeclaration = {
      ...parsed,
      source: { did, pds, uri: `at://${did}/${LEXICON_SCHEMA_COLLECTION}/${nsid}` },
    };
    declarationCache.set(nsid, declaration);
    return declaration;
  })()
    .catch(() => null)
    .finally(() => {
      declarationInflight.delete(nsid);
    });

  declarationInflight.set(nsid, pending);
  return pending;
}
