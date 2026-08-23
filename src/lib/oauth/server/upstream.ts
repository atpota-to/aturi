/**
 * Facts about relaying an upstream HTTP response verbatim.
 *
 * Deliberately free of framework imports, so it can be unit-tested under plain
 * `node --test` — the Next-importing helpers next door cannot be.
 */

/**
 * Statuses the Response constructor refuses to pair with a body, including an
 * empty one: `new Response(new ArrayBuffer(0), { status: 204 })` throws. A
 * proxy that mirrors an upstream status must pass null for these, or a
 * perfectly good 204 from a PDS reaches the client as a 500.
 */
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

export function bodyForStatus(status: number, body: ArrayBuffer): ArrayBuffer | null {
  return NULL_BODY_STATUSES.has(status) ? null : body;
}
