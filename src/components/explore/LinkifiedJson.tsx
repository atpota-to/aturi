'use client';

import { Fragment, useMemo } from 'react';
import Link from 'next/link';
import { explorePathFromAtUri } from '@/utils/atproto/urls';

type Props = {
  value: unknown;
  className?: string;
  style?: React.CSSProperties;
};

// Match at:// URIs, did:plc / did:web identifiers, and http(s) URLs.
// All three are commonly embedded as JSON string values; rendering them
// as plain text inside a <pre> hides the navigational structure of a
// record. We tokenise the stringified JSON and route each match type to
// the appropriate destination.
const PATTERN =
  /at:\/\/[A-Za-z0-9._:~%/-]+|did:(?:plc|web):[A-Za-z0-9._-]+|https?:\/\/[^\s"'<>)]+/g;

type Token =
  | { kind: 'text'; value: string }
  | { kind: 'at'; value: string }
  | { kind: 'did'; value: string }
  | { kind: 'http'; value: string };

function tokenise(text: string): Token[] {
  const out: Token[] = [];
  let lastIndex = 0;
  PATTERN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATTERN.exec(text)) !== null) {
    const matched = m[0];
    if (m.index > lastIndex) {
      out.push({ kind: 'text', value: text.slice(lastIndex, m.index) });
    }
    if (matched.startsWith('at://')) {
      out.push({ kind: 'at', value: matched });
    } else if (matched.startsWith('did:')) {
      out.push({ kind: 'did', value: matched });
    } else {
      out.push({ kind: 'http', value: matched });
    }
    lastIndex = m.index + matched.length;
  }
  if (lastIndex < text.length) {
    out.push({ kind: 'text', value: text.slice(lastIndex) });
  }
  return out;
}

/**
 * Render a JSON-serialisable value as pretty-printed text with at:// URIs,
 * did:plc/did:web identifiers, and http(s) URLs hyperlinked in place.
 *
 *   - at:// → explorer record / collection / repo page
 *   - did:* → explorer repo page (preserves the DID method)
 *   - http(s):// → external link (new tab)
 *
 * Used by the record explorer's "raw record" section and the universal
 * link page's "View Full Record" JSON modal so users can keep clicking
 * deeper into the graph.
 *
 * The two internal link kinds set `rel="nofollow"` and `prefetch={false}`.
 * Their destinations are not pages of this site in any bounded sense: they are
 * whatever DIDs and at:// URIs a record happens to contain, so a post links to
 * its author, its reply parent, its thread root, its embeds and every mention
 * in its facets — each of which is a record page whose own JSON does the same.
 * Followed mechanically that is an unbounded walk over the whole network, and
 * a single record can put dozens of these edges on one page.
 *
 * It takes both flags, because they stop different things. `rel="nofollow"`
 * asks a crawler not to queue the URL as a link worth visiting. It says
 * nothing about prefetching: that is a fetch the browser issues by itself once
 * the link scrolls into the viewport, and a crawler executing JavaScript
 * issues it too, `rel` notwithstanding. Dropping one flag and keeping the
 * other leaves the requests happening.
 *
 * Neither flag changes what a click does — the destinations stay reachable,
 * and the deeper-into-the-graph browsing this component exists for is
 * unaffected. The first click is a cold navigation instead of a warm one.
 *
 * External URLs keep their existing `rel` and are left alone: they cost this
 * site nothing to have crawled.
 */
export default function LinkifiedJson({ value, className, style }: Props) {
  const tokens = useMemo(() => {
    const text = (() => {
      try {
        return JSON.stringify(value, null, 2);
      } catch {
        return String(value);
      }
    })();
    return tokenise(text);
  }, [value]);

  return (
    <pre className={className} style={style}>
      {tokens.map((t, i) => {
        if (t.kind === 'text') return <Fragment key={i}>{t.value}</Fragment>;
        if (t.kind === 'at') {
          const path = explorePathFromAtUri(t.value);
          if (!path) return <Fragment key={i}>{t.value}</Fragment>;
          return (
            <Link
              key={i}
              href={path}
              className="explore-json-link"
              prefetch={false}
              rel="nofollow"
            >
              {t.value}
            </Link>
          );
        }
        if (t.kind === 'did') {
          return (
            <Link
              key={i}
              href={`/explore/${t.value}`}
              className="explore-json-link"
              prefetch={false}
              rel="nofollow"
            >
              {t.value}
            </Link>
          );
        }
        // External URLs open in a new tab.
        return (
          <a
            key={i}
            href={t.value}
            target="_blank"
            rel="noreferrer noopener"
            className="explore-json-link explore-json-link-external"
          >
            {t.value}
          </a>
        );
      })}
    </pre>
  );
}
