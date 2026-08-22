import Link from 'next/link';
import Header from '@/components/Header';
import { parseInline, type ContentPage, type InlineSegment } from '@/lib/siteContent';

/**
 * Renders a ContentPage (see src/lib/siteContent.ts) as a styled page.
 *
 * Mirrors the treatment of /terms — full-width compact header, narrow
 * container, one bordered card holding the article — so /about and /contact
 * read as the same kind of page rather than each inventing a layout. Styles
 * are inline CSS-variable objects for the same reason the rest of the content
 * pages use them.
 */

const sectionHeading = {
  color: 'var(--text-primary)',
  fontSize: '1.5rem',
  marginBottom: '1rem',
} as const;

const paragraph = { marginBottom: '1rem' } as const;

const list = { marginBottom: '1rem', paddingLeft: '1.5rem' } as const;

const listItem = { marginBottom: '0.5rem' } as const;

const linkStyle = {
  color: 'var(--text-accent)',
  textDecoration: 'none',
} as const;

const codeStyle = {
  fontFamily: 'var(--font-mono, ui-monospace, monospace)',
  fontSize: '0.9em',
  background: 'var(--bg-tertiary)',
  border: '1px solid var(--border-subtle)',
  borderRadius: '3px',
  padding: '0.1em 0.35em',
} as const;

/** An internal href routes through next/link; anything else is a plain anchor. */
function InlineLink({ href, text }: { href: string; text: string }) {
  if (href.startsWith('/')) {
    return (
      <Link href={href} style={linkStyle}>
        {text}
      </Link>
    );
  }
  return (
    <a href={href} style={linkStyle} target="_blank" rel="noopener noreferrer">
      {text}
    </a>
  );
}

function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((segment: InlineSegment, i: number) => {
        switch (segment.kind) {
          case 'link':
            return <InlineLink key={i} href={segment.href} text={segment.text} />;
          case 'strong':
            return (
              <strong key={i} style={{ color: 'var(--text-primary)' }}>
                {segment.text}
              </strong>
            );
          case 'code':
            return (
              <code key={i} style={codeStyle}>
                {segment.text}
              </code>
            );
          default:
            return <span key={i}>{segment.text}</span>;
        }
      })}
    </>
  );
}

export default function ContentPageView({ page }: { page: ContentPage }) {
  return (
    <div style={{ position: 'relative', overflowX: 'clip' }}>
      <Header compact />

      <div className="container-narrow" style={{ padding: '2rem 2rem 4rem' }}>
        <header style={{ marginBottom: '3rem', textAlign: 'center' }}>
          <h1 style={{ marginBottom: '1rem', color: 'var(--text-primary)' }}>
            {page.title}
          </h1>
        </header>

        <div className="card" style={{ padding: '2rem', maxWidth: '48rem', margin: '0 auto' }}>
          <article style={{ color: 'var(--text-secondary)', lineHeight: '1.7' }}>
            <p style={{ ...paragraph, fontSize: '1.05rem' }}>
              <Inline text={page.intro} />
            </p>

            {page.sections.map(section => (
              <section key={section.id} id={section.id} style={{ marginTop: '2.5rem' }}>
                <h2 style={sectionHeading}>{section.heading}</h2>
                {section.blocks.map((block, i) =>
                  block.kind === 'p' ? (
                    <p key={i} style={paragraph}>
                      <Inline text={block.text} />
                    </p>
                  ) : (
                    <ul key={i} style={list}>
                      {block.items.map((item, j) => (
                        <li key={j} style={listItem}>
                          <Inline text={item} />
                        </li>
                      ))}
                    </ul>
                  )
                )}
              </section>
            ))}
          </article>
        </div>
      </div>
    </div>
  );
}
