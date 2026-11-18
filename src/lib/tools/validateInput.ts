/**
 * What was given to the record validator: the address of a record to fetch,
 * or a record pasted as JSON.
 */

import { resolveSearchPath } from '@/utils/atproto/searchRouting';

export type ValidatorInput =
  | { kind: 'uri'; uri: string; repo: string; collection: string; rkey: string }
  | { kind: 'json'; record: Record<string, unknown>; nsid: string }
  | { kind: 'error'; reason: string };

/**
 * Read the validator's input. Anything that starts with a brace is JSON;
 * everything else goes through the explorer's own link reader, so the same
 * at:// URIs and app links the search box accepts work here.
 */
export function parseValidatorInput(raw: string): ValidatorInput {
  const text = raw.trim();
  if (!text) return { kind: 'error', reason: 'Paste a record as JSON, or the at:// URI of one.' };

  if (text.startsWith('{')) {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch (err) {
      const detail = err instanceof Error ? err.message : 'it could not be parsed';
      return { kind: 'error', reason: `That is not valid JSON: ${detail}.` };
    }
    if (typeof value !== 'object' || value === null || Array.isArray(value)) {
      return { kind: 'error', reason: 'A record is a JSON object.' };
    }
    const record = value as Record<string, unknown>;
    // A getRecord response wraps the record; take what is inside.
    const inner =
      typeof record.uri === 'string' && typeof record.value === 'object' && record.value !== null && !Array.isArray(record.value)
        ? (record.value as Record<string, unknown>)
        : record;
    if (typeof inner.$type !== 'string' || !inner.$type) {
      return {
        kind: 'error',
        reason: 'The record has no $type, so there is no lexicon to check it against. Add "$type": "<the record’s NSID>".',
      };
    }
    return { kind: 'json', record: inner, nsid: inner.$type };
  }

  const path = resolveSearchPath(text);
  const match = path?.match(/^\/explore\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (!match) {
    return {
      kind: 'error',
      reason: 'That does not point at one record. Use an at:// URI with a collection and a record key, or a link to a record.',
    };
  }
  const [, repo, collection, rkey] = match.map(decodeURIComponent);
  return { kind: 'uri', uri: `at://${repo}/${collection}/${rkey}`, repo, collection, rkey };
}
