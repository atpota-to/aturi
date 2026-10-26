/**
 * Accept-header parsing for Markdown content negotiation
 * (https://acceptmarkdown.com/, RFC 9110 §12.5.1).
 *
 * The `Accept` header is a ranked list of preferences, not a string to
 * substring-match. Real Chrome sends
 * `text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*​/*;q=0.8`
 * — a naive `accept.includes('text/markdown')` is false there, but a naive
 * `*​/*` check would hand a browser a Markdown blob it renders as raw text.
 * Hence a real parser.
 *
 * Deliberately hand-written: the repo takes no new dependencies, and the rules
 * are small enough to state exactly.
 */

/** One parsed entry from an Accept header. */
type AcceptEntry = {
  type: string;
  subtype: string;
  /** Quality factor, 0–1. Absent means 1. */
  q: number;
};

/**
 * How precisely an offered type matched an Accept entry. Higher wins ties at
 * equal q, per RFC 9110: `text/markdown` beats `text/*` beats `*​/*`.
 */
const SPECIFICITY = { exact: 3, subtypeWildcard: 2, fullWildcard: 1, none: 0 } as const;

/**
 * Parse an Accept header into entries. Malformed entries are skipped rather
 * than throwing: a header we can't read is a header that shouldn't take the
 * site down.
 */
export function parseAcceptHeader(header: string): AcceptEntry[] {
  const entries: AcceptEntry[] = [];

  for (const raw of header.split(',')) {
    const parts = raw.trim().split(';');
    const mediaRange = parts[0]?.trim().toLowerCase();
    if (!mediaRange) continue;

    const slash = mediaRange.indexOf('/');
    if (slash < 1) continue;

    const type = mediaRange.slice(0, slash);
    const subtype = mediaRange.slice(slash + 1);
    if (!subtype) continue;

    // q defaults to 1 when absent. A malformed or out-of-range q is treated as
    // absent rather than as a rejection — the safer reading of a broken header.
    let q = 1;
    for (const param of parts.slice(1)) {
      const eq = param.indexOf('=');
      if (eq < 0) continue;
      if (param.slice(0, eq).trim().toLowerCase() !== 'q') continue;
      const parsed = Number.parseFloat(param.slice(eq + 1).trim());
      if (Number.isFinite(parsed) && parsed >= 0 && parsed <= 1) q = parsed;
    }

    entries.push({ type, subtype, q });
  }

  return entries;
}

/** Score one offered media type against the parsed Accept list. */
function scoreOffer(
  offer: string,
  entries: AcceptEntry[],
): { q: number; specificity: number } {
  const slash = offer.indexOf('/');
  const type = offer.slice(0, slash).toLowerCase();
  const subtype = offer.slice(slash + 1).toLowerCase();

  let best: { q: number; specificity: number } = {
    q: 0,
    specificity: SPECIFICITY.none,
  };

  for (const entry of entries) {
    let specificity: number = SPECIFICITY.none;
    if (entry.type === type && entry.subtype === subtype) {
      specificity = SPECIFICITY.exact;
    } else if (entry.type === type && entry.subtype === '*') {
      specificity = SPECIFICITY.subtypeWildcard;
    } else if (entry.type === '*' && entry.subtype === '*') {
      specificity = SPECIFICITY.fullWildcard;
    } else {
      continue;
    }

    // The most specific matching entry decides this offer's q, even when a
    // vaguer entry carries a higher one: `text/markdown;q=0, */*` means "not
    // Markdown", not "anything goes".
    if (specificity > best.specificity) {
      best = { q: entry.q, specificity };
    }
  }

  return best;
}

/**
 * Pick which of `offered` to serve, or null when none is acceptable (→ 406).
 *
 * `offered` is in server-preference order, which breaks exact ties — so a page
 * that lists HTML first keeps serving HTML to `Accept: *​/*` and to clients
 * that send no Accept header at all. Both of those mean "no constraint", not
 * "surprise me", and neither should flip a browser onto the Markdown variant.
 *
 * 406 is deliberately rare, per RFC 9110 §15.5.7 and the acceptmarkdown.com
 * guidance: it means "I tried every representation I have and you'll take none
 * of them", not "the header was unusual".
 */
export function selectRepresentation(
  acceptHeader: string | null | undefined,
  offered: readonly string[],
): string | null {
  if (offered.length === 0) return null;

  // Missing or empty Accept: no constraint. Serve the default.
  if (!acceptHeader || !acceptHeader.trim()) return offered[0];

  const entries = parseAcceptHeader(acceptHeader);
  if (entries.length === 0) return offered[0];

  const scored = offered.map(offer => ({ offer, ...scoreOffer(offer, entries) }));

  let winner: string | null = null;
  let winningScore = { q: 0, specificity: SPECIFICITY.none as number };

  for (const candidate of scored) {
    if (candidate.q <= 0) continue; // unmatched, or explicitly refused with q=0
    if (
      candidate.q > winningScore.q ||
      (candidate.q === winningScore.q && candidate.specificity > winningScore.specificity)
    ) {
      winner = candidate.offer;
      winningScore = { q: candidate.q, specificity: candidate.specificity };
    }
  }

  if (winner) return winner;

  // Nothing scored above zero. Two very different situations look alike here:
  //
  //   Accept: application/pdf        — a real request for something we can't
  //                                    produce. That's a 406.
  //   Accept: text/markdown;q=0      — "anything but Markdown". It names no
  //                                    positive preference at all, so it's a
  //                                    constraint, not a request; serve the
  //                                    default representation it didn't
  //                                    exclude.
  //
  // Treating the second as a 406 is the classic over-eager implementation the
  // spec warns about, and it would 406 on a header that is happy with HTML.
  if (entries.some(entry => entry.q > 0)) return null;

  // Exclusions only. specificity === none means the offer went unmentioned,
  // and so was never excluded.
  const unexcluded = scored.find(
    candidate => candidate.specificity === SPECIFICITY.none,
  );
  return unexcluded ? unexcluded.offer : null;
}
