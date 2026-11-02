/**
 * Query parsing and ranking for the command palette.
 *
 * Pure, like `keybindings.ts`, so the matching rules are unit-tested rather
 * than eyeballed: what a prefix means, which rows a query matches, and in what
 * order. The palette component only renders what these return.
 */

import { isValidNsid } from '@/utils/atproto/spaceUri';

/**
 * A leading character narrows the palette to one source, the way `>` does in
 * an editor's palette. Without one it searches everything at once.
 *
 *   >  commands only
 *   @  people (handle and display-name typeahead)
 *   #  lexicons (NSIDs and namespaces)
 */
export type PaletteMode = 'all' | 'commands' | 'people' | 'lexicons';

export const PALETTE_PREFIXES: { prefix: string; mode: PaletteMode; label: string }[] = [
  { prefix: '>', mode: 'commands', label: 'commands' },
  { prefix: '@', mode: 'people', label: 'people' },
  { prefix: '#', mode: 'lexicons', label: 'lexicons' },
];

export type ParsedPaletteQuery = {
  mode: PaletteMode;
  /** The query with any mode prefix removed, trimmed. */
  text: string;
};

export function parsePaletteQuery(raw: string): ParsedPaletteQuery {
  const trimmed = raw.trimStart();
  for (const { prefix, mode } of PALETTE_PREFIXES) {
    if (trimmed.startsWith(prefix)) {
      // `@handle` is how people write a handle, so the people prefix keeps
      // nothing of it but the handle; the others drop their sigil the same way.
      return { mode, text: trimmed.slice(prefix.length).trim() };
    }
  }
  return { mode: 'all', text: raw.trim() };
}

function words(value: string): string[] {
  return value.split(/[^a-z0-9]+/).filter(Boolean);
}

/** Every character of `term` is the first letter of a later word, in order. */
function matchesInitials(term: string, labelWords: string[]): boolean {
  let at = 0;
  for (const ch of term) {
    while (at < labelWords.length && labelWords[at][0] !== ch) at++;
    if (at === labelWords.length) return false;
    at++;
  }
  return true;
}

function termScore(
  term: string,
  label: string,
  labelWords: string[],
  keywords: string[],
  extra: string,
): number {
  if (label.startsWith(term)) return 100;
  if (labelWords.some((w) => w.startsWith(term))) return 80;
  if (label.includes(term)) return 60;
  if (keywords.some((k) => k.startsWith(term))) return 50;
  if (keywords.some((k) => k.includes(term))) return 40;
  if (extra && extra.includes(term)) return 25;
  // Initials only, not any scattered subsequence: "gtl" finds "Go to
  // lexicons", but "dame" doesn't find "Use dark theme" by way of its d, a,
  // m and e, which would bury the people results under nonsense.
  if (term.length >= 2 && matchesInitials(term, labelWords)) return 15;
  return -1;
}

/**
 * How well `query` matches a row, or -1 for no match. Every whitespace-split
 * term has to hit the label, a keyword or `extra` (the group name, say), so
 * "theme dark" finds "Use dark theme". A label that starts with the whole
 * query outranks everything but an exact match.
 */
export function matchScore(
  query: string,
  label: string,
  keywords: readonly string[] = [],
  extra = '',
): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const l = label.toLowerCase();
  if (l === q) return 1000;

  const labelWords = words(l);
  const kws = keywords.map((k) => k.toLowerCase());
  const ex = extra.toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);

  let total = 0;
  for (const term of terms) {
    const s = termScore(term, l, labelWords, kws, ex);
    if (s < 0) return -1;
    total += s;
  }
  return total / terms.length + (l.startsWith(q) ? 200 : 0);
}

/**
 * Text that names a place rather than a command: a handle or NSID (has a
 * dot), a DID, an at:// URI or a URL. Gates the "Go to" row so filtering
 * commands by "toggle theme" — or "settings:" — doesn't sprout a navigation
 * row. A bare colon isn't enough; only DIDs and schemes carry one.
 */
export function looksLikeTarget(text: string): boolean {
  const t = text.trim();
  if (!t || /\s/.test(t)) return false;
  return t.includes('.') || t.includes('/') || /^(did|at):/i.test(t);
}

/**
 * First NSID segments that are top-level domains, so "app.bsky.feed.post"
 * reads as a lexicon before it reads as a handle. Only orders the two rows;
 * both are offered, since `alice.bsky.social` is a valid NSID too.
 */
const NSID_AUTHORITY_TLDS = new Set([
  'app', 'blue', 'ca', 'chat', 'club', 'co', 'com', 'community', 'de', 'dev',
  'eu', 'fm', 'fr', 'fyi', 'garden', 'io', 'is', 'link', 'me', 'net', 'network',
  'org', 'page', 'place', 'pub', 'sh', 'site', 'so', 'social', 'space', 'systems',
  'tech', 'to', 'tv', 'uk', 'us', 'world', 'xyz',
]);

export type NsidLikelihood = 'likely' | 'possible' | 'no';

/**
 * Whether text could be a lexicon NSID, and whether it's more likely one than
 * a handle. Text with a scheme, a slash or an `@` is never an NSID.
 */
export function nsidLikelihood(text: string): NsidLikelihood {
  const t = text.trim();
  if (!t || /[:/@\s]/.test(t)) return 'no';
  if (!isValidNsid(t)) return 'no';
  const first = t.split('.')[0].toLowerCase();
  return NSID_AUTHORITY_TLDS.has(first) ? 'likely' : 'possible';
}

/**
 * Whether a query should go to the people typeahead. The `@` mode always does
 * (two characters minimum, the appview's own floor). The mixed mode does only
 * for a single word that isn't a DID or URI: handles never contain spaces,
 * and a multi-word query is far more often a command than a display name.
 */
export function wantsPeopleSearch(mode: PaletteMode, text: string): boolean {
  const t = text.trim().replace(/^@/, '');
  if (t.length < 2) return false;
  if (t.startsWith('did:') || t.startsWith('at://') || /^https?:/i.test(t)) return false;
  if (mode === 'people') return true;
  if (mode !== 'all') return false;
  return !/\s/.test(t) && !t.includes('/');
}

/** UFOs' lexicon search needs two alphanumerics, like the lexicons page box. */
export function wantsLexiconSearch(mode: PaletteMode, text: string): boolean {
  return mode === 'lexicons' && (text.match(/[a-z0-9-]/gi) || []).length >= 2;
}
