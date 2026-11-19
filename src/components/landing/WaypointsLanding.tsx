'use client';

import Link from 'next/link';
import {
  ArrowRight,
  BookOpen,
  Code2,
  Compass,
  Globe,
  Layers,
  Link2,
  MapPin,
  Package,
  PenLine,
  Signpost,
  Sparkles,
  Tags,
  UserCog,
} from 'lucide-react';
import AppearIn from '@/components/explore/AppearIn';
import CodeBlock from '@/components/docs/CodeBlock';
import CrossLinkCards from './CrossLinkCards';
import FeatureSection from './FeatureSection';
import LinksHeroVisual from './LinksHeroVisual';
import UrlAnatomyVisual from './UrlAnatomyVisual';
import RecordTypesGrid from './RecordTypesGrid';
import PickerPreviewVisual from './PickerPreviewVisual';
import {
  CATEGORY_ORDER,
  WAYPOINT_CATEGORIES,
  WAYPOINT_DESTINATIONS,
  WAYPOINT_ORDER,
  getWaypointCount,
} from '@/utils/waypoints';
import { getComposeIntentWaypoints } from '@/utils/waypoints.data';

const DEMO_HANDLE = 'aturi.to';
// Aturi's own DID — hardcoded so the carousel can build did-aware URLs
// without a runtime profile fetch.
const DEMO_DID = 'did:plc:6teuhlkizzebk6wdp42633el';

/**
 * Where a developer goes next. The integration guide is the page's main call
 * to action, so it leads the hero and closes the page; the package itself is
 * the secondary one, for someone who wants to look before reading.
 */
const DOCS_HREF = '/docs';
const NPMX_CORE_URL = 'https://npmx.dev/package/@aturi.to/waypoints';
const CATALOG_PR_URL =
  'https://github.com/atpota-to/aturi/blob/main/CONTRIBUTING.md#adding-a-waypoint';

/**
 * The shortest honest example: one install, one call, and what comes back.
 * The guide's own first example, cut down to the AT URI case.
 */
const QUICKSTART = `npm install @aturi.to/waypoints

import { resolveAtUri } from '@aturi.to/waypoints';

const result = resolveAtUri('at://did:plc:abc/app.bsky.feed.post/3k7');
result?.recommended.label; // 'Recommended for Posts'
result?.waypoints[0];      // { id: 'anisota', name: 'Anisota', url, … }`;

/**
 * The catalog by category, in the order the picker lists them. Forks get a
 * group of their own here rather than nesting under Bluesky clients as they
 * do in the picker: on a page that shows the whole catalog at once, a flat
 * run of groups is easier to scan.
 */
function catalogGroups() {
  return CATEGORY_ORDER.map((id) => ({
    id,
    name: WAYPOINT_CATEGORIES[id]?.name ?? id,
    waypoints: WAYPOINT_ORDER.map((wid) => WAYPOINT_DESTINATIONS[wid]).filter(
      (w) => w && w.category === id,
    ),
  })).filter((group) => group.waypoints.length > 0);
}

/**
 * `/waypoints`: what aturi.to's client catalog does for the people who share
 * links and for the people who build apps. Universal links are the part most
 * visitors meet first, so they come first; the catalog behind them and the
 * packages that ship it follow, and every road ends at the integration guide.
 */
export default function WaypointsLanding() {
  const count = getWaypointCount();
  const composeCount = getComposeIntentWaypoints().length;
  const groups = catalogGroups();

  return (
    <div className="fl-page">
      {/* Hero */}
      <AppearIn rise>
        <header className="fl-hero">
          <div className="fl-hero-copy">
            <span className="fl-pill">
              <Signpost size={13} aria-hidden /> Waypoints
            </span>
            <h1 className="fl-title">
              Every record, <span className="fl-title-accent">in every Atmosphere app</span>
            </h1>
            <p className="fl-lede">
              Waypoints is aturi.to&rsquo;s map of the Atmosphere: {count} clients,
              the records each one can open, and the exact URL that opens them.
              Share a universal link and let people choose where to read it, or
              put the same &ldquo;Open in&hellip;&rdquo; picker in your own app.
            </p>
            <p className="fl-meta">
              <MapPin size={14} aria-hidden />
              {count} clients · MIT packages · no API key
            </p>
            <div className="fl-hero-actions" data-row="">
              <Link href={DOCS_HREF} className="fl-button" data-variant="primary">
                Read the integration guide
                <ArrowRight size={15} aria-hidden />
              </Link>
              <Link href={`/profile/${DEMO_HANDLE}`} prefetch={false} className="fl-button">
                See a live universal link
              </Link>
            </div>
          </div>
          <div className="fl-hero-visual">
            <LinksHeroVisual handle={DEMO_HANDLE} did={DEMO_DID} />
          </div>
        </header>
      </AppearIn>

      <AppearIn delay={0.05} id="links">
        <FeatureSection
          badge={{ icon: <Sparkles size={12} />, label: 'Universal links' }}
          title="A friendly landing page for every record"
          body={
            <>
              <p>
                Drop an <code>aturi.to</code> link anywhere: a DM, a footer, a
                bio, a QR code. Recipients land on a clean preview with a
                recommended client pinned at the top and every alternative
                below. They read the record, pick where to open it, and skip
                the apps they don&rsquo;t use. No lock-in, no sign-up.
              </p>
              <p>
                Each link is a real, indexable URL. Embeds get OpenGraph
                cards, link unfurlers get a real title and description.
              </p>
            </>
          }
          visual={<PickerPreviewVisual />}
        />
      </AppearIn>

      <AppearIn delay={0.05}>
        <FeatureSection
          flip
          badge={{ icon: <Compass size={12} />, label: 'Anatomy of a link' }}
          title="Predictable, hackable URLs"
          body={
            <>
              <p>
                Every aturi.to URL follows one pattern: the host, the{' '}
                <code>/profile</code>{' '}
                mount, a handle or DID, the lexicon collection, and the record
                key. The same shape covers every record type. If you know what
                an AT URI looks like, you already know the URL.
              </p>
              <p>
                Drop the collection and rkey for a profile link. Posts also
                accept a friendlier{' '}
                <code>/post/&lt;rkey&gt;</code>{' '}
                shortcut, and bare paths without the{' '}
                <code>/profile</code>{' '}
                prefix still resolve for backwards compatibility.
              </p>
            </>
          }
          visual={<UrlAnatomyVisual />}
        />
      </AppearIn>

      <AppearIn delay={0.05}>
        <section className="fl-section">
          <div className="fl-section-head">
            <span className="fl-kicker">
              <Layers size={14} /> Every record type
            </span>
            <h2 className="fl-h2">Posts, profiles, lists, feeds, documents, repos, galleries…</h2>
            <p className="fl-body">
              If a lexicon has a public record, aturi.to has a URL for it. The
              same{' '}
              <code>handle/collection/rkey</code>{' '}
              pattern resolves whether the record lives in app.bsky.feed.post,
              pub.leaflet.document, sh.tangled.repo, or a lexicon that shipped
              yesterday.
            </p>
          </div>
          <RecordTypesGrid />
        </section>
      </AppearIn>

      <AppearIn delay={0.05}>
        <FeatureSection
          badge={{ icon: <UserCog size={12} />, label: 'Smart preferences' }}
          title="Signed in? The picker reorders for you."
          body={
            <>
              <p>
                Sign in with your atproto handle and aturi.to remembers your
                favorite client for each record type, the waypoints
                you&rsquo;ve hidden, and any custom ones you&rsquo;ve added.
                Every visit lifts your favorites to the top of the picker.
              </p>
              <p>
                Preferences live in your atproto repo as records you own. They
                sync across every device you sign in to, and they migrate
                with you if you move your data to a different PDS.
              </p>
            </>
          }
          visual={
            <div className="fl-mock" data-size="s">
              <div className="fl-mock-head">
                <span className="fl-mock-head-title">Your favorites</span>
                <span className="fl-mock-sub">Signed in as @aturi.to</span>
              </div>
              <div className="fl-mock-body">
                <PrefRow lexicon="app.bsky.feed.post" client="Anisota" />
                <PrefRow lexicon="pub.leaflet.document" client="Leaflet" />
                <PrefRow lexicon="sh.tangled.repo" client="Tangled" />
              </div>
              <div className="fl-mock-foot">
                Synced to your repo · works on every device you sign in to.
              </div>
            </div>
          }
        />
      </AppearIn>

      {/* The whole catalog. The docs' "see the supported waypoints" lands
          here, so the id is a link target. */}
      <AppearIn delay={0.05} id="catalog">
        <section className="fl-section">
          <div className="fl-section-head">
            <span className="fl-kicker">
              <MapPin size={14} /> The catalog
            </span>
            <h2 className="fl-h2">{count} clients, one catalog</h2>
            <p className="fl-body">
              A waypoint is an app plus the URL patterns it understands: which
              records it renders, which lexicons it expects, and how to link
              straight to one. Each kind of record gets a recommended client,
              with the rest as alternatives. Building a client that belongs
              here?{' '}
              <a href={CATALOG_PR_URL} target="_blank" rel="noopener noreferrer">
                Add it with a pull request
              </a>
              .
            </p>
          </div>
          <div className="fl-card fl-catalog">
            {groups.map((group) => (
              <div key={group.id} className="fl-catalog-row">
                <h3 className="fl-catalog-head">
                  {group.name}
                  <span className="fl-catalog-count">{group.waypoints.length}</span>
                </h3>
                <ul className="fl-catalog-list">
                  {group.waypoints.map((w) => (
                    <li key={w.id} className="fl-catalog-item">
                      <span className="fl-mock-icon" data-size="s" aria-hidden>
                        {w.icon}
                      </span>
                      {w.name}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </AppearIn>

      <AppearIn delay={0.05} id="build">
        <section className="fl-section">
          <div className="fl-section-head">
            <span className="fl-kicker">
              <Code2 size={14} /> For developers
            </span>
            <h2 className="fl-h2">Put waypoints in your own app</h2>
            <p className="fl-body">
              The catalog, the recommendations and the link logic behind
              aturi.to ship as two MIT-licensed npm packages, and a public API
              does the same work over HTTP. Your users get every client they
              might prefer; you get one small dependency, or none.
            </p>
          </div>
          <div className="fl-build-code">
            <CodeBlock label="ts" code={QUICKSTART} />
          </div>
          <div className="fl-cross-grid fl-build-grid">
            <BuildCard
              href={`${DOCS_HREF}#core`}
              icon={<Package size={18} />}
              title="Core package"
              body={
                <>
                  <code>@aturi.to/waypoints</code>: the catalog, per-client
                  links, recommendations and URL ⇄ AT URI resolution. Zero
                  dependencies, browser, Node and edge.
                </>
              }
            />
            <BuildCard
              href={`${DOCS_HREF}#react`}
              icon={<Code2 size={18} />}
              title="React picker"
              body="A drop-in picker, a headless hook for your own markup, and every client’s icon. Ships no CSS unless you ask for it."
            />
            <BuildCard
              href={`${DOCS_HREF}#resolve-api`}
              icon={<Globe size={18} />}
              title="Resolve API"
              body="Hand it an AT URI or any client’s page URL and get back every client that can open it. CORS-open, no key."
            />
            <BuildCard
              href={`${DOCS_HREF}#compose`}
              icon={<PenLine size={18} />}
              title="Compose intents"
              body={`Open a composer, text prefilled, in the ${composeCount} clients that accept one.`}
            />
            <BuildCard
              href={`${DOCS_HREF}#links`}
              icon={<Link2 size={18} />}
              title="Universal links"
              body="Build an aturi.to link from anything that names a record, with the text a copy button or a share sheet needs."
            />
            <BuildCard
              href={`${DOCS_HREF}#links`}
              icon={<Tags size={18} />}
              title="Resolvable pages"
              body="Head tags that let the rest of the Atmosphere find its way from your pages back to the records they show."
            />
          </div>
        </section>
      </AppearIn>

      <AppearIn delay={0.05}>
        <section className="fl-band">
          <span className="fl-kicker">
            <BookOpen size={14} aria-hidden /> Integration guide
          </span>
          <h2 className="fl-h2">Everything you need is in the guide</h2>
          <div className="fl-body">
            <p>
              Install, the picker, the Resolve API, compose intents and
              universal links, each with an example to copy. Building with a
              coding agent? The whole guide is one Markdown file away.
            </p>
          </div>
          <div className="fl-hero-actions" data-row="">
            <Link href={DOCS_HREF} className="fl-button" data-variant="primary">
              Read the integration guide
              <ArrowRight size={15} aria-hidden />
            </Link>
            <a
              href={NPMX_CORE_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="fl-button"
            >
              <Package size={15} aria-hidden />
              @aturi.to/waypoints ↗
            </a>
          </div>
        </section>
      </AppearIn>

      <AppearIn delay={0.05}>
        <CrossLinkCards current="waypoints" />
      </AppearIn>
    </div>
  );
}

/** One thing the packages do, as a card into its section of the guide. */
function BuildCard({
  href,
  icon,
  title,
  body,
}: {
  href: string;
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
}) {
  return (
    <Link href={href} className="fl-card fl-cross-card">
      <span className="fl-cross-card-head">
        <span className="fl-icon-tile" aria-hidden>
          {icon}
        </span>
        <h3>{title}</h3>
        <ArrowRight size={16} aria-hidden className="fl-cross-card-chev" />
      </span>
      <p>{body}</p>
    </Link>
  );
}

function PrefRow({ lexicon, client }: { lexicon: string; client: string }) {
  return (
    <div className="fl-mock-row">
      <span className="fl-mock-sub fl-grow fl-dim">{lexicon}</span>
      <ArrowRight size={13} className="fl-redirect-arrow" aria-hidden />
      <span className="fl-chip" data-on="">
        {client}
      </span>
    </div>
  );
}
