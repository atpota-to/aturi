/**
 * What a search field's text looks like, for the small chip that names it as
 * you type ("Handle", "DID", …). A label only: routing stays with
 * resolveSearchTarget (src/utils/atproto/searchRouting.ts), and the order of
 * these checks follows its order so the chip names what a lookup will do.
 *
 * Returns null while the text doesn't yet read as anything, so half-typed
 * input ("did:", "dame.") shows no chip rather than a wrong one.
 */
export type InputKind = 'at:// URI' | 'URL' | 'PDS' | 'DID' | 'Handle';

export function inputKind(raw: string): InputKind | null {
  const v = raw.trim();
  if (!v) return null;
  if (/^at:\/\/\S+/i.test(v)) return 'at:// URI';
  if (/^https?:\/\/[^\s/]+\.[^\s/]+/i.test(v)) return 'URL';
  // Same shape as looksLikeBarePdsHostname: `pds.<domain>`, no path.
  if (/^pds\.[^\s./]+\.[^\s/]+$/i.test(v)) return 'PDS';
  if (/^did:(plc|web):\S+/i.test(v)) return 'DID';
  if (/^@?[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(v)) return 'Handle';
  return null;
}
