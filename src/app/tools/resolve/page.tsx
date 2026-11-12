import { Suspense } from 'react';
import BulkResolver from '@/components/tools/BulkResolver';
import { ToolShell } from '@/components/tools/ToolFrame';
import { toolMetadata } from '@/lib/tools/metadata';

export const metadata = toolMetadata('resolve');

/**
 * The tool reads its input from the query string, so it renders in the
 * browser under a Suspense boundary; the static HTML carries the head card.
 */
export default function BulkResolverPage() {
  return (
    <Suspense fallback={<ToolShell slug="resolve" wide />}>
      <BulkResolver />
    </Suspense>
  );
}
