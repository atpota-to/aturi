/**
 * Result plumbing shared by every MCP tool.
 *
 * Success payloads are plain JSON objects returned twice in one result: as
 * pretty-printed text (what most clients feed the model) and as
 * structuredContent (what 2026-era clients consume directly). Keeping the two
 * identical means there is exactly one output contract per tool.
 *
 * toolHandler() is the only place try/catch lives; individual tools just
 * throw McpToolError (or let upstream errors propagate) and return data.
 */

import { getSiteUrl } from '@/lib/config';
import { encodeRepo } from '@/utils/atproto/urls';
import { apiErrorBody } from '@/lib/apiError';
import { toolFailure, type ToolResult } from '@/lib/mcp/errors';

/**
 * Ceiling on a single tool result.
 *
 * Most payloads are shaped by an upstream this server does not control: a
 * record is whatever its author wrote, and a repo on an attacker-run PDS can
 * answer a legal `list_records` call with megabytes. Unbounded, one call
 * floods the caller's context window and costs them real money. Tools that can
 * predict their own size trim first (get_lexicon_schema, sample_jetstream);
 * this is the net under all of them, including tools added later.
 *
 * A megabyte is deliberately more than one caller's context window can hold,
 * and that is the right place to draw it. This limit exists to stop a payload
 * nobody could have wanted, not to size the caller's context — they already
 * control that with `limit`, and they are the only ones who know their budget.
 * Drawn tight, it refuses instead: a full page of long-form records (whtwnd
 * entries, lexicon documents) is an honest request that used to come back as
 * an error, which is a worse answer than a large one.
 *
 * For scale: 100 posts with full records, the largest result measured on the
 * Bluesky tools, is about 200KB.
 */
const MAX_RESULT_BYTES = 1_000_000;

export function okResult(data: Record<string, unknown>): ToolResult {
  const body = { ok: true, ...data };
  const text = JSON.stringify(body, null, 2);

  if (text.length > MAX_RESULT_BYTES) {
    // Refuse rather than truncate: half a record is worse than none, and the
    // caller can always ask for less.
    const overflow = apiErrorBody(
      'invalid_parameter',
      `This result is ${Math.round(text.length / 1000)}KB, over the ${Math.round(MAX_RESULT_BYTES / 1000)}KB limit for one call`,
      'Ask for less: lower `limit`, narrow the collection, or page with the cursor.',
    );
    return {
      content: [{ type: 'text', text: JSON.stringify(overflow, null, 2) }],
      structuredContent: overflow,
      isError: true,
    };
  }

  return {
    content: [{ type: 'text', text }],
    structuredContent: body,
  };
}

export function toolHandler<Args>(
  fn: (args: Args) => Promise<Record<string, unknown>>,
): (args: Args) => Promise<ToolResult> {
  return async (args: Args) => {
    try {
      return okResult(await fn(args));
    } catch (err) {
      return toolFailure(err);
    }
  };
}

/**
 * Every tool that names a record or an account also hands back URLs a human
 * can open, per the plan's "every result is addressable" principle. Built on
 * getSiteUrl() so forks link to themselves.
 */
export function profileLink(identifier: string): string {
  return `${getSiteUrl()}/profile/${encodeRepo(identifier)}`;
}

export function recordLink(
  identifier: string,
  collection: string,
  rkey: string,
): string {
  return `${getSiteUrl()}/profile/${encodeRepo(identifier)}/${encodeURIComponent(
    collection,
  )}/${encodeURIComponent(rkey)}`;
}

export function exploreLink(path: string): string {
  return `${getSiteUrl()}/explore${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Absolute site URL for an already-rooted path (e.g. the output of
 * explorePathFromAtUri, which includes its own /explore prefix).
 */
export function siteLink(path: string): string {
  return `${getSiteUrl()}${path.startsWith('/') ? path : `/${path}`}`;
}

/**
 * Shared read-only annotations. Every tool in this server reads public
 * network data and writes nothing; openWorldHint is true because results
 * come from external services, not a closed corpus.
 */
export const READ_ONLY = {
  readOnlyHint: true,
  idempotentHint: true,
  openWorldHint: true,
} as const;
