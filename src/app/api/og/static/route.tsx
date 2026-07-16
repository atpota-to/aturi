import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';
import {
  AnisotaIcon,
  DropChevron,
  Headline,
  loadGoogleFont,
  OgFrame,
  OG_COLORS,
  OG_GLYPH_BASELINE,
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
  /** Promotional product visual shown beneath the headline. */
  visual: ReactNode;
};

/**
 * Promotional OG cards for the site's landing pages. Every card shares the
 * same top row (leaf wordmark + uppercase product label), a serif headline,
 * a tagline, and a product-specific visual mock further down.
 */
function configFor(page: string): PageConfig {
  switch (page) {
    case 'explore':
      return {
        eyebrow: 'Atmosphere data explorer',
        title: 'Browse every PDS.',
        tagline:
          'Records, identity history, backlinks, and a live view of network activity. For any account in the Atmosphere.',
        visual: <ExploreVisual />,
      };
    case 'extension':
      return {
        eyebrow: 'Browser extension',
        title: 'Jump between clients\nin one click.',
        tagline:
          'Land on any post and pop open the curated picker. Auto-redirect by lexicon, inspect the underlying AT URI, copy a universal link.',
        visual: <ExtensionVisual />,
      };
    case 'universal-links':
      return {
        eyebrow: 'Universal links',
        title: 'One link, every\nAtmosphere client.',
        tagline:
          'Share aturi.to/handle/collection/rkey with anyone — they pick where to open it, from a curated list of 25+ clients.',
        visual: <UniversalLinksVisual />,
      };
    case 'fork':
      return {
        eyebrow: 'Fork & deploy',
        title: 'Run your own\ninstance.',
        tagline:
          'Open source, environment-driven branding, and ready to deploy on a custom domain.',
        visual: <HomeVisual />,
      };
    case 'docs':
      return {
        eyebrow: 'Developer packages',
        title: 'Add Atmosphere\nlinks to your app.',
        tagline:
          'Drop-in npm packages — a zero-dependency core and a headless React picker — for client links, recommendations, and AT-URI resolution.',
        visual: <HomeVisual />,
      };
    case 'home':
    default:
      return {
        eyebrow: 'Atmosphere fast travel',
        title: 'Tour the\nAtmosphere.',
        tagline:
          'Travel between clients with the browser extension, share universal links, and explore any account’s PDS data.',
        visual: <HomeVisual />,
      };
  }
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
        gap: '14px',
      }}
    >
      <UrlPill url="aturi.to/profile/dame.is" />
      <DropChevron />
      <WaypointRow highlightIndex={1} />
    </div>
  );
}

function UniversalLinksVisual() {
  return <HomeVisual />;
}

function ExploreVisual() {
  // AT-URI styled breadcrumb — the explorer's signature navigation
  // pattern, rendered as a horizontal pill so it scans like the
  // breadcrumb you'd see inside the app.
  const segments: { label: string; muted?: boolean }[] = [
    { label: 'pds.atpota.to' },
    { label: '@dame.is' },
    { label: 'app.bsky.actor.profile' },
    { label: 'self', muted: true },
  ];
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '10px 14px',
        padding: '24px 28px',
        background: OG_COLORS.bgSecondary,
        border: `1px solid ${OG_COLORS.borderMedium}`,
        fontFamily: 'Crimson Pro',
        fontSize: '24px',
      }}
    >
      {segments.map((s, i) => (
        <div
          key={s.label}
          style={{ display: 'flex', alignItems: 'center', gap: '14px' }}
        >
          {i > 0 && (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke={OG_COLORS.textTertiary} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" xmlns="http://www.w3.org/2000/svg">
              <polyline points="9 5 16 12 9 19" />
            </svg>
          )}
          <span
            style={{
              color: s.muted ? OG_COLORS.textTertiary : OG_COLORS.textPrimary,
              display: 'flex',
            }}
          >
            {s.label}
          </span>
        </div>
      ))}
    </div>
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
        width: '460px',
        background: OG_COLORS.bgSecondary,
        border: `1px solid ${OG_COLORS.borderMedium}`,
        boxShadow: '0 12px 40px rgba(0, 0, 0, 0.35)',
        transform: 'rotate(-1deg)',
      }}
    >
      {/* Popup header */}
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
        <div
          style={{
            fontSize: '14px',
            color: OG_COLORS.textTertiary,
            display: 'flex',
          }}
        >
          app.bsky.feed.post
        </div>
      </div>
      {/* Source URI strip */}
      <div
        style={{
          padding: '10px 18px',
          borderBottom: `1px solid ${OG_COLORS.borderSubtle}`,
          fontSize: '15px',
          color: OG_COLORS.textTertiary,
          display: 'flex',
        }}
      >
        <span style={{ display: 'flex', color: OG_COLORS.textSecondary }}>at://</span>
        <span style={{ display: 'flex' }}>&nbsp;dame.is&nbsp;/&nbsp;app.bsky.feed.post&nbsp;/&nbsp;3lq9…</span>
      </div>
      {/* Recommended section */}
      <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
        <div
          style={{
            fontSize: '12px',
            letterSpacing: '0.14em',
            textTransform: 'uppercase',
            color: OG_COLORS.accent,
            display: 'flex',
            alignItems: 'center',
            gap: '6px',
          }}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill={OG_COLORS.accent} xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2l2.9 6.26L21.5 9.27l-5 4.6 1.4 6.86L12 17.5l-5.9 3.23 1.4-6.86-5-4.6 6.6-1.01L12 2z" />
          </svg>
          <span style={{ display: 'flex' }}>Recommended for posts</span>
        </div>
        <RowChip name="Anisota" desc="View post on anisota.net" icon={<AnisotaIcon height={26} color={OG_COLORS.accent} />} featured />
      </div>
    </div>
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
      <div style={{ display: 'flex', alignItems: 'center', width: 28, justifyContent: 'center' }}>
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

    const allText =
      `${config.title} ${config.tagline} ${config.eyebrow} aturi.to ` +
      'Anisota Bluesky Leaflet Tangled Margin Deer Grain Recommended for posts ' +
      'pds.atpota.to dame.is app.bsky.feed.post app.bsky.actor.profile self at:// ' +
      // The eyebrow is rendered uppercase via CSS; include the full alphabet
      // so the font subset has glyphs for the transformed text (see
      // OG_GLYPH_BASELINE).
      OG_GLYPH_BASELINE;
    const fontData = await loadGoogleFont('Crimson+Pro:wght@300;400;600', allText);

    return new ImageResponse(
      (
        <OgFrame>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              gap: '36px',
              position: 'relative',
              zIndex: 1,
            }}
          >
            <TopRow eyebrow={config.eyebrow} />

            <Headline title={config.title} tagline={config.tagline} />

            <div
              style={{
                display: 'flex',
                flex: 1,
                alignItems: 'flex-end',
                justifyContent: 'center',
              }}
            >
              {config.visual}
            </div>
          </div>
        </OgFrame>
      ),
      {
        width: 1200,
        height: 630,
        fonts: [
          {
            name: 'Crimson Pro',
            data: fontData,
            style: 'normal',
            weight: 300,
          },
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
