import { Suspense } from 'react';
import OAuthChecker from '@/components/tools/OAuthChecker';
import { ToolShell } from '@/components/tools/ToolFrame';
import { toolMetadata } from '@/lib/tools/metadata';

export const metadata = toolMetadata('oauth');

/**
 * The tool reads its input from the query string, so it renders in the
 * browser under a Suspense boundary; the static HTML carries the head card.
 */
export default function OAuthCheckerPage() {
  return (
    <Suspense fallback={<ToolShell slug="oauth" />}>
      <OAuthChecker />
    </Suspense>
  );
}
