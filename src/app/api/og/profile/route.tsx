import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';
export const revalidate = 3600; // Cache for 1 hour

// Cache font data to avoid repeated fetches
const fontCache = new Map<string, ArrayBuffer>();

// Helper to load Google Font with timeout
async function loadGoogleFont(font: string, text: string) {
  const cacheKey = `${font}-${text.slice(0, 50)}`; // Cache based on font and first 50 chars
  
  if (fontCache.has(cacheKey)) {
    return fontCache.get(cacheKey)!;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
  
  try {
    const url = `https://fonts.googleapis.com/css2?family=${font}&text=${encodeURIComponent(text)}`;
    const css = await fetch(url, { signal: controller.signal }).then(r => r.text());
    const resource = css.match(/src: url\((.+)\) format\('(opentype|truetype)'\)/);

    if (resource) {
      const response = await fetch(resource[1], { signal: controller.signal });
      if (response.status == 200) {
        const fontData = await response.arrayBuffer();
        fontCache.set(cacheKey, fontData);
        return fontData;
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }

  throw new Error('failed to load font data');
}

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
        }
      );

      if (response.ok) {
        profileData = await response.json();
      }
    } catch (error) {
      console.error('Error fetching profile:', error);
    }

    const displayName = profileData?.displayName || profileData?.handle || identifier;
    const handleName = profileData?.handle || identifier;
    const bio = profileData?.description || '';
    const avatarUrl = profileData?.avatar || '';
    
    // Fetch avatar image and convert to base64 with timeout
    let avatarDataUrl = '';
    if (avatarUrl) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
        
        try {
          const avatarResponse = await fetch(avatarUrl, { signal: controller.signal });
          if (avatarResponse.ok) {
            const avatarBuffer = await avatarResponse.arrayBuffer();
            const base64 = Buffer.from(avatarBuffer).toString('base64');
            const contentType = avatarResponse.headers.get('content-type') || 'image/jpeg';
            avatarDataUrl = `data:${contentType};base64,${base64}`;
          }
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        console.error('Error fetching avatar:', error);
        // Continue without avatar
      }
    }
    
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
    const allText = `${displayName} @${handleName} ${displayBio} ${isTruncated ? '...' : ''} ${followers.toLocaleString()} followers ${following.toLocaleString()} following ${posts.toLocaleString()} posts aturi.to Universal ATmosphere Links Choose where to view this profile`;
    const fontData = await loadGoogleFont('Crimson+Pro:wght@300;400;600', allText);

    return new ImageResponse(
      (
        <div
          style={{
            height: '100%',
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            backgroundColor: '#0a0a0a',
            backgroundImage: 'radial-gradient(ellipse at 20% 30%, rgba(138, 154, 127, 0.18) 0%, rgba(10, 10, 10, 0) 85%), radial-gradient(ellipse at 80% 70%, rgba(74, 90, 63, 0.15) 0%, rgba(10, 10, 10, 0) 85%), radial-gradient(ellipse at 50% 50%, rgba(61, 51, 41, 0.12) 0%, rgba(10, 10, 10, 0) 90%)',
            color: '#e8e8e6',
            fontFamily: 'Crimson Pro',
            padding: '70px',
            position: 'relative',
          }}
        >
          {/* Grain overlay */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 800 800' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.8' numOctaves='5' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E")`,
              opacity: 0.6,
              display: 'flex',
            }}
          />

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
              <div
                style={{
                  fontSize: '36px',
                  color: '#8a9a7f',
                  fontWeight: 300,
                  letterSpacing: '0.5px',
                  display: 'flex',
                }}
              >
                aturi.to
              </div>
              <div
                style={{
                  fontSize: '22px',
                  color: '#686866',
                  fontWeight: 400,
                  letterSpacing: '1px',
                  display: 'flex',
                }}
              >
                Universal ATmosphere Links
              </div>
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
                        color: '#686866',
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
                        color: '#686866',
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
                        color: '#686866',
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
                fontSize: '22px',
                color: '#686866',
                textAlign: 'right',
                fontWeight: 400,
                letterSpacing: '0.5px',
                display: 'flex',
                justifyContent: 'flex-end',
              }}
            >
              Choose where to view this profile
            </div>
          </div>
        </div>
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
      }
    );
  } catch (error) {
    console.error('Error generating OG image:', error);
    return new Response('Error generating image', { status: 500 });
  }
}
