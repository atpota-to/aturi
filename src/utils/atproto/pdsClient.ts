/**
 * AT Protocol PDS client. Pure fetch + JSON — no SDK dependency.
 *
 * All call sites use a single source of truth: this module. The existing
 * `src/utils/recordFetcher.ts` is refactored to delegate to `getRecord` so
 * the universal link pages and the explorer share the same code path.
 */

export type AtRecord = {
  uri: string;
  cid: string;
  value: Record<string, unknown>;
};

export type ListRecordsPage = {
  records: AtRecord[];
  cursor?: string;
};

export type DescribeRepoResponse = {
  handle?: string;
  did: string;
  didDoc?: unknown;
  collections: string[];
  handleIsCorrect?: boolean;
};

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const err = new Error(
      `HTTP ${res.status} ${res.statusText} for ${url} :: ${text.slice(0, 200)}`,
    );
    (err as Error & { status?: number }).status = res.status;
    throw err;
  }
  return (await res.json()) as T;
}

/**
 * com.atproto.repo.describeRepo
 */
export async function describeRepo(pds: string, repo: string): Promise<DescribeRepoResponse> {
  const params = new URLSearchParams({ repo });
  return fetchJson<DescribeRepoResponse>(
    `${pds}/xrpc/com.atproto.repo.describeRepo?${params}`,
  );
}

/**
 * com.atproto.repo.listRecords (single page).
 * Use this when the caller wants to control pagination (e.g. "Load more").
 */
export async function listRecordsPage(
  pds: string,
  opts: {
    repo: string;
    collection: string;
    limit?: number;
    cursor?: string;
    reverse?: boolean;
  },
): Promise<ListRecordsPage> {
  const { repo, collection, limit = 50, cursor, reverse = false } = opts;
  const params = new URLSearchParams({ repo, collection, limit: String(limit) });
  if (reverse) params.set('reverse', 'true');
  if (cursor) params.set('cursor', cursor);
  return fetchJson<ListRecordsPage>(
    `${pds}/xrpc/com.atproto.repo.listRecords?${params}`,
  );
}

/**
 * com.atproto.repo.listRecords — auto-paginates up to `max` records.
 */
export async function listRecords(
  pds: string,
  opts: {
    repo: string;
    collection: string;
    limit?: number;
    max?: number;
    reverse?: boolean;
  },
): Promise<AtRecord[]> {
  const { repo, collection, limit = 100, max = 500, reverse = false } = opts;
  const records: AtRecord[] = [];
  let cursor: string | undefined;
  while (records.length < max) {
    const params = new URLSearchParams({
      repo,
      collection,
      limit: String(Math.min(limit, max - records.length)),
    });
    if (reverse) params.set('reverse', 'true');
    if (cursor) params.set('cursor', cursor);
    const res = await fetchJson<ListRecordsPage>(
      `${pds}/xrpc/com.atproto.repo.listRecords?${params}`,
    );
    const batch = res.records || [];
    records.push(...batch);
    if (!res.cursor || batch.length === 0) break;
    cursor = res.cursor;
  }
  return records;
}

/**
 * com.atproto.repo.getRecord
 */
export async function getRecord(
  pds: string,
  opts: { repo: string; collection: string; rkey: string },
): Promise<AtRecord> {
  const params = new URLSearchParams(opts);
  return fetchJson<AtRecord>(
    `${pds}/xrpc/com.atproto.repo.getRecord?${params}`,
  );
}

/**
 * Build the public PDS XRPC URL for a single record. Used by the
 * "View on PDS" link in the explorer and the extension's inspect view
 * so the visitor can read the raw JSON straight from the source.
 */
export function getRecordUrl(
  pds: string,
  opts: { repo: string; collection: string; rkey: string },
): string {
  const params = new URLSearchParams(opts);
  return `${pds}/xrpc/com.atproto.repo.getRecord?${params}`;
}
