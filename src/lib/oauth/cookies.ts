/**
 * Cookie names shared by the browser and the server.
 *
 * Deliberately free of a 'use client' directive and of any import, so both
 * sides can read it without dragging a module across the boundary. A name
 * spelled twice would fail silently — the server would set a cookie the client
 * never looks for, and the session probe would simply never fire.
 */

/**
 * Carries no secret. It says only that a backend session probably exists, so
 * an anonymous visitor can skip the session round trip on every page load.
 */
export const SIGNED_IN_HINT_COOKIE = 'aturi_signed_in';
