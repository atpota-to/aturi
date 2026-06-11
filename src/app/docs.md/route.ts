import { DOCS_MARKDOWN } from '../docs/markdown';

// Plain-text Markdown rendering of the developer docs, served at /docs.md.
// Lets an LLM or coding agent fetch the full docs in one request:
//   curl https://aturi.to/docs.md
export const dynamic = 'force-static';

export function GET() {
  return new Response(DOCS_MARKDOWN, {
    headers: {
      'Content-Type': 'text/markdown; charset=utf-8',
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
