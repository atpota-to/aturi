import { HOME_PAGE, renderContentPageMarkdown } from '@/lib/siteContent';
import { markdownResponse } from '@/lib/markdownVariants';

/**
 * Markdown twin of the homepage. Reachable directly at /index.md, and what the
 * Accept negotiation in src/middleware.ts rewrites `/` to when a client asks
 * for text/markdown.
 */
export const dynamic = 'force-static';

export function GET() {
  return markdownResponse(renderContentPageMarkdown(HOME_PAGE));
}
