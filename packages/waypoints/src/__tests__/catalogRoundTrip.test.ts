import { describe, it, expect } from 'vitest';
import {
  WAYPOINT_DESTINATIONS_DATA,
  WAYPOINT_ORDER,
  type WaypointData,
  type WaypointType,
} from '../waypoints.data';
import {
  isSupportedHost,
  matchSupportedUrl,
  parseAtUri,
  type SourceApp,
} from '../reverseParsers';
import type { ParsedURI } from '../uriParser';

/**
 * The catalog and the reverse parsers are the two halves of the same contract:
 * `getUrl` writes a link, `matchSupportedUrl` reads it back. Nothing crossed
 * them until this file, so a builder and its parser could drift apart
 * indefinitely and every test stayed green.
 *
 * The property: take every waypoint, hand it every record shape it claims to
 * support, and require that the URL it produces parses back into the same
 * record it was given. Anything that does not is either a bug or an entry in
 * one of the two allowlists below — and each allowlist is itself enforced, so
 * fixing the underlying bug fails this file until the entry is deleted.
 */

type Fixture = {
  name: string;
  type: WaypointType;
  collection?: string;
  rkey?: string;
};

/**
 * One fixture per WaypointType, plus the record collections the catalog
 * actually routes on (a bare `record` fixture would never exercise Tangled's,
 * Margin's, or Grain's record branches).
 */
const FIXTURES: Fixture[] = [
  { name: 'profile', type: 'profile' },
  // 'unknown' carries no record, same as a profile: `buildWaypointsForParsed`
  // collapses it to 'profile' before it reaches any getUrl.
  { name: 'unknown', type: 'unknown' },
  { name: 'post', type: 'post', collection: 'app.bsky.feed.post', rkey: 'rk1' },
  { name: 'list', type: 'list', collection: 'app.bsky.graph.list', rkey: 'rk1' },
  { name: 'standardDoc', type: 'record', collection: 'site.standard.document', rkey: 'rk1' },
  { name: 'leafletDoc', type: 'record', collection: 'pub.leaflet.document', rkey: 'rk1' },
  { name: 'tangledRepo', type: 'record', collection: 'sh.tangled.repo', rkey: 'rk1' },
  { name: 'marginAnnotation', type: 'record', collection: 'at.margin.annotation', rkey: 'rk1' },
  { name: 'grainGallery', type: 'record', collection: 'social.grain.gallery', rkey: 'rk1' },
];

/**
 * Both identifier forms a caller can arrive with. A waypoint is free to prefer
 * the DID over the handle (several do — their routes only accept a DID), so
 * the round trip accepts either identifier back.
 */
const IDENTITIES = [
  { name: 'handle', handle: 'alice.bsky.social', did: 'did:plc:xyz' },
  { name: 'did', handle: 'did:plc:xyz', did: 'did:plc:xyz' },
];

/**
 * Waypoints that publish on a host another waypoint already owns, so
 * `matchSupportedUrl` can only ever name the host's owner.
 *
 * `anisotaReader` is Anisota's document reader: same `anisota.net` origin, same
 * `/profile/:id/...` layout, distinct catalog entry. Nothing in the URL
 * distinguishes the two, so the reverse parser reports `anisota` and the popup
 * offers the reader as a destination rather than recognizing it as the source.
 * That is a catalog modelling decision, not a parser defect.
 */
const HOST_SHARING_SOURCE: Readonly<Record<string, SourceApp>> = {
  anisotaReader: 'anisota',
};

/**
 * Known-lossy `${waypointId}:${collection}` pairs, mapped to the collection the
 * round trip actually comes back with.
 *
 * All six live rows here are the same defect: Anisota's
 * `/profile/:id/document/:rkey` and Standard Reader's `/a/:did/:rkey` routes
 * omit the NSID, so `reverseParsers.ts` reconstructs a hardcoded
 * `site.standard.document` — but the catalog builds those same URL shapes for
 * `pub.leaflet.document` too. A Leaflet document therefore round-trips into an
 * AT URI naming a record that does not exist.
 *
 * This is rank 11 of the packages audit. It was deliberately left unfixed
 * because the correct fix (returning the collection as provisional rather than
 * guessing it) needs the live apps checked first, and AGENTS.md forbids
 * narrowing supported types on a guess. The entries are here so the drift is
 * documented and counted instead of invisible.
 *
 * Deleting an entry is the deliberate act of fixing rank 11 — and the
 * "allowlist is not stale" test below fails if you fix the bug and forget.
 */
const KNOWN_LOSSY_COLLECTION: Readonly<Record<string, string>> = {
  'anisota:pub.leaflet.document': 'site.standard.document',
  'anisotaReader:pub.leaflet.document': 'site.standard.document',
  'standardReader:pub.leaflet.document': 'site.standard.document',
};

type Case = {
  waypoint: WaypointData;
  fixture: Fixture;
  identity: (typeof IDENTITIES)[number];
  url: string;
  /**
   * True when the waypoint cannot render this record and fell back to the
   * author's profile — legitimate for apps outside the record's family (the
   * picker offers those as "find this person over there" jumps).
   */
  fellBackToProfile: boolean;
};

function casesFor(id: string): Case[] {
  const waypoint = WAYPOINT_DESTINATIONS_DATA[id];
  const cases: Case[] = [];
  for (const identity of IDENTITIES) {
    const profileUrl = waypoint.getUrl(identity.handle, undefined, undefined, identity.did);
    for (const fixture of FIXTURES) {
      const url = waypoint.getUrl(
        identity.handle,
        fixture.collection,
        fixture.rkey,
        identity.did,
      );
      // `getUrl` returns null for input it cannot render at all; that contract
      // is covered by catalogInvariants.test.ts.
      if (url === null) continue;
      cases.push({
        waypoint,
        fixture,
        identity,
        url,
        fellBackToProfile: !!fixture.collection && url === profileUrl,
      });
    }
  }
  return cases;
}

/** Human-readable label so a failure names the exact combination. */
function label(c: Case): string {
  return `${c.waypoint.id}/${c.fixture.name}/${c.identity.name}`;
}

/**
 * Run the round trip for one case and return a list of human-readable
 * problems. Empty means the URL reversed cleanly.
 */
function roundTripProblems(c: Case): string[] {
  const problems: string[] = [];
  let target: URL;
  try {
    target = new URL(c.url);
  } catch {
    return [`${label(c)}: getUrl produced an unparseable URL ${c.url}`];
  }

  if (!isSupportedHost(target.hostname)) {
    // A waypoint whose own links this package cannot recognize means the
    // extension will not know the user is already there.
    return [`${label(c)}: ${target.hostname} is not in SUPPORTED_HOSTS`];
  }

  const match = matchSupportedUrl(target);
  if (!match) return [`${label(c)}: matchSupportedUrl returned null for ${c.url}`];

  const expectedSource = HOST_SHARING_SOURCE[c.waypoint.id] ?? c.waypoint.id;
  if (match.source !== expectedSource) {
    problems.push(
      `${label(c)}: source ${match.source}, expected ${expectedSource} (${c.url})`,
    );
  }

  const parsed = match.parsed;
  // Either identifier form is acceptable: the waypoint may deliberately build
  // its link from the DID even when handed a handle.
  const acceptableIdentifiers = [c.identity.handle, c.identity.did];
  if (!acceptableIdentifiers.includes(parsed.handle)) {
    problems.push(
      `${label(c)}: identifier ${parsed.handle}, expected one of ${acceptableIdentifiers.join(' | ')}`,
    );
  }

  if (c.fellBackToProfile) {
    // The link addresses the author, not the record, so only the identifier
    // has to survive — but it still has to read back as a profile rather than
    // as some other record.
    if (parsed.collection !== undefined) {
      problems.push(
        `${label(c)}: profile fallback reversed into a ${parsed.collection} record`,
      );
    }
    return problems;
  }

  const lossyKey = `${c.waypoint.id}:${c.fixture.collection}`;
  const expectedCollection = KNOWN_LOSSY_COLLECTION[lossyKey] ?? c.fixture.collection;
  if (parsed.collection !== expectedCollection) {
    problems.push(
      `${label(c)}: collection ${parsed.collection}, expected ${expectedCollection} (${c.url})`,
    );
  }
  if (parsed.rkey !== c.fixture.rkey) {
    problems.push(`${label(c)}: rkey ${parsed.rkey}, expected ${c.fixture.rkey} (${c.url})`);
  }

  problems.push(...uriConsistencyProblems(c, parsed));
  return problems;
}

/**
 * `parsed.uri` is what every downstream waypoint is rebuilt from, so it has to
 * agree with the components beside it and survive a second parse.
 */
function uriConsistencyProblems(c: Case, parsed: ParsedURI): string[] {
  const problems: string[] = [];
  const expectedUri =
    parsed.collection && parsed.rkey
      ? `at://${parsed.handle}/${parsed.collection}/${parsed.rkey}`
      : `at://${parsed.handle}`;
  if (parsed.uri !== expectedUri) {
    problems.push(`${label(c)}: uri ${parsed.uri}, expected ${expectedUri}`);
  }

  const reparsed = parseAtUri(parsed.uri);
  if (!reparsed) {
    problems.push(`${label(c)}: parseAtUri could not re-read ${parsed.uri}`);
    return problems;
  }
  const before = { ...parsed };
  const after = { ...reparsed.parsed };
  for (const key of ['type', 'uri', 'handle', 'did', 'collection', 'rkey'] as const) {
    if (before[key] !== after[key]) {
      problems.push(
        `${label(c)}: re-parsing ${parsed.uri} changed ${key}: ${before[key]} -> ${after[key]}`,
      );
    }
  }
  return problems;
}

describe('getUrl -> matchSupportedUrl round trip', () => {
  it.each(WAYPOINT_ORDER.map((id) => [id] as const))('%s reverses cleanly', (id) => {
    const cases = casesFor(id);
    expect(cases.length).toBeGreaterThan(0);
    expect(cases.flatMap(roundTripProblems)).toEqual([]);
  });

  it('covers every waypoint in the catalog', () => {
    const covered = WAYPOINT_ORDER.filter((id) => casesFor(id).length > 0);
    expect(covered).toEqual(WAYPOINT_ORDER);
  });
});

describe('round-trip allowlists', () => {
  it('names only waypoints that exist', () => {
    for (const id of Object.keys(HOST_SHARING_SOURCE)) {
      expect(WAYPOINT_ORDER).toContain(id);
    }
    for (const key of Object.keys(KNOWN_LOSSY_COLLECTION)) {
      expect(WAYPOINT_ORDER).toContain(key.split(':')[0]);
    }
  });

  it('is not stale: every allowlisted pair is still lossy', () => {
    // Without this, fixing rank 11 would leave a permanent exemption behind
    // that quietly re-hides the same defect the next time it appears.
    const stillLossy = new Set<string>();
    for (const id of WAYPOINT_ORDER) {
      for (const c of casesFor(id)) {
        if (c.fellBackToProfile || !c.fixture.collection) continue;
        const parsed = matchSupportedUrl(new URL(c.url))?.parsed;
        if (parsed && parsed.collection !== c.fixture.collection) {
          stillLossy.add(`${id}:${c.fixture.collection}`);
        }
      }
    }
    expect([...stillLossy].sort()).toEqual(Object.keys(KNOWN_LOSSY_COLLECTION).sort());
  });

  it('is still exactly the six rank-11 rows', () => {
    // The audit measured this defect as 6 corrupt rows. The count is asserted
    // so the blast radius cannot grow unnoticed while the fix is pending.
    const corrupt = WAYPOINT_ORDER.flatMap((id) =>
      casesFor(id).filter((c) => {
        if (c.fellBackToProfile || !c.fixture.collection) return false;
        const parsed = matchSupportedUrl(new URL(c.url))?.parsed;
        return !!parsed && parsed.collection !== c.fixture.collection;
      }).map(label),
    );
    expect(corrupt.sort()).toEqual([
      'anisota/leafletDoc/did',
      'anisota/leafletDoc/handle',
      'anisotaReader/leafletDoc/did',
      'anisotaReader/leafletDoc/handle',
      'standardReader/leafletDoc/did',
      'standardReader/leafletDoc/handle',
    ]);
  });
});

describe('every waypoint link is a link this package recognizes', () => {
  it.each(WAYPOINT_ORDER.map((id) => [id] as const))('%s stays on a supported host', (id) => {
    const offHost = casesFor(id)
      .map((c) => ({ c, hostname: new URL(c.url).hostname }))
      .filter(({ hostname }) => !isSupportedHost(hostname))
      .map(({ c, hostname }) => `${label(c)}: ${hostname}`);
    expect(offHost).toEqual([]);
  });
});
