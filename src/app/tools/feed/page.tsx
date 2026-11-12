import { Suspense } from 'react';
import FeedInspector from '@/components/tools/FeedInspector';
import { ToolShell } from '@/components/tools/ToolFrame';
import { toolMetadata } from '@/lib/tools/metadata';

export const metadata = toolMetadata('feed');

/**
 * The tool reads its input from the query string, so it renders in the
 * browser under a Suspense boundary; the static HTML carries the head card.
 */
export default function FeedInspectorPage() {
  return (
    <Suspense fallback={<ToolShell slug="feed" />}>
      <FeedInspector />
    </Suspense>
  );
}
