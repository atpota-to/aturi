import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';
import {
  BrandMark,
  ChipSlash,
  fitMonoSize,
  Folder,
  FooterCta,
  Headline,
  IdentityChip,
  loadOgFonts,
  OgFrame,
  OG_COLORS,
  PANEL_CONTENT_W,
  ServerGlyph,
} from '@/lib/og-design';
import { pdsHostname } from '@/utils/atproto/pdsServer';
import { isBlockedFetchHost } from '@/utils/ssrfGuard';
import type { ReactNode } from 'react';

export const runtime = 'edge';
export const revalidate = 3600;

// ─── CDN lifetimes ──────────────────────────────────────────────────────────
// Every render is a function invocation, and a render costs real CPU, so
// each kind of card stays in Vercel's CDN as long as its content allows.
// Vercel keys that cache on the deployment, so a deploy starts every card
// fresh and design changes never wait on these.
//
// Lexicon, namespace, PDS, and fallback cards are built from the URL alone,
// so nothing short of a deploy can change them.
const CDN_MAX_AGE_STATIC = 60 * 60 * 24 * 365;
// Repo cards show a handle and a PDS host, which change rarely.
const CDN_MAX_AGE_RESOLVED = 60 * 60 * 24;
// A repo card whose identity lookup failed or timed out shows a bare DID and
// no PDS. Keep that one short so a slow plc.directory doesn't pin it.
const CDN_MAX_AGE_DEGRADED = 60 * 60;

// ─── Identity resolution ────────────────────────────────────────────────────
// Best-effort, PDS-agnostic resolution so the card names the account the way
// the app does (@handle, not a raw DID). Every step is guarded; we render with
// whatever we managed to resolve and fall back to the raw repo.

type Resolved = { did?: string; handle?: string; pdsHost?: string };

async function resolveRepo(repo: string, signal: AbortSignal): Promise<Resolved> {
  const out: Resolved = {};
  let did = '';

  if (repo.startsWith('did:')) {
    did = repo;
  } else {
    out.handle = repo;
    try {
      const r = await fetch(
        `https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=${encodeURIComponent(repo)}`,
        { signal },
      );
      if (r.ok) {
        const j = (await r.json()) as { did?: string };
        if (j?.did) did = j.did;
      }
    } catch {
      // identity resolution is optional — keep the bare handle
    }
  }

  if (!did) return out;
  out.did = did;

  try {
    let docUrl = '';
    if (did.startsWith('did:plc:')) {
      docUrl = `https://plc.directory/${did}`;
    } else if (did.startsWith('did:web:')) {
      const host = did.slice('did:web:'.length).replace(/:/g, '/');
      // did:web host comes straight from the caller-supplied ?repo= param;
      // reject loopback/private/internal targets so this can't be used to
      // probe internal services via the OG renderer (SSRF).
      if (!isBlockedFetchHost(host.split('/')[0])) {
        docUrl = `https://${host}/.well-known/did.json`;
      }
    }

    if (docUrl) {
      const r = await fetch(docUrl, { signal });
      if (r.ok) {
        const doc = (await r.json()) as {
          alsoKnownAs?: string[];
          service?: { id?: string; type?: string; serviceEndpoint?: string }[];
        };
        if (!out.handle) {
          const aka = (doc.alsoKnownAs || []).find((a) => a.startsWith('at://'));
          if (aka) out.handle = aka.slice('at://'.length);
        }
        const pds = (doc.service || []).find(
          (s) => s?.type === 'AtprotoPersonalDataServer' || s?.id?.endsWith('#atproto_pds'),
        );
        if (pds?.serviceEndpoint) out.pdsHost = pdsHostname(pds.serviceEndpoint);
      }
    }
  } catch {
    // DID-doc fetch is optional — the card just drops the PDS line
  }

  return out;
}

/** Collapse a long DID into something that still fits a headline chip. */
function shortenDid(did: string): string {
  if (did.length <= 24) return did;
  return `${did.slice(0, 20)}…`;
}

// ─── Card model ─────────────────────────────────────────────────────────────

type Chip = { text: string; glyph?: boolean };

type Card = {
  label: string;
  tagline: string;
  /** The AT-URI trail, leaf last — the leaf is what the route points at. */
  chips: Chip[];
  pdsHost?: string;
};

/**
 * Size the trail from the leaf backwards.
 *
 * The leaf takes the largest size that still fits the content width; each
 * segment above it is then capped at a fraction of whatever the leaf actually
 * landed on. Sizing every chip independently would let a short handle outgrow
 * a long NSID below it and invert the hierarchy — @dame.is has room to be
 * enormous, com.atproto.lexicon.schema does not.
 */
function chipSizes(chips: Chip[]): number[] {
  const leafIndex = chips.length - 1;
  // Lower caps the deeper the trail, so a three-chip record still fits the
  // sheet's height under the PDS line.
  const leafCap = chips.length === 1 ? 92 : chips.length === 2 ? 78 : 64;
  // Short of the sheet's full content width, leaving room for the trailing
  // slash and a margin — a chip that lands exactly on the edge reads as
  // clipped even when it technically fits.
  const maxWidth = PANEL_CONTENT_W - 56;
  const width = (c: Chip) => c.text.length + (c.glyph ? 2 : 0);
  const leafSize = fitMonoSize(width(chips[leafIndex]), leafCap, { maxWidth });

  return chips.map((chip, i) => {
    if (i === leafIndex) return leafSize;
    const stepsBack = leafIndex - i;
    const cap = Math.round(leafSize * (stepsBack === 1 ? 0.8 : 0.68));
    return fitMonoSize(width(chip), cap, { maxWidth });
  });
}

/** Leaf is brightest; each step back from it recedes. */
function chipTone(index: number, total: number): 'primary' | 'accent' | 'muted' {
  const stepsBack = total - 1 - index;
  if (stepsBack === 0) return 'primary';
  if (stepsBack === 1) return 'accent';
  return 'muted';
}

// ─── Tab glyphs ─────────────────────────────────────────────────────────────
// Lucide marks for the kind of thing on the sheet, so the explore cards' tabs
// carry an icon like the profile, post and list cards' do. Arrays rather than
// fragments: Satori cannot read a fragment inside an <svg> and the whole
// card fails.

const KIND_GLYPHS: Record<string, ReactNode[]> = {
  Repository: [
    <ellipse key="0" cx="12" cy="5" rx="9" ry="3" />,
    <path key="1" d="M3 5V19A9 3 0 0 0 21 19V5" />,
    <path key="2" d="M3 12A9 3 0 0 0 21 12" />,
  ],
  Collection: [
    <path key="0" d="M20 20a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-7.9a2 2 0 0 1-1.69-.9L9.6 3.9A2 2 0 0 0 7.93 3H4a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2Z" />,
  ],
  Record: [
    <path key="0" d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />,
    <path key="1" d="M14 2v4a2 2 0 0 0 2 2h4" />,
    <path key="2" d="M16 13H8" />,
    <path key="3" d="M16 17H8" />,
  ],
  Lexicon: [
    <path key="0" d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5c0 1.1.9 2 2 2h1" />,
    <path key="1" d="M16 21h1a2 2 0 0 0 2-2v-5c0-1.1.9-2 2-2a2 2 0 0 1-2-2V5a2 2 0 0 0-2-2h-1" />,
  ],
  Namespace: [
    <path key="0" d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />,
    <path key="1" d="m22 17.65-9.17 4.16a2 2 0 0 1-1.66 0L2 17.65" />,
    <path key="2" d="m22 12.65-9.17 4.16a2 2 0 0 1-1.66 0L2 12.65" />,
  ],
  'Atmosphere Explorer': [
    <path key="0" d="m10.065 12.493-6.18 1.318a.934.934 0 0 1-1.108-.702l-.537-2.15a1.07 1.07 0 0 1 .691-1.265l13.504-4.44" />,
    <path key="1" d="m13.56 11.747 4.332-.924" />,
    <path key="2" d="m16 21-3.105-6.21" />,
    <path key="3" d="M16.485 5.94a2 2 0 0 1 1.455-2.425l1.09-.272a1 1 0 0 1 1.212.727l1.515 6.06a1 1 0 0 1-.727 1.213l-1.09.272a2 2 0 0 1-2.425-1.455z" />,
    <path key="4" d="m6.158 8.633 1.114 4.456" />,
    <path key="5" d="m8 21 3.105-6.21" />,
    <circle key="6" cx="12" cy="13" r="2" />,
  ],
};

function TabGlyph({ kind }: { kind: string }) {
  if (kind === 'Personal data server') return <ServerGlyph size={20} color={OG_COLORS.accent} />;
  const paths = KIND_GLYPHS[kind];
  if (!paths) return null;
  return (
    <svg
      width={20}
      height={20}
      viewBox="0 0 24 24"
      fill="none"
      stroke={OG_COLORS.accent}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      {paths}
    </svg>
  );
}

/**
 * The server the record lives on, as the explorer's breadcrumb opens with
 * it. Deliberately small — the chips below carry the headline, and the kind
 * of thing this is sits on the folder tab.
 */
function PdsLine({ host }: { host: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        fontFamily: 'IBM Plex Mono',
        fontSize: '21px',
        fontWeight: 500,
        color: OG_COLORS.textTertiary,
      }}
    >
      <ServerGlyph size={20} />
      <span style={{ display: 'flex' }}>{host}</span>
    </div>
  );
}

function HeadlineChips({ card }: { card: Card }) {
  const sizes = chipSizes(card.chips);
  const total = card.chips.length;

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'flex-start',
        gap: '14px',
      }}
    >
      {card.chips.map((chip, i) => {
        const tone = chipTone(i, total);
        const glyphColor =
          tone === 'primary'
            ? OG_COLORS.textSecondary
            : tone === 'accent'
            ? OG_COLORS.accent
            : OG_COLORS.textTertiary;
        return (
          <div
            key={chip.text}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: `${Math.round(sizes[i] * 0.28)}px`,
            }}
          >
            <IdentityChip
              text={chip.text}
              size={sizes[i]}
              tone={tone}
              icon={
                chip.glyph ? (
                  <ServerGlyph size={Math.round(sizes[i] * 0.82)} color={glyphColor} />
                ) : undefined
              }
            />
            {i < total - 1 && <ChipSlash size={sizes[i]} />}
          </div>
        );
      })}
    </div>
  );
}

// ─── Route ────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const repo = searchParams.get('repo') || '';
    const collection = searchParams.get('collection') || '';
    const rkey = searchParams.get('rkey') || '';
    const hostParam = searchParams.get('host') || '';
    const nsidParam = searchParams.get('nsid') || '';
    const prefixParam = searchParams.get('prefix') || '';
    // Universal-link pages share this layout but sell a different action:
    // "open this anywhere" rather than "inspect this here".
    const isLink = searchParams.get('context') === 'link';

    let card: Card | null = null;
    // How long Vercel's CDN may keep the rendered card. See the response
    // headers below for why each kind of card gets the lifetime it does.
    let cdnMaxAge = CDN_MAX_AGE_STATIC;

    if (hostParam && !repo) {
      card = {
        label: 'Personal data server',
        tagline: 'Server metadata, available domains, and the repos it hosts.',
        chips: [{ text: pdsHostname(hostParam), glyph: true }],
      };
    } else if (nsidParam) {
      card = {
        label: 'Lexicon',
        tagline: 'Schema, usage trends, and recent records across the network.',
        chips: [{ text: nsidParam }],
      };
    } else if (prefixParam) {
      card = {
        label: 'Namespace',
        tagline: 'Every lexicon published under this namespace.',
        chips: [{ text: prefixParam }],
      };
    } else if (repo) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      let resolved: Resolved = {};
      try {
        resolved = await resolveRepo(repo, controller.signal);
      } finally {
        clearTimeout(timeoutId);
      }
      // pdsHost only lands once the DID document was read, so its absence
      // means resolution fell short and the card is the degraded one.
      cdnMaxAge = resolved.pdsHost ? CDN_MAX_AGE_RESOLVED : CDN_MAX_AGE_DEGRADED;

      const handle = resolved.handle
        ? `@${resolved.handle}`
        : repo.startsWith('did:')
        ? shortenDid(repo)
        : repo;

      if (rkey && collection) {
        card = {
          label: 'Record',
          tagline: isLink
            ? 'A single record, ready to open wherever you read the Atmosphere.'
            : 'Raw record data, the lexicon behind it, and who links to it.',
          chips: [{ text: handle }, { text: collection }, { text: rkey }],
          pdsHost: resolved.pdsHost,
        };
      } else if (collection) {
        card = {
          label: 'Collection',
          tagline: 'Every record in this collection for this account.',
          chips: [{ text: handle }, { text: collection }],
          pdsHost: resolved.pdsHost,
        };
      } else {
        card = {
          label: 'Repository',
          tagline: 'Records, lexicons, identity history, and backlinks.',
          chips: [{ text: handle }],
          pdsHost: resolved.pdsHost,
        };
      }
    }

    // No target — degrade to a branded explorer card rather than faking a
    // breadcrumb out of the site's own URL.
    const tab = card?.label ?? 'Atmosphere Explorer';
    const fallbackTagline =
      'Browse the records, identity history, and backlinks for any account in the Atmosphere.';

    const fonts = await loadOgFonts(
      `${tab} ${card?.tagline ?? fallbackTagline} Browse every PDS. Open in any Atmosphere client`,
      `${card?.chips.map((c) => c.text).join(' ') ?? ''} ${card?.pdsHost ?? ''} aturi.to/explore`,
    );

    const content: ReactNode = (
      <OgFrame>
        <Folder
          tab={tab}
          tabIcon={<TabGlyph kind={tab} />}
          aside={<BrandMark />}
          footerLeft={
            // The fallback card already carries its tagline in the headline
            // block, so leave the footer's left slot empty rather than
            // echoing the URL that sits on the right.
            card ? (
              <div
                style={{
                  display: 'flex',
                  fontSize: '23px',
                  color: OG_COLORS.textSecondary,
                  lineHeight: 1.35,
                  maxWidth: '640px',
                }}
              >
                {card.tagline}
              </div>
            ) : undefined
          }
          footerRight={
            isLink ? (
              <FooterCta>Open in any Atmosphere client</FooterCta>
            ) : (
              <div
                style={{
                  display: 'flex',
                  flexShrink: 0,
                  fontFamily: 'IBM Plex Mono',
                  fontSize: '20px',
                  fontWeight: 500,
                  color: OG_COLORS.accent,
                }}
              >
                aturi.to/explore
              </div>
            )
          }
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              justifyContent: 'center',
              gap: '24px',
            }}
          >
            {/* Rendered as flat siblings, never wrapped in a fragment: Satori
                treats a fragment as a layout node, which collapses the parent
                column back into a row. */}
            {card?.pdsHost && <PdsLine host={card.pdsHost} />}
            {card && <HeadlineChips card={card} />}
            {!card && <Headline title={'Browse\n*every PDS.*'} tagline={fallbackTagline} size={68} />}
          </div>
        </Folder>
      </OgFrame>
    );

    return new ImageResponse(content, {
      width: 1200,
      height: 630,
      fonts,
      headers: {
        // Not @vercel/og's immutable year: clients and downstream caches
        // keep an hour. The CDN lifetime varies by card (see the constants
        // at the top of the route).
        'Cache-Control': `public, max-age=3600, s-maxage=${cdnMaxAge}, stale-while-revalidate=86400`,
      },
    });
  } catch (error) {
    console.error('Error generating explore OG image:', error);
    return new Response('Error generating image', { status: 500 });
  }
}
