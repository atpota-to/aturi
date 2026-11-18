'use client';

import { useEffect, useState } from 'react';

interface DocsTocProps {
  items: { id: string; label: string }[];
}

/**
 * The "On this page" list. From 1000px it is a sticky rail beside the
 * sheet (content.css), and this marks the entry for the section the reader
 * is in, the way the explorer's folder tabs mark the open sheet; below
 * that the list is a row of pills and the mark is harmless.
 *
 * One observer over the `section[id]`s, watching a band from under the
 * sticky header to about a third of the way down. The topmost section in
 * the band wins, so a long section keeps its entry while the reader is
 * inside it, and the last mark stays when the band holds no section (the
 * footer).
 */
export default function DocsToc({ items }: DocsTocProps) {
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    const sections = items
      .map((item) => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;

    const visible = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) visible.add(entry.target.id);
          else visible.delete(entry.target.id);
        }
        const first = items.find((item) => visible.has(item.id));
        if (first) setCurrent(first.id);
      },
      { rootMargin: '-88px 0px -70% 0px' },
    );
    sections.forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [items]);

  return (
    <nav aria-label="On this page" className="fn-docs-toc">
      <span className="fn-docs-toc-label" aria-hidden>
        On this page
      </span>
      <ol>
        {items.map((item) => (
          <li key={item.id}>
            <a href={`#${item.id}`} aria-current={current === item.id ? 'location' : undefined}>
              {item.label}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
