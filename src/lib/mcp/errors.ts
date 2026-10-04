/**
 * Error contract for MCP tools.
 *
 * Tool failures reuse the public API's ApiErrorCode enum so an agent that has
 * learned the REST surface (or read /openapi.json) can branch on the same
 * stable codes here. The body shape matches apiErrorBody() exactly; MCP adds
 * only the isError flag on the result envelope.
 *
 * Tools throw McpToolError for anticipated failures; toolFailure() maps
 * anything else to upstream_error / internal_error so an agent never sees a
 * bare stack trace.
 */

import { apiErrorBody, type ApiErrorCode } from '@/lib/apiError';

export class McpToolError extends Error {
  readonly code: ApiErrorCode;
  readonly hint?: string;

  constructor(code: ApiErrorCode, message: string, hint?: string) {
    super(message);
    this.name = 'McpToolError';
    this.code = code;
    this.hint = hint;
  }
}

export type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  structuredContent?: Record<string, unknown>;
  isError?: boolean;
};

/**
 * Errors thrown by the shared upstream helpers are network-shaped: fetch
 * TypeErrors, AbortSignal timeouts, and the `HTTP <status> …` errors the
 * protocol-layer clients throw on non-2xx responses. All of those mean "a
 * third-party host failed us", not "the tool is broken".
 */
function isUpstreamShaped(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  if (err.name === 'AbortError' || err.name === 'TimeoutError') return true;
  // res.json() on a 2xx whose body isn't JSON — a PDS/PLC serving an HTML
  // maintenance or interstitial page — throws SyntaxError. The tool layer
  // itself parses no JSON, so any SyntaxError here came from an upstream fetch.
  if (err.name === 'SyntaxError') return true;
  return /^HTTP \d{3}|fetch failed|network|ECONNRESET|ETIMEDOUT/i.test(err.message);
}

export function toolFailure(err: unknown): ToolResult {
  const body =
    err instanceof McpToolError
      ? apiErrorBody(err.code, err.message, err.hint)
      : isUpstreamShaped(err)
        ? apiErrorBody(
            'upstream_error',
            'An upstream atproto service failed or timed out',
            'Safe to retry once; if it persists, that service is likely down.',
          )
        : apiErrorBody('internal_error', 'Unexpected failure inside the tool');

  return {
    content: [{ type: 'text', text: JSON.stringify(body, null, 2) }],
    structuredContent: body,
    isError: true,
  };
}
