import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';
import { fetchImageAsDataUrl } from '@/lib/og-image';
import {
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

const AVATAR = 132;

/**
 * Trim a bio to at most `maxLines` lines and `maxChars` characters, breaking on
 * a word boundary and folding the ellipsis into the last line — the old
 * version emitted "…" as its own centred paragraph under the text.
 */
function clampBio(bio: string, { maxChars = 240, maxLines = 4 } = {}): string {
  const lines = bio.split('\n');
  let out = lines.slice(0, maxLines).join('\n');
  let truncated = lines.length > maxLines;

  if (out.length > maxChars) {
    const slice = out.slice(0, maxChars);
    const lastSpace = slice.lastIndexOf(' ');
    out = lastSpace > maxChars * 0.6 ? slice.slice(0, lastSpace) : slice;
    truncated = true;
  }

  out = out.trimEnd();
  // Drop trailing punctuation before the ellipsis, so a bio that happens to
  // break after a full stop doesn't render as "sky/weather.…".
  return truncated ? `${out.replace(/[\s.,;:!?·|—-]+$/, '')}…` : out;
}

function PersonGlyph({ size = 56 }: { size?: number }) {
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
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const identifier = searchParams.get('handle'); // This can be a handle or DID

    if (!identifier) {
      return new Response('Missing handle parameter', { status: 400 });
    }

    const apiUrl = process.env.NEXT_PUBLIC_BSKY_API_URL || 'https://public.api.bsky.app';

    let profileData = null;

    try {
      const response = await fetch(
        `${apiUrl}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(identifier)}`,
        {
          headers: { Accept: 'application/json' },
          next: { revalidate: 3600 },
          // A hung upstream connection here has kept this function alive
          // until Vercel's 300s task timeout. Bound it like the avatar fetch.
          signal: AbortSignal.timeout(8000),
        },
      );

      if (response.ok) {
        profileData = await response.json();
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
    }

    // Not every DID has a Bluesky profile. Rendering one anyway produced a card
    // headed by a raw did:plc: with 0 followers / 0 following / 0 posts, so hand
    // those off to the repository card, which is built for exactly that case.
    if (!profileData) {
      const fallback = new URL('/api/og/explore', request.url);
      fallback.search = '';
      fallback.searchParams.set('repo', identifier);
      return Response.redirect(fallback, 302);
    }

    const displayName = sanitizeOgText(profileData?.displayName || profileData?.handle || identifier);
    const handleName = sanitizeOgText(profileData?.handle || identifier);
    const bio = clampBio(sanitizeOgText(profileData?.description || ''));
    const avatarDataUrl = await fetchImageAsDataUrl(profileData?.avatar || '');

    const followers = profileData?.followersCount || 0;
    const following = profileData?.followsCount || 0;
    const posts = profileData?.postsCount || 0;

    const stats: [number, string][] = [
      [followers, 'followers'],
      [following, 'following'],
      [posts, 'posts'],
    ];

    // The eyebrow is uppercased in CSS, so the subset needs the full alphabet
    // to cover the transformed glyphs (see OG_GLYPH_BASELINE).
    const allText =
      `${displayName} @${handleName} ${bio} Universal link ` +
      `Open in any Atmosphere client followers following posts aturi.to ` +
      OG_GLYPH_BASELINE;

    const [crimsonData, monoData] = await Promise.all([
      loadGoogleFont('Crimson+Pro:wght@300;400;600', allText),
      loadGoogleFont(
        'IBM+Plex+Mono:wght@500',
        `@${handleName} ${stats.map(([n]) => n.toLocaleString()).join(' ')} , . : / - _ ` +
          OG_GLYPH_BASELINE,
      ),
    ]);

    // Long display names would otherwise run under the card's right edge.
    const nameSize = displayName.length > 26 ? 38 : displayName.length > 18 ? 44 : 52;

    return new ImageResponse(
      (
        <OgFrame>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              gap: '30px',
              position: 'relative',
              zIndex: 1,
            }}
          >
            <TopRow eyebrow="Universal link" />

            {/* Identity — avatar and name on one baseline, so the block reads
                as a single unit instead of two columns drifting apart. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '28px', flexShrink: 0 }}>
              <div
                style={{
                  width: `${AVATAR}px`,
                  height: `${AVATAR}px`,
                  flexShrink: 0,
                  background: OG_COLORS.bgTertiary,
                  border: `1px solid ${OG_COLORS.borderAccent}`,
                  boxShadow: '0 0 50px rgba(138, 154, 127, 0.16)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  overflow: 'hidden',
                }}
              >
                {avatarDataUrl ? (
                  <img
                    src={avatarDataUrl}
                    alt=""
                    width={AVATAR}
                    height={AVATAR}
                    style={{ width: `${AVATAR}px`, height: `${AVATAR}px`, objectFit: 'cover' }}
                  />
                ) : (
                  <PersonGlyph size={56} />
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    fontSize: `${nameSize}px`,
                    fontWeight: 400,
                    letterSpacing: '-0.02em',
                    lineHeight: 1.1,
                  }}
                >
                  {displayName}
                </div>
                <div
                  style={{
                    display: 'flex',
                    fontFamily: 'IBM Plex Mono',
                    fontSize: '26px',
                    fontWeight: 500,
                    color: OG_COLORS.accent,
                  }}
                >
                  {'@' + handleName}
                </div>
              </div>
            </div>

            {/* Bio as plain type rather than a boxed card: a two-line bio no
                longer leaves a half-empty panel sitting in the middle. */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                justifyContent: 'center',
                overflow: 'hidden',
              }}
            >
              {bio && (
                <div
                  style={{
                    display: 'flex',
                    fontSize: '29px',
                    lineHeight: 1.5,
                    fontWeight: 300,
                    color: OG_COLORS.textSecondary,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {bio}
                </div>
              )}
            </div>

            <OgFooter
              left={
                <div style={{ display: 'flex', gap: '34px', fontSize: '21px', fontWeight: 300 }}>
                  {stats.map(([count, label]) => (
                    <div
                      key={label}
                      style={{
                        display: 'flex',
                        alignItems: 'baseline',
                        gap: '8px',
                        color: OG_COLORS.textSecondary,
                      }}
                    >
                      <span
                        style={{
                          display: 'flex',
                          fontFamily: 'IBM Plex Mono',
                          fontSize: '24px',
                          fontWeight: 500,
                          color: OG_COLORS.accent,
                        }}
                      >
                        {count.toLocaleString()}
                      </span>
                      <span style={{ display: 'flex' }}>{label}</span>
                    </div>
                  ))}
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
          // Override @vercel/og's default 1-year immutable cache: profile
          // cards change when the account's avatar/name/bio changes.
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
