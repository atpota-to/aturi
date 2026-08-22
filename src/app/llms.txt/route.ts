import { buildLlmsTxt } from '@/lib/llmsTxt';

/**
 * /llms.txt — the llmstxt.org index. Serves as the entry point an agent reads
 * to decide whether this site is the right tool for its task, and where to go
 * next (the OpenAPI spec, /docs.md, the API endpoints themselves).
 *
 * Served as text/plain rather than text/markdown: llmstxt.org specifies a
 * Markdown *body*, but the file is fetched by tooling that expects to render
 * it as plain text, and text/plain is what the reference implementations
 * serve. `charset=utf-8` matters — the copy contains typographic quotes.
 */
export const dynamic = 'force-static';

export function GET() {
  return new Response(buildLlmsTxt(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'public, max-age=0, s-maxage=3600, stale-while-revalidate=86400',
    },
  });
}
