import type { ReactNode } from 'react';
import Header from '@/components/Header';

export default function ToolsLayout({ children }: { children: ReactNode }) {
  return (
    <>
      <Header compact />
      <div className="fn-c-wrap">{children}</div>
    </>
  );
}
