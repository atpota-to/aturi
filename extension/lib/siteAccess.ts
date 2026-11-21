/**
 * Site access for auto-redirect on Safari.
 *
 * Safari treats the manifest's `<all_urls>` as something to ask for, not as
 * a grant: the user allows the extension site by site (or on every site).
 * WebKit only applies a DNR redirect when the extension has
 * `declarativeNetRequestWithHostAccess` AND the user has allowed the site the
 * link points to, so a link to a redirect source the user hasn't allowed is
 * left alone without a word. The General tab uses this module to show which
 * redirect sources are allowed and to ask for the rest.
 *
 * The helpers at the top are pure. The wrappers under them call
 * `browser.permissions` and degrade to "can't tell" where it doesn't exist.
 */

import { browser } from '#imports';

/** The match pattern covering one host, over http and https. */
export function originPatternForHost(host: string): string {
  return `*://${host}/*`;
}

/** Hosts trimmed, lower-cased, de-duplicated and sorted, empties dropped. */
export function normalizeHosts(hosts: readonly string[]): string[] {
  const out = new Set<string>();
  for (const host of hosts) {
    const clean = host.trim().toLowerCase();
    if (clean) out.add(clean);
  }
  return [...out].sort();
}

export function originPatternsForHosts(hosts: readonly string[]): string[] {
  return normalizeHosts(hosts).map(originPatternForHost);
}

export type SiteAccessSummary = {
  /** Every host asked about, normalized. */
  hosts: string[];
  /** The ones the user has allowed. */
  allowed: string[];
  /** The ones still to allow, in the same order. */
  missing: string[];
};

/** Split `hosts` by `isAllowed`. */
export function summarizeSiteAccess(
  hosts: readonly string[],
  isAllowed: (host: string) => boolean
): SiteAccessSummary {
  const list = normalizeHosts(hosts);
  const allowed: string[] = [];
  const missing: string[] = [];
  for (const host of list) (isAllowed(host) ? allowed : missing).push(host);
  return { hosts: list, allowed, missing };
}

type PermissionsEvent = {
  addListener(fn: () => void): void;
  removeListener(fn: () => void): void;
};

type PermissionsApi = {
  contains(permissions: { origins: string[] }): Promise<boolean>;
  request(permissions: { origins: string[] }): Promise<boolean>;
  onAdded?: PermissionsEvent;
  onRemoved?: PermissionsEvent;
};

function permissionsApi(): PermissionsApi | null {
  const api = (browser as unknown as { permissions?: PermissionsApi } | undefined)?.permissions;
  return api && typeof api.contains === 'function' ? api : null;
}

/**
 * Which of `hosts` the user has allowed, or null when this browser can't say.
 * One `contains` call per host, because a call with several origins only
 * answers "all of them?". A call that fails counts as not allowed.
 */
export async function checkSiteAccess(
  hosts: readonly string[]
): Promise<SiteAccessSummary | null> {
  const api = permissionsApi();
  if (!api) return null;
  const list = normalizeHosts(hosts);
  const results = await Promise.all(
    list.map(async host => {
      try {
        return (await api.contains({ origins: [originPatternForHost(host)] })) === true;
      } catch {
        return false;
      }
    })
  );
  const allowed = new Set(list.filter((_, i) => results[i]));
  return summarizeSiteAccess(list, host => allowed.has(host));
}

/**
 * Ask the user to allow `hosts`. Resolves true when Safari reports them all
 * allowed, false when the user said no or the request failed.
 *
 * Call it as the first statement of a click handler, with no await before
 * it: Safari only shows the prompt while it is handling a user gesture, and
 * the first await ends that. For the same reason `permissions.request` is
 * the first thing this function calls; building the patterns before it is
 * plain synchronous work.
 */
export function requestSiteAccess(hosts: readonly string[]): Promise<boolean> {
  const origins = originPatternsForHosts(hosts);
  if (origins.length === 0) return Promise.resolve(true);
  let pending: Promise<boolean>;
  try {
    const api = permissionsApi();
    pending = api ? api.request({ origins }) : Promise.resolve(false);
  } catch (err) {
    pending = Promise.reject(err);
  }
  return pending.then(
    granted => granted === true,
    () => false
  );
}

/**
 * Call `onChange` whenever site access may have changed: when the browser
 * reports a grant or a removal, and when this page comes back into view,
 * which covers a change made in Safari's own settings while the page sat in
 * a background tab. Returns the unsubscribe.
 */
export function watchSiteAccess(onChange: () => void): () => void {
  const api = permissionsApi();
  const events = [api?.onAdded, api?.onRemoved].filter(
    (e): e is PermissionsEvent => !!e && typeof e.addListener === 'function'
  );
  const handler = () => onChange();
  for (const event of events) {
    try {
      event.addListener(handler);
    } catch {
      /* not supported here: visibilitychange still covers it */
    }
  }
  const onVisible = () => {
    if (document.visibilityState === 'visible') onChange();
  };
  const hasDocument = typeof document !== 'undefined';
  if (hasDocument) document.addEventListener('visibilitychange', onVisible);
  return () => {
    for (const event of events) {
      try {
        event.removeListener(handler);
      } catch {
        /* ignore */
      }
    }
    if (hasDocument) document.removeEventListener('visibilitychange', onVisible);
  };
}
