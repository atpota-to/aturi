import { Suspense } from 'react';
import RecordValidator from '@/components/tools/RecordValidator';
import { ToolShell } from '@/components/tools/ToolFrame';
import { toolMetadata } from '@/lib/tools/metadata';

export const metadata = toolMetadata('validate');

/**
 * The tool reads its input from the query string, so it renders in the
 * browser under a Suspense boundary; the static HTML carries the head card.
 */
export default function RecordValidatorPage() {
  return (
    <Suspense fallback={<ToolShell slug="validate" />}>
      <RecordValidator />
    </Suspense>
  );
}
