/**
 * PDS-level XRPC helpers — the layer above repos.
 *
 *   - describeServer(pds) → server metadata (DID, available domains, links).
 *   - listRepos(pds, opts) → paginated list of repos hosted on the PDS.
 *
 * Both wrap public XRPC endpoints; no auth required.
 */

export type ServerDescription = {
  /** The PDS's own DID (e.g. did:web:pds.example.com). Returned by recent PDS implementations. */
  did?: string;
  /** Account-creation suffixes accepted by this PDS (e.g. [".bsky.social"]). */
  availableUserDomains?: string[];
  inviteCodeRequired?: boolean;
  phoneVerificationRequired?: boolean;
  links?: {
    privacyPolicy?: string;
    termsOfService?: string;
  };
  contact?: {
    email?: string;
  };
};

export type RepoEntry = {
  did: string;
  head?: string;
  rev?: string;
  active?: boolean;
  status?: string;
};

export type ListReposPage = {
  cursor?: string;
  repos: RepoEntry[];
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} ${res.statusText} :: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as T;
}

/**
 * Strip trailing slash from a PDS URL so concatenation with `/xrpc/...` is
 * always well-formed. Accepts hostnames or full URLs.
 */
export function normalizePdsBase(input: string): string {
  let url = input.trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  return url.replace(/\/$/, '');
}

export async function describeServer(pds: string): Promise<ServerDescription> {
  return fetchJson<ServerDescription>(
    `${normalizePdsBase(pds)}/xrpc/com.atproto.server.describeServer`,
  );
}

export async function listRepos(
  pds: string,
  opts: { limit?: number; cursor?: string } = {},
): Promise<ListReposPage> {
  const { limit = 50, cursor } = opts;
  const params = new URLSearchParams({ limit: String(limit) });
  if (cursor) params.set('cursor', cursor);
  return fetchJson<ListReposPage>(
    `${normalizePdsBase(pds)}/xrpc/com.atproto.sync.listRepos?${params}`,
  );
}

/**
 * Extract the bare hostname from a URL or hostname input. Used for the
 * `/explore/pds/[host]` route param.
 */
export function pdsHostname(input: string): string {
  try {
    const u = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    return u.host;
  } catch {
    return input.replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  }
}
