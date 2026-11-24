import { Suspense } from 'react';
import PdsVersionCheck from '@/components/tools/PdsVersionCheck';
import { ToolShell } from '@/components/tools/ToolFrame';
import { toolMetadata } from '@/lib/tools/metadata';

export const metadata = toolMetadata('pds');

/**
 * The tool reads its input from the query string, so it renders in the
 * browser under a Suspense boundary; the static HTML carries the head card.
 */
export default function PdsVersionCheckPage() {
  return (
    <Suspense fallback={<ToolShell slug="pds" />}>
      <PdsVersionCheck />
    </Suspense>
  );
}
