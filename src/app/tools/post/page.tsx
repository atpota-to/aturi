import { Suspense } from 'react';
import PostInspector from '@/components/tools/PostInspector';
import { ToolShell } from '@/components/tools/ToolFrame';
import { toolMetadata } from '@/lib/tools/metadata';

export const metadata = toolMetadata('post');

/**
 * The tool reads its input from the query string, so it renders in the
 * browser under a Suspense boundary; the static HTML carries the head card.
 */
export default function PostInspectorPage() {
  return (
    <Suspense fallback={<ToolShell slug="post" />}>
      <PostInspector />
    </Suspense>
  );
}
