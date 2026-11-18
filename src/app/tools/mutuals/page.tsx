import { Suspense } from 'react';
import MutualBlocks from '@/components/tools/MutualBlocks';
import { ToolShell } from '@/components/tools/ToolFrame';
import { toolMetadata } from '@/lib/tools/metadata';

export const metadata = toolMetadata('mutuals');

/**
 * The tool reads its input from the query string, so it renders in the
 * browser under a Suspense boundary; the static HTML carries the head card.
 */
export default function MutualBlocksPage() {
  return (
    <Suspense fallback={<ToolShell slug="mutuals" wide />}>
      <MutualBlocks />
    </Suspense>
  );
}
