import { Suspense } from 'react';
import CarInspector from '@/components/tools/CarInspector';
import { ToolShell } from '@/components/tools/ToolFrame';
import { toolMetadata } from '@/lib/tools/metadata';

export const metadata = toolMetadata('car');

/**
 * The tool reads its input from the query string, so it renders in the
 * browser under a Suspense boundary; the static HTML carries the head card.
 */
export default function CarInspectorPage() {
  return (
    <Suspense fallback={<ToolShell slug="car" wide />}>
      <CarInspector />
    </Suspense>
  );
}
