import { Suspense } from 'react';
import Memberships from '@/components/tools/Memberships';
import { ToolShell } from '@/components/tools/ToolFrame';
import { toolMetadata } from '@/lib/tools/metadata';

export const metadata = toolMetadata('memberships');

/**
 * The tool reads its input from the query string, so it renders in the
 * browser under a Suspense boundary; the static HTML carries the head card.
 */
export default function MembershipsPage() {
  return (
    <Suspense fallback={<ToolShell slug="memberships" />}>
      <Memberships />
    </Suspense>
  );
}
