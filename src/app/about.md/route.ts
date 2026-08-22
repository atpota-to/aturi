import { ABOUT_PAGE, renderContentPageMarkdown } from '@/lib/siteContent';
import { markdownResponse } from '@/lib/markdownVariants';

/**
 * Markdown twin of /about. Reachable directly, and what the Accept
 * negotiation in src/middleware.ts rewrites /about to when a client asks for
 * text/markdown.
 */
export const dynamic = 'force-static';

export function GET() {
  return markdownResponse(renderContentPageMarkdown(ABOUT_PAGE));
}
