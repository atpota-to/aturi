/**
 * Shared error body for the public JSON API.
 *
 * Every public endpoint under /api answers failures with the same shape so a
 * caller — increasingly an LLM agent rather than a person — can branch on a
 * stable machine-readable `code` instead of pattern-matching English prose,
 * and can act on `hint` without re-reading the docs:
 *
 *   { "ok": false, "code": "missing_parameter",
 *     "error": "Missing url parameter",
 *     "hint": "Pass ?url=<page-url> or ?atUri=at://<did>/<collection>/<rkey>." }
 *
 * `error` is the pre-existing field and keeps its exact meaning, so callers
 * written against the older shape keep working; `code` and `hint` are purely
 * additive. The set of codes is closed and documented in /openapi.json — add a
 * member here and to the ApiErrorCode schema there in the same change.
 */

export type ApiErrorCode =
  /** A required query parameter was absent. */
  | 'missing_parameter'
  /** A parameter was present but malformed, out of range, or disallowed. */
  | 'invalid_parameter'
  /** The requested response format isn't implemented. */
  | 'unsupported_format'
  /** The request was well-formed but the thing asked for doesn't exist. */
  | 'not_found'
  /** A third-party host we had to call failed, timed out, or refused. */
  | 'upstream_error'
  /** An unhandled fault on our side. */
  | 'internal_error';

export type ApiErrorBody = {
  ok: false;
  code: ApiErrorCode;
  error: string;
  hint?: string;
};

/**
 * Build the body for a failed API response. `hint` is omitted rather than set
 * to null when there's nothing useful to say, so its presence always means
 * there is a concrete next step to take.
 */
export function apiErrorBody(
  code: ApiErrorCode,
  error: string,
  hint?: string,
): ApiErrorBody {
  return hint ? { ok: false, code, error, hint } : { ok: false, code, error };
}
