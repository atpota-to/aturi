import { Suspense } from 'react';
import ShareBuilder from '@/components/tools/ShareBuilder';
import { ToolShell } from '@/components/tools/ToolFrame';
import { toolMetadata } from '@/lib/tools/metadata';

export const metadata = toolMetadata('share');

/**
 * The tool reads its input from the query string, so it renders in the
 * browser under a Suspense boundary; the static HTML carries the head card.
 */
export default function ShareBuilderPage() {
  return (
    <Suspense fallback={<ToolShell slug="share" />}>
      <ShareBuilder />
    </Suspense>
  );
}
