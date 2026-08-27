/**
 * The checks that stand between a stranger's post and something published
 * under the operator's handle.
 *
 * The threat is not that someone asks a rude question. It is that the text of
 * a mention is the input to a model whose output is then posted, publicly,
 * by an account that is not theirs. Prompt framing alone is not a control —
 * it is an instruction to something that can be argued with. The controls
 * that actually hold are the ones enforced in code: what facets can exist at
 * all (see format.ts), how often one account can make this thing speak, and
 * how much it can say in an hour.
 */

import type { Config } from './config.ts';

const HOUR_MS = 60 * 60 * 1000;

/**
 * A sliding-window counter, in memory.
 *
 * In memory is the right scope: it bounds a single process's output, which is
 * what an hourly cap is for, and the dedupe pass in bluesky.ts — which reads
 * the repo, not this map — is what survives a restart. A counter that reset on
 * deploy would be a problem if it were the only thing preventing a repeat; it
 * is not.
 */
export class SlidingWindow {
  private readonly hits = new Map<string, number[]>();

  /** Records a hit and reports whether it was within the limit. */
  take(key: string, limit: number, now = Date.now()): boolean {
    const cutoff = now - HOUR_MS;
    const kept = (this.hits.get(key) ?? []).filter((at) => at > cutoff);
    if (kept.length >= limit) {
      this.hits.set(key, kept);
      return false;
    }
    kept.push(now);
    this.hits.set(key, kept);
    return true;
  }

  /** Drops keys whose hits have all aged out, so the map cannot grow forever. */
  prune(now = Date.now()): void {
    const cutoff = now - HOUR_MS;
    for (const [key, times] of this.hits) {
      const kept = times.filter((at) => at > cutoff);
      if (kept.length === 0) this.hits.delete(key);
      else this.hits.set(key, kept);
    }
  }
}

export type Author = { did: string; handle: string };

export type Verdict = { ok: true } | { ok: false; reason: string };

/**
 * Who this account will answer, before any model is involved. Blocklist wins
 * over allowlist so that one entry is always enough to stop an account.
 */
export function screenAuthor(config: Config, author: Author): Verdict {
  const did = author.did.toLowerCase();
  const handle = author.handle.toLowerCase();

  if (config.blocklist.has(did) || config.blocklist.has(handle)) {
    return { ok: false, reason: 'blocklisted' };
  }
  if (
    config.allowlist.size > 0 &&
    !config.allowlist.has(did) &&
    !config.allowlist.has(handle)
  ) {
    return { ok: false, reason: 'not on allowlist' };
  }
  return { ok: true };
}

/**
 * Does the reply contain a verbatim stretch of the instructions?
 *
 * The classic extraction attack ends with the model reciting its own system
 * prompt, and the tell is a long exact run of it. Eight words is long enough
 * that ordinary prose about the Atmosphere will not trip it and short enough
 * to catch a partial recitation. This is a backstop for a prompt that already
 * refuses; it is not the reason the prompt refuses.
 */
export function leaksInstructions(output: string, system: string): boolean {
  const normalise = (text: string) =>
    text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').split(/\s+/).filter(Boolean);

  const needle = normalise(output);
  if (needle.length < 8) return false;
  const haystack = normalise(system).join(' ');

  for (let i = 0; i + 8 <= needle.length; i += 1) {
    if (haystack.includes(needle.slice(i, i + 8).join(' '))) return true;
  }
  return false;
}
