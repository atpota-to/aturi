import { Suspense } from 'react';
import PageChecker from '@/components/tools/PageChecker';
import { ToolShell } from '@/components/tools/ToolFrame';
import { toolMetadata } from '@/lib/tools/metadata';

export const metadata = toolMetadata('page');

/**
 * The tool reads its input from the query string, so it renders in the
 * browser under a Suspense boundary; the static HTML carries the head card.
 */
export default function PageCheckerPage() {
  return (
    <Suspense fallback={<ToolShell slug="page" />}>
      <PageChecker />
    </Suspense>
  );
}
