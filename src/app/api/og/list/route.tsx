import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';
import { fetchImageAsDataUrl } from '@/lib/og-image';
import {
  Avatar,
  BrandMark,
  Folder,
  FooterCta,
  loadOgFonts,
  OgFrame,
  OG_COLORS,
  PersonGlyph,
  sanitizeOgText,
} from '@/lib/og-design';

export const runtime = 'edge';
export const revalidate = 3600; // Cache for 1 hour

const LIST_AVATAR = 112;

/**
 * Trim to a word boundary near `max`, dropping trailing punctuation so the
 * ellipsis doesn't land as "weather.…".
 */
function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.replace(/[\s.,;:!?·|—-]+$/, '')}…`;
}

function ListGlyph({ size = 44, color = OG_COLORS.accent }: { size?: number; color?: string }) {
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

    const fonts = await loadOgFonts(
      `${listName} ${description} Curated by ${creatorName} ${countLabel} List Open in any Atmosphere client`,
      `@${creatorHandle}`,
    );

    const nameSize = listName.length > 30 ? 42 : listName.length > 20 ? 50 : 58;

    return new ImageResponse(
      (
        <OgFrame>
          <Folder
            tab={
              countLabel ? (
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                  <span style={{ display: 'flex' }}>List</span>
                  <span style={{ display: 'flex', fontWeight: 500, color: OG_COLORS.textTertiary }}>
                    {countLabel}
                  </span>
                </div>
              ) : (
                'List'
              )
            }
            tabIcon={<ListGlyph size={22} />}
            aside={<BrandMark />}
            // The byline lives in the footer so an undescribed list still has
            // a weighted bottom edge instead of one line floating mid-card.
            footerLeft={
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', minWidth: 0 }}>
                <Avatar src={creatorAvatarDataUrl} size={40} fallback={<PersonGlyph size={20} />} />
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px' }}>
                  <span style={{ display: 'flex', fontSize: '22px', color: OG_COLORS.textSecondary }}>
                    Curated by
                    <span style={{ display: 'flex', marginLeft: '6px', fontWeight: 700, color: OG_COLORS.textPrimary }}>
                      {creatorName}
                    </span>
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
            footerRight={<FooterCta>Open in any Atmosphere client</FooterCta>}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '28px', flexShrink: 0 }}>
              <Avatar
                src={listAvatarDataUrl}
                size={LIST_AVATAR}
                shape="square"
                fallback={<ListGlyph size={48} />}
              />
              <div
                style={{
                  display: 'flex',
                  fontSize: `${nameSize}px`,
                  fontWeight: 800,
                  letterSpacing: '-0.03em',
                  lineHeight: 1.1,
                  minWidth: 0,
                }}
              >
                {listName}
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
                    color: OG_COLORS.textSecondary,
                    wordBreak: 'break-word',
                  }}
                >
                  {description}
                </div>
              )}
            </div>
          </Folder>
        </OgFrame>
      ),
      {
        width: 1200,
        height: 630,
        fonts,
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
