import type { ReactNode } from 'react';
import Header from '@/components/Header';

export default function FeedbackLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Header compact />
      <div className="fn-c-wrap" data-width="board">
        {children}
      </div>
    </>
  );
}
