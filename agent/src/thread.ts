/**
 * Fitting an answer into Bluesky posts.
 *
 * app.bsky.feed.post caps text at 300 graphemes and 3000 bytes. Graphemes,
 * not code points and not UTF-16 units, so a family emoji is one unit and
 * `String.length` is the wrong ruler; Intl.Segmenter is the right one and is
 * in Node 22 without a flag.
 */

const POST_GRAPHEME_LIMIT = 300;
const POST_BYTE_LIMIT = 3000;

const segmenter = new Intl.Segmenter('en', { granularity: 'grapheme' });
const encoder = new TextEncoder();

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
