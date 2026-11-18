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
  StatLine,
} from '@/lib/og-design';

export const runtime = 'edge';
export const revalidate = 3600; // Cache for 1 hour

const AVATAR = 120;

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

    const fonts = await loadOgFonts(
      `${displayName} ${bio} Profile Open in any Atmosphere client ` +
        `${stats.map(([n, label]) => `${n.toLocaleString()} ${label}`).join(' ')}`,
      `@${handleName}`,
    );

    // Long display names would otherwise run under the card's right edge.
    const nameSize = displayName.length > 26 ? 38 : displayName.length > 18 ? 44 : 50;

    return new ImageResponse(
      (
        <OgFrame>
          <Folder
            tab="Profile"
            tabIcon={<PersonGlyph size={22} color={OG_COLORS.accent} />}
            aside={<BrandMark />}
            footerLeft={<StatLine stats={stats} />}
            footerRight={<FooterCta>Open in any Atmosphere client</FooterCta>}
          >
            {/* Identity — avatar and name on one axis, so the block reads as a
                single unit instead of two columns drifting apart. */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '28px', flexShrink: 0 }}>
              <Avatar src={avatarDataUrl} size={AVATAR} fallback={<PersonGlyph size={52} />} />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
                <div
                  style={{
                    display: 'flex',
                    fontSize: `${nameSize}px`,
                    fontWeight: 700,
                    letterSpacing: '-0.025em',
                    lineHeight: 1.1,
                  }}
                >
                  {displayName}
                </div>
                <div
                  style={{
                    display: 'flex',
                    fontFamily: 'IBM Plex Mono',
                    fontSize: '25px',
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
                    fontSize: '26px',
                    lineHeight: 1.5,
                    color: OG_COLORS.textSecondary,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {bio}
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
