import { describe, it, expect } from 'vitest';
import * as publicApi from '../index';

/**
 * The package's entry point is four `export *` lines. Deleting one, or adding
 * an `export` to a module that was only ever meant to be internal, changes the
 * published API of @aturi.to/waypoints without touching a single line that
 * looks like an API change — and both directions typecheck and test green.
 *
 * This is the snapshot that makes the change visible in review. It is kept
 * inline (rather than in a `.snap` file) so the diff shows the name that moved.
 */

/**
 * Every runtime value @aturi.to/waypoints exports, sorted. Types are not listed
 * here — they are erased at runtime; `npm run typecheck` covers them via the
 * type-only imports at the bottom of this file.
 */
const PUBLIC_EXPORTS = [
  'CATEGORY_ORDER',
  'COMPAT_FAMILIES',
  'COMPAT_FAMILY_ORDER',
  'COMPOSE_INTENT_TEXT_PLACEHOLDER',
  'DID_REQUIRED_WAYPOINTS',
  'SUPPORTED_HOSTS',
  'WAYPOINT_CATEGORIES_DATA',
  'WAYPOINT_DESTINATIONS_DATA',
  'WAYPOINT_ORDER',
  'buildWaypointsForParsed',
  'describeComposeIntent',
  'getCategorizedWaypointsData',
  'getComposeIntentAppUrl',
  'getComposeIntentTemplate',
  'getComposeIntentUrl',
  'getComposeIntentWaypoints',
  'getDisplayName',
  'getFeaturedWaypointData',
  'getRecommendedWaypointsData',
  'getWaypointCountData',
  'getWaypointDataForType',
  'isPublicFetchHost',
  'isSupportedHost',
  'matchSupportedUrl',
  'parseAtUri',
  'parseURI',
  'requiresDid',
  'resolveAtUri',
  'resolveHandle',
  'resolveHandleStatus',
  'resolveUrl',
  'resolveViaApi',
  'supportsComposeIntent',
  'waypointActivity',
];

const HOW_TO_FIX = [
  '',
  'The public API of @aturi.to/waypoints changed.',
  '',
  '  - A name that disappeared is a BREAKING change for every consumer of the',
  '    published package. Restore it, or (if the removal is intended) delete it',
  '    from PUBLIC_EXPORTS in this file and call it out in the release notes.',
  '  - A name that appeared is a new public API you are now committed to',
  '    supporting. If it was meant to stay internal, drop the `export` keyword;',
  '    otherwise add it to PUBLIC_EXPORTS here and document it in README.md.',
  '',
  'Either way the fix is a deliberate edit to this list, not a re-record.',
].join('\n');

describe('public API surface', () => {
  it('exports exactly the documented names', () => {
    const actual = Object.keys(publicApi).sort();
    const removed = PUBLIC_EXPORTS.filter((name) => !actual.includes(name));
    const added = actual.filter((name) => !PUBLIC_EXPORTS.includes(name));
    expect({ removed, added, HOW_TO_FIX }).toEqual({
      removed: [],
      added: [],
      HOW_TO_FIX,
    });
  });

  it('keeps the snapshot sorted and duplicate-free so diffs stay readable', () => {
    expect(PUBLIC_EXPORTS).toEqual([...new Set(PUBLIC_EXPORTS)].sort());
  });

  it('exports no default', () => {
    // The package is ESM+CJS dual-published; a default export would resolve
    // differently under each and is not part of the contract.
    expect(Object.keys(publicApi)).not.toContain('default');
  });

  it('exports each name as the kind of value the README promises', () => {
    const shouldBeFunctions = PUBLIC_EXPORTS.filter((name) => /^[a-z]/.test(name));
    const wrong = shouldBeFunctions.filter(
      (name) => typeof (publicApi as Record<string, unknown>)[name] !== 'function',
    );
    // Everything camelCase is a function; everything SCREAMING_CASE is data.
    expect(wrong).toEqual([]);
    const shouldBeData = PUBLIC_EXPORTS.filter((name) => /^[A-Z]/.test(name));
    const undefinedData = shouldBeData.filter(
      (name) => (publicApi as Record<string, unknown>)[name] === undefined,
    );
    expect(undefinedData).toEqual([]);
  });
});

/**
 * Type-only surface. These imports have no runtime effect; their whole job is
 * to fail `npm run typecheck` if a published type is renamed or dropped.
 */
import type {
  BuildWaypointsOptions,
  CategorizedWaypointsData,
  CompatFamilyMeta,
  ComposeIntentData,
  ComposeIntentDescriptor,
  HandleResolution,
  ParsedURI,
  RedirectCompatFamily,
  ResolveApiFailure,
  ResolveApiInput,
  ResolveApiParsed,
  ResolveApiResponse,
  ResolveApiSuccess,
  ResolveResult,
  ResolveUrlOptions,
  ResolveViaApiOptions,
  ResolvedRecommendation,
  ResolvedWaypoint,
  ReverseMatch,
  SourceApp,
  WaypointActivity,
  WaypointCategoryData,
  WaypointData,
  WaypointType,
} from '../index';

/** One value of each published type, so the compiler has to check the shape. */
type PublicTypeSurface = {
  buildWaypointsOptions: BuildWaypointsOptions;
  categorizedWaypointsData: CategorizedWaypointsData;
  compatFamilyMeta: CompatFamilyMeta;
  composeIntentData: ComposeIntentData;
  composeIntentDescriptor: ComposeIntentDescriptor;
  handleResolution: HandleResolution;
  parsedUri: ParsedURI;
  redirectCompatFamily: RedirectCompatFamily;
  resolveApiFailure: ResolveApiFailure;
  resolveApiInput: ResolveApiInput;
  resolveApiParsed: ResolveApiParsed;
  resolveApiResponse: ResolveApiResponse;
  resolveApiSuccess: ResolveApiSuccess;
  resolveResult: ResolveResult;
  resolveUrlOptions: ResolveUrlOptions;
  resolveViaApiOptions: ResolveViaApiOptions;
  resolvedRecommendation: ResolvedRecommendation;
  resolvedWaypoint: ResolvedWaypoint;
  reverseMatch: ReverseMatch;
  sourceApp: SourceApp;
  waypointActivity: WaypointActivity;
  waypointCategoryData: WaypointCategoryData;
  waypointData: WaypointData;
  waypointType: WaypointType;
};

describe('public type surface', () => {
  it('is reachable from the barrel', () => {
    // The assertion that matters happens at compile time, in the imports and
    // the `PublicTypeSurface` alias above. This keeps the file honest at
    // runtime too: a type that is removed makes `tsc --noEmit` fail, and the
    // import list is the checklist of what is published.
    const surface: Partial<PublicTypeSurface> = {};
    expect(surface).toEqual({});
  });
});
