import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';
import {
  AnisotaIcon,
  BlueskyIcon,
  DropChevron,
  Headline,
  LeafletIcon,
  loadGoogleFont,
  OgFrame,
  OG_COLORS,
  OG_GLYPH_BASELINE,
  ServerGlyph,
  TopRow,
  UrlPill,
  WaypointRow,
} from '@/lib/og-design';
import type { ReactNode } from 'react';

export const runtime = 'edge';
export const revalidate = 86400;

type PageConfig = {
  eyebrow: string;
  title: string;
  tagline: string;
  /**
   * `split` puts the headline and the visual side by side; `stack` runs the
   * headline full width with the visual beneath. Tall visuals must use
   * `split` — Satori paints an overflowing block straight over its
   * neighbours, which is how the extension popup ended up sitting on top of
   * its own tagline.
   */
  layout: 'split' | 'stack';
  /** Promotional product visual. */
  visual: ReactNode;
  /** Extra glyphs the font subset needs for text baked into the visual. */
  visualText?: string;
};

/**
 * Promotional OG cards for the site's landing pages. Every card shares the
 * same top row (leaf wordmark + uppercase product label), a serif headline,
 * a tagline, and a product-specific visual.
 */
function configFor(page: string): PageConfig {
  switch (page) {
    case 'explore':
      return {
        eyebrow: 'Atmosphere data explorer',
        title: 'Browse every PDS.',
        tagline:
          'Records, identity history, backlinks, and a live view of network activity. For any account in the Atmosphere.',
        layout: 'split',
        visual: <ExploreVisual />,
        visualText: 'COLLECTION pds.atpota.to @dame.is app.bsky.feed.post',
      };
    case 'extension':
      return {
        eyebrow: 'Browser extension',
        title: 'Jump between clients\nin one click.',
        tagline:
          'Land on any post and pop open the curated picker. Auto-redirect by lexicon, inspect the underlying AT URI, copy a universal link.',
        layout: 'split',
        visual: <ExtensionVisual />,
        visualText: 'Aturi app.bsky.feed.post at:// dame.is 3lq9 Recommended for posts Or open in ' +
          'Anisota View post on anisota.net Bluesky bsky.app Leaflet leaflet.pub',
      };
    case 'universal-links':
      return {
        eyebrow: 'Universal links',
        title: 'One link, every\nAtmosphere client.',
        tagline:
          'Share aturi.to/handle/collection/rkey with anyone; they pick where to open it.',
        layout: 'split',
        visual: <PickerVisual />,
        visualText:
          'aturi.to/dame.is/app.bsky.feed.post/3lq9 Choose where to view Anisota Bluesky Leaflet anisota.net bsky.app leaflet.pub and the rest of the catalog',
      };
    case 'fork':
      return {
        eyebrow: 'Fork & deploy',
        title: 'Run your own\ninstance.',
        tagline:
          'Open source, environment-driven branding, and ready to deploy on a custom domain.',
        layout: 'split',
        visual: <ForkVisual />,
        visualText:
          '.env.local NEXT_PUBLIC_DOMAIN NEXT_PUBLIC_SITE_NAME NEXT_PUBLIC_AUTHOR_NAME moss.link moss dame',
      };
    case 'docs':
      return {
        eyebrow: 'Developer packages',
        title: 'Add Atmosphere\nlinks to your app.',
        tagline:
          'Drop-in npm packages (a zero-dependency core and a headless React picker) for client links, recommendations, and AT-URI resolution.',
        layout: 'split',
        visual: <DocsVisual />,
        visualText:
          "npm i @aturi.to/waypoints import { resolveAtUri } from '@aturi.to/waypoints' const result = resolveAtUri(uri)",
      };
    case 'home':
    default:
      return {
        eyebrow: 'Atmosphere fast travel',
        title: 'Tour the\nAtmosphere.',
        tagline:
          'Travel between clients with the browser extension, share universal links, and explore any account’s PDS data.',
        layout: 'stack',
        visual: <HomeVisual />,
        visualText: 'aturi.to/profile/dame.is',
      };
  }
}

// ─── Shared visual chrome ──────────────────────────────────────────────────

const PANEL_W = 452;

/** Bordered panel every split-layout visual sits inside. */
function Panel({ children, pad = 20 }: { children: ReactNode; pad?: number }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: `${PANEL_W}px`,
        background: OG_COLORS.bgSecondary,
        border: `1px solid ${OG_COLORS.borderMedium}`,
        boxShadow: '0 16px 48px rgba(0, 0, 0, 0.4)',
        padding: `${pad}px`,
        gap: '14px',
        overflow: 'hidden',
      }}
    >
      {children}
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
        fontFamily: 'IBM Plex Mono',
        fontSize: `${size}px`,
        fontWeight: 500,
        color,
      }}
    >
      {children}
    </div>
  );
}

function Kicker({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        fontFamily: 'IBM Plex Mono',
        fontSize: '12px',
        fontWeight: 500,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        color: OG_COLORS.accent,
      }}
    >
      {children}
    </div>
  );
}

// ─── Page visuals ──────────────────────────────────────────────────────────

function HomeVisual() {
  // Mirrors the homepage WaypointJumpVisual: aturi.to URL pill on top,
  // chevron, row of waypoint icons with one highlighted to show the
  // "which client?" pick that aturi enables.
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '12px',
      }}
    >
      <UrlPill url="aturi.to/profile/dame.is" fontSize={22} />
      <DropChevron />
      <WaypointRow highlightIndex={1} iconSize={32} />
    </div>
  );
}

function ExploreVisual() {
  // Echoes the explore OG card's own hierarchy — context line on top, then
  // the two chips that carry the identity.
  return (
    <Panel>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <Kicker>Collection</Kicker>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '7px',
            fontFamily: 'IBM Plex Mono',
            fontSize: '13px',
            fontWeight: 500,
            color: OG_COLORS.textTertiary,
          }}
        >
          <ServerGlyph size={13} />
          <span style={{ display: 'flex' }}>pds.atpota.to</span>
        </div>
      </div>
      {/* Same rules as the real explore card: identical chip chrome, colour
          and size carrying the hierarchy, slash outside the chip. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <div
          style={{
            display: 'flex',
            padding: '8px 12px',
            background: OG_COLORS.bgTertiary,
            border: `1px solid ${OG_COLORS.borderSubtle}`,
          }}
        >
          <MonoLine size={21} color={OG_COLORS.accent}>
            @dame.is
          </MonoLine>
        </div>
        <MonoLine size={18} color={OG_COLORS.textTertiary}>
          /
        </MonoLine>
      </div>
      <div
        style={{
          display: 'flex',
          padding: '10px 14px',
          background: OG_COLORS.bgTertiary,
          border: `1px solid ${OG_COLORS.borderSubtle}`,
        }}
      >
        <MonoLine size={26} color={OG_COLORS.textPrimary}>
          app.bsky.feed.post
        </MonoLine>
      </div>
    </Panel>
  );
}

function ExtensionVisual() {
  // Compact extension-popup mock: header strip, source URI, a
  // "Recommended" row with the Anisota icon (matches the live popup's
  // default recommendation for posts).
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: `${PANEL_W}px`,
        background: OG_COLORS.bgSecondary,
        border: `1px solid ${OG_COLORS.borderMedium}`,
        boxShadow: '0 16px 48px rgba(0, 0, 0, 0.4)',
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '14px 18px',
          borderBottom: `1px solid ${OG_COLORS.borderSubtle}`,
          background: OG_COLORS.bgTertiary,
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '10px',
            color: OG_COLORS.textPrimary,
            fontSize: '20px',
          }}
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke={OG_COLORS.accent}
            strokeWidth={1.6}
            strokeLinecap="round"
            strokeLinejoin="round"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
            <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
          </svg>
          <span style={{ display: 'flex' }}>Aturi</span>
        </div>
        <MonoLine size={13} color={OG_COLORS.textTertiary}>
          app.bsky.feed.post
        </MonoLine>
      </div>

      <div
        style={{
          display: 'flex',
          padding: '11px 18px',
          borderBottom: `1px solid ${OG_COLORS.borderSubtle}`,
        }}
      >
        <MonoLine size={14} color={OG_COLORS.textTertiary}>
          at://dame.is/app.bsky.feed.post/3lq9…
        </MonoLine>
      </div>

      <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
          <svg width="13" height="13" viewBox="0 0 24 24" fill={OG_COLORS.accent} xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2l2.9 6.26L21.5 9.27l-5 4.6 1.4 6.86L12 17.5l-5.9 3.23 1.4-6.86-5-4.6 6.6-1.01L12 2z" />
          </svg>
          <Kicker>Recommended for posts</Kicker>
        </div>
        <RowChip
          name="Anisota"
          desc="View post on anisota.net"
          icon={<AnisotaIcon height={34} color={OG_COLORS.accent} />}
          featured
        />
      </div>

      <div
        style={{
          padding: '0 18px 18px',
          display: 'flex',
          flexDirection: 'column',
          gap: '9px',
        }}
      >
        <Kicker>Or open in</Kicker>
        <RowChip name="Bluesky" desc="bsky.app" icon={<BlueskyIcon size={20} />} />
        <RowChip name="Leaflet" desc="leaflet.pub" icon={<LeafletIcon size={20} />} />
      </div>
    </div>
  );
}

function PickerVisual() {
  // The universal-link landing itself: one URL, then the list of clients a
  // reader can choose from. Distinct from the home card's icon row, which
  // sells travelling *between* clients rather than picking one.
  return (
    <Panel pad={0}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '15px 18px',
          borderBottom: `1px solid ${OG_COLORS.borderSubtle}`,
          background: OG_COLORS.bgTertiary,
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke={OG_COLORS.accent}
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path d="M9 17H7A5 5 0 0 1 7 7h2" />
          <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
        <MonoLine size={14} color={OG_COLORS.textSecondary}>
          aturi.to/dame.is/app.bsky.feed.post/3lq9
        </MonoLine>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', padding: '16px 18px 18px' }}>
        <Kicker>Choose where to view</Kicker>
        <RowChip
          name="Anisota"
          desc="anisota.net"
          icon={<AnisotaIcon height={30} color={OG_COLORS.accent} />}
          featured
        />
        <RowChip name="Bluesky" desc="bsky.app" icon={<BlueskyIcon size={20} />} />
        <RowChip name="Leaflet" desc="leaflet.pub" icon={<LeafletIcon size={20} />} />
        <div
          style={{
            display: 'flex',
            justifyContent: 'center',
            paddingTop: '2px',
          }}
        >
          <MonoLine size={13} color={OG_COLORS.textTertiary}>
            and the rest of the catalog
          </MonoLine>
        </div>
      </div>
    </Panel>
  );
}

function ForkVisual() {
  // Environment-driven branding is the actual product claim on /fork, so
  // show the file you'd edit rather than the universal-links picker the
  // card used to borrow from the home page.
  const rows: [string, string][] = [
    ['NEXT_PUBLIC_DOMAIN', 'moss.link'],
    ['NEXT_PUBLIC_SITE_NAME', 'moss'],
    ['NEXT_PUBLIC_AUTHOR_NAME', 'you'],
  ];
  return (
    <Panel pad={0}>
      <div
        style={{
          display: 'flex',
          padding: '13px 18px',
          borderBottom: `1px solid ${OG_COLORS.borderSubtle}`,
          background: OG_COLORS.bgTertiary,
        }}
      >
        <MonoLine size={14} color={OG_COLORS.textTertiary}>
          .env.local
        </MonoLine>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '12px', padding: '18px' }}>
        {rows.map(([key, value]) => (
          <div key={key} style={{ display: 'flex', alignItems: 'baseline' }}>
            <MonoLine size={15} color={OG_COLORS.textTertiary}>
              {key}
            </MonoLine>
            <MonoLine size={15} color={OG_COLORS.textTertiary}>
              =
            </MonoLine>
            <MonoLine size={15} color={OG_COLORS.accent}>
              {value}
            </MonoLine>
          </div>
        ))}
      </div>
    </Panel>
  );
}

function DocsVisual() {
  return (
    <Panel pad={0}>
      <div
        style={{
          display: 'flex',
          padding: '13px 18px',
          borderBottom: `1px solid ${OG_COLORS.borderSubtle}`,
          background: OG_COLORS.bgTertiary,
        }}
      >
        <MonoLine size={14} color={OG_COLORS.textSecondary}>
          npm i @aturi.to/waypoints
        </MonoLine>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', padding: '18px' }}>
        <MonoLine size={14} color={OG_COLORS.textTertiary}>
          import &#123; resolveAtUri &#125; from
        </MonoLine>
        <MonoLine size={14} color={OG_COLORS.accent}>
          &nbsp;&nbsp;&apos;@aturi.to/waypoints&apos;
        </MonoLine>
        <div style={{ display: 'flex', height: '10px' }} />
        <MonoLine size={14} color={OG_COLORS.textSecondary}>
          const result = resolveAtUri(uri)
        </MonoLine>
      </div>
    </Panel>
  );
}

function RowChip({
  name,
  desc,
  icon,
  featured,
}: {
  name: string;
  desc: string;
  icon: ReactNode;
  featured?: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '12px',
        padding: '10px 12px',
        background: featured ? OG_COLORS.bgTertiary : 'transparent',
        border: `1px solid ${featured ? OG_COLORS.accent : OG_COLORS.borderSubtle}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', width: 30, justifyContent: 'center' }}>
        {icon}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', lineHeight: 1.2 }}>
        <span style={{ fontSize: '18px', color: OG_COLORS.textPrimary, display: 'flex' }}>
          {name}
        </span>
        <span style={{ fontSize: '14px', color: OG_COLORS.textTertiary, display: 'flex' }}>
          {desc}
        </span>
      </div>
    </div>
  );
}

// ─── Route ────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = searchParams.get('page') || 'home';
    const config = configFor(page);
    const isSplit = config.layout === 'split';

    const allText =
      `${config.title} ${config.tagline} ${config.eyebrow} ${config.visualText || ''} aturi.to ` +
      // The eyebrow is rendered uppercase via CSS; include the full alphabet
      // so the font subset has glyphs for the transformed text (see
      // OG_GLYPH_BASELINE).
      OG_GLYPH_BASELINE;

    const [crimsonData, monoData] = await Promise.all([
      loadGoogleFont('Crimson+Pro:wght@300;400;600', allText),
      loadGoogleFont(
        'IBM+Plex+Mono:wght@500',
        `${config.visualText || ''} @ . : / - _ = + & ' ( ) { } ` + OG_GLYPH_BASELINE,
      ),
    ]);

    return new ImageResponse(
      (
        <OgFrame>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              gap: '34px',
              position: 'relative',
              zIndex: 1,
            }}
          >
            <TopRow eyebrow={config.eyebrow} />

            {isSplit ? (
              <div style={{ display: 'flex', flex: 1, gap: '48px', alignItems: 'center', overflow: 'hidden' }}>
                <div style={{ display: 'flex', flex: 1, minWidth: 0 }}>
                  <Headline title={config.title} tagline={config.tagline} size={58} />
                </div>
                <div style={{ display: 'flex', flexShrink: 0 }}>{config.visual}</div>
              </div>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  flex: 1,
                  gap: '30px',
                  overflow: 'hidden',
                }}
              >
                <Headline title={config.title} tagline={config.tagline} />
                <div
                  style={{
                    display: 'flex',
                    flex: 1,
                    alignItems: 'flex-end',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
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
        fonts: [
          { name: 'Crimson Pro', data: crimsonData, style: 'normal', weight: 300 },
          { name: 'IBM Plex Mono', data: monoData, style: 'normal', weight: 500 },
        ],
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
