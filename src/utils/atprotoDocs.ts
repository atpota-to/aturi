/**
 * Reader for the upstream documentation and lexicon sources.
 *
 * Everything here comes from raw.githubusercontent.com, which serves the same
 * Markdown that renders on atproto.com, docs.bsky.app and bsky.network, and
 * the same JSON the SDKs are generated from. Fetching at request time rather
 * than vendoring a copy means an answer tracks upstream: when a spec changes,
 * the next call sees the change.
 *
 * The host is a fixed constant, so no SSRF guard applies; what does apply is
 * the shared request deadline and a byte cap, since a document is still a
 * remote response.
 */

import { withIdentification } from './requestDeadline';
import { TTLMap } from './atproto/cache';

const RAW_HOST = 'https://raw.githubusercontent.com/';

/** Bodies are Markdown or a lexicon; neither is legitimately larger. */
const MAX_DOC_BYTES = 512_000;

/**
 * Documents change on upstream's release cadence, not by the minute, and a
 * search fetches several at once. Ten minutes keeps a burst of related
 * questions to one round of requests without holding a stale spec for long.
 */
const DOC_TTL_MS = 10 * 60_000;
const docCache = new TTLMap<string, string>(DOC_TTL_MS);

/**
 * Fetch one raw document. Returns null when it cannot be read, since a missing
 * page is a normal answer for a manifest entry upstream has since renamed.
 */
export async function fetchRawDoc(url: string): Promise<string | null> {
  if (!url.startsWith(RAW_HOST)) return null;

  const cached = docCache.get(url);
  if (cached !== undefined) return cached;

  try {
    const res = await fetch(url, withIdentification());
    if (!res.ok) return null;
    const declared = Number(res.headers.get('content-length') ?? '');
    if (Number.isFinite(declared) && declared > MAX_DOC_BYTES) return null;
    const text = (await res.text()).slice(0, MAX_DOC_BYTES);
    docCache.set(url, text);
    return text;
  } catch {
    return null;
  }
}

/**
 * Strip the parts of an MDX file that are machinery rather than prose: the
 * frontmatter, the import lines, and the `export const header` block. What is
 * left is what a reader would see, which is what should be searched and
 * quoted.
 */
export function toReadableMarkdown(source: string): string {
  return source
    .replace(/^---\n[\s\S]*?\n---\n/, '')
    .replace(/^export const header = \{[\s\S]*?\n\}\n/m, '')
    .replace(/^import .*$/gm, '')
    .replace(/\{\{\s*className:.*?\}\}/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export type Passage = { heading: string | null; text: string };

/**
 * Pull the parts of a document that actually mention the query.
 *
 * Returning a whole 35KB spec to answer "what is a TID" wastes the caller's
 * context and buries the answer. This walks the document by heading and keeps
 * only the sections that match, each labelled with the heading it sits under
 * so the agent can cite a section rather than a whole page.
 */
export function findPassages(markdown: string, terms: string[], maxPassages = 4): Passage[] {
  if (!terms.length) return [];
  const sections: Passage[] = [];
  let heading: string | null = null;
  let buffer: string[] = [];

  const flush = () => {
    const text = buffer.join('\n').trim();
    if (text) sections.push({ heading, text });
    buffer = [];
  };

  for (const line of markdown.split('\n')) {
    const match = line.match(/^#{1,4}\s+(.+?)\s*$/);
    if (match) {
      flush();
      heading = match[1].replace(/[#*`]/g, '').trim();
    } else {
      buffer.push(line);
    }
  }
  flush();

  return sections
    .map((section) => {
      const haystack = `${section.heading ?? ''}\n${section.text}`.toLowerCase();
      const score = terms.reduce((sum, term) => sum + (haystack.includes(term) ? 1 : 0), 0);
      return { section, score };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxPassages)
    .map(({ section }) => ({
      heading: section.heading,
      // Long enough to answer, short enough that four of them still fit.
      text: section.text.length > 1200 ? `${section.text.slice(0, 1199)}…` : section.text,
    }));
}

/** Split a query into the terms ranking and passage-matching both use. */
export function queryTerms(query: string): string[] {
  return [
    ...new Set(
      query
        .toLowerCase()
        .split(/[^a-z0-9.:_-]+/)
        .map((t) => t.replace(/^[.:_-]+|[.:_-]+$/g, ''))
        .filter((t) => t.length > 1),
    ),
  ];
}
