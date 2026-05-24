import { CRED_BLUE_API } from '@/utils/atproto/config';

export type CredBlueScore = {
  handle: string;
  did: string;
  scores: {
    combined: number;
    bluesky: number;
    atproto: number;
  };
  cachedAt?: string;
  version?: string;
  source?: 'memory' | 'supabase';
  ageMs?: number;
};

/**
 * Fetches a cached cred.blue score for the given handle or DID.
 * Returns null when no cached score exists (HTTP 204) or on any error —
 * the endpoint will not trigger a fresh compute on the backend.
 */
export async function fetchCachedCredBlueScore(
  identifier: string,
): Promise<CredBlueScore | null> {
  if (!identifier) return null;
  const cleaned = identifier.replace(/^@/, '');
  const url = `${CRED_BLUE_API}/api/score/${encodeURIComponent(cleaned)}`;
  try {
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (res.status === 204 || res.status === 404) return null;
    if (!res.ok) return null;
    return (await res.json()) as CredBlueScore;
  } catch {
    return null;
  }
}
