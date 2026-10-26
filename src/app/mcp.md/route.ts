import { buildMcpPage, renderContentPageMarkdown } from '@/lib/siteContent';
import { markdownResponse } from '@/lib/markdownVariants';
import { getSiteUrl } from '@/lib/config';

/**
 * Markdown twin of /mcp. See src/app/about.md/route.ts.
 */
export const dynamic = 'force-static';

export function GET() {
  return markdownResponse(renderContentPageMarkdown(buildMcpPage(getSiteUrl())));
}
