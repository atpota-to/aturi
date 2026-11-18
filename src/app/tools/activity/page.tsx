import { Suspense } from 'react';
import ActivityCalendar from '@/components/tools/ActivityCalendar';
import { ToolShell } from '@/components/tools/ToolFrame';
import { toolMetadata } from '@/lib/tools/metadata';

export const metadata = toolMetadata('activity');

/**
 * The tool reads its input from the query string, so it renders in the
 * browser under a Suspense boundary; the static HTML carries the head card.
 */
export default function ActivityCalendarPage() {
  return (
    <Suspense fallback={<ToolShell slug="activity" />}>
      <ActivityCalendar />
    </Suspense>
  );
}
