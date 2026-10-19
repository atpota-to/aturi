import { apiErrorBody } from '@/lib/apiError';
import { findNewLexicons, UFOS_HISTORY_BEGINS } from '@/lib/lexiconTrends';
import { McpToolError } from '@/lib/mcp/errors';
import type { Window } from '@/utils/ufos/windows';

/**
 * New lexicons for the explorer's "New lexicons" section: the answer
 * list_new_lexicons gives, computed here behind the CDN rather than in each
 * visitor's browser, because one answer costs UFOs around thirty requests.
 * Node runtime, like /api/mcp, which already runs this code.
 *
 * Not part of the documented REST API (src/lib/openapi.ts). Its shape follows
 * the explorer section and can change with it.
 */

const WINDOW_CHOICES: Window[] = ['1d', '7d', '30d'];
const MIN_ACCOUNTS = 3;
const LIMIT = 50;
/** UFOs rolls counts up hourly; half an hour at the edge loses little. */
const CACHE_SECONDS = 1800;

export async function GET(request: Request) {
  const window = new URL(request.url).searchParams.get('window') ?? '7d';
  if (!WINDOW_CHOICES.includes(window as Window)) {
    return Response.json(
      apiErrorBody('invalid_parameter', `Unknown window. Expected one of: ${WINDOW_CHOICES.join(', ')}`),
      { status: 400 },
    );
  }

  try {
    const found = await findNewLexicons(window as Window, MIN_ACCOUNTS);
    return Response.json(
      {
        ok: true,
        window,
        since: found.since,
        minAccounts: MIN_ACCOUNTS,
        historyBegins: UFOS_HISTORY_BEGINS,
        count: found.lexicons.length,
        lexicons: found.lexicons.slice(0, LIMIT).map((c) => ({
          nsid: c.nsid,
          creates: c.creates ?? 0,
          didsEstimate: c.dids_estimate ?? 0,
        })),
      },
      {
        headers: {
          'Cache-Control': `public, max-age=${CACHE_SECONDS}, s-maxage=${CACHE_SECONDS}, stale-while-revalidate=${CACHE_SECONDS * 6}`,
        },
      },
    );
  } catch (err) {
    const body =
      err instanceof McpToolError
        ? apiErrorBody(err.code, err.message, err.hint)
        : apiErrorBody('upstream_error', 'The UFOs lexicon-stats service is unavailable');
    return Response.json(body, {
      status: body.code === 'invalid_parameter' ? 400 : 502,
      headers: { 'Cache-Control': 'no-store' },
    });
  }
}
