import { Suspense } from 'react';
import IdentifierDecoder from '@/components/tools/IdentifierDecoder';
import { ToolShell } from '@/components/tools/ToolFrame';
import { toolMetadata } from '@/lib/tools/metadata';

export const metadata = toolMetadata('decode');

/**
 * The tool reads its input from the query string, so it renders in the
 * browser under a Suspense boundary; the static HTML carries the head card.
 */
export default function IdentifierDecoderPage() {
  return (
    <Suspense fallback={<ToolShell slug="decode" />}>
      <IdentifierDecoder />
    </Suspense>
  );
}
