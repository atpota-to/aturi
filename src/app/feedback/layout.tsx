import type { ReactNode } from 'react';
import Header from '@/components/Header';

export default function FeedbackLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Header compact />
      <div
        className="container-narrow"
        style={{ padding: '0 2rem 4rem', minHeight: '80dvh' }}
      >
        {children}
      </div>
    </>
  );
}
