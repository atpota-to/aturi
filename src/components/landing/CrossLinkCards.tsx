import Link from 'next/link';

type ProductKey = 'universal-links' | 'extension' | 'explore';

type Card = {
  key: ProductKey;
  href: string;
  title: string;
  body: string;
};

const CARDS: Card[] = [
  {
    key: 'universal-links',
    href: '/links',
    title: 'Universal links',
    body: 'Share aturi.to/handle/collection/rkey for a post, a profile, a list, or any other record.',
  },
  {
    key: 'extension',
    href: '/extension',
    title: 'Browser extension',
    body: 'Inspect AT URIs on any page and jump between Atmosphere apps.',
  },
  {
    key: 'explore',
    href: '/explore',
    title: 'Atmosphere Explorer',
    body: "Browse any account's PDS records, identity history, and backlinks.",
  },
];

/**
 * Bottom-of-page pointer to the other two products. Pass `current` to
 * hide the entry for the page you're already on so we don't link a page
 * to itself.
 *
 * This runs as one quiet band rather than the eyebrow + h2 + bordered
 * cards it used to be. It closes three pages, so at full weight it read
 * as a third product pitch after the page had already made its own; the
 * band puts it below the page's own closing CTA where a footer pointer
 * belongs. No h2 means the entries drop to spans, which also keeps each
 * page's heading order intact.
 */
export default function CrossLinkCards({ current }: { current?: ProductKey }) {
  const cards = CARDS.filter((c) => c.key !== current);
  return (
    <section
      aria-label="Other Aturi tools"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1.25rem',
        padding: '1.5rem',
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-secondary)',
      }}
    >
      {cards.map((c) => (
        <Link
          key={c.key}
          href={c.href}
          style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}
        >
          <span style={{ fontSize: 'var(--type-lead)', fontWeight: 400, lineHeight: 1.4 }}>
            {c.title}
          </span>
          <span
            style={{
              fontSize: 'var(--type-small)',
              lineHeight: 1.5,
              color: 'var(--text-secondary)',
            }}
          >
            {c.body}
          </span>
        </Link>
      ))}
    </section>
  );
}
