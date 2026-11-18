import { Suspense } from 'react';
import LabelChecker from '@/components/tools/LabelChecker';
import { ToolShell } from '@/components/tools/ToolFrame';
import { toolMetadata } from '@/lib/tools/metadata';

export const metadata = toolMetadata('labels');

/**
 * The tool reads its input from the query string, so it renders in the
 * browser under a Suspense boundary; the static HTML carries the head card.
 */
export default function LabelCheckerPage() {
  return (
    <Suspense fallback={<ToolShell slug="labels" />}>
      <LabelChecker />
    </Suspense>
  );
}
