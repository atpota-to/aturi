/**
 * AT URI normalization for the AppView-backed tools.
 *
 * The Bluesky AppView indexes records under DID authorities only. Handed a
 * handle-form URI (`at://alice.example/app.bsky.feed.post/3k…`) it answers
 * HTTP 200 with an empty result rather than an error, which an agent reads as
 * "nobody engaged with this" instead of "you passed the wrong identifier".
 *
 * That shape is not hypothetical: resolve_link returns handle-form URIs, and
 * several tool descriptions tell the agent to feed resolve_link's output
 * straight in. So every tool that forwards a caller's URI to the AppView
 * normalizes the authority first, and a handle that does not resolve becomes
 * an explicit not_found instead of a confident wrong answer.
 */

import { resolveHandle } from '@/utils/atproto/identity';
import { parseAtUri, toAtUri } from '@/utils/atproto/urls';
import { McpToolError } from '@/lib/mcp/errors';

function requireRecordUri(uri: string, what: string) {
  const trimmed = uri.trim();
  if (!trimmed.startsWith('at://')) {
    throw new McpToolError(
      'invalid_parameter',
      `${what} must be an at:// URI`,
      'resolve_link converts a web URL into one.',
    );
  }
  const parsed = parseAtUri(trimmed);
  if (!parsed || parsed.space || !parsed.collection || !parsed.rkey) {
    throw new McpToolError(
      'invalid_parameter',
      `${what} is not a full record URI`,
      'Expected at://<did-or-handle>/<collection>/<rkey>.',
    );
  }
  return parsed;
}

/** Normalize one record URI's authority to a DID. */
export async function normalizeRecordUri(uri: string, what: string): Promise<string> {
  const parsed = requireRecordUri(uri, what);
  if (parsed.repo.startsWith('did:')) {
    return toAtUri({ did: parsed.repo, collection: parsed.collection, rkey: parsed.rkey });
  }
  const did = await resolveHandle(parsed.repo);
  if (!did) {
    throw new McpToolError(
      'not_found',
      `Could not resolve the handle "${parsed.repo}" in ${what}`,
      'Check the handle, or pass the DID form of the URI.',
    );
  }
  return toAtUri({ did, collection: parsed.collection, rkey: parsed.rkey });
}

/**
 * Normalize a batch, resolving each distinct handle once. Returns the
 * normalized URIs in input order alongside a map from the original URI, so a
 * caller can still report results against what it was given.
 */
export async function normalizeRecordUris(
  uris: readonly string[],
  what: string,
): Promise<{ normalized: string[]; byOriginal: Map<string, string> }> {
  const parsed = uris.map((uri) => ({ original: uri, parts: requireRecordUri(uri, what) }));
  const handles = [...new Set(parsed.map((p) => p.parts.repo).filter((r) => !r.startsWith('did:')))];
  const resolved = new Map<string, string | null>();
  await Promise.all(
    handles.map(async (handle) => {
      resolved.set(handle, await resolveHandle(handle));
    }),
  );

  const byOriginal = new Map<string, string>();
  const normalized = parsed.map(({ original, parts }) => {
    const did = parts.repo.startsWith('did:') ? parts.repo : resolved.get(parts.repo);
    if (!did) {
      throw new McpToolError(
        'not_found',
        `Could not resolve the handle "${parts.repo}" in ${what}`,
        'Check the handle, or pass the DID form of the URI.',
      );
    }
    const uri = toAtUri({ did, collection: parts.collection, rkey: parts.rkey });
    byOriginal.set(original, uri);
    return uri;
  });
  return { normalized, byOriginal };
}
