/**
 * AT Protocol TID (timestamp identifier) helpers.
 *
 * TIDs are 13-character base32-sortable identifiers used as rkeys (and
 * elsewhere) across atproto. The 64 bits decode to:
 *
 *   bit 0       — always 0 (reserved for sortability under signed int64)
 *   bits 1–53   — microseconds since the Unix epoch (UTC)
 *   bits 54–63  — 10-bit clock identifier
 *
 * The base32 alphabet is the deterministic sortable variant:
 * `234567abcdefghijklmnopqrstuvwxyz`. We do the decode with BigInt so
 * we don't lose precision across the boundary between the microsecond
 * field and the clock id; the final Date is created from milliseconds
 * (microseconds / 1000) so it stays a normal JS Date.
 *
 * Pure parsing — no network. Returns `null` for inputs that don't
 * look like a TID, so callers can use it speculatively on any rkey.
 */

const TID_ALPHABET = '234567abcdefghijklmnopqrstuvwxyz';
const TID_LENGTH = 13;
const TID_CHAR_REGEX = /^[234567abcdefghijklmnopqrstuvwxyz]{13}$/;

const CHAR_VALUE: Record<string, number> = (() => {
  const m: Record<string, number> = {};
  for (let i = 0; i < TID_ALPHABET.length; i++) m[TID_ALPHABET[i]] = i;
  return m;
})();

/**
 * Quick syntactic check. Use this to decide whether to call `tidToDate`
 * at all (e.g. when rendering many rkeys); the rkey could be a custom
 * string in some collections rather than a TID.
 */
export function looksLikeTid(input: string): boolean {
  return TID_CHAR_REGEX.test(input);
}

/**
 * Decode a TID rkey to a Date. Returns `null` if the input isn't a
 * well-formed TID or the decoded time falls outside a reasonable range
 * (a misencoded value could otherwise place the record in the year
 * 5000+ and the UI would render nonsense).
 */
export function tidToDate(rkey: string): Date | null {
  if (!looksLikeTid(rkey)) return null;

  // BigInt() over the constants keeps the file compatible with the
  // project's ES2017 TS target (which forbids the `0n` literal syntax)
  // without losing the precision we need across the 64-bit decode.
  const FIVE = BigInt(5);
  const TEN = BigInt(10);
  const ONE_THOUSAND = BigInt(1000);

  let value = BigInt(0);
  for (let i = 0; i < TID_LENGTH; i++) {
    const v = CHAR_VALUE[rkey[i]];
    if (v === undefined) return null;
    value = (value << FIVE) | BigInt(v);
  }

  // Drop the 10-bit clock identifier, leaving microseconds since epoch.
  const micros = value >> TEN;
  const millis = Number(micros / ONE_THOUSAND);
  if (!Number.isFinite(millis) || millis <= 0) return null;

  const date = new Date(millis);
  const year = date.getUTCFullYear();
  // Atproto launched in 2022. Anything well outside [2020, current+10]
  // is almost certainly a non-TID rkey that happens to pass the alphabet
  // check; treat it as not-a-TID rather than render a misleading date.
  const now = new Date().getUTCFullYear();
  if (year < 2020 || year > now + 10) return null;

  return date;
}
