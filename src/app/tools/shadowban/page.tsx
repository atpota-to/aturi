import { Suspense } from 'react';
import ShadowbanChecker from '@/components/tools/ShadowbanChecker';
import { ToolShell } from '@/components/tools/ToolFrame';
import { toolMetadata } from '@/lib/tools/metadata';

export const metadata = toolMetadata('shadowban');

/**
 * The tool reads its input from the query string, so it renders in the
 * browser under a Suspense boundary; the static HTML carries the head card.
 */
export default function ShadowbanCheckerPage() {
  return (
    <Suspense fallback={<ToolShell slug="shadowban" />}>
      <ShadowbanChecker />
    </Suspense>
  );
}
