/**
 * Where the PDS explorer is, read from the address and written back to it,
 * and how it sorts and filters the accounts a host lists.
 *
 * A PDS has one route, /explore/pds/{host}, so the rest is in the query, and
 * every view (Workbench, Files and Classic) reads the same one:
 *
 *   ?tab=overview|accounts|relays   which of the host's views; left off, the
 *                                   view's own default (the workbench opens
 *                                   on the overview, Files on the accounts)
 *   ?status=active|inactive|<name>  accounts by how they stand on the host
 *   ?commit=24h|7d|30d|1y|dormant   accounts by when their repo last changed
 *   ?sort=handle|commit|status      the order, with ?dir=asc|desc only when
 *                                   it isn't that order's natural direction
 *   ?account=did:…                  one account open beside the list
 *
 * The account parameters belong to the accounts view: any of them implies
 * it, and they are dropped from any other.
 */

export const PDS_TABS = ['overview', 'accounts', 'relays'] as const;
export type PdsTab = (typeof PDS_TABS)[number];

export const PDS_TAB_LABELS: Record<PdsTab, string> = {
  overview: 'Overview',
  accounts: 'Accounts',
  relays: 'Relays',
};

/**
 * When an account's repo last changed, from the TID its head commit carries
 * as `rev`. The four windows count back from now and include one another, so
 * "past 7 days" holds the past day too; `dormant` is everything older than a
 * year. A repo with no readable rev is in none of them.
 */
export const COMMIT_WINDOWS = ['24h', '7d', '30d', '1y', 'dormant'] as const;
export type CommitWindow = (typeof COMMIT_WINDOWS)[number];

export const COMMIT_WINDOW_LABELS: Record<CommitWindow, string> = {
  '24h': 'Past 24 hours',
  '7d': 'Past 7 days',
  '30d': 'Past 30 days',
  '1y': 'Past year',
  dormant: 'Over a year ago',
};

const DAY_MS = 24 * 60 * 60 * 1000;
const WINDOW_MS: Record<Exclude<CommitWindow, 'dormant'>, number> = {
  '24h': DAY_MS,
  '7d': 7 * DAY_MS,
  '30d': 30 * DAY_MS,
  '1y': 365 * DAY_MS,
};

/**
 * The orders the accounts list can take. `listed` is the order the host
 * lists them in, which on the reference PDS is the order the accounts were
 * created, oldest first (its listRepos cursor is a creation time).
 */
export const ACCOUNT_SORTS = ['listed', 'handle', 'commit', 'status'] as const;
export type AccountSort = (typeof ACCOUNT_SORTS)[number];

/** Each order's natural direction: newest commit first, everything else A to Z. */
export const SORT_DESC_BY_DEFAULT: Record<AccountSort, boolean> = {
  listed: false,
  handle: false,
  commit: true,
  status: false,
};

/** `all`, `active`, `inactive`, or one inactive status by its name (`deactivated`). */
export type StatusFilter = string;

export type PdsLocation = {
  /** The host as the route spells it. */
  host: string;
  /** The view named in the address; null for the layout's own default. */
  tab: PdsTab | null;
  status: StatusFilter;
  commit: CommitWindow | null;
  sort: AccountSort;
  desc: boolean;
  /** The DID of the account open beside the list. */
  account: string | null;
};

const BASE = '/explore/pds';

/** A status name as listRepos might send one: lower-case letters and dashes. */
const STATUS_NAME = /^[a-z][a-z0-9-]{0,39}$/;

function decodeSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function isTab(value: string | null): value is PdsTab {
  return (PDS_TABS as readonly (string | null)[]).includes(value);
}

function isCommitWindow(value: string | null): value is CommitWindow {
  return (COMMIT_WINDOWS as readonly (string | null)[]).includes(value);
}

function isSort(value: string | null): value is AccountSort {
  return (ACCOUNT_SORTS as readonly (string | null)[]).includes(value);
}

/** True for /explore/pds/{host}, and nothing else. */
export function isPdsPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const parts = pathname.split('/');
  return parts.length === 4 && parts[0] === '' && parts[1] === 'explore' && parts[2] === 'pds' && parts[3] !== '';
}

/** Whether a location says anything about the accounts beyond the defaults. */
function narrowsAccounts(loc: Omit<PdsLocation, 'host' | 'tab'>): boolean {
  return (
    loc.status !== 'all' ||
    loc.commit !== null ||
    loc.sort !== 'listed' ||
    loc.desc !== SORT_DESC_BY_DEFAULT[loc.sort] ||
    loc.account !== null
  );
}

const ACCOUNT_DEFAULTS = {
  status: 'all',
  commit: null,
  sort: 'listed',
  desc: false,
  account: null,
} as const satisfies Omit<PdsLocation, 'host' | 'tab'>;

/**
 * Reads a PDS address. Null for anything that isn't the PDS route. Values
 * the explorer doesn't know are ignored rather than refused, so a mistyped
 * `?sort=` still opens the page.
 */
export function parsePdsLocation(
  pathname: string | null | undefined,
  query: URLSearchParams | { get(name: string): string | null },
): PdsLocation | null {
  if (!isPdsPath(pathname)) return null;
  const host = decodeSegment((pathname as string).split('/')[3]);

  const statusParam = query.get('status')?.trim().toLowerCase() ?? '';
  const commitParam = query.get('commit');
  const sortParam = query.get('sort');
  const dirParam = query.get('dir');
  const accountParam = query.get('account')?.trim() ?? '';

  const sort: AccountSort = isSort(sortParam) ? sortParam : 'listed';
  const accounts = {
    status: STATUS_NAME.test(statusParam) ? statusParam : 'all',
    commit: isCommitWindow(commitParam) ? commitParam : null,
    sort,
    desc: dirParam === 'desc' ? true : dirParam === 'asc' ? false : SORT_DESC_BY_DEFAULT[sort],
    account: accountParam.startsWith('did:') ? accountParam : null,
  };

  const tabParam = query.get('tab');
  const tab: PdsTab | null = isTab(tabParam) ? tabParam : narrowsAccounts(accounts) ? 'accounts' : null;
  return tab === 'accounts' ? { host, tab, ...accounts } : { host, tab, ...ACCOUNT_DEFAULTS };
}

/**
 * The address of a location: the shortest one that reads back the same.
 * `defaultTab` is the view the layout opens on, which the address can leave
 * unsaid.
 */
export function pdsAddress(loc: PdsLocation, defaultTab: PdsTab | null = null): string {
  const query = new URLSearchParams();
  const tab = loc.tab ?? defaultTab;
  if (tab === 'accounts') {
    const narrowed = narrowsAccounts(loc);
    if (!narrowed && defaultTab !== 'accounts') query.set('tab', 'accounts');
    if (loc.status !== 'all') query.set('status', loc.status);
    if (loc.commit) query.set('commit', loc.commit);
    if (loc.sort !== 'listed') query.set('sort', loc.sort);
    if (loc.desc !== SORT_DESC_BY_DEFAULT[loc.sort]) query.set('dir', loc.desc ? 'desc' : 'asc');
    if (loc.account) query.set('account', loc.account);
  } else if (tab && tab !== defaultTab) {
    query.set('tab', tab);
  }
  const path = `${BASE}/${encodeURIComponent(loc.host)}`;
  const qs = query.toString();
  return qs ? `${path}?${qs}` : path;
}

/** A location with the account parameters back at their defaults. */
export function withoutAccountParams(loc: PdsLocation): PdsLocation {
  return { ...loc, ...ACCOUNT_DEFAULTS };
}

/** What the browser tab says, in the words the route's own metadata uses. */
export function pdsTitle(host: string, tab: PdsTab): string {
  const base = `${host} · PDS · Atmosphere Explorer`;
  return tab === 'overview' ? base : `${PDS_TAB_LABELS[tab]} · ${base}`;
}

// ─── Standing ────────────────────────────────────────────────────────────────

/**
 * How an account stands on its host, from listRepos' `active` and `status`:
 * `active`, or the status the host gave for an inactive one. Hosts older
 * than the account-status fields send neither, and serve every repo they
 * list, so those count as active.
 */
export function standingOf(repo: { active?: boolean; status?: string }): string {
  if (repo.active === false) return repo.status?.toLowerCase() || 'inactive';
  if (repo.status && repo.status.toLowerCase() !== 'active') return repo.status.toLowerCase();
  return 'active';
}

export function matchesStatus(standing: string, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  if (filter === 'active') return standing === 'active';
  if (filter === 'inactive') return standing !== 'active';
  return standing === filter;
}

const STATUS_LABELS: Record<string, string> = {
  active: 'Active',
  inactive: 'Inactive',
  deactivated: 'Deactivated',
  takendown: 'Taken down',
  suspended: 'Suspended',
  deleted: 'Deleted',
  desynchronized: 'Desynchronized',
  throttled: 'Throttled',
};

/** A status in words. The lexicon leaves the set open, so an unknown one is shown as sent. */
export function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.charAt(0).toUpperCase() + status.slice(1);
}

const STATUS_MEANINGS: Record<string, string> = {
  active: 'The host serves this repo’s records.',
  inactive: 'The host lists this repo but won’t serve its records.',
  deactivated: 'Paused by the account holder, who can come back to it. Until then its records aren’t served.',
  takendown: 'Taken down by the host’s operator. Its records aren’t served.',
  suspended: 'Suspended for a time by the host’s operator. Its records aren’t served meanwhile.',
  deleted: 'The account was deleted. The host keeps only a marker that it existed.',
  desynchronized: 'The host’s copy of this repo has fallen out of step with the network.',
  throttled: 'The host is limiting how fast this repo can change.',
};

/** What a status means for the repo, in a sentence. */
export function statusMeaning(status: string): string {
  return STATUS_MEANINGS[status] ?? `The host gives this repo the status “${status}” and won’t serve its records.`;
}

/**
 * How loud a status is: `good` for active, `warn` for one the account
 * holder chose (deactivated), `bad` for one imposed on them, `quiet` for the
 * rest. The tone is never shown without the status's name.
 */
export function statusTone(status: string): 'good' | 'warn' | 'bad' | 'quiet' {
  if (status === 'active') return 'good';
  if (status === 'deactivated') return 'warn';
  if (status === 'takendown' || status === 'suspended' || status === 'deleted') return 'bad';
  return 'quiet';
}

/** Active first, then the inactive statuses by how severe, then the rest by name. */
const STATUS_ORDER = ['active', 'deactivated', 'suspended', 'takendown', 'deleted'];

export function compareStatus(a: string, b: string): number {
  const x = STATUS_ORDER.indexOf(a);
  const y = STATUS_ORDER.indexOf(b);
  if (x !== y) return (x < 0 ? STATUS_ORDER.length : x) - (y < 0 ? STATUS_ORDER.length : y);
  return a.localeCompare(b);
}

// ─── Last commit ─────────────────────────────────────────────────────────────

export function matchesCommit(date: Date | null, window: CommitWindow | null, now: number = Date.now()): boolean {
  if (window === null) return true;
  if (date === null) return false;
  const age = now - date.getTime();
  if (window === 'dormant') return age >= WINDOW_MS['1y'];
  return age < WINDOW_MS[window];
}

// ─── Counting ────────────────────────────────────────────────────────────────

export type AccountFacets = {
  /** Accounts within the commit filter, whatever their status. */
  statusAll: number;
  /** Those accounts by standing. */
  byStatus: Map<string, number>;
  /** Accounts within the status filter, whatever their last commit. */
  commitAll: number;
  /** Those accounts by commit window. */
  byCommit: Record<CommitWindow, number>;
};

/**
 * How many accounts each filter would show, as a faceted search counts:
 * each facet's counts honour the other facet's choice but not its own, so
 * picking "Active" shows how many active accounts committed this week, and
 * the status counts still say how many of each there are.
 */
export function countFacets(
  rows: readonly { standing: string; date: Date | null }[],
  status: StatusFilter,
  commit: CommitWindow | null,
  now: number = Date.now(),
): AccountFacets {
  const byStatus = new Map<string, number>();
  const byCommit = Object.fromEntries(COMMIT_WINDOWS.map((w) => [w, 0])) as Record<CommitWindow, number>;
  let statusAll = 0;
  let commitAll = 0;
  for (const row of rows) {
    if (matchesCommit(row.date, commit, now)) {
      statusAll++;
      byStatus.set(row.standing, (byStatus.get(row.standing) ?? 0) + 1);
    }
    if (matchesStatus(row.standing, status)) {
      commitAll++;
      for (const w of COMMIT_WINDOWS) if (matchesCommit(row.date, w, now)) byCommit[w]++;
    }
  }
  return { statusAll, byStatus, commitAll, byCommit };
}

// ─── Sorting ─────────────────────────────────────────────────────────────────

/** What sorting needs of an account. */
export type SortableAccount = {
  /** Its place in the host's listing. */
  index: number;
  standing: string;
  date: Date | null;
  /** The handle, once known. */
  handle: string | null;
};

/**
 * Orders two accounts. Accounts with nothing to sort by (no handle yet, no
 * readable commit date) go last in either direction, and ties keep the
 * host's order, so the list doesn't shuffle as handles fill in.
 */
export function compareAccounts(a: SortableAccount, b: SortableAccount, sort: AccountSort, desc: boolean): number {
  const dir = desc ? -1 : 1;
  const listed = a.index - b.index;
  if (sort === 'listed') return dir * listed;
  if (sort === 'status') return dir * compareStatus(a.standing, b.standing) || listed;
  if (sort === 'handle') {
    if (!a.handle || !b.handle) return (a.handle ? -1 : b.handle ? 1 : 0) || listed;
    return dir * a.handle.localeCompare(b.handle) || listed;
  }
  if (!a.date || !b.date) return (a.date ? -1 : b.date ? 1 : 0) || listed;
  return dir * (a.date.getTime() - b.date.getTime()) || listed;
}
