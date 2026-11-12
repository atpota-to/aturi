import { NextResponse } from 'next/server';
import { apiErrorBody, type ApiErrorCode } from '@/lib/apiError';

/**
 * Responses for the tool routes under /api/tools.
 *
 * These routes serve the tool pages and nothing else: they are not part of
 * the public API (/openapi.json), carry no CORS headers, and sit behind the
 * `/api/` disallow in robots.txt. Failures still use the public API's error
 * body, so the pages branch on the same `code` everything else does.
 *
 * Results are cached briefly at the edge. A tool page runs its check on load
 * when the input is in its link, so a shared link would otherwise cost one
 * function call per visit, crawlers that run scripts included.
 */
export function toolJson(body: unknown, cacheSeconds: number): NextResponse {
  return NextResponse.json(body, {
    status: 200,
    headers: {
      'Cache-Control':
        cacheSeconds > 0
          ? `public, max-age=${cacheSeconds}, s-maxage=${cacheSeconds}, stale-while-revalidate=${cacheSeconds * 2}`
          : 'no-store',
      'X-Robots-Tag': 'noindex',
    },
  });
}

export function toolError(status: number, code: ApiErrorCode, message: string, hint?: string): NextResponse {
  return NextResponse.json(apiErrorBody(code, message, hint), {
    status,
    headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' },
  });
}
