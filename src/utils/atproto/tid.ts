/**
 * Wrapper around `@atproto/common-web`'s `TID` class — gives us a
 * forgiving `tidToDate()` that returns `null` for non-TID rkeys
 * (custom strings, singletons like `self`) instead of throwing.
 *
 * Using the upstream parser keeps us in lockstep with the spec; the
 * 13-char base32-sortable encoding and the (53-bit timestamp / 10-bit
 * clock-id) split are owned there.
 */

import { TID } from '@atproto/common-web';

const TID_CHAR_REGEX = /^[234567abcdefghijklmnopqrstuvwxyz]{13}$/;

/**
 * Quick syntactic check — used by callers that want to render many
 * rkeys without paying the construction cost on obviously-non-TID
 * strings. `TID.is()` upstream only checks length, not the alphabet,
 * so we pre-filter ourselves.
 */
export function looksLikeTid(input: string): boolean {
  return TID_CHAR_REGEX.test(input);
}

/**
 * Decode a TID rkey to a Date. Returns `null` when the input isn't a
 * well-formed TID or the decoded time falls outside a sane range — a
 * misencoded value could otherwise place the record in the year
 * 5000+ and the UI would happily render the nonsense.
 */
export function tidToDate(rkey: string): Date | null {
  if (!looksLikeTid(rkey)) return null;
  let micros: number;
  try {
    micros = TID.fromStr(rkey).timestamp();
  } catch {
    return null;
  }
  if (!Number.isFinite(micros) || micros <= 0) return null;
  const millis = Math.floor(micros / 1000);
  const date = new Date(millis);
  const year = date.getUTCFullYear();
  // Atproto launched in 2022. Anything well outside [2020, current+10]
  // is almost certainly a non-TID rkey that happens to pass the alphabet
  // check; treat it as not-a-TID rather than render a misleading date.
  const now = new Date().getUTCFullYear();
  if (year < 2020 || year > now + 10) return null;
  return date;
}

/**
 * Render a TID-derived date in a list-friendly way: recent dates get a
 * relative chip ("12m ago", "3d ago"); older dates get an ISO calendar
 * date so a six-month-old record doesn't read as "189d ago". Callers
 * typically pair this with a `title={date.toISOString()}` for the
 * exact timestamp on hover.
 */
export function formatTidRelative(date: Date): string {
  const diffMs = Date.now() - date.getTime();
  if (diffMs < 0) return date.toISOString().slice(0, 10);
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 14) return `${day}d ago`;
  return date.toISOString().slice(0, 10);
}
