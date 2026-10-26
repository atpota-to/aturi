import { CONTACT_PAGE, renderContentPageMarkdown } from '@/lib/siteContent';
import { markdownResponse } from '@/lib/markdownVariants';

/**
 * Markdown twin of /contact. See src/app/about.md/route.ts.
 */
export const dynamic = 'force-static';

export function GET() {
  return markdownResponse(renderContentPageMarkdown(CONTACT_PAGE));
}
