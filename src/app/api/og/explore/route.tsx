import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';
import {
  ChipSlash,
  ContextLabel,
  fitMonoSize,
  FooterCta,
  Headline,
  IdentityChip,
  loadGoogleFont,
  OgFooter,
  OgFrame,
  OG_COLORS,
  OG_GLYPH_BASELINE,
  ServerGlyph,
  TopRow,
} from '@/lib/og-design';
import { pdsHostname } from '@/utils/atproto/pdsServer';
import { isBlockedFetchHost } from '@/utils/ssrfGuard';
import type { ReactNode } from 'react';

export const runtime = 'edge';
export const revalidate = 3600;

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
  const leafCap = chips.length === 1 ? 92 : chips.length === 2 ? 82 : 72;
  // 1000 rather than the full 1060 content width, leaving room for the
  // trailing slash and a margin — a chip that lands exactly on the edge reads
  // as clipped even when it technically fits.
  const width = (c: Chip) => c.text.length + (c.glyph ? 2 : 0);
  const leafSize = fitMonoSize(width(chips[leafIndex]), leafCap, { maxWidth: 1000 });

  return chips.map((chip, i) => {
    if (i === leafIndex) return leafSize;
    const stepsBack = leafIndex - i;
    const cap = Math.round(leafSize * (stepsBack === 1 ? 0.8 : 0.68));
    return fitMonoSize(width(chip), cap, { maxWidth: 1000 });
  });
}

/** Leaf is brightest; each step back from it recedes. */
function chipTone(index: number, total: number): 'primary' | 'accent' | 'muted' {
  const stepsBack = total - 1 - index;
  if (stepsBack === 0) return 'primary';
  if (stepsBack === 1) return 'accent';
  return 'muted';
}

/**
 * Context line: what kind of thing this is, and which server it lives on.
 * Deliberately small — the chips below carry the headline.
 */
function ContextRow({ card }: { card: Card }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
      <ContextLabel>{card.label}</ContextLabel>
      {card.pdsHost && (
        <div
          style={{
            display: 'flex',
            width: '4px',
            height: '4px',
            background: OG_COLORS.textTertiary,
          }}
        />
      )}
      {card.pdsHost && (
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '9px',
            fontFamily: 'IBM Plex Mono',
            fontSize: '20px',
            fontWeight: 500,
            color: OG_COLORS.textTertiary,
          }}
        >
          <ServerGlyph size={19} />
          <span style={{ display: 'flex' }}>{card.pdsHost}</span>
        </div>
      )}
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
            ? OG_COLORS.textPrimary
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
          tagline: 'Every record in this collection, with live counts.',
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
    const eyebrow = isLink ? 'Universal link' : 'Atmosphere Explorer';
    const fallbackTagline =
      'Browse the records, identity history, and backlinks for any account in the Atmosphere.';

    const serifText =
      `${eyebrow} ${card?.tagline ?? fallbackTagline} Browse every PDS. ` +
      'Open in any Atmosphere client aturi.to ' +
      OG_GLYPH_BASELINE;
    const monoText =
      `${card?.label ?? ''} ${card?.chips.map((c) => c.text).join(' ') ?? ''} ` +
      `${card?.pdsHost ?? ''} aturi.to/explore @ . : / - _ ` +
      OG_GLYPH_BASELINE;

    const [crimsonData, monoData] = await Promise.all([
      loadGoogleFont('Crimson+Pro:wght@300;400;600', serifText),
      loadGoogleFont('IBM+Plex+Mono:wght@500', monoText),
    ]);

    const content: ReactNode = (
      <OgFrame>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            position: 'relative',
            zIndex: 1,
          }}
        >
          <TopRow eyebrow={eyebrow} />

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              justifyContent: 'center',
              gap: '26px',
            }}
          >
            {/* Rendered as flat siblings, never wrapped in a fragment: Satori
                treats a fragment as a layout node, which collapses the parent
                column back into a row. */}
            {card && <ContextRow card={card} />}
            {card && <HeadlineChips card={card} />}
            {!card && <Headline title={'Browse every\nPDS.'} tagline={fallbackTagline} />}
          </div>

          <OgFooter
            left={
              // The fallback card already carries its tagline in the headline
              // block, so leave the footer's left slot empty rather than
              // echoing the URL that sits on the right.
              card ? (
                <div
                  style={{
                    display: 'flex',
                    fontFamily: 'Crimson Pro',
                    fontSize: '27px',
                    fontWeight: 300,
                    color: OG_COLORS.textSecondary,
                    lineHeight: 1.3,
                    maxWidth: '740px',
                  }}
                >
                  {card.tagline}
                </div>
              ) : undefined
            }
            right={
              isLink ? (
                <FooterCta>Open in any Atmosphere client</FooterCta>
              ) : (
                <div
                  style={{
                    display: 'flex',
                    flexShrink: 0,
                    fontFamily: 'IBM Plex Mono',
                    fontSize: '19px',
                    fontWeight: 500,
                    letterSpacing: '0.02em',
                    color: OG_COLORS.textTertiary,
                  }}
                >
                  aturi.to/explore
                </div>
              )
            }
          />
        </div>
      </OgFrame>
    );

    return new ImageResponse(content, {
      width: 1200,
      height: 630,
      fonts: [
        { name: 'Crimson Pro', data: crimsonData, weight: 300, style: 'normal' },
        { name: 'IBM Plex Mono', data: monoData, weight: 500, style: 'normal' },
      ],
      headers: {
        // Explore cards show live repo data — cache for an hour, not
        // @vercel/og's immutable year.
        'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
      },
    });
  } catch (error) {
    console.error('Error generating explore OG image:', error);
    return new Response('Error generating image', { status: 500 });
  }
}
