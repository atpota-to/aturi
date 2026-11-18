'use client';

import { useEffect, useState } from 'react';
import { APPVIEW, HANDLE_RESOLVER_FALLBACK } from '@/utils/atproto/config';
import { TTLMap } from '@/utils/atproto/cache';

/**
 * Whether a handle resolves back to the DID that claims it.
 *
 * The explorer reads an account's handle from its PDS or its DID document,
 * and both are the account's own claim. A handle is only good when the
 * domain agrees, so this asks a resolver the other half of the question.
 *
 * `verified`    the handle resolves to this DID.
 * `mismatch`    it resolves to a different DID: the name belongs to someone else now.
 * `unresolved`  it resolves to nothing, which is what apps show as handle.invalid.
 * `unknown`     the resolvers could not be reached; say nothing rather than guess.
 *
 * Unlike `resolveHandle` (identity.ts), this keeps "does not resolve" apart
 * from "could not ask": the first is worth a warning and the second is not.
 * The full step-by-step check is the handle debugger's job (/tools/handle).
 */
export type HandleVerification = 'pending' | 'verified' | 'mismatch' | 'unresolved' | 'unknown';

type Settled = Exclude<HandleVerification, 'pending'>;

const cache = new TTLMap<string, Settled>(5 * 60_000);
const inflight = new Map<string, Promise<Settled>>();

/** `did` when the host resolves the handle, `null` when it says there is none, `undefined` when it could not say. */
async function ask(host: string, handle: string): Promise<string | null | undefined> {
  try {
    const res = await fetch(
      `${host}/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(handle)}`,
    );
    if (res.ok) {
      const body = (await res.json()) as { did?: string };
      return typeof body.did === 'string' ? body.did : undefined;
    }
    // A 400 is the resolver answering: it looked and found no DID.
    return res.status === 400 ? null : undefined;
  } catch {
    return undefined;
  }
}

async function verify(did: string, handle: string): Promise<Settled> {
  if (handle === 'handle.invalid') return 'unresolved';
  let sawNone = false;
  for (const host of [APPVIEW, HANDLE_RESOLVER_FALLBACK]) {
    const resolved = await ask(host, handle);
    if (resolved) return resolved === did ? 'verified' : 'mismatch';
    if (resolved === null) sawNone = true;
  }
  return sawNone ? 'unresolved' : 'unknown';
}

export function verifyHandle(did: string, handle: string): Promise<Settled> {
  const key = `${did} ${handle.toLowerCase()}`;
  const hit = cache.get(key);
  if (hit) return Promise.resolve(hit);
  const pending = inflight.get(key);
  if (pending) return pending;
  const next = verify(did, handle.toLowerCase())
    .then((answer) => {
      // An answer is kept; a failure to ask is tried again next time.
      if (answer !== 'unknown') cache.set(key, answer);
      return answer;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, next);
  return next;
}

export function useHandleVerification(did: string, handle: string | null | undefined): HandleVerification {
  const [state, setState] = useState<{ key: string; value: Settled } | null>(null);
  const key = handle ? `${did} ${handle}` : null;

  useEffect(() => {
    if (!key || !handle) return undefined;
    let cancelled = false;
    verifyHandle(did, handle).then((value) => {
      if (!cancelled) setState({ key, value });
    });
    return () => {
      cancelled = true;
    };
  }, [did, handle, key]);

  if (!key) return 'unknown';
  return state?.key === key ? state.value : 'pending';
}
