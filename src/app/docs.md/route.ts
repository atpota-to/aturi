import { DOCS_MARKDOWN } from '../docs/markdown';
import { markdownResponse } from '@/lib/markdownVariants';

// Plain-text Markdown rendering of the developer docs, served at /docs.md.
// Lets an LLM or coding agent fetch the full docs in one request:
//   curl https://aturi.to/docs.md
//
// Also the target of the Accept negotiation on /docs, which is why the
// response goes through the shared helper: that's what carries `Vary: Accept`,
// without which a CDN can hand this body to a browser asking for HTML.
export const dynamic = 'force-static';

export function GET() {
  return markdownResponse(DOCS_MARKDOWN);
}
