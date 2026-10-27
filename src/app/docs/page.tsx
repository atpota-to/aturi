import type { Metadata } from 'next';
import Link from 'next/link';
import { Package } from 'lucide-react';
import Header from '@/components/Header';
import CodeBlock from '@/components/docs/CodeBlock';
import DocsToc from '@/components/docs/DocsToc';
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

// The published core package, linked from the page header rather than buried
// in the "Core package" section: the first thing a developer wants off this
// page is somewhere to go look at the thing before installing it.
const NPMX_CORE_URL = 'https://npmx.dev/package/@aturi.to/waypoints';

const TOC: { id: string; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'core', label: 'Core package' },
  { id: 'react', label: 'React picker' },
  { id: 'resolve-api', label: 'Resolve API' },
  { id: 'compose', label: 'Compose intents' },
  { id: 'links', label: 'Universal links' },
  { id: 'preferred-clients', label: 'Preferred clients' },
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
// ['anisota', 'bluesky', 'impro', 'blacksky', 'witchsky', 'mu', 'deer', 'northsky']

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

const preferredClientsExample = `import {
  PREFERRED_CLIENTS_NSID,
  getPreferredClient,
  getPreferredClientUrl,
  parsePreferredClients,
} from '@aturi.to/waypoints';

// The signed-in viewer's declaration: one getRecord on their own repo.
const res = await agent.com.atproto.repo
  .getRecord({ repo: viewerDid, collection: PREFERRED_CLIENTS_NSID, rkey: 'self' })
  .catch(() => null); // not declared, or unreachable: keep your default
const declaration = parsePreferredClients(res?.data.value);

const client = getPreferredClient(declaration, 'bluesky-social', { platform: 'mobile' });
const href = client && getPreferredClientUrl(client, 'at://did:plc:abc/app.bsky.feed.post/3k7');
// 'https://blacksky.community/profile/did:plc:abc/post/3k7', or null`;

const preferredClientsRecord = `{
  "$type": "to.aturi.actor.preferredClients",
  "preferences": [
    {
      "category": "bluesky-social",
      "client": {
        "url": "https://bsky.app",
        "name": "Bluesky",
        "waypoint": "bluesky",
        "templates": {
          "profile": "https://bsky.app/profile/{handle}",
          "post": "https://bsky.app/profile/{handle}/post/{rkey}",
          "list": "https://bsky.app/profile/{handle}/lists/{rkey}"
        }
      },
      "mobile": { "url": "https://blacksky.community", "name": "Blacksky", … }
    },
    { "category": "atproto-explorer", "client": { "url": "https://pdsls.dev", … } }
  ],
  "updatedAt": "2026-10-27T12:00:00.000Z"
}`;

const linkReactExample = `import { UniversalLinkButton } from '@aturi.to/waypoints-react';

// Native share sheet on phones, clipboard everywhere else.
<UniversalLinkButton target={post.uri} />`;

export default function DocsPage() {
  return (
    <>
      <Header compact />
      <div className="fn-c-wrap">
        {/* Page header */}
        <header className="fn-c-head fn-docs-head">
          <h1 className="fn-c-title">Developer docs</h1>
          <p className="fn-c-lede">
            Add Atmosphere “Open in…” links, smart client recommendations,
            compose intents, and AT-URI resolution to your own app, with two
            MIT-licensed packages and a public API.
          </p>
          <div className="fn-docs-actions">
            <a
              href={NPMX_CORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="fn-c-pill"
            >
              <Package size={14} aria-hidden />
              <span>@aturi.to/waypoints</span>
              <span className="fn-c-pill-dim">on npmx ↗</span>
            </a>
            <CopyMarkdownButton markdown={DOCS_MARKDOWN} />
            <a href="/docs.md" className="fn-docs-raw">
              View raw .md →
            </a>
          </div>
          <p className="fn-docs-note">
            Building with an LLM or coding agent? Grab the whole page as Markdown.
          </p>
        </header>

        <div className="fn-docs-layout">
          {/* Table of contents; marks the section in view. */}
          <DocsToc items={TOC} />

          <article className="fn-c-sheet fn-prose">
            {/* Overview */}
            <section id="overview">
              <h2>Overview</h2>
              <p>
                The same waypoint catalog, recommendations, and link logic that
                power aturi.to are published as two standalone, MIT-licensed npm
                packages so you can drop them into any Atmosphere (AT Protocol)
                app:
              </p>
              <ul>
                <li>
                  <code>@aturi.to/waypoints</code>, a zero-dependency,
                  framework-agnostic core: the client catalog, per-client
                  “Open in…” link builders, recommendations, and URL ⇄ AT-URI
                  resolution. Works in the browser, Node 18+, and edge runtimes.
                </li>
                <li>
                  <code>@aturi.to/waypoints-react</code>: a headless-first React
                  picker UI plus client icons, built on the core. Ships zero CSS
                  by default and is fully themeable.
                </li>
              </ul>
              <p>
                Both are dual-licensed <strong>MIT</strong> (the aturi.to app
                itself is GPL-3.0) to remove the adoption barrier. Prefer not to
                install anything? The hosted{' '}
                <a href="#resolve-api">Resolve API</a> does the same work over
                HTTP.
              </p>
            </section>

            {/* Core package */}
            <section id="core">
              <h2>
                <code>@aturi.to/waypoints</code>
              </h2>
              <p>
                The zero-dependency core. Turn an AT URI into per-client links,
                recommend the best client for a record type, and reverse-resolve a
                pasted URL back into an AT URI.
              </p>
              <CodeBlock label="bash" code={coreInstall} />

              <h3>Resolve an AT URI or a pasted URL</h3>
              <CodeBlock label="ts" code={coreExample} />

              <h3>What’s included</h3>
              <ul>
                <li>
                  <strong>High-level resolvers:</strong> <code>resolveAtUri</code>,{' '}
                  <code>resolveUrl</code>, <code>buildWaypointsForParsed</code>,
                  and <code>resolveViaApi</code> (a typed client for the hosted
                  endpoint).
                </li>
                <li>
                  <strong>Catalog &amp; recommendations:</strong>{' '}
                  <code>getWaypointDataForType</code>,{' '}
                  <code>getCategorizedWaypointsData</code>,{' '}
                  <code>getRecommendedWaypointsData</code>, and the raw{' '}
                  <code>WAYPOINT_DESTINATIONS_DATA</code> catalog.
                </li>
                <li>
                  <strong>Parsing:</strong> <code>parseURI</code>,{' '}
                  <code>parseAtUri</code>, <code>matchSupportedUrl</code>,{' '}
                  <code>resolveHandle</code>.
                </li>
                <li>
                  <strong>Capabilities:</strong> <code>supportsComposeIntent</code>,{' '}
                  <code>getComposeIntentUrl</code>,{' '}
                  <code>getComposeIntentWaypoints</code> — see{' '}
                  <a href="#compose">compose intents</a>.
                </li>
              </ul>
              <p>
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
            <section id="react">
              <h2>
                <code>@aturi.to/waypoints-react</code>
              </h2>
              <p>
                A drop-in React “Open in…” picker. Headless-first: it ships zero
                CSS and emits stable, namespaced styling hooks, so you can use your
                own design system, opt into the polished theme, or drop down to a
                hook and render everything yourself. It re-exports the entire core,
                so a single install gives you the components and the resolvers.
              </p>
              <CodeBlock label="bash" code={reactInstall} />

              <h3>1. Drop-in picker</h3>
              <p>
                Renders clean semantic markup with no CSS attached. Every element
                carries a <code>data-aturi-wp</code> attribute and an{' '}
                <code>aturi-wp-*</code> class; map your own via <code>classNames</code>,
                pass <code>unstyled</code> to drop the built-ins, or replace rows
                with the <code>renderWaypoint</code> prop.
              </p>
              <CodeBlock label="tsx" code={reactPicker} />

              <h3>2. The useWaypoints hook</h3>
              <p>
                For full control, the hook returns render-ready data plus{' '}
                <code>copy</code> / <code>open</code> helpers: no markup at all.
              </p>
              <CodeBlock label="tsx" code={reactHook} />

              <h3>3. The polished theme (opt-in)</h3>
              <p>
                Want the Aturi look without writing CSS? Import the stylesheet
                once. It targets the namespaced classes and is fully themeable via{' '}
                <code>--aturi-wp-*</code> CSS custom properties (with light/dark
                defaults).
              </p>
              <CodeBlock label="tsx" code={reactTheme} />

              <p>
                <strong>Server vs. client:</strong> the package is a client
                component (it carries <code>&quot;use client&quot;</code>), so it
                works out of the box in the Next.js App Router. For framework-agnostic
                helpers inside a Server Component, import them from{' '}
                <code>@aturi.to/waypoints</code> directly.
              </p>
            </section>

            {/* Resolve API */}
            <section id="resolve-api">
              <h2>Resolve API</h2>
              <p>
                Don’t want to install anything? Hit the hosted endpoint from a
                share sheet, an Apple Shortcut, or any client: no login, no API
                keys. It returns the resolved waypoints and recommendations for a
                page URL or an AT URI.
              </p>
              <CodeBlock label="http" code={resolveApi} />
              <p>
                The core package’s <code>resolveViaApi()</code> is a typed client
                for this endpoint. It’s the right choice from a browser, where
                fetching arbitrary pages is blocked by CORS.
              </p>
              <p>
                To ask about the catalog itself rather than a specific record —
                what’s in it, and which clients can do what — there’s a companion
                endpoint: <code>GET /api/waypoints</code>, filterable by{' '}
                <code>?type=</code> and <code>?capability=</code>.
              </p>
            </section>

            {/* Compose intents */}
            <section id="compose">
              <h2>Compose intents</h2>
              <p>
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
              <p>
                Two nuances worth reading off the data rather than assuming.{' '}
                <code>prefillsText</code> is <code>false</code> for a client that
                routes the intent but ignores the text, so a “share this” link would
                open an empty composer — fine as a jump, useless as a share. And{' '}
                <code>appUrl</code> appears only where the client publishes a native
                scheme, so it’s a bonus, not a fallback.
              </p>
              <p>
                Over HTTP, the same data comes back on both endpoints. Pass the text
                to get finished links, or take <code>urlTemplate</code> and
                substitute the URL-encoded text for <code>{'{text}'}</code>{' '}
                yourself.
              </p>
              <CodeBlock label="http" code={composeApi} />
              <CodeBlock label="json" code={composeResponse} />
              <p>
                In React, each <code>useWaypoints</code> entry carries the same{' '}
                <code>composeIntent</code>; pass <code>composeText</code> to the
                hook to have the links built for you.
              </p>
            </section>

            {/* Universal links */}
            <section id="links">
              <h2>Build an aturi.to link</h2>
              <p>
                A universal link is the client-agnostic address of a record: paste
                an <code>aturi.to/…</code> URL anywhere and the recipient gets a
                preview plus every client that can open it, rather than being
                pushed into whichever app you happen to use. It&rsquo;s just a URL,
                so no SDK is required. The core package builds it from anything that
                names a record, and adds the strings a copy button or a share sheet
                needs around it.
              </p>
              <CodeBlock label="ts" code={linkExample} />
              <p>
                <code>parseUniversalLink</code> goes the other way, turning an
                aturi.to URL back into an AT URI. In React,{' '}
                <code>&lt;UniversalLinkButton&gt;</code> is the whole control: a
                native share sheet in browsers that implement{' '}
                <code>navigator.share</code>, the clipboard in the ones that
                don&rsquo;t. <code>useUniversalLink</code> is the same logic without
                markup.
              </p>
              <CodeBlock label="tsx" code={linkReactExample} />

              <h3>Make your own pages resolvable</h3>
              <p>
                If your app renders atproto records,{' '}
                <code>buildUniversalLinkTags</code> writes the{' '}
                <code>&lt;head&gt;</code> tags that let the rest of the Atmosphere
                find its way back to them.
              </p>
              <CodeBlock label="ts" code={linkTagsExample} />
              <p>
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

            {/* Preferred clients */}
            <section id="preferred-clients">
              <h2>Preferred clients</h2>
              <p>
                People can publish which client they use for each kind of link, as
                a public <code>to.aturi.actor.preferredClients/self</code> record in
                their own repository (
                <a
                  href="https://github.com/atpota-to/aturi/blob/testing/lexicons/to/aturi/actor/preferredClients.json"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  schema
                </a>
                ). If your app links out to Bluesky posts or atproto records, read
                the signed-in viewer&rsquo;s declaration and send them straight to
                their client, instead of bsky.app or a picker.
              </p>
              <CodeBlock label="ts" code={preferredClientsExample} />
              <p>
                Two categories are defined so far: <code>bluesky-social</code>{' '}
                (Bluesky posts, profiles and lists, in a Bluesky client) and{' '}
                <code>atproto-explorer</code> (any record or repository, in a raw
                record explorer). Each preference has a <code>client</code> for any
                device and may add <code>mobile</code> and <code>desktop</code>{' '}
                overrides. Pass <code>platform</code> when you know the
                viewer&rsquo;s device (<code>clientPlatformFromUserAgent</code>{' '}
                reads one off a user agent); without it, only <code>client</code>{' '}
                counts.
              </p>
              <CodeBlock label="json" code={preferredClientsRecord} />
              <p>
                Every declared client carries its own URL templates, so you
                don&rsquo;t need the package to act on a record:{' '}
                <code>{'{handle}'}</code>, <code>{'{did}'}</code>,{' '}
                <code>{'{actor}'}</code> (the DID, else the handle),{' '}
                <code>{'{collection}'}</code> and <code>{'{rkey}'}</code>, filled
                with percent-encoded values. Follow the result only if it&rsquo;s an
                http(s) URL: the record is the viewer&rsquo;s to write, and{' '}
                <code>getPreferredClientUrl</code> already refuses anything else.
              </p>
              <p>
                To write one, <code>clientFromWaypoint(&apos;blacksky&apos;)</code>{' '}
                turns a catalog entry into a declared client, templates included,
                and <code>buildPreferredClientsRecord</code> stamps the result ready
                for <code>putRecord</code>. Signed-in visitors can publish theirs
                from the <Link href="/account#clients">Clients</Link> settings tab,
                and aturi.to&rsquo;s own auto-redirect follows it wherever they
                haven&rsquo;t picked a favorite.
              </p>
            </section>

            {/* License */}
            <section id="license">
              <h2>License</h2>
              <p>
                <code>@aturi.to/waypoints</code> and{' '}
                <code>@aturi.to/waypoints-react</code> are MIT © atpotato, LLC. The
                aturi.to web app and browser extension are licensed GPL-3.0; the
                packages are intentionally dual-licensed MIT so other Atmosphere
                developers can adopt them freely.
              </p>
            </section>

          </article>
        </div>

        <p className="fn-docs-foot">
          Building an Atmosphere client and want it in the catalog?{' '}
          <Link href="/links">See the supported waypoints</Link> or open a PR.
        </p>
      </div>
    </>
  );
}
