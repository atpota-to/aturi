import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';
import { fetchImageAsDataUrl } from '@/lib/og-image';
import {
  ArrowRight,
  BrandMark,
  Eyebrow,
  loadGoogleFont,
  OgFrame,
  OG_COLORS,
  OG_GLYPH_BASELINE,
  sanitizeOgText,
} from '@/lib/og-design';

export const runtime = 'edge';
export const revalidate = 3600; // Cache for 1 hour

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const identifier = searchParams.get('handle'); // This can be a handle or DID

    if (!identifier) {
      return new Response('Missing handle parameter', { status: 400 });
    }

    // Fetch profile data from Bluesky API using the identifier (works with both handle and DID)
    const apiUrl = process.env.NEXT_PUBLIC_BSKY_API_URL || 'https://public.api.bsky.app';
    
    let profileData = null;
    
    try {
      const response = await fetch(
        `${apiUrl}/xrpc/app.bsky.actor.getProfile?actor=${encodeURIComponent(identifier)}`,
        {
          headers: {
            'Accept': 'application/json',
          },
          next: { revalidate: 3600 }, // Cache for 1 hour
          // A hung upstream connection here has kept this function alive
          // until Vercel's 300s task timeout. Bound it like the avatar fetch.
          signal: AbortSignal.timeout(8000),
        }
      );

      if (response.ok) {
        profileData = await response.json();
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
    }

    const displayName = sanitizeOgText(profileData?.displayName || profileData?.handle || identifier);
    const handleName = sanitizeOgText(profileData?.handle || identifier);
    const bio = sanitizeOgText(profileData?.description || '');
    const avatarUrl = profileData?.avatar || '';
    
    const avatarDataUrl = await fetchImageAsDataUrl(avatarUrl);
    
    // Get first 3 lines or truncate at ~180 characters
    const bioLines = bio.split('\n');
    const maxChars = 180;
    const maxLines = 3;
    
    let displayBio = '';
    let isTruncated = false;
    
    if (bio.length > maxChars || bioLines.length > maxLines) {
      // Take up to maxLines or until we hit maxChars
      let charCount = 0;
      let lineCount = 0;
      
      for (const line of bioLines) {
        if (lineCount >= maxLines) {
          isTruncated = true;
          break;
        }
        
        if (charCount + line.length > maxChars) {
          displayBio += line.slice(0, maxChars - charCount);
          isTruncated = true;
          break;
        }
        
        displayBio += line + '\n';
        charCount += line.length + 1;
        lineCount++;
      }
      
      displayBio = displayBio.trim();
    } else {
      displayBio = bio;
    }
    
    const followers = profileData?.followersCount || 0;
    const following = profileData?.followsCount || 0;
    const posts = profileData?.postsCount || 0;

    // Load Crimson Pro font
    // The "Universal link" eyebrow is rendered uppercase via CSS; append the
    // full alphabet so the font subset covers the transformed glyphs (see
    // OG_GLYPH_BASELINE).
    const allText = `${displayName} @${handleName} ${displayBio} ${isTruncated ? '...' : ''} ${followers.toLocaleString()} followers ${following.toLocaleString()} following ${posts.toLocaleString()} posts aturi.to Open in any Atmosphere client Universal link aturi ${OG_GLYPH_BASELINE}`;
    const fontData = await loadGoogleFont('Crimson+Pro:wght@300;400;600', allText);

    return new ImageResponse(
      (
        <OgFrame>
          {/* Content */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              position: 'relative',
              zIndex: 1,
            }}
          >
            {/* Header */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                marginBottom: '50px',
              }}
            >
              <BrandMark size={30} />
              <Eyebrow>Universal link</Eyebrow>
            </div>

            {/* Card-based Profile Layout */}
            <div
              style={{
                flex: 1,
                display: 'flex',
                gap: '30px',
              }}
            >
              {/* Left side - Avatar and basic info */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: '25px',
                }}
              >
                {/* Avatar */}
                <div
                  style={{
                    width: '160px',
                    height: '160px',
                    backgroundColor: '#4a5a3f',
                    boxShadow: '0 0 60px rgba(138, 154, 127, 0.2)',
                    border: '2px solid rgba(138, 154, 127, 0.3)',
                    display: 'flex',
                    overflow: 'hidden',
                  }}
                >
                  {avatarDataUrl && (
                    <img
                      src={avatarDataUrl}
                      alt={displayName}
                      width="160"
                      height="160"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                      }}
                    />
                  )}
                </div>

                {/* Name & Handle */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '42px',
                      fontWeight: 400,
                      display: 'flex',
                      letterSpacing: '-0.5px',
                    }}
                  >
                    {displayName}
                  </div>
                  <div
                    style={{
                      fontSize: '24px',
                      color: '#a8a8a6',
                      fontWeight: 300,
                      display: 'flex',
                    }}
                  >
                    {'@' + handleName}
                  </div>
                </div>
              </div>

              {/* Right side - Bio and Stats */}
              <div
                style={{
                  flex: 1,
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'space-between',
                  paddingLeft: '30px',
                }}
              >
                {/* Bio card */}
                <div
                  style={{
                    padding: '30px',
                    backgroundColor: 'rgba(26, 26, 26, 0.8)',
                    border: '1px solid rgba(232, 232, 230, 0.08)',
                    backdropFilter: 'blur(10px)',
                    marginBottom: '30px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '24px',
                      lineHeight: 1.6,
                      color: '#e8e8e6',
                      fontWeight: 300,
                      display: 'flex',
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                    }}
                  >
                    {displayBio}
                  </div>
                  {isTruncated && (
                    <div
                      style={{
                        fontSize: '20px',
                        color: '#8a9a7f',
                        fontWeight: 300,
                        display: 'flex',
                        fontStyle: 'italic',
                      }}
                    >
                      ...
                    </div>
                  )}
                </div>

                {/* Stats grid */}
                <div
                  style={{
                    display: 'flex',
                    gap: '40px',
                  }}
                >
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span
                      style={{
                        color: '#8a9a7f',
                        fontSize: '36px',
                        fontWeight: 400,
                        display: 'flex',
                      }}
                    >
                      {followers.toLocaleString()}
                    </span>
                    <span
                      style={{
                        fontWeight: 300,
                        fontSize: '18px',
                        color: '#b8b8b6',
                        display: 'flex',
                      }}
                    >
                      followers
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span
                      style={{
                        color: '#8a9a7f',
                        fontSize: '36px',
                        fontWeight: 400,
                        display: 'flex',
                      }}
                    >
                      {following.toLocaleString()}
                    </span>
                    <span
                      style={{
                        fontWeight: 300,
                        fontSize: '18px',
                        color: '#b8b8b6',
                        display: 'flex',
                      }}
                    >
                      following
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                    <span
                      style={{
                        color: '#8a9a7f',
                        fontSize: '36px',
                        fontWeight: 400,
                        display: 'flex',
                      }}
                    >
                      {posts.toLocaleString()}
                    </span>
                    <span
                      style={{
                        fontWeight: 300,
                        fontSize: '18px',
                        color: '#b8b8b6',
                        display: 'flex',
                      }}
                    >
                      posts
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Footer tagline */}
            <div
              style={{
                marginTop: '50px',
                fontSize: '24px',
                color: OG_COLORS.textTertiary,
                fontWeight: 300,
                fontStyle: 'italic',
                display: 'flex',
                alignItems: 'center',
                gap: '10px',
                justifyContent: 'flex-end',
              }}
            >
              <span style={{ display: 'flex' }}>Open in any Atmosphere client</span>
              <ArrowRight size={22} color={OG_COLORS.textTertiary} />
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
            weight: 400,
            style: 'normal',
          },
        ],
        headers: {
          // Override @vercel/og's default 1-year immutable cache: profile
          // cards change when the account's avatar/name/bio changes.
          'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
        },
      }
    );
  } catch (error) {
    console.error('Error generating OG image:', error);
    // Serve the branded static card instead of a broken image so link
    // unfurls in Slack/Discord/Messages still show something.
    return Response.redirect(new URL('/api/og/static', request.url), 302);
  }
}
