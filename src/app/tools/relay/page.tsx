import { Suspense } from 'react';
import RelayCheck from '@/components/tools/RelayCheck';
import { ToolShell } from '@/components/tools/ToolFrame';
import { toolMetadata } from '@/lib/tools/metadata';

export const metadata = toolMetadata('relay');

/**
 * The tool reads its input from the query string, so it renders in the
 * browser under a Suspense boundary; the static HTML carries the head card.
 */
export default function RelayCheckPage() {
  return (
    <Suspense fallback={<ToolShell slug="relay" />}>
      <RelayCheck />
    </Suspense>
  );
}
