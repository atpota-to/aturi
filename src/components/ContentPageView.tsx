import Link from 'next/link';
import Header from '@/components/Header';
import { parseInline, type ContentPage, type InlineSegment } from '@/lib/siteContent';

/**
 * Renders a ContentPage (see src/lib/siteContent.ts) as a styled page.
 *
 * Mirrors the treatment of /terms — full-width compact header, a left-aligned
 * title block, one white sheet holding the article — so /about and /contact
 * read as the same kind of page rather than each inventing a layout. Styles
 * live in src/styles/fieldnotes/content.css (.fn-c-*, .fn-prose).
 */

/** An internal href routes through next/link; anything else is a plain anchor. */
function InlineLink({ href, text }: { href: string; text: string }) {
  if (href.startsWith('/')) {
    return <Link href={href}>{text}</Link>;
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer">
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
            // Bold runs can hold a link ("**The [Explorer](/explore).**"),
            // so their text goes through the same pass again.
            return (
              <strong key={i}>
                <Inline text={segment.text} />
              </strong>
            );
          case 'code':
            return <code key={i}>{segment.text}</code>;
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

      <div className="fn-c-wrap" data-width="article">
        <header className="fn-c-head">
          <h1 className="fn-c-title">{page.title}</h1>
        </header>

        <article className="fn-c-sheet fn-prose">
          <p className="fn-prose-lede">
            <Inline text={page.intro} />
          </p>

          {page.sections.map(section => (
            <section key={section.id} id={section.id}>
              <h2>{section.heading}</h2>
              {section.blocks.map((block, i) =>
                block.kind === 'p' ? (
                  <p key={i}>
                    <Inline text={block.text} />
                  </p>
                ) : (
                  <ul key={i}>
                    {block.items.map((item, j) => (
                      <li key={j}>
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
  );
}
