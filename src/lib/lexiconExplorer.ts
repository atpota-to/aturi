/**
 * Where the lexicons explorer's Workbench and Files views are, read from the
 * address and written back to it.
 *
 * The three routes stay what they were, so a link opens the same place in
 * every view, Classic included:
 *
 *   /explore/lexicons                   the ranked lists (`?list=`), or a
 *                                       search (`?q=`)
 *   /explore/lexicons/group/{prefix}    a namespace; a single segment is a
 *                                       search term, as it always was
 *   /explore/lexicons/{nsid}            one lexicon
 *
 * The workbench shows a lexicon beside a list, so a lexicon's address also
 * says which list (`?list=`, `?ns=` or `?q=`). Left off, it is the lexicon's
 * own namespace, which is where a link from anywhere else should land. What
 * the lists count over (`?window=`) and rank by (`?by=`) ride along when they
 * are not the defaults, and so do a lexicon's recent records in the main
 * pane (`?records=1`) and one of them opened beside it (`?peek=`, as the
 * account explorer spells it).
 */

import { parsePeek, type PeekTarget } from './explorerView';
import { METRIC_LABEL, type Metric } from '@/utils/ufos/config';
import { groupPrefix } from '@/utils/ufos/nsid';
import { WINDOWS, type Window } from '@/utils/ufos/windows';

export const LEXICON_LISTS = ['trending', 'top', 'new', 'all'] as const;
export type LexiconList = (typeof LEXICON_LISTS)[number];

export const LEXICON_LIST_LABELS: Record<LexiconList, string> = {
  trending: 'Trending',
  top: 'Top',
  new: 'New',
  all: 'All lexicons',
};

export const DEFAULT_LEXICON_LIST: LexiconList = 'trending';
export const DEFAULT_LEXICON_WINDOW: Window = '7d';
/** Accounts: how many publish a lexicon says more about reach than volume. */
export const DEFAULT_LEXICON_METRIC: Metric = 'dids';

/** What the main pane lists. */
export type LexiconScope =
  | { kind: 'list'; list: LexiconList }
  | { kind: 'namespace'; prefix: string }
  | { kind: 'search'; term: string };

export type LexiconLocation = {
  scope: LexiconScope;
  /** The lexicon open in the inspector. */
  nsid: string | null;
  /** The open lexicon's recent records, in the main pane over its list. */
  records: boolean;
  /** One of those records, open in the inspector. */
  peek: PeekTarget | null;
  window: Window;
  metric: Metric;
};

const BASE = '/explore/lexicons';

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function isWindow(value: string | null): value is Window {
  return value !== null && Object.prototype.hasOwnProperty.call(WINDOWS, value);
}

function isMetric(value: string | null): value is Metric {
  return value !== null && Object.prototype.hasOwnProperty.call(METRIC_LABEL, value);
}

function isList(value: string | null): value is LexiconList {
  return (LEXICON_LISTS as readonly (string | null)[]).includes(value);
}

/** The group route's one argument: a dotted namespace, or a term to search. */
function scopeForGroup(value: string): LexiconScope {
  return value.includes('.') ? { kind: 'namespace', prefix: value } : { kind: 'search', term: value };
}

/**
 * The list a lexicon sits in when its address names none: its namespace,
 * which `/prefix` can list from two segments up. A lexicon too short to have
 * one (`a.b`) sits in the default list instead.
 */
export function homeScopeFor(nsid: string): LexiconScope {
  const prefix = groupPrefix(nsid);
  return prefix.includes('.') ? { kind: 'namespace', prefix } : { kind: 'list', list: DEFAULT_LEXICON_LIST };
}

export function sameScope(a: LexiconScope, b: LexiconScope): boolean {
  if (a.kind === 'list' && b.kind === 'list') return a.list === b.list;
  if (a.kind === 'namespace' && b.kind === 'namespace') return a.prefix === b.prefix;
  if (a.kind === 'search' && b.kind === 'search') return a.term === b.term;
  return false;
}

/** True for the three lexicon routes, and nothing else under /explore. */
export function isLexiconPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const parts = pathname.split('/');
  if (parts[0] !== '' || parts[1] !== 'explore' || parts[2] !== 'lexicons') return false;
  if (parts.length === 3) return true;
  if (parts.length === 4) return parts[3] !== '' && parts[3] !== 'group';
  return parts.length === 5 && parts[3] === 'group' && parts[4] !== '';
}

/**
 * Reads a lexicon address. Null for anything that is not one of the three
 * routes. Query values the explorer does not know are ignored rather than
 * refused, so a mistyped `?by=` still opens the page.
 */
export function parseLexiconLocation(
  pathname: string | null | undefined,
  query: URLSearchParams | { get(name: string): string | null },
): LexiconLocation | null {
  if (!isLexiconPath(pathname)) return null;
  const parts = (pathname as string).split('/').slice(3).map(decodeSegment);

  const listParam = query.get('list');
  const nsParam = query.get('ns')?.trim() || null;
  const qParam = query.get('q')?.trim() || null;
  const named: LexiconScope | null = isList(listParam)
    ? { kind: 'list', list: listParam }
    : nsParam && nsParam.includes('.')
      ? { kind: 'namespace', prefix: nsParam }
      : qParam
        ? { kind: 'search', term: qParam }
        : null;

  let scope: LexiconScope;
  let nsid: string | null = null;
  if (parts.length === 0) {
    scope = named ?? { kind: 'list', list: DEFAULT_LEXICON_LIST };
  } else if (parts[0] === 'group') {
    scope = scopeForGroup(parts[1]);
  } else {
    nsid = parts[0];
    scope = named ?? homeScopeFor(nsid);
  }

  const records = nsid !== null && query.get('records') !== null;
  const windowParam = query.get('window');
  const byParam = query.get('by');
  return {
    scope,
    nsid,
    records,
    peek: records ? parsePeek(query.get('peek')) : null,
    window: isWindow(windowParam) ? windowParam : DEFAULT_LEXICON_WINDOW,
    metric: isMetric(byParam) ? byParam : DEFAULT_LEXICON_METRIC,
  };
}

/**
 * The address of a location: the shortest one that reads back the same, so
 * a lexicon in its own namespace carries no `?ns=` and the defaults carry
 * nothing at all.
 */
export function lexiconAddress(loc: LexiconLocation): string {
  const query = new URLSearchParams();
  let path = BASE;
  const { scope, nsid } = loc;

  if (nsid) {
    path = `${BASE}/${encodeURIComponent(nsid)}`;
    if (!sameScope(scope, homeScopeFor(nsid))) {
      if (scope.kind === 'list') query.set('list', scope.list);
      else if (scope.kind === 'namespace') query.set('ns', scope.prefix);
      else query.set('q', scope.term);
    }
    if (loc.records) {
      query.set('records', '1');
      if (loc.peek) query.set('peek', `${loc.peek.did}/${loc.peek.collection}/${loc.peek.rkey}`);
    }
  } else if (scope.kind === 'namespace') {
    path = `${BASE}/group/${encodeURIComponent(scope.prefix)}`;
  } else if (scope.kind === 'search') {
    query.set('q', scope.term);
  } else if (scope.list !== DEFAULT_LEXICON_LIST) {
    query.set('list', scope.list);
  }

  if (loc.window !== DEFAULT_LEXICON_WINDOW) query.set('window', loc.window);
  if (loc.metric !== DEFAULT_LEXICON_METRIC) query.set('by', loc.metric);
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}

/** What the browser tab says, in the words the routes' own metadata uses. */
export function lexiconTitle(loc: LexiconLocation): string {
  if (loc.nsid) return `${loc.nsid} · Lexicons · Atmosphere Explorer`;
  if (loc.scope.kind === 'namespace') return `${loc.scope.prefix} · Lexicons · Atmosphere Explorer`;
  if (loc.scope.kind === 'search') return `${loc.scope.term} · Lexicons · Atmosphere Explorer`;
  return 'Lexicons · Atmosphere Explorer · aturi.to';
}
