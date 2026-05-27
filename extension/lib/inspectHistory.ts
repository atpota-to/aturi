/**
 * Local history of repos surfaced by the Inspect tab. Populated whenever a
 * page-scan yields one or more AT URIs; surfaced in the empty state of the
 * Inspect tab so a "no URIs detected" page can still offer useful next-steps
 * (jump straight into the Explorer for someone you tend to look up).
 *
 * Stored in `browser.storage.local` rather than `sync`:
 *   - it's noisy, device-specific browsing data — no value in syncing
 *   - it can grow larger than the per-key sync quota
 */
import { browser } from '#imports';
import { parseAtUri } from '@aturi/atproto/urls';
import type { DetectedAtUri } from './inspectScanner';

const STORAGE_KEY = 'aturi.inspectHistory.v1';
const MAX_ENTRIES = 50;

export type InspectRepoEntry = {
  /** Raw repo identifier as it appeared in the AT URI (handle or DID). */
  repo: string;
  /** Times this repo has appeared in a scan. */
  count: number;
  /** ms-since-epoch of the most recent appearance. */
  lastSeen: number;
};

type StoredShape = { entries?: InspectRepoEntry[] };

type StorageArea = {
  get(keys?: string | string[] | Record<string, unknown> | null): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
};

function getLocalArea(): StorageArea | null {
  if (typeof browser !== 'undefined' && browser.storage?.local) {
    return browser.storage.local as unknown as StorageArea;
  }
  return null;
}

async function readEntries(): Promise<InspectRepoEntry[]> {
  const area = getLocalArea();
  if (!area) return [];
  try {
    const got = await area.get(STORAGE_KEY);
    const raw = got?.[STORAGE_KEY] as StoredShape | undefined;
    if (!raw || !Array.isArray(raw.entries)) return [];
    return raw.entries.filter(
      (e): e is InspectRepoEntry =>
        !!e && typeof e.repo === 'string' && typeof e.count === 'number' && typeof e.lastSeen === 'number',
    );
  } catch {
    return [];
  }
}

async function writeEntries(entries: InspectRepoEntry[]): Promise<void> {
  const area = getLocalArea();
  if (!area) return;
  try {
    await area.set({ [STORAGE_KEY]: { entries } satisfies StoredShape });
  } catch {
    /* ignore — local storage write failures aren't worth surfacing */
  }
}

function extractRepos(hits: DetectedAtUri[]): string[] {
  const repos = new Set<string>();
  for (const hit of hits) {
    const parsed = parseAtUri(hit.uri);
    if (!parsed?.repo) continue;
    repos.add(parsed.repo);
  }
  return Array.from(repos);
}

/**
 * Record that the given hits were observed. Dedupes repos within a single
 * call so visiting a page with five posts from the same author bumps that
 * author's counter by one, not five.
 */
export async function recordInspectHits(hits: DetectedAtUri[]): Promise<void> {
  const repos = extractRepos(hits);
  if (repos.length === 0) return;

  const existing = await readEntries();
  const byRepo = new Map<string, InspectRepoEntry>();
  for (const e of existing) byRepo.set(e.repo, e);

  const now = Date.now();
  for (const repo of repos) {
    const prev = byRepo.get(repo);
    byRepo.set(repo, {
      repo,
      count: (prev?.count ?? 0) + 1,
      lastSeen: now,
    });
  }

  const next = Array.from(byRepo.values())
    .sort((a, b) => {
      // Frequency first, then recency.
      if (b.count !== a.count) return b.count - a.count;
      return b.lastSeen - a.lastSeen;
    })
    .slice(0, MAX_ENTRIES);

  await writeEntries(next);
}

/**
 * Read the stored entries, already sorted (frequency desc, then recency desc).
 */
export async function loadInspectRecentRepos(): Promise<InspectRepoEntry[]> {
  const entries = await readEntries();
  return entries.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return b.lastSeen - a.lastSeen;
  });
}

export async function clearInspectHistory(): Promise<void> {
  await writeEntries([]);
}
