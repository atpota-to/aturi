import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';
import { fetchImageAsDataUrl } from '@/lib/og-image';
import {
  ContextLabel,
  FooterCta,
  loadGoogleFont,
  OgFooter,
  OgFrame,
  OG_COLORS,
  OG_GLYPH_BASELINE,
  sanitizeOgText,
  TopRow,
} from '@/lib/og-design';

export const runtime = 'edge';
export const revalidate = 3600; // Cache for 1 hour

const LIST_AVATAR = 104;

/**
 * Trim to a word boundary near `max`, dropping trailing punctuation so the
 * ellipsis doesn't land as "weather.…".
 */
function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.replace(/[\s.,;:!?—-]+$/, '')}…`;
}

function ListGlyph({ size = 44 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={OG_COLORS.accent}
      strokeWidth={1.4}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <line x1="9" y1="6" x2="20" y2="6" />
      <line x1="9" y1="12" x2="20" y2="12" />
      <line x1="9" y1="18" x2="20" y2="18" />
      <circle cx="4.5" cy="6" r="1.2" />
      <circle cx="4.5" cy="12" r="1.2" />
      <circle cx="4.5" cy="18" r="1.2" />
    </svg>
  );
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const identifier = searchParams.get('handle'); // This should be a DID
    const rkey = searchParams.get('rkey');

    if (!identifier || !rkey) {
      return new Response('Missing parameters', { status: 400 });
    }

    const apiUrl = process.env.NEXT_PUBLIC_BSKY_API_URL || 'https://public.api.bsky.app';

    let listData = null;
    let creatorData = null;

    try {
      const uri = `at://${identifier}/app.bsky.graph.list/${rkey}`;
      const response = await fetch(
        `${apiUrl}/xrpc/app.bsky.graph.getList?list=${encodeURIComponent(uri)}&limit=1`,
        {
          headers: { Accept: 'application/json' },
          next: { revalidate: 3600 }, // Cache for 1 hour
          // Bound the upstream call so a hung connection can't pin the
          // function until the platform's task timeout.
          signal: AbortSignal.timeout(8000),
        },
      );

      if (response.ok) {
        const data = await response.json();
        listData = data.list;
        creatorData = data.list?.creator;
      }
    } catch (error) {
      console.error('Error fetching list:', error);
    }

    const listName = sanitizeOgText(listData?.name || 'Atmosphere List');
    // No description means no description — the old placeholder ("View this
    // list in your preferred Atmosphere client") restated the footer CTA two
    // lines below it.
    // Flatten the author's line breaks: a description written as paragraphs
    // burns the card's whole body on blank lines and pushes the byline out
    // through the bottom of its container.
    const description = clamp(
      sanitizeOgText(listData?.description || '').replace(/\s*\n+\s*/g, ' ').trim(),
      180,
    );
    const itemCount: number | null =
      typeof listData?.listItemCount === 'number' ? listData.listItemCount : null;
    const creatorName = sanitizeOgText(creatorData?.displayName || creatorData?.handle || identifier);
    const creatorHandle = sanitizeOgText(creatorData?.handle || identifier);

    const [listAvatarDataUrl, creatorAvatarDataUrl] = await Promise.all([
      fetchImageAsDataUrl(listData?.avatar || ''),
      fetchImageAsDataUrl(creatorData?.avatar || ''),
    ]);

    const countLabel =
      itemCount === null ? '' : `${itemCount.toLocaleString()} ${itemCount === 1 ? 'member' : 'members'}`;

    const allText =
      `${listName} ${description} ${creatorName} @${creatorHandle} ${countLabel} ` +
      'List Curated by aturi.to Open in any Atmosphere client Universal link ' +
      OG_GLYPH_BASELINE;

    const [crimsonData, monoData] = await Promise.all([
      loadGoogleFont('Crimson+Pro:wght@300;400;600', allText),
      loadGoogleFont(
        'IBM+Plex+Mono:wght@500',
        `List @${creatorHandle} ${countLabel} , . : / - _ ` + OG_GLYPH_BASELINE,
      ),
    ]);

    const nameSize = listName.length > 30 ? 44 : listName.length > 20 ? 52 : 60;

    return new ImageResponse(
      (
        <OgFrame>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              gap: '28px',
              position: 'relative',
              zIndex: 1,
            }}
          >
            <TopRow eyebrow="Universal link" />

            <div style={{ display: 'flex', alignItems: 'center', gap: '26px', flexShrink: 0 }}>
              <div
                style={{
                  width: `${LIST_AVATAR}px`,
                  height: `${LIST_AVATAR}px`,
                  flexShrink: 0,
                  background: OG_COLORS.bgTertiary,
                  border: `1px solid ${OG_COLORS.borderAccent}`,
                  boxShadow: '0 0 40px rgba(138, 154, 127, 0.16)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                {listAvatarDataUrl ? (
                  <img
                    src={listAvatarDataUrl}
                    alt=""
                    width={LIST_AVATAR}
                    height={LIST_AVATAR}
                    style={{
                      width: `${LIST_AVATAR}px`,
                      height: `${LIST_AVATAR}px`,
                      objectFit: 'cover',
                    }}
                  />
                ) : (
                  <ListGlyph size={44} />
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                  <ContextLabel>List</ContextLabel>
                  {countLabel && (
                    <div
                      style={{
                        display: 'flex',
                        fontFamily: 'IBM Plex Mono',
                        fontSize: '19px',
                        fontWeight: 500,
                        color: OG_COLORS.textTertiary,
                      }}
                    >
                      {countLabel}
                    </div>
                  )}
                </div>
                <div
                  style={{
                    display: 'flex',
                    fontSize: `${nameSize}px`,
                    fontWeight: 400,
                    letterSpacing: '-0.02em',
                    lineHeight: 1.1,
                  }}
                >
                  {listName}
                </div>
              </div>
            </div>

            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              {description && (
                <div
                  style={{
                    display: 'flex',
                    fontSize: '26px',
                    lineHeight: 1.5,
                    fontWeight: 300,
                    color: OG_COLORS.textSecondary,
                    wordBreak: 'break-word',
                  }}
                >
                  {description}
                </div>
              )}
            </div>

            <OgFooter
              // The byline lives in the footer so an undescribed list still has
              // a weighted bottom edge instead of one line floating mid-card.
              left={
                <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                  <div
                    style={{
                      width: '42px',
                      height: '42px',
                      flexShrink: 0,
                      background: OG_COLORS.bgTertiary,
                      border: `1px solid ${OG_COLORS.borderMedium}`,
                      display: 'flex',
                      overflow: 'hidden',
                    }}
                  >
                    {creatorAvatarDataUrl && (
                      <img
                        src={creatorAvatarDataUrl}
                        alt=""
                        width={42}
                        height={42}
                        style={{ width: '42px', height: '42px', objectFit: 'cover' }}
                      />
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
                    <span
                      style={{ display: 'flex', fontSize: '23px', color: OG_COLORS.textSecondary }}
                    >
                      Curated by {creatorName}
                    </span>
                    <span
                      style={{
                        display: 'flex',
                        fontFamily: 'IBM Plex Mono',
                        fontSize: '18px',
                        fontWeight: 500,
                        color: OG_COLORS.textTertiary,
                      }}
                    >
                      {'@' + creatorHandle}
                    </span>
                  </div>
                </div>
              }
              right={<FooterCta>Open in any Atmosphere client</FooterCta>}
            />
          </div>
        </OgFrame>
      ),
      {
        width: 1200,
        height: 630,
        fonts: [
          { name: 'Crimson Pro', data: crimsonData, weight: 300, style: 'normal' },
          { name: 'IBM Plex Mono', data: monoData, weight: 500, style: 'normal' },
        ],
        headers: {
          // Override @vercel/og's default 1-year immutable cache: list
          // cards change when the list's name/description changes.
          'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
        },
      },
    );
  } catch (error) {
    console.error('Error generating OG image:', error);
    // Serve the branded static card instead of a broken image so link
    // unfurls in Slack/Discord/Messages still show something.
    return Response.redirect(new URL('/api/og/static', request.url), 302);
  }
}
