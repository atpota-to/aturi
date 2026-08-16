import type { Metadata } from 'next';
import Link from 'next/link';
import { Package } from 'lucide-react';
import Header from '@/components/Header';
import CodeBlock from '@/components/docs/CodeBlock';
import CopyMarkdownButton from '@/components/docs/CopyMarkdownButton';
import { DOCS_MARKDOWN } from './markdown';

const DESCRIPTION =
  'Add Atmosphere “Open in…” links, per-type client recommendations, compose intents, and AT-URI resolution to your own app with the @aturi.to/waypoints packages and the public Resolve API.';

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
// across the site's content pages (see src/app/terms/page.tsx). Every size is a
// step of the site-wide type scale; the section box itself is `.docs-section`,
// and a `.card` alongside it means the section holds code you can copy.
const h2Style: React.CSSProperties = {
  fontSize: 'var(--type-heading)',
  fontWeight: 300,
  color: 'var(--text-primary)',
  letterSpacing: '-0.01em',
  lineHeight: 1.2,
  margin: '0 0 1rem',
};
const h3Style: React.CSSProperties = {
  fontSize: 'var(--type-lead)',
  fontWeight: 600,
  lineHeight: 1.4,
  color: 'var(--text-primary)',
  margin: '1.75rem 0 0.5rem',
};
const pStyle: React.CSSProperties = {
  color: 'var(--text-secondary)',
  fontSize: 'var(--type-body)',
  lineHeight: 1.65,
  margin: '0 0 1rem',
};
const liStyle: React.CSSProperties = {
  color: 'var(--text-secondary)',
  fontSize: 'var(--type-body)',
  lineHeight: 1.65,
  marginBottom: '0.4rem',
};

// The published core package, linked from the page header rather than buried
// in the "Core package" section: the first thing a developer wants off this
// page is somewhere to go look at the thing before installing it.
const NPMX_CORE_URL = 'https://npmx.dev/package/@aturi.to/waypoints';

// One name per section, used here, in the section's own <h2>, and in the
// Markdown mirror's `##` heading, so a chip's accessible name always matches
// the heading it jumps to.
const TOC: { id: string; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'core', label: '@aturi.to/waypoints' },
  { id: 'react', label: '@aturi.to/waypoints-react' },
  { id: 'resolve-api', label: 'Resolve API' },
  { id: 'waypoints', label: 'Waypoints API' },
  { id: 'compose', label: 'Compose intents' },
  { id: 'links', label: 'Build an aturi.to link' },
  { id: 'preferences', label: 'Preferences and storage' },
  { id: 'license', label: 'License and catalog' },
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

const waypointsApi = `GET https://aturi.to/api/waypoints
GET https://aturi.to/api/waypoints?type=post
GET https://aturi.to/api/waypoints?capability=compose
GET https://aturi.to/api/waypoints?capability=compose&text=<encoded-text>`;

const composeExample = `import {
  WAYPOINT_DESTINATIONS_DATA,
  getComposeIntentUrl,
  getComposeIntentWaypoints,
  supportsComposeIntent,
} from '@aturi.to/waypoints';

// Which clients will open a composer for you?
getComposeIntentWaypoints().map((w) => w.id);
// ['anisota', 'bluesky', 'impro', 'blacksky', 'witchsky', 'mu', 'deer', 'northsky']

supportsComposeIntent(WAYPOINT_DESTINATIONS_DATA.deer); // true
getComposeIntentUrl(WAYPOINT_DESTINATIONS_DATA.deer, 'hello from my app');
// 'https://deer.social/intent/compose?text=hello%20from%20my%20app'`;

const composeApi = `GET https://aturi.to/api/resolve?atUri=at://...&composeText=<encoded-text>`;

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

const linkExample = `import {
  buildUniversalLink,
  describeUniversalLink,
} from '@aturi.to/waypoints';

// Anything that names a record: an AT URI, a handle, a DID, or a page URL
// from any client in the catalog.
buildUniversalLink('at://did:plc:abc/app.bsky.feed.post/3k7');
// 'https://aturi.to/profile/did:plc:abc/post/3k7'
buildUniversalLink('https://bsky.app/profile/alice.bsky.social/post/3k7');
// 'https://aturi.to/profile/alice.bsky.social/post/3k7'

// Everything a copy button or a share sheet needs:
const link = describeUniversalLink('at://alice.bsky.social/app.bsky.feed.post/3k7');
link.label;             // 'Post by @alice.bsky.social'
link.share;             // { title, text, url }; hand it to navigator.share()
link.snippets.markdown; // '[Post by @alice.bsky.social](https://aturi.to/…)'`;

const linkTagsExample = `import { buildUniversalLinkTags } from '@aturi.to/waypoints';

buildUniversalLinkTags('at://did:plc:abc/app.bsky.feed.post/3k7').html;
// <meta name="at:canonical" content="at://did:plc:abc/app.bsky.feed.post/3k7" />
// <meta name="at:author" content="at://did:plc:abc" />
// <link rel="alternate" href="at://did:plc:abc/app.bsky.feed.post/3k7" />
// <link rel="alternate" type="application/json+oembed" href="https://aturi.to/api/oembed?url=…" />`;

const linkReactExample = `import { UniversalLinkButton } from '@aturi.to/waypoints-react';

// Native share sheet on phones, clipboard everywhere else.
<UniversalLinkButton target={post.uri} />`;

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
              fontSize: 'var(--type-display)',
              fontWeight: 300,
              letterSpacing: '-0.01em',
              lineHeight: 1.15,
              margin: '0 0 1rem',
            }}
          >
            Developer docs
          </h1>
          <p
            style={{
              color: 'var(--text-secondary)',
              fontSize: 'var(--type-lead)',
              lineHeight: 1.6,
              margin: 0,
            }}
          >
            Add Atmosphere “Open in…” links, per-type client recommendations,
            compose intents, and AT-URI resolution to your own app, with two
            MIT-licensed packages and a public API.
          </p>
          {/* One action row: where the package lives, the whole page as
              Markdown, and the raw file. Color on the npmx chip is left to the
              global `a` rule so it picks up the accent color and its hover
              transition — this page is a Server Component, so the inline hover
              handlers used by the Copy button aren't available here. */}
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
            <a
              href={NPMX_CORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.45rem',
                padding: '0.45rem 0.85rem',
                border: '1px solid var(--border-subtle)',
                background: 'var(--bg-tertiary)',
                fontFamily: 'var(--font-mono)',
                fontSize: 'var(--type-small)',
              }}
            >
              <Package size={14} strokeWidth={1.5} aria-hidden />
              <span>@aturi.to/waypoints</span>
              <span style={{ color: 'var(--text-tertiary)' }}>on npmx ↗</span>
            </a>
            <CopyMarkdownButton markdown={DOCS_MARKDOWN} />
            <a
              href="/docs.md"
              style={{
                fontSize: 'var(--type-small)',
                color: 'var(--text-tertiary)',
                fontFamily: 'var(--font-mono)',
              }}
            >
              View raw .md →
            </a>
          </div>
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
                fontSize: 'var(--type-small)',
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
        <section id="overview" className="docs-section">
          <h2 style={h2Style}>Overview</h2>
          <p style={pStyle}>
            The same waypoint catalog, recommendations, and link logic that
            power aturi.to are published as two standalone, MIT-licensed npm
            packages so you can drop them into any Atmosphere (AT Protocol)
            app:
          </p>
          <ul style={{ paddingLeft: '1.25rem', margin: 0 }}>
            <li style={liStyle}>
              <code>@aturi.to/waypoints</code>, a zero-dependency,
              framework-agnostic core: the client catalog, per-client
              “Open in…” link builders, recommendations, and URL ⇄ AT-URI
              resolution. Works in the browser, Node 18+, and edge runtimes.
            </li>
            <li style={{ ...liStyle, marginBottom: 0 }}>
              <code>@aturi.to/waypoints-react</code>: the React picker UI and
              the client icons, built on the core.
            </li>
          </ul>
        </section>

        {/* Core package */}
        <section id="core" className="card docs-section">
          <h2 style={h2Style}>
            <code>@aturi.to/waypoints</code>
          </h2>
          <p style={pStyle}>
            The zero-dependency core. Turn an AT URI into per-client links,
            recommend the best client for a record type, and reverse-resolve a
            pasted URL back into an AT URI.
          </p>
          <CodeBlock code={coreInstall} />

          <h3 style={h3Style}>Resolve an AT URI or a pasted URL</h3>
          <CodeBlock code={coreExample} />

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
              <code>getComposeIntentWaypoints</code>. See{' '}
              <a href="#compose">compose intents</a>.
            </li>
            <li style={liStyle}>
              <strong>Universal links:</strong> <code>buildUniversalLink</code>,{' '}
              <code>parseUniversalLink</code>,{' '}
              <code>describeUniversalLink</code>,{' '}
              <code>buildUniversalLinkTags</code>. See{' '}
              <a href="#links">build an aturi.to link</a>.
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
        <section id="react" className="card docs-section">
          <h2 style={h2Style}>
            <code>@aturi.to/waypoints-react</code>
          </h2>
          <p style={pStyle}>
            A drop-in React “Open in…” picker. It re-exports the entire core,
            so a single install gives you the components and the resolvers.
          </p>
          <CodeBlock code={reactInstall} />

          <h3 style={h3Style}>1. Drop-in picker</h3>
          <p style={pStyle}>
            Every element carries a <code>data-aturi-wp</code> attribute and an{' '}
            <code>aturi-wp-*</code> class; map your own via <code>classNames</code>,
            pass <code>unstyled</code> to drop the built-ins, or replace rows
            with the <code>renderWaypoint</code> prop.
          </p>
          <CodeBlock code={reactPicker} />

          <h3 style={h3Style}>2. The useWaypoints hook</h3>
          <p style={pStyle}>
            The hook returns render-ready data plus <code>copy</code> /{' '}
            <code>open</code> helpers, and renders nothing.
          </p>
          <CodeBlock code={reactHook} />

          <h3 style={h3Style}>3. The stylesheet (opt-in)</h3>
          <p style={pStyle}>
            Import the stylesheet once to get the Aturi look without writing
            CSS. The package ships zero CSS otherwise; the sheet targets the
            namespaced classes and is themeable through{' '}
            <code>--aturi-wp-*</code> custom properties, with light and dark
            defaults.
          </p>
          <CodeBlock code={reactTheme} />

          <p style={{ ...pStyle, margin: '1rem 0 0' }}>
            <strong>Server vs. client:</strong> the package is a client
            component (it carries <code>&quot;use client&quot;</code>), so it
            works out of the box in the Next.js App Router. For framework-agnostic
            helpers inside a Server Component, import them from{' '}
            <code>@aturi.to/waypoints</code> directly.
          </p>
        </section>

        {/* Resolve API */}
        <section id="resolve-api" className="card docs-section">
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
            A companion endpoint answers questions about the catalog itself
            rather than a specific record: what is in it, and which clients can
            do what. See the <a href="#waypoints">Waypoints API</a>.
          </p>
        </section>

        {/* Waypoints API */}
        <section id="waypoints" className="card docs-section">
          <h2 style={h2Style}>Waypoints API</h2>
          <p style={pStyle}>
            <code>GET /api/waypoints</code> returns the catalog itself, with no
            record to resolve first. Same terms as the Resolve API: no login,
            no keys, CORS open to any origin, responses cached for an hour.
          </p>
          <CodeBlock label="http" code={waypointsApi} />
          <ul style={{ paddingLeft: '1.25rem', margin: '0 0 1rem' }}>
            <li style={liStyle}>
              <code>type</code> takes <code>post</code>, <code>profile</code>,{' '}
              <code>list</code>, <code>record</code>, or <code>unknown</code>,
              and keeps the clients that render that type.
            </li>
            <li style={liStyle}>
              <code>capability</code> takes one value today,{' '}
              <code>compose</code>, and keeps the clients with a compose intent
              route.
            </li>
            <li style={liStyle}>
              <code>text</code> pre-fills the compose intent links in the
              response, so you get finished URLs back instead of templates.
            </li>
          </ul>
          <p style={{ ...pStyle, margin: 0 }}>
            An unknown <code>type</code> or <code>capability</code> is a 400
            rather than an empty list. The response carries <code>ok</code>,
            the <code>filters</code> it applied, a <code>count</code>, and the{' '}
            <code>waypoints</code> array; each entry has its id, name,
            description, category, supported types, its{' '}
            <code>expectedCollections</code> where the catalog records them,
            and its <code>composeIntent</code> or <code>null</code>.
          </p>
        </section>

        {/* Compose intents */}
        <section id="compose" className="card docs-section">
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
            route, so the catalog records which ones do. Every waypoint carries
            a <code>composeIntent</code>, <code>null</code> when the client has
            no confirmed route.
          </p>
          <CodeBlock code={composeExample} />
          <p style={pStyle}>
            Two fields to read off the data rather than assume.{' '}
            <code>prefillsText</code> is <code>false</code> for a client that
            routes the intent but ignores the text, so a “share this” link would
            open an empty composer: fine as a jump, useless as a share. And{' '}
            <code>appUrl</code> appears only where the client publishes a native
            scheme, so it’s a bonus, not a fallback.
          </p>
          <p style={pStyle}>
            Over HTTP, pass the text and the links come back built:{' '}
            <code>text</code> on the <a href="#waypoints">Waypoints API</a>,{' '}
            <code>composeText</code> on any resolve call. Or take{' '}
            <code>urlTemplate</code> and substitute the URL-encoded text for{' '}
            <code>{'{text}'}</code> yourself.
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
        <section id="links" className="card docs-section">
          <h2 style={h2Style}>Build an aturi.to link</h2>
          <p style={pStyle}>
            A universal link is the client-agnostic address of a record.
            It&rsquo;s just a URL, so no SDK is required. The core package
            builds it from anything that names a record, and adds the strings a
            copy button or a share sheet needs around it.
          </p>
          <CodeBlock code={linkExample} />
          <p style={pStyle}>
            Three options change what comes out: <code>origin</code> points the
            link at your own deployment, <code>did</code> plus{' '}
            <code>preferDid</code> address it by DID so a handle change
            doesn&rsquo;t break it, and <code>params</code> appends query
            parameters.
          </p>
          <p style={pStyle}>
            <code>parseUniversalLink</code> goes the other way, turning an
            aturi.to URL back into an AT URI. In React,{' '}
            <code>&lt;UniversalLinkButton&gt;</code> is the whole control: a
            native share sheet in browsers that implement{' '}
            <code>navigator.share</code>, the clipboard in the ones that
            don&rsquo;t. <code>useUniversalLink</code> is the same logic without
            markup.
          </p>
          <CodeBlock code={linkReactExample} />

          <h3 style={h3Style}>URL shapes</h3>
          <p style={pStyle}>
            What <code>buildUniversalLink</code> emits, where{' '}
            <code>{'{id}'}</code> is whichever of the handle or the DID it was
            given:
          </p>
          <ul style={{ paddingLeft: '1.25rem', margin: '0 0 1rem' }}>
            <li style={liStyle}>
              <code>/profile/{'{id}'}</code> for a profile or a bare identity.
            </li>
            <li style={liStyle}>
              <code>/profile/{'{id}'}/post/{'{rkey}'}</code> for{' '}
              <code>app.bsky.feed.post</code>.
            </li>
            <li style={liStyle}>
              <code>/profile/{'{id}'}/lists/{'{rkey}'}</code> for{' '}
              <code>app.bsky.graph.list</code>.
            </li>
            <li style={liStyle}>
              <code>/profile/{'{did}'}/{'{collection}'}/{'{rkey}'}</code> for
              every other collection, falling back to the handle when no DID is
              known.
            </li>
          </ul>
          <p style={{ ...pStyle, margin: 0 }}>
            <code>parseUniversalLink</code> reads those back, plus three more
            shapes the site serves: the explorer&rsquo;s{' '}
            <code>/explore/{'{id}'}/{'{collection}'}/{'{rkey}'}</code> record
            views, the legacy bare path{' '}
            <code>aturi.to/{'{handle}'}/{'{collection}'}/{'{rkey}'}</code>{' '}
            without the <code>/profile</code> prefix, and an AT URI sitting in
            the path (<code>aturi.to/at://…</code>).
          </p>

          <h3 style={h3Style}>Make your own pages resolvable</h3>
          <p style={pStyle}>
            If your app renders atproto records,{' '}
            <code>buildUniversalLinkTags</code> writes the{' '}
            <code>at:canonical</code>, <code>at:author</code> and{' '}
            <code>alternate</code> <code>&lt;head&gt;</code> tags for the
            record.
          </p>
          <CodeBlock code={linkTagsExample} />
          <p style={{ ...pStyle, margin: 0 }}>
            <code>at:canonical</code> is the{' '}
            <a
              href="https://tangled.org/chrisshank.com/at-tags/"
              target="_blank"
              rel="noopener noreferrer"
            >
              AT Tags proposal
            </a>
            . The Aturi extension reads it off the live page and{' '}
            <a href="#resolve-api">the Resolve API</a> reads it off your HTML,
            so a link to your page resolves into every other client that can
            open the record, without your app being in the catalog at all. The
            oEmbed pointer is emitted for posts, so a link to your page
            previews as the post it is. They&rsquo;re static strings describing
            a record you already display, and serving them hands nothing to
            aturi.to.
          </p>
        </section>

        {/* Preferences and storage */}
        <section id="preferences" className="docs-section">
          <h2 style={h2Style}>Preferences and storage</h2>
          <p style={pStyle}>
            On aturi.to, a signed-in visitor&rsquo;s picker preferences are
            written to their own repo as a{' '}
            <code>to.aturi.actor.preferences/self</code> record, with a
            localStorage copy (<code>aturi.prefs.v1</code>) behind it for
            anonymous use and for when the PDS isn&rsquo;t reachable. The
            record is what loads on the next device that account signs in to,
            and because it lives in the user&rsquo;s repo it travels with the
            account rather than with aturi.to.
          </p>
          <p style={{ ...pStyle, margin: 0 }}>
            The browser extension keeps its own copy in extension storage:{' '}
            <code>chrome.storage.sync</code> first, falling back to{' '}
            <code>chrome.storage.local</code> when the sync quota is hit.
            Auto-redirect is off by default, and the favorite client is stored
            per compatibility group rather than per lexicon, so Bluesky
            clients, publications and Tangled each get their own destination.
            Turning auto-redirect off leaves the popup working. Groups double
            as the popup&rsquo;s visibility list: a waypoint that is in no
            group doesn&rsquo;t appear.
          </p>
        </section>

        {/* License and catalog */}
        <section id="license" className="docs-section">
          <h2 style={h2Style}>License and catalog</h2>
          <p
            style={{
              color: 'var(--text-tertiary)',
              fontSize: 'var(--type-small)',
              lineHeight: 1.65,
              margin: 0,
            }}
          >
            @aturi.to/waypoints and @aturi.to/waypoints-react are MIT ©
            atpotato, LLC. The aturi.to web app and browser extension are
            licensed GPL-3.0. To get an Atmosphere client into the catalog,{' '}
            <Link href="/links">see the supported waypoints</Link> and open a
            PR.
          </p>
        </section>
      </div>
    </>
  );
}
