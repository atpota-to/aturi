import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';
import {
  loadGoogleFont,
  OgFrame,
  OG_COLORS,
  OG_GLYPH_BASELINE,
  TopRow,
} from '@/lib/og-design';
import { pdsHostname } from '@/utils/atproto/pdsServer';
import type { ReactNode } from 'react';

export const runtime = 'edge';
export const revalidate = 3600;

// ─── Identity resolution ────────────────────────────────────────────────────
// Best-effort, PDS-agnostic resolution so the breadcrumb matches the in-app
// trail (pds host → @handle → collection → rkey). Every step is guarded; we
// render with whatever we managed to resolve and fall back to the raw repo.

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
      docUrl = `https://${host}/.well-known/did.json`;
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
    // DID-doc fetch is optional — the breadcrumb just drops the PDS segment
  }

  return out;
}

/** Collapse a long DID into something that fits a breadcrumb segment. */
function shortenDid(did: string): string {
  if (did.length <= 24) return did;
  return `${did.slice(0, 20)}…`;
}

// ─── Breadcrumb hero ─────────────────────────────────────────────────────────

type SegmentKind = 'pds' | 'repo' | 'collection' | 'rkey';
type Segment = { kind: SegmentKind; label: string };

function ChevronRight({ size, color }: { size: number; color: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

function ServerGlyph({ size, color }: { size: number; color: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
      <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
      <path d="M6 6h.01" />
      <path d="M6 18h.01" />
    </svg>
  );
}

function BreadcrumbHero({ segments }: { segments: Segment[] }) {
  // Scale the trail down as it gets longer so typical AT URIs stay on one or
  // two lines instead of overflowing the 1200px card.
  const totalLen =
    segments.reduce((n, s) => n + s.label.length, 0) + segments.length * 3;
  let size = 52;
  if (totalLen > 28) size = 44;
  if (totalLen > 40) size = 36;
  if (totalLen > 56) size = 30;
  if (totalLen > 74) size = 26;

  const toneFor = (i: number): string => {
    const isLeaf = i === segments.length - 1;
    if (isLeaf) return OG_COLORS.accent;
    const kind = segments[i].kind;
    if (kind === 'pds') return OG_COLORS.textTertiary;
    if (kind === 'collection') return OG_COLORS.textPrimary;
    return OG_COLORS.textSecondary;
  };

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: `${Math.round(size * 0.42)}px`,
        padding: '32px 36px',
        background: OG_COLORS.bgSecondary,
        border: `1px solid ${OG_COLORS.borderMedium}`,
        fontFamily: 'IBM Plex Mono',
      }}
    >
      {segments.map((seg, i) => {
        const isLeaf = i === segments.length - 1;
        const color = toneFor(i);
        return (
          <div
            key={`${seg.kind}-${i}`}
            style={{ display: 'flex', alignItems: 'center', gap: `${Math.round(size * 0.42)}px` }}
          >
            {i > 0 && <ChevronRight size={Math.round(size * 0.72)} color={OG_COLORS.textTertiary} />}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: `${Math.round(size * 0.3)}px`,
                fontSize: `${size}px`,
                fontWeight: 500,
                color,
                lineHeight: 1.1,
                // Highlight the leaf (the record/collection you actually
                // shared) with an accent chip so the eye lands there.
                ...(isLeaf
                  ? {
                      padding: `${Math.round(size * 0.16)}px ${Math.round(size * 0.34)}px`,
                      background: OG_COLORS.bgTertiary,
                      border: `1px solid ${OG_COLORS.borderAccent}`,
                    }
                  : {}),
              }}
            >
              {seg.kind === 'pds' && (
                <ServerGlyph size={Math.round(size * 0.78)} color={color} />
              )}
              <span style={{ display: 'flex' }}>{seg.label}</span>
            </div>
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

    // Build the breadcrumb segments.
    const segments: Segment[] = [];
    let contextLabel = 'Repository';
    let tagline = 'Records, lexicons, identity history, and backlinks.';

    if (hostParam && !repo) {
      // PDS-level link: the host is the whole trail.
      segments.push({ kind: 'pds', label: pdsHostname(hostParam) });
      contextLabel = 'Personal data server';
      tagline = 'Server metadata, available domains, and the repos it hosts.';
    } else if (repo) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      let resolved: Resolved = {};
      try {
        resolved = await resolveRepo(repo, controller.signal);
      } finally {
        clearTimeout(timeoutId);
      }

      if (resolved.pdsHost) segments.push({ kind: 'pds', label: resolved.pdsHost });

      const repoLabel = resolved.handle
        ? `@${resolved.handle}`
        : repo.startsWith('did:')
        ? shortenDid(repo)
        : repo;
      segments.push({ kind: 'repo', label: repoLabel });

      if (collection) segments.push({ kind: 'collection', label: collection });
      if (rkey) segments.push({ kind: 'rkey', label: rkey });

      if (rkey) {
        contextLabel = 'Record';
        tagline = 'Raw record data, the lexicon behind it, and who links to it.';
      } else if (collection) {
        contextLabel = 'Collection';
        tagline = 'Every record in this collection, with live counts.';
      } else {
        contextLabel = 'Repository';
        tagline = 'Records, lexicons, identity history, and backlinks.';
      }
    } else {
      // No target — degrade to a generic explorer card rather than 500.
      segments.push({ kind: 'repo', label: 'aturi.to/explore' });
      contextLabel = 'Atmosphere explorer';
      tagline = 'Browse the PDS records, identity, and backlinks for any account.';
    }

    const serifText =
      `Atmosphere Explorer ${contextLabel} ${tagline} aturi.to ` + OG_GLYPH_BASELINE;
    const monoText =
      `${contextLabel} ${segments.map((s) => s.label).join(' ')} @ . : / - _ ` +
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
          <TopRow eyebrow="Atmosphere Explorer" />

          {/* Breadcrumb hero — vertically centered so the trail is the focus. */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              justifyContent: 'center',
              gap: '24px',
            }}
          >
            <div
              style={{
                display: 'flex',
                fontFamily: 'IBM Plex Mono',
                fontSize: '20px',
                fontWeight: 500,
                letterSpacing: '0.18em',
                textTransform: 'uppercase',
                color: OG_COLORS.accent,
              }}
            >
              {contextLabel}
            </div>

            <BreadcrumbHero segments={segments} />

            <div
              style={{
                display: 'flex',
                fontFamily: 'Crimson Pro',
                fontSize: '30px',
                fontWeight: 300,
                color: OG_COLORS.textSecondary,
                lineHeight: 1.3,
                maxWidth: '960px',
              }}
            >
              {tagline}
            </div>
          </div>
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
    });
  } catch (error) {
    console.error('Error generating explore OG image:', error);
    return new Response('Error generating image', { status: 500 });
  }
}
