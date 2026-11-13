/**
 * The records a page carries, as the popup's card files them: the page's own
 * record first ("This page"), then one tab per other record the scan found
 * (the references), in the order the scan reports them. Pure helpers, so the
 * rules for what counts as "the same record" and how labels read can be
 * tested without a browser.
 */
import { parseAtUri, type ReverseMatch } from '@aturi/reverseParsers';
import type { WaypointType } from '@aturi/waypoints.data';
import type { DetectedAtUri, DetectedSource } from './inspectScanner';

/**
 * How many references the tab strip's run holds. Past twelve a run stops
 * being something to read as it slides by, and the records list under the
 * card is the faster path.
 */
export const RUN_CAP = 12;

export type PageReference = {
  /** The URI as found, which also keys the tab. */
  key: string;
  match: ReverseMatch;
  where: DetectedSource;
  /** The AT Tags relation, for a hit declared that way. */
  relation?: string;
};

/** What the popup knows about the page's own record. */
export type PageRecordHint = {
  handle?: string | null;
  did?: string | null;
  collection?: string;
  rkey?: string;
};

const PROFILE_COLLECTION = 'app.bsky.actor.profile';

function sameRepo(repo: string, page: PageRecordHint): boolean {
  const r = repo.toLowerCase();
  return [page.handle, page.did].some(id => !!id && id.toLowerCase() === r);
}

/**
 * Whether a found URI is the page's own record. The page is often known by
 * its handle (from the address) while the page declares itself by DID, so
 * both are checked. A profile page and the account's profile record are the
 * same thing to a reader.
 */
export function isPageRecord(match: ReverseMatch, page: PageRecordHint): boolean {
  const { parsed } = match;
  if (!sameRepo(parsed.handle, page) && !(parsed.did && sameRepo(parsed.did, page))) {
    return false;
  }
  if (!page.collection) {
    return (
      !parsed.collection ||
      (parsed.collection === PROFILE_COLLECTION && parsed.rkey === 'self')
    );
  }
  return parsed.collection === page.collection && parsed.rkey === page.rkey;
}

/**
 * The references: every hit that parses as a public record and is not the
 * page's own. The scan has already merged hits with the same URI, so each
 * remaining URI is one tab.
 */
export function referencesFromHits(
  hits: DetectedAtUri[],
  page: PageRecordHint | null,
): PageReference[] {
  const out: PageReference[] = [];
  const seen = new Set<string>();
  for (const hit of hits) {
    if (seen.has(hit.uri)) continue;
    const match = parseAtUri(hit.uri);
    if (!match) continue;
    if (page && isPageRecord(match, page)) continue;
    seen.add(hit.uri);
    out.push({ key: hit.uri, match, where: hit.where, relation: hit.relation });
  }
  return out;
}

/**
 * The run's tabs: the first RUN_CAP references, plus the open one if it lies
 * beyond them, so the open record always has its tab in view.
 */
export function runReferences<T extends { key: string }>(refs: T[], openKey: string | null): T[] {
  const head = refs.slice(0, RUN_CAP);
  if (!openKey || head.some(r => r.key === openKey)) return head;
  const open = refs.find(r => r.key === openKey);
  return open ? [...head, open] : head;
}

const WHERE_LABEL: Record<DetectedSource, string> = {
  url: 'in the address bar',
  'at-tags': 'declared by the page',
  head: 'in the page head',
  meta: 'in a meta tag',
  link: 'linked on the page',
  jsonld: 'in structured data',
  text: 'in the page text',
};

/**
 * Where on the page a reference was found, lowercase so it reads after a
 * middot ("app.bsky.feed.post · in structured data").
 */
export function whereLabel(where: DetectedSource, relation?: string): string {
  if (where === 'at-tags' && relation) return `declared as at:${relation}`;
  return WHERE_LABEL[where] ?? where;
}

const COLLECTION_KIND: Record<string, string> = {
  'app.bsky.feed.generator': 'Feed',
  'app.bsky.graph.starterpack': 'Starter pack',
};

const TYPE_KIND: Record<string, string> = {
  post: 'Post',
  profile: 'Profile',
  list: 'List',
  record: 'Record',
};

/** The record's kind in a word: Post, Profile, List, Feed, Record. */
export function kindLabel(type: WaypointType, collection?: string): string {
  return (collection && COLLECTION_KIND[collection]) || TYPE_KIND[type] || 'Record';
}

/** "Post by dame.is", or the account alone for a profile. */
export function recordTitle(type: WaypointType, collection: string | undefined, who: string): string {
  const kind = type === 'unknown' ? 'profile' : type;
  if (kind === 'profile') return who;
  return `${kindLabel(kind, collection)} by ${who}`;
}

/** The first letter of an account's name, for its avatar mark. */
export function initialOf(who: string): string {
  return (who.replace(/^did:[a-z]+:/, '')[0] ?? '?').toUpperCase();
}

/**
 * A long identifier split where it may wrap: after every slash and before
 * every dot. The ledger puts a `<wbr>` between the pieces, so an AT URI
 * breaks at its joints instead of mid-word; a CID has none and wraps where it
 * must.
 */
export function joints(value: string): string[] {
  const out: string[] = [];
  let piece = '';
  for (const ch of value) {
    if (ch === '.' && piece) {
      out.push(piece);
      piece = '';
    }
    piece += ch;
    if (ch === '/') {
      out.push(piece);
      piece = '';
    }
  }
  if (piece) out.push(piece);
  return out;
}

/** A URL as the ledger shows it: without the scheme. */
export function bareUrl(url: string): string {
  return url.replace(/^https?:\/\//i, '');
}

/**
 * How many references the strip is not showing: all of them, less the run's
 * tabs that are fully in view. A tab counts as in view while at most 8px of
 * it sits under one of the 40px fades.
 */
export function hiddenReferenceCount(
  tabs: { left: number; width: number }[],
  view: { scrollLeft: number; width: number; scrolled: boolean; atEnd: boolean },
  total: number,
): number {
  const lo = view.scrollLeft + (view.scrolled ? 32 : 0);
  const hi = view.scrollLeft + view.width - (view.atEnd ? 0 : 32);
  const visible = tabs.filter(t => t.left >= lo - 0.5 && t.left + t.width <= hi + 0.5).length;
  return Math.max(0, total - visible);
}
