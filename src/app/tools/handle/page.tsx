import { Suspense } from 'react';
import HandleDebugger from '@/components/tools/HandleDebugger';
import { ToolShell } from '@/components/tools/ToolFrame';
import { toolMetadata } from '@/lib/tools/metadata';

export const metadata = toolMetadata('handle');

/**
 * The tool reads its input from the query string, so it renders in the
 * browser under a Suspense boundary; the static HTML carries the head card.
 */
export default function HandleDebuggerPage() {
  return (
    <Suspense fallback={<ToolShell slug="handle" />}>
      <HandleDebugger />
    </Suspense>
  );
}
