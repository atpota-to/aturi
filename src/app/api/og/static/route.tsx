import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';
import { AnisotaLogo } from '@/components/AnisotaLogo';
import {
  ArrowRight,
  BlueskyIcon,
  BrandMark,
  ClientChoiceRow,
  Headline,
  Kicker,
  LeafGlyph,
  LeafletIcon,
  LinkGlyph,
  loadOgFonts,
  OgFrame,
  OG_COLORS,
  OG_RADIUS,
  ServerGlyph,
  SoftPill,
  UrlPill,
} from '@/lib/og-design';
import { TOOL_COUNT } from '@/lib/mcp/catalog';
import { MCP_STAGE } from '@/lib/mcp/about';
import type { ReactNode } from 'react';

export const runtime = 'edge';
export const revalidate = 86400;

type PageConfig = {
  eyebrow: string;
  /** Lines split on '\n'; a line wrapped in asterisks is set in the accent. */
  title: string;
  tagline: string;
  /**
   * `split` puts the headline and the visual side by side; `center` stacks a
   * centred headline over the visual, like the site's home hero. Tall
   * visuals must use `split` — Satori paints an overflowing block straight
   * over its neighbours, which is how the extension popup once ended up
   * sitting on top of its own tagline.
   */
  layout: 'split' | 'center';
  /** Promotional product visual. */
  visual: ReactNode;
  /** Extra glyphs the Figtree subset needs for text baked into the visual. */
  visualText?: string;
  /** Glyphs the mono subset needs for identifiers baked into the visual. */
  visualMono?: string;
};

/**
 * Promotional OG cards for the site's landing pages, and the branded
 * fallback the data cards redirect to when they cannot render. Every card
 * shares the wordmark, the pale green pill, an 800-weight headline closing
 * on a green line, a tagline, and a product-specific visual set on the
 * site's white sheets.
 */
function configFor(page: string): PageConfig {
  switch (page) {
    case 'explore':
      return {
        eyebrow: 'Atmosphere data explorer',
        title: 'Browse\n*every PDS.*',
        tagline:
          'Records, identity history, backlinks, and a live view of network activity. For any account in the Atmosphere.',
        layout: 'split',
        visual: <ExploreVisual />,
        visualText: 'Record key Created ' + EXPLORE_ROWS.map((r) => r[1]).join(' '),
        visualMono: 'pds.atpota.to @dame.is app.bsky.feed.post ' + EXPLORE_ROWS.map((r) => r[0]).join(' '),
      };
    case 'extension':
      return {
        eyebrow: 'Browser extension',
        title: 'Jump between\n*clients in one click.*',
        tagline:
          'Land on any post and pop open the curated picker. Auto-redirect by lexicon, inspect the underlying AT URI, copy a universal link.',
        layout: 'split',
        visual: <ExtensionVisual />,
        visualText: 'aturi Waypoints Inspect Recommended for posts Or open in Anisota Default Bluesky Leaflet',
        visualMono: 'app.bsky.feed.post at://dame.is/ 3lq9… anisota.net bsky.app leaflet.pub',
      };
    case 'universal-links':
      return {
        eyebrow: 'Universal links',
        title: 'One link, every\n*Atmosphere client.*',
        tagline:
          'Share aturi.to/handle/collection/rkey with anyone; they pick where to open it, from a curated list of 25+ clients.',
        layout: 'split',
        visual: <PickerVisual />,
        visualText: 'Open dame’s post in… Pick an app. They all show the same post. Recommended Anisota Bluesky Leaflet +22 more clients',
        visualMono: 'aturi.to/dame.is/app.bsky.feed.post/3lq9 anisota.net bsky.app leaflet.pub',
      };
    case 'fork':
      return {
        eyebrow: 'Fork & deploy',
        title: 'Run your own\n*instance.*',
        tagline:
          'Open source, environment-driven branding, and ready to deploy on a custom domain.',
        layout: 'split',
        visual: <ForkVisual />,
        visualMono:
          '.env.local NEXT_PUBLIC_DOMAIN NEXT_PUBLIC_SITE_NAME NEXT_PUBLIC_AUTHOR_NAME = moss.link moss you',
      };
    case 'docs':
      return {
        eyebrow: 'Developer packages',
        title: 'Add Atmosphere\n*links to your app.*',
        tagline:
          'Drop-in npm packages (a zero-dependency core and a headless React picker) for client links, recommendations, and AT-URI resolution.',
        layout: 'split',
        visual: <DocsVisual />,
        visualText: 'Terminal',
        visualMono:
          "$ npm i @aturi.to/waypoints import { resolveAtUri } from '@aturi.to/waypoints' const result = resolveAtUri(uri)",
      };
    case 'mcp':
      return {
        eyebrow: `Model Context Protocol · ${MCP_STAGE}`,
        title: 'Let your agent\n*read the Atmosphere.*',
        tagline:
          'Add aturi.to/api/mcp to Claude, Cursor, or any MCP client — no key, no account. ' +
          'Repositories, identity, backlinks, Jetstream, and the protocol docs themselves.',
        layout: 'split',
        visual: <McpVisual />,
        visualText: 'What has @aturi.to been posting about, and which post landed best? read-only tools',
        visualMono: `agent · aturi.to/api/mcp ${TOOL_COUNT} resolve_identity get_author_feed did:plc:6teuh… 8 posts`,
      };
    case 'spaces':
      return {
        eyebrow: 'Permissioned data · alpha',
        title: 'Browse your\n*private records.*',
        tagline:
          'Atproto spaces keep records outside your public repo. Sign in to explore the ones your account can reach.',
        layout: 'split',
        visual: <SpacesVisual />,
        visualText: 'Space Collections Records',
        visualMono: 'my.bulletin.board/self at.secretsky.post at.secretsky.reaction 24 8',
      };
    case 'home':
    default:
      return {
        eyebrow: 'Atmosphere fast travel',
        title: 'Tour the\n*Atmosphere.*',
        tagline:
          'Travel between clients with the browser extension, share universal links, and explore any account’s PDS data.',
        layout: 'center',
        visual: <HomeVisual />,
        visualText: 'Open dame’s profile in… Anisota Bluesky Leaflet Deer Grain +25',
        visualMono: 'aturi.to/dame.is',
      };
  }
}

// ─── Shared visual chrome ──────────────────────────────────────────────────

const PANEL_W = 470;

/**
 * White sheet every split-layout visual sits on: the site's card, with an
 * optional off-white header strip (the "agent · aturi.to/api/mcp" row on the
 * MCP page, the table head in the explorer).
 */
function Sheet({ header, children, pad = 22 }: { header?: ReactNode; children: ReactNode; pad?: number }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: `${PANEL_W}px`,
        background: OG_COLORS.bgSecondary,
        border: `1px solid ${OG_COLORS.borderMedium}`,
        borderRadius: `${OG_RADIUS.card}px`,
      }}
    >
      {header && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: '12px',
            padding: '15px 22px',
            background: OG_COLORS.surfaceSubtle,
            borderBottom: `1px solid ${OG_COLORS.borderSubtle}`,
            borderTopLeftRadius: `${OG_RADIUS.card - 1}px`,
            borderTopRightRadius: `${OG_RADIUS.card - 1}px`,
          }}
        >
          {header}
        </div>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: `${pad}px` }}>{children}</div>
    </div>
  );
}

function MonoLine({
  children,
  size = 16,
  color = OG_COLORS.textSecondary,
}: {
  children: ReactNode;
  size?: number;
  color?: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        fontFamily: 'IBM Plex Mono',
        fontSize: `${size}px`,
        fontWeight: 500,
        color,
        whiteSpace: 'pre',
      }}
    >
      {children}
    </div>
  );
}

/**
 * One client in a picker list, as the link page sets it: white row with a
 * hairline, name over a mono host. The `featured` row is the recommended
 * pick, filled moss with white type like the link page's first choice.
 */
function ClientRow({
  name,
  host,
  icon,
  featured,
  badge,
}: {
  name: string;
  host: string;
  icon: (color: string) => ReactNode;
  featured?: boolean;
  badge?: string;
}) {
  const ink = featured ? OG_COLORS.textOnAccent : OG_COLORS.textPrimary;
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        padding: '11px 16px',
        background: featured ? OG_COLORS.accentFill : OG_COLORS.bgSecondary,
        border: `1px solid ${featured ? OG_COLORS.accentFill : OG_COLORS.borderMedium}`,
        borderRadius: `${OG_RADIUS.control}px`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 28 }}>
        {icon(ink)}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', flex: 1, lineHeight: 1.25 }}>
        <span style={{ display: 'flex', fontSize: '19px', fontWeight: 700, color: ink }}>{name}</span>
        <span
          style={{
            display: 'flex',
            fontSize: '15px',
            color: featured ? OG_COLORS.accentSoft : OG_COLORS.textTertiary,
          }}
        >
          {featured ? 'Recommended' : host}
        </span>
      </div>
      {badge ? (
        <div
          style={{
            display: 'flex',
            padding: '3px 11px',
            background: OG_COLORS.accentSoft,
            border: `1px solid ${OG_COLORS.accentSoftRing}`,
            borderRadius: `${OG_RADIUS.pill}px`,
            fontSize: '14px',
            fontWeight: 600,
            color: OG_COLORS.accentSoftFg,
          }}
        >
          {badge}
        </div>
      ) : (
        <ArrowRight size={18} color={featured ? OG_COLORS.textOnAccent : OG_COLORS.textTertiary} />
      )}
    </div>
  );
}

/**
 * Anisota's full brand mark, the one the site's picker shows. The OG icon
 * set carries a one-path stand-in that smudges at row size; this card is
 * rendered at most once a day, so it can afford the real paths.
 */
function AnisotaMark({ size, color }: { size: number; color: string }) {
  return <AnisotaLogo width={size} height={size} style={{ color }} />;
}

// ─── Page visuals ──────────────────────────────────────────────────────────

function HomeVisual() {
  // The home page's universal-links card: one aturi.to link, the question it
  // answers, and the row of clients with the reader's pick filled in.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '18px' }}>
      <UrlPill url="aturi.to/dame.is" />
      <ClientChoiceRow picked={0} />
    </div>
  );
}

/**
 * Rows for the explorer's records table: an rkey and when it was created.
 * No post text — the account is a real one, so the card does not put words
 * in its mouth.
 */
const EXPLORE_ROWS: [string, string][] = [
  ['3mze4bsn4no2h', '2m ago'],
  ['3mz4m67ahbs2o', '1h ago'],
  ['3myzuuxapey22', '3d ago'],
  ['3myzuumxuc2s', '4d ago'],
];

function ExploreVisual() {
  // The collection page in miniature: the breadcrumb, the NSID set as the
  // page title, and the head of its records table.
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '14px', width: `${PANEL_W}px` }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', paddingLeft: '4px' }}>
        <MonoLine size={15} color={OG_COLORS.textTertiary}>
          <ServerGlyph size={15} />
          {'pds.atpota.to / @dame.is /'}
        </MonoLine>
        <MonoLine size={30} color={OG_COLORS.textPrimary}>
          app.bsky.feed.post
        </MonoLine>
      </div>
      <Sheet
        pad={0}
        header={
          <div style={{ display: 'flex', width: '100%', fontSize: '14px', fontWeight: 600, color: OG_COLORS.textSecondary }}>
            <span style={{ display: 'flex', flex: 1 }}>Record key</span>
            <span style={{ display: 'flex' }}>Created</span>
          </div>
        }
      >
        {EXPLORE_ROWS.map(([rkey, created], i) => (
          <div
            key={rkey}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '12px 22px',
              borderTop: i === 0 ? 'none' : `1px solid ${OG_COLORS.borderSubtle}`,
            }}
          >
            <MonoLine size={16} color={OG_COLORS.accent}>
              {rkey}
            </MonoLine>
            <span style={{ display: 'flex', fontSize: '15px', color: OG_COLORS.textTertiary }}>{created}</span>
          </div>
        ))}
      </Sheet>
    </div>
  );
}

function ExtensionVisual() {
  // The extension popup the home page mocks: the wordmark over the record's
  // NSID, folder tabs for the two modes, then the recommended client and
  // the others under it.
  return (
    <Sheet
      pad={18}
      header={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '9px', fontSize: '19px', fontWeight: 700 }}>
            <LeafGlyph size={19} />
            <span style={{ display: 'flex' }}>aturi</span>
          </div>
          <MonoLine size={14} color={OG_COLORS.textTertiary}>
            app.bsky.feed.post
          </MonoLine>
        </div>
      }
    >
      <MonoLine size={14} color={OG_COLORS.textTertiary}>
        at://dame.is/app.bsky.feed.post/3lq9…
      </MonoLine>
      <Kicker size={13}>Recommended for posts</Kicker>
      <ClientRow
        name="Anisota"
        host="anisota.net"
        badge="Default"
        icon={(c) => <AnisotaMark size={24} color={c} />}
      />
      <Kicker size={13}>Or open in</Kicker>
      <ClientRow name="Bluesky" host="bsky.app" icon={(c) => <BlueskyIcon size={20} color={c} />} />
      <ClientRow name="Leaflet" host="leaflet.pub" icon={(c) => <LeafletIcon size={20} color={c} />} />
    </Sheet>
  );
}

function PickerVisual() {
  // The universal-link landing itself: one URL, then the clients a reader
  // can choose from, the recommended one filled. Distinct from the home
  // card's chip row, which sells travelling *between* clients rather than
  // picking one.
  return (
    <Sheet
      pad={20}
      header={
        <MonoLine size={14} color={OG_COLORS.textSecondary}>
          <LinkGlyph size={15} />
          aturi.to/dame.is/app.bsky.feed.post/3lq9
        </MonoLine>
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '2px', marginBottom: '2px' }}>
        <div style={{ display: 'flex', fontSize: '22px', fontWeight: 700, letterSpacing: '-0.01em' }}>
          Open dame’s post in…
        </div>
        <div style={{ display: 'flex', fontSize: '15px', color: OG_COLORS.textSecondary }}>
          Pick an app. They all show the same post.
        </div>
      </div>
      <ClientRow name="Anisota" host="anisota.net" featured icon={(c) => <AnisotaMark size={24} color={c} />} />
      <ClientRow name="Bluesky" host="bsky.app" icon={(c) => <BlueskyIcon size={20} color={c} />} />
      <ClientRow name="Leaflet" host="leaflet.pub" icon={(c) => <LeafletIcon size={20} color={c} />} />
      <div style={{ display: 'flex', justifyContent: 'center', fontSize: '14px', fontWeight: 600, color: OG_COLORS.textTertiary }}>
        +22 more clients
      </div>
    </Sheet>
  );
}

function ForkVisual() {
  // Environment-driven branding is the actual product claim on /fork, so
  // show the file you'd edit rather than a picker borrowed from elsewhere.
  const rows: [string, string][] = [
    ['NEXT_PUBLIC_DOMAIN', 'moss.link'],
    ['NEXT_PUBLIC_SITE_NAME', 'moss'],
    ['NEXT_PUBLIC_AUTHOR_NAME', 'you'],
  ];
  return (
    <Sheet
      pad={24}
      header={
        <MonoLine size={16} color={OG_COLORS.textSecondary}>
          .env.local
        </MonoLine>
      }
    >
      {rows.map(([key, value]) => (
        <MonoLine key={key} size={18} color={OG_COLORS.textTertiary}>
          {key}
          <span style={{ display: 'flex', color: OG_COLORS.textFaint, marginLeft: '-8px', marginRight: '-8px' }}>=</span>
          <span style={{ display: 'flex', color: OG_COLORS.accent }}>{value}</span>
        </MonoLine>
      ))}
    </Sheet>
  );
}

function DocsVisual() {
  return (
    <Sheet
      pad={24}
      header={
        <MonoLine size={16} color={OG_COLORS.textSecondary}>
          <span style={{ display: 'flex', color: OG_COLORS.textFaint }}>$</span>
          npm i @aturi.to/waypoints
        </MonoLine>
      }
    >
      <MonoLine size={18} color={OG_COLORS.textTertiary}>
        {'import { resolveAtUri } from'}
      </MonoLine>
      <MonoLine size={18} color={OG_COLORS.accent}>
        {"  '@aturi.to/waypoints'"}
      </MonoLine>
      <div style={{ display: 'flex', height: '8px' }} />
      <MonoLine size={18} color={OG_COLORS.textPrimary}>
        const result = resolveAtUri(uri)
      </MonoLine>
    </Sheet>
  );
}

/**
 * A space address over two of its collections — the shape the explorer shows,
 * with no real account in it. Every space route shares this one card, so
 * nothing about who is in which space reaches an unfurl.
 */
function SpacesVisual() {
  return (
    <Sheet
      pad={0}
      header={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <MonoLine size={17} color={OG_COLORS.accent}>
            my.bulletin.board/self
          </MonoLine>
          <Kicker size={13} color={OG_COLORS.textTertiary}>
            Space
          </Kicker>
        </div>
      }
    >
      <SpaceCollectionLine name="at.secretsky.post" count="24" first />
      <SpaceCollectionLine name="at.secretsky.reaction" count="8" />
    </Sheet>
  );
}

function SpaceCollectionLine({ name, count, first }: { name: string; count: string; first?: boolean }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '18px 22px',
        borderTop: first ? 'none' : `1px solid ${OG_COLORS.borderSubtle}`,
      }}
    >
      <MonoLine size={19} color={OG_COLORS.textPrimary}>
        {name}
      </MonoLine>
      <MonoLine size={17} color={OG_COLORS.textTertiary}>
        {count}
      </MonoLine>
    </div>
  );
}

/** A tool call in the MCP transcript, as the landing page sets it. */
function McpToolCall({ name, detail }: { name: string; detail: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
      <div
        style={{
          display: 'flex',
          padding: '4px 12px',
          background: OG_COLORS.accentSoft,
          border: `1px solid ${OG_COLORS.accentSoftRing}`,
          borderRadius: `${OG_RADIUS.pill}px`,
        }}
      >
        <MonoLine size={14} color={OG_COLORS.accentSoftFg}>
          {name}
        </MonoLine>
      </div>
      {/* An SVG arrow, not "→". Satori asks Google Fonts for a dynamic
          subset when a glyph is missing, and that request 400s for the
          symbol blocks (U+2190–U+2BFF), failing the whole image. */}
      <ArrowRight size={13} color={OG_COLORS.textTertiary} />
      <MonoLine size={14} color={OG_COLORS.textTertiary}>
        {detail}
      </MonoLine>
    </div>
  );
}

function McpVisual() {
  // The landing page's hero visual, compressed to what survives a thumbnail:
  // the endpoint being advertised, a question in plain language, and the two
  // tools an agent picks to answer it. The count comes from the catalog, so
  // the card cannot claim a tool surface the server does not serve.
  return (
    <Sheet
      pad={22}
      header={
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}>
          <MonoLine size={14} color={OG_COLORS.textTertiary}>
            agent · aturi.to/api/mcp
          </MonoLine>
          <MonoLine size={14} color={OG_COLORS.accent}>
            {`${TOOL_COUNT}`}
            <span style={{ display: 'flex', fontFamily: 'Figtree', fontWeight: 600, marginLeft: '-2px' }}>
              read-only tools
            </span>
          </MonoLine>
        </div>
      }
    >
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <div
          style={{
            display: 'flex',
            maxWidth: '360px',
            padding: '12px 16px',
            background: OG_COLORS.accentSoft,
            borderRadius: `${OG_RADIUS.control}px`,
            fontSize: '17px',
            lineHeight: 1.4,
            color: OG_COLORS.textPrimary,
          }}
        >
          What has @aturi.to been posting about, and which post landed best?
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginTop: '4px' }}>
        <McpToolCall name="resolve_identity" detail="did:plc:6teuh…" />
        <McpToolCall name="get_author_feed" detail="8 posts" />
      </div>
    </Sheet>
  );
}

// ─── Route ────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = searchParams.get('page') || 'home';
    const config = configFor(page);
    const isSplit = config.layout === 'split';

    const fonts = await loadOgFonts(
      `${config.title} ${config.tagline} ${config.eyebrow} ${config.visualText || ''}`,
      config.visualMono || '',
    );

    return new ImageResponse(
      (
        <OgFrame>
          <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: '26px' }}>
            <BrandMark />

            {/* No overflow: 'hidden' on these layout boxes. Satori pushes a
                clip and mask onto every descendant of one, which more than
                doubled the home card's render CPU, and it was also clipping
                the top of the home URL pill and the hook of the J in "Jump".
                The copy here is fixed, so check new pages by eye instead. */}
            {isSplit ? (
              <div style={{ display: 'flex', flex: 1, gap: '44px', alignItems: 'center', paddingBottom: '18px' }}>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0, gap: '24px' }}>
                  <div style={{ display: 'flex' }}>
                    <SoftPill>{config.eyebrow}</SoftPill>
                  </div>
                  <Headline title={config.title} tagline={config.tagline} size={54} taglineSize={22} />
                </div>
                <div style={{ display: 'flex', flexShrink: 0 }}>{config.visual}</div>
              </div>
            ) : (
              // Centred on the canvas rather than the space under the
              // wordmark, so the hero sits where the eye expects it; the
              // negative margin hands back the wordmark row's height.
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 1,
                  gap: '22px',
                  marginTop: '-48px',
                }}
              >
                <SoftPill>{config.eyebrow}</SoftPill>
                <Headline
                  title={config.title}
                  tagline={config.tagline}
                  size={64}
                  taglineSize={24}
                  align="center"
                />
                <div style={{ display: 'flex', justifyContent: 'center', marginTop: '14px' }}>
                  {config.visual}
                </div>
              </div>
            )}
          </div>
        </OgFrame>
      ),
      {
        width: 1200,
        height: 630,
        fonts,
        headers: {
          // Cache for a day, not @vercel/og's immutable year — the card
          // design changes with deploys.
          'Cache-Control': 'public, max-age=86400, s-maxage=86400, stale-while-revalidate=604800',
        },
      },
    );
  } catch (error) {
    console.error('Error generating OG image:', error);
    return new Response('Error generating image', { status: 500 });
  }
}
