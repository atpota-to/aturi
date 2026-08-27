/**
 * Turning model output into something Bluesky will accept and render.
 *
 * Two jobs, and the second is a security control rather than a cosmetic one:
 *
 * 1. Fit the text. app.bsky.feed.post caps at 300 graphemes and 3000 bytes.
 *    Graphemes, not code points and not UTF-16 units, so a family emoji is one
 *    unit and `String.length` is the wrong ruler; Intl.Segmenter is the right
 *    one and is in Node 22 without a flag.
 *
 * 2. Build the facets by hand, and build only link facets. Facets are what
 *    make a post *do* something — a mention facet notifies an account whether
 *    or not its handle appears in the text. Handing generated text to a
 *    facet detector means anything that can steer the model can also make
 *    this account tag arbitrary people. Nothing here emits a mention or tag
 *    facet, so that capability does not exist to be abused. Replies notify
 *    the person being replied to on their own; no mention facet is needed for
 *    the bot to work.
 */

const POST_GRAPHEME_LIMIT = 300;
const POST_BYTE_LIMIT = 3000;
/** Longest a link's *display* text may be before it is abbreviated. */
const LINK_DISPLAY_LIMIT = 32;
/** Facets per post. A reply that is mostly links is spam, whoever asked for it. */
const MAX_LINKS_PER_POST = 4;
const MAX_URI_LENGTH = 2000;

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const encoder = new TextEncoder();

export type Link = { display: string; uri: string };

export type Facet = {
  index: { byteStart: number; byteEnd: number };
  features: { $type: 'app.bsky.richtext.facet#link'; uri: string }[];
};

export function graphemeLength(text: string): number {
  let count = 0;
  for (const _ of segmenter.segment(text)) count += 1;
  return count;
}

function graphemes(text: string): string[] {
  return Array.from(segmenter.segment(text), (segment) => segment.segment);
}

/**
 * Cut to at most `limit` graphemes, and to the byte cap as well — a string of
 * ZWJ sequences can clear 300 graphemes and still blow past 3000 bytes, which
 * the PDS rejects with a validation error rather than a truncation.
 */
function clamp(text: string, limit: number): string {
  const units = graphemes(text);
  let out = units.length > limit ? units.slice(0, limit).join('') : text;
  while (encoder.encode(out).length > POST_BYTE_LIMIT) {
    out = graphemes(out).slice(0, -1).join('');
  }
  return out;
}

/**
 * Markdown a model emits out of habit, rendered down to plain text.
 *
 * Bluesky has no rich text of its own — asterisks post as asterisks and a
 * `[label](url)` posts as literal brackets with the URL buried where nobody
 * can click it. The link case is the one that matters: unwrapping it puts the
 * URL back in the text where the facet builder can find it.
 */
export function stripMarkdown(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1 $2')
    .replace(/(\*\*|__)(?=\S)([^]*?\S)\1/g, '$2')
    .replace(/(^|\s)[*_](?=\S)([^*_\n]+?\S)[*_](?=\s|$)/g, '$1$2')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^\s*[-*]\s+/gm, '• ')
    .replace(/`([^`\n]+)`/g, '$1')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Drop the `@` from anything handle-shaped.
 *
 * No mention facet is ever emitted, so an `@handle` in the text notifies
 * nobody — but it still *reads* as tagging someone, and a model that has been
 * talked into repeating a list of handles produces something that looks like
 * pile-on even while being inert. Removing the sigil keeps the name readable
 * and removes the appearance along with the effect. Runs before the link pass
 * so it cannot disturb a facet's byte offsets.
 */
export function defuseHandles(text: string): string {
  return text.replace(/(^|[^\w/])@([a-z0-9][a-z0-9-]*(?:\.[a-z0-9-]+)+)/gi, '$1$2');
}

/** `https://aturi.to/a/very/long/path` → `aturi.to/a/very/long/…` */
function displayFor(uri: string): string {
  let bare: string;
  try {
    const url = new URL(uri);
    bare = url.host.replace(/^www\./, '') + url.pathname + url.search + url.hash;
  } catch {
    bare = uri;
  }
  bare = bare.replace(/\/$/, '');
  if (bare.length <= LINK_DISPLAY_LIMIT) return bare;
  return `${bare.slice(0, LINK_DISPLAY_LIMIT - 1)}…`;
}

/**
 * Replace every URL in the text with a shortened display form, returning the
 * rewritten text alongside the display→URI mapping the facet builder needs.
 *
 * Only explicit `http(s)://` URLs are recognised. Bluesky's own detector also
 * linkifies bare `example.com`, which is the wrong trade here: it would turn
 * any domain-shaped fragment of a stranger's text that the model happened to
 * repeat into a live link.
 */
export function shortenLinks(text: string): { text: string; links: Link[] } {
  const links: Link[] = [];
  const taken = new Map<string, string>();

  const rewritten = text.replace(/https?:\/\/[^\s<>"'`]+/gi, (match) => {
    // Trailing punctuation is almost always the sentence's, not the URL's.
    const trimmed = match.replace(/[.,;:!?)\]}]+$/, '');
    const tail = match.slice(trimmed.length);
    if (trimmed.length > MAX_URI_LENGTH) return match;

    let display = displayFor(trimmed);
    // Two different URLs must never share a display string, or the facet
    // builder cannot tell which one a given occurrence meant.
    const claimed = taken.get(display);
    if (claimed && claimed !== trimmed) display = trimmed;
    taken.set(display, trimmed);

    links.push({ display, uri: trimmed });
    return display + tail;
  });

  return { text: rewritten, links };
}

/**
 * Link facets for one post, located by exact substring match on the display
 * text and measured in UTF-8 bytes, which is what the lexicon indexes.
 *
 * A link that did not survive splitting intact simply gets no facet: it stays
 * readable as text, which is a better failure than a facet whose byte range
 * points at the wrong characters.
 */
export function buildLinkFacets(post: string, links: Link[]): Facet[] {
  const total = encoder.encode(post).length;
  const candidates: Facet[] = [];

  for (const link of links) {
    if (!/^https?:\/\//i.test(link.uri)) continue;

    let from = 0;
    for (;;) {
      const at = post.indexOf(link.display, from);
      if (at === -1) break;
      from = at + link.display.length;

      const byteStart = encoder.encode(post.slice(0, at)).length;
      const byteEnd = byteStart + encoder.encode(link.display).length;
      if (byteEnd > total) continue;

      candidates.push({
        index: { byteStart, byteEnd },
        features: [{ $type: 'app.bsky.richtext.facet#link', uri: link.uri }],
      });
    }
  }

  // Facet ranges must not overlap, and one display string can be a substring
  // of another ('aturi.to/a' inside 'aturi.to/ab'), so a match is not enough
  // on its own. Longest-first at each position, then take greedily.
  candidates.sort(
    (a, b) =>
      a.index.byteStart - b.index.byteStart ||
      b.index.byteEnd - a.index.byteEnd,
  );

  const facets: Facet[] = [];
  let end = -1;
  for (const facet of candidates) {
    if (facet.index.byteStart < end) continue;
    facets.push(facet);
    end = facet.index.byteEnd;
    if (facets.length >= MAX_LINKS_PER_POST) break;
  }

  return facets;
}

/**
 * The last index at which `units` can be cut so the break lands on a sentence
 * end or, failing that, a space. Returns `max` when neither exists, which is a
 * mid-word cut and still better than dropping the remainder.
 *
 * The 60% floor stops a single early period from producing a two-word post
 * followed by a wall of text.
 */
function breakPoint(units: string[], max: number): number {
  const floor = Math.floor(max * 0.6);
  for (let i = max; i > floor; i -= 1) {
    const unit = units[i - 1];
    if (unit === undefined) continue;
    if (/[.!?]/.test(unit) && /\s/.test(units[i] ?? ' ')) return i;
  }
  for (let i = max; i > floor; i -= 1) {
    if (/\s/.test(units[i - 1] ?? '')) return i;
  }
  return max;
}

/**
 * Split an answer across up to `maxPosts` posts.
 *
 * Numbering only appears when there is more than one post, and it costs
 * graphemes, so the per-post budget shrinks to make room for it. The count is
 * not known until the split is done, which is circular — resolved by assuming
 * the worst case (`maxPosts`) when reserving.
 */
export function splitIntoPosts(text: string, maxPosts: number): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  if (maxPosts <= 1 || graphemeLength(trimmed) <= POST_GRAPHEME_LIMIT) {
    return [clamp(trimmed, POST_GRAPHEME_LIMIT)];
  }

  const suffixCost = ` ${maxPosts}/${maxPosts}`.length;
  const budget = POST_GRAPHEME_LIMIT - suffixCost;

  const chunks: string[] = [];
  let units = graphemes(trimmed);
  while (units.length > 0 && chunks.length < maxPosts) {
    const last = chunks.length === maxPosts - 1;
    if (units.length <= budget) {
      chunks.push(units.join(''));
      units = [];
      break;
    }
    // On the final allowed post the remainder will not fit, so reserve one
    // grapheme for the ellipsis that tells the reader it was cut.
    const cut = last ? breakPoint(units, budget - 1) : breakPoint(units, budget);
    chunks.push(units.slice(0, cut).join('').trimEnd() + (last ? '…' : ''));
    units = units.slice(cut);
  }

  if (chunks.length === 1) return [clamp(chunks[0] ?? '', POST_GRAPHEME_LIMIT)];
  return chunks.map((chunk, index) =>
    clamp(`${chunk} ${index + 1}/${chunks.length}`, POST_GRAPHEME_LIMIT),
  );
}

export type PreparedPost = { text: string; facets: Facet[] };

/** The whole pipeline: raw model output in, postable records out. */
export function preparePosts(raw: string, maxPosts: number): PreparedPost[] {
  const { text, links } = shortenLinks(defuseHandles(stripMarkdown(raw)));
  return splitIntoPosts(text, maxPosts).map((post) => ({
    text: post,
    facets: buildLinkFacets(post, links),
  }));
}
