import type { Metadata } from 'next';
import Link from 'next/link';
import Header from '@/components/Header';
import CodeBlock from '@/components/docs/CodeBlock';
import CopyMarkdownButton from '@/components/docs/CopyMarkdownButton';
import { DOCS_MARKDOWN } from './markdown';

const DESCRIPTION =
  'Add Atmosphere “Open in…” links, smart client recommendations, compose intents, and AT-URI resolution to your own app with the @aturi.to/waypoints packages and the public Resolve API.';

export const metadata: Metadata = {
  title: 'Developer Docs · aturi.to',
  description: DESCRIPTION,
  openGraph: {
    title: 'Developer Docs · aturi.to',
    description: DESCRIPTION,
    images: ['/api/og/static?page=docs'],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Developer Docs · aturi.to',
    description: DESCRIPTION,
    images: ['/api/og/static?page=docs'],
  },
};

// Shared inline styles — mirrors the CSS-variable + inline-style approach used
// across the site's content pages (see src/app/terms/page.tsx).
const sectionStyle: React.CSSProperties = {
  padding: '2rem',
  marginBottom: '1.5rem',
  scrollMarginTop: '5.5rem',
};
const h2Style: React.CSSProperties = {
  fontSize: '1.6rem',
  fontWeight: 400,
  color: 'var(--text-primary)',
  letterSpacing: '-0.01em',
  lineHeight: 1.2,
  margin: '0 0 1rem',
};
const h3Style: React.CSSProperties = {
  fontSize: '1.05rem',
  fontWeight: 600,
  color: 'var(--text-primary)',
  margin: '1.75rem 0 0.5rem',
};
const pStyle: React.CSSProperties = {
  color: 'var(--text-secondary)',
  fontSize: '1rem',
  lineHeight: 1.7,
  margin: '0 0 1rem',
};
const liStyle: React.CSSProperties = {
  color: 'var(--text-secondary)',
  fontSize: '1rem',
  lineHeight: 1.6,
  marginBottom: '0.4rem',
};

const TOC: { id: string; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'core', label: 'Core package' },
  { id: 'react', label: 'React picker' },
  { id: 'resolve-api', label: 'Resolve API' },
  { id: 'compose', label: 'Compose intents' },
  { id: 'links', label: 'Universal links' },
  { id: 'license', label: 'License' },
];

const coreInstall = `npm install @aturi.to/waypoints`;

const coreExample = `import { resolveAtUri, resolveUrl } from '@aturi.to/waypoints';

// AT URI -> waypoints
const result = resolveAtUri('at://did:plc:abc/app.bsky.feed.post/3k7');
result?.waypoints;   // [{ id: 'anisota', name: 'Anisota', category, url }, ...]
result?.recommended; // { ids: ['bluesky', 'anisota', ...], label: 'Recommended for Posts' }

// Pasted page URL -> waypoints (offline pattern match)
const fromUrl = await resolveUrl('https://bsky.app/profile/alice.bsky.social/post/3k7');`;

const reactInstall = `npm install @aturi.to/waypoints-react
# peers (you almost certainly already have react/react-dom):
npm install react react-dom lucide-react`;

const reactPicker = `import { WaypointPicker } from '@aturi.to/waypoints-react';

<WaypointPicker
  type="post"
  handle="alice.bsky.social"
  collection="app.bsky.feed.post"
  rkey="3k7qw..."
/>;`;

const reactHook = `import { useWaypoints } from '@aturi.to/waypoints-react';

function MyPicker() {
  const { recommended, categories, waypoints, copy, open } = useWaypoints({
    type: 'post',
    handle: 'alice.bsky.social',
    collection: 'app.bsky.feed.post',
    rkey: '3k7qw...',
  });

  return (
    <ul>
      {waypoints.map((w) => (
        <li key={w.id}>
          {w.icon}
          <button onClick={() => open(w.url)}>{w.name}</button>
          <button onClick={() => copy(w.url)}>Copy</button>
        </li>
      ))}
    </ul>
  );
}`;

const reactTheme = `import '@aturi.to/waypoints-react/styles.css';
import { WaypointPicker } from '@aturi.to/waypoints-react';`;

const resolveApi = `GET https://aturi.to/api/resolve?url=<encoded-page-url>
GET https://aturi.to/api/resolve?atUri=at://...`;

const composeExample = `import {
  WAYPOINT_DESTINATIONS_DATA,
  getComposeIntentUrl,
  getComposeIntentWaypoints,
  supportsComposeIntent,
} from '@aturi.to/waypoints';

// Which clients will open a composer for you?
getComposeIntentWaypoints().map((w) => w.id);
// ['anisota', 'bluesky', 'impro', 'blacksky', 'witchsky', 'mu', 'deer']

supportsComposeIntent(WAYPOINT_DESTINATIONS_DATA.deer); // true
getComposeIntentUrl(WAYPOINT_DESTINATIONS_DATA.deer, 'hello from my app');
// 'https://deer.social/intent/compose?text=hello%20from%20my%20app'`;

const composeApi = `GET https://aturi.to/api/waypoints?capability=compose
GET https://aturi.to/api/waypoints?capability=compose&text=<encoded-text>

# or inline, on any resolve call:
GET https://aturi.to/api/resolve?atUri=at://...&composeText=<encoded-text>`;

const composeResponse = `{
  "id": "deer",
  "name": "Deer",
  "category": "blueskyForks",
  "composeIntent": {
    "url": "https://deer.social/intent/compose?text=hello",
    "urlTemplate": "https://deer.social/intent/compose?text={text}",
    "textParam": "text",
    "prefillsText": true
  }
}`;

// Escaped so the template literal renders the snippet literally.
const linkExample = `function toAturiLink(atUri: string): string {
  const uri = atUri.replace('at://', '');
  return \`https://aturi.to/profile/\${uri}\`;
}`;

export default function DocsPage() {
  return (
    <>
      <Header compact />
      <div
        className="container-narrow"
        style={{ padding: '0 2rem 4rem', minHeight: '80dvh' }}
      >
        {/* Page header */}
        <header style={{ textAlign: 'center', margin: '0 auto 2.5rem', maxWidth: '40rem' }}>
          <h1
            style={{
              fontSize: '2.5rem',
              fontWeight: 300,
              letterSpacing: '-0.01em',
              lineHeight: 1.15,
              margin: '0 0 1rem',
            }}
          >
            Developer docs
          </h1>
          <p style={{ color: 'var(--text-secondary)', fontSize: '1.125rem', lineHeight: 1.6, margin: 0 }}>
            Add Atmosphere “Open in…” links, smart client recommendations,
            compose intents, and AT-URI resolution to your own app, with two
            MIT-licensed packages and a public API.
          </p>
          <div
            style={{
              display: 'flex',
              flexWrap: 'wrap',
              justifyContent: 'center',
              alignItems: 'center',
              gap: '0.75rem',
              marginTop: '1.5rem',
            }}
          >
            <CopyMarkdownButton markdown={DOCS_MARKDOWN} />
            <a
              href="/docs.md"
              style={{
                fontSize: '0.8125rem',
                color: 'var(--text-tertiary)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              View raw .md →
            </a>
          </div>
          <p
            style={{
              color: 'var(--text-tertiary)',
              fontSize: '0.8125rem',
              lineHeight: 1.5,
              margin: '0.75rem 0 0',
            }}
          >
            Building with an LLM or coding agent? Grab the whole page as Markdown.
          </p>
        </header>

        {/* Table of contents */}
        <nav
          aria-label="On this page"
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: '0.5rem',
            marginBottom: '2.5rem',
          }}
        >
          {TOC.map((item) => (
            <a
              key={item.id}
              href={`#${item.id}`}
              style={{
                fontSize: '0.8125rem',
                padding: '0.3rem 0.7rem',
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-tertiary)',
              }}
            >
              {item.label}
            </a>
          ))}
        </nav>

        {/* Overview */}
        <section id="overview" className="card" style={sectionStyle}>
          <h2 style={h2Style}>Overview</h2>
          <p style={pStyle}>
            The same waypoint catalog, recommendations, and link logic that
            power aturi.to are published as two standalone, MIT-licensed npm
            packages so you can drop them into any Atmosphere (AT Protocol)
            app:
          </p>
          <ul style={{ paddingLeft: '1.25rem', margin: '0 0 1rem' }}>
            <li style={liStyle}>
              <code>@aturi.to/waypoints</code>, a zero-dependency,
              framework-agnostic core: the client catalog, per-client
              “Open in…” link builders, recommendations, and URL ⇄ AT-URI
              resolution. Works in the browser, Node 18+, and edge runtimes.
            </li>
            <li style={liStyle}>
              <code>@aturi.to/waypoints-react</code>: a headless-first React
              picker UI plus client icons, built on the core. Ships zero CSS
              by default and is fully themeable.
            </li>
          </ul>
          <p style={{ ...pStyle, margin: 0 }}>
            Both are dual-licensed <strong>MIT</strong> (the aturi.to app
            itself is GPL-3.0) to remove the adoption barrier. Prefer not to
            install anything? The hosted{' '}
            <a href="#resolve-api">Resolve API</a> does the same work over
            HTTP.
          </p>
        </section>

        {/* Core package */}
        <section id="core" className="card" style={sectionStyle}>
          <h2 style={h2Style}>
            <code>@aturi.to/waypoints</code>
          </h2>
          <p style={pStyle}>
            The zero-dependency core. Turn an AT URI into per-client links,
            recommend the best client for a record type, and reverse-resolve a
            pasted URL back into an AT URI.
          </p>
          <CodeBlock label="bash" code={coreInstall} />

          <h3 style={h3Style}>Resolve an AT URI or a pasted URL</h3>
          <CodeBlock label="ts" code={coreExample} />

          <h3 style={h3Style}>What’s included</h3>
          <ul style={{ paddingLeft: '1.25rem', margin: '0 0 1rem' }}>
            <li style={liStyle}>
              <strong>High-level resolvers:</strong> <code>resolveAtUri</code>,{' '}
              <code>resolveUrl</code>, <code>buildWaypointsForParsed</code>,
              and <code>resolveViaApi</code> (a typed client for the hosted
              endpoint).
            </li>
            <li style={liStyle}>
              <strong>Catalog &amp; recommendations:</strong>{' '}
              <code>getWaypointDataForType</code>,{' '}
              <code>getCategorizedWaypointsData</code>,{' '}
              <code>getRecommendedWaypointsData</code>, and the raw{' '}
              <code>WAYPOINT_DESTINATIONS_DATA</code> catalog.
            </li>
            <li style={liStyle}>
              <strong>Parsing:</strong> <code>parseURI</code>,{' '}
              <code>parseAtUri</code>, <code>matchSupportedUrl</code>,{' '}
              <code>resolveHandle</code>.
            </li>
            <li style={liStyle}>
              <strong>Capabilities:</strong> <code>supportsComposeIntent</code>,{' '}
              <code>getComposeIntentUrl</code>,{' '}
              <code>getComposeIntentWaypoints</code> — see{' '}
              <a href="#compose">compose intents</a>.
            </li>
          </ul>
          <p style={{ ...pStyle, margin: 0 }}>
            A handful of destinations (pdsls, atp.tools, Margin, Grain,
            Popfeed) only produce useful URLs when a DID is known; they’re
            filtered out unless a DID is available, so pass one in or supply a{' '}
            <code>resolveHandle</code> to <code>resolveUrl</code>. Full
            reference in the{' '}
            <a
              href="https://github.com/atpota-to/aturi/blob/main/packages/waypoints/README.md"
              target="_blank"
              rel="noopener noreferrer"
            >
              package README
            </a>
            .
          </p>
        </section>

        {/* React picker */}
        <section id="react" className="card" style={sectionStyle}>
          <h2 style={h2Style}>
            <code>@aturi.to/waypoints-react</code>
          </h2>
          <p style={pStyle}>
            A drop-in React “Open in…” picker. Headless-first: it ships zero
            CSS and emits stable, namespaced styling hooks, so you can use your
            own design system, opt into the polished theme, or drop down to a
            hook and render everything yourself. It re-exports the entire core,
            so a single install gives you the components and the resolvers.
          </p>
          <CodeBlock label="bash" code={reactInstall} />

          <h3 style={h3Style}>1. Drop-in picker</h3>
          <p style={pStyle}>
            Renders clean semantic markup with no CSS attached. Every element
            carries a <code>data-aturi-wp</code> attribute and an{' '}
            <code>aturi-wp-*</code> class; map your own via <code>classNames</code>,
            pass <code>unstyled</code> to drop the built-ins, or replace rows
            with the <code>renderWaypoint</code> prop.
          </p>
          <CodeBlock label="tsx" code={reactPicker} />

          <h3 style={h3Style}>2. The useWaypoints hook</h3>
          <p style={pStyle}>
            For full control, the hook returns render-ready data plus{' '}
            <code>copy</code> / <code>open</code> helpers: no markup at all.
          </p>
          <CodeBlock label="tsx" code={reactHook} />

          <h3 style={h3Style}>3. The polished theme (opt-in)</h3>
          <p style={pStyle}>
            Want the Aturi look without writing CSS? Import the stylesheet
            once. It targets the namespaced classes and is fully themeable via{' '}
            <code>--aturi-wp-*</code> CSS custom properties (with light/dark
            defaults).
          </p>
          <CodeBlock label="tsx" code={reactTheme} />

          <p style={{ ...pStyle, margin: '1rem 0 0' }}>
            <strong>Server vs. client:</strong> the package is a client
            component (it carries <code>&quot;use client&quot;</code>), so it
            works out of the box in the Next.js App Router. For framework-agnostic
            helpers inside a Server Component, import them from{' '}
            <code>@aturi.to/waypoints</code> directly.
          </p>
        </section>

        {/* Resolve API */}
        <section id="resolve-api" className="card" style={sectionStyle}>
          <h2 style={h2Style}>Resolve API</h2>
          <p style={pStyle}>
            Don’t want to install anything? Hit the hosted endpoint from a
            share sheet, an Apple Shortcut, or any client: no login, no API
            keys. It returns the resolved waypoints and recommendations for a
            page URL or an AT URI.
          </p>
          <CodeBlock label="http" code={resolveApi} />
          <p style={pStyle}>
            The core package’s <code>resolveViaApi()</code> is a typed client
            for this endpoint. It’s the right choice from a browser, where
            fetching arbitrary pages is blocked by CORS.
          </p>
          <p style={{ ...pStyle, margin: 0 }}>
            To ask about the catalog itself rather than a specific record —
            what’s in it, and which clients can do what — there’s a companion
            endpoint: <code>GET /api/waypoints</code>, filterable by{' '}
            <code>?type=</code> and <code>?capability=</code>.
          </p>
        </section>

        {/* Compose intents */}
        <section id="compose" className="card" style={sectionStyle}>
          <h2 style={h2Style}>Compose intents</h2>
          <p style={pStyle}>
            bsky.app can be handed a link that opens its composer pre-filled:{' '}
            <code>/intent/compose?text=…</code> (see the{' '}
            <a
              href="https://docs.bsky.app/docs/advanced-guides/intent-links"
              target="_blank"
              rel="noopener noreferrer"
            >
              intent link docs
            </a>
            ). Clients forked from the official social app inherit the same
            route, so the catalog records which ones do — and every waypoint
            carries a <code>composeIntent</code>, <code>null</code> when the
            client has no confirmed route.
          </p>
          <CodeBlock label="ts" code={composeExample} />
          <p style={pStyle}>
            Two nuances worth reading off the data rather than assuming.{' '}
            <code>prefillsText</code> is <code>false</code> for a client that
            routes the intent but ignores the text, so a “share this” link would
            open an empty composer — fine as a jump, useless as a share. And{' '}
            <code>appUrl</code> appears only where the client publishes a native
            scheme, so it’s a bonus, not a fallback.
          </p>
          <p style={pStyle}>
            Over HTTP, the same data comes back on both endpoints. Pass the text
            to get finished links, or take <code>urlTemplate</code> and
            substitute the URL-encoded text for <code>{'{text}'}</code>{' '}
            yourself.
          </p>
          <CodeBlock label="http" code={composeApi} />
          <CodeBlock label="json" code={composeResponse} />
          <p style={{ ...pStyle, margin: 0 }}>
            In React, each <code>useWaypoints</code> entry carries the same{' '}
            <code>composeIntent</code>; pass <code>composeText</code> to the
            hook to have the links built for you.
          </p>
        </section>

        {/* Universal links */}
        <section id="links" className="card" style={sectionStyle}>
          <h2 style={h2Style}>Build an aturi.to link</h2>
          <p style={pStyle}>
            Universal links need no SDK at all: just rewrite an AT URI into an{' '}
            <code>aturi.to/profile/…</code> URL and the recipient picks their
            client on a friendly landing page.
          </p>
          <CodeBlock label="ts" code={linkExample} />
        </section>

        {/* License */}
        <section id="license" className="card" style={sectionStyle}>
          <h2 style={h2Style}>License</h2>
          <p style={{ ...pStyle, margin: 0 }}>
            <code>@aturi.to/waypoints</code> and{' '}
            <code>@aturi.to/waypoints-react</code> are MIT © atpotato, LLC. The
            aturi.to web app and browser extension are licensed GPL-3.0; the
            packages are intentionally dual-licensed MIT so other Atmosphere
            developers can adopt them freely.
          </p>
        </section>

        <p
          style={{
            textAlign: 'center',
            color: 'var(--text-tertiary)',
            fontSize: '0.9rem',
            marginTop: '2rem',
          }}
        >
          Building an Atmosphere client and want it in the catalog?{' '}
          <Link href="/links">See the supported waypoints</Link> or open a PR.
        </p>
      </div>
    </>
  );
}
