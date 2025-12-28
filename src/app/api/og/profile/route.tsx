import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

// Helper to load Google Font
async function loadGoogleFont(font: string, text: string) {
  const url = `https://fonts.googleapis.com/css2?family=${font}&text=${encodeURIComponent(text)}`;
  const css = await (await fetch(url)).text();
  const resource = css.match(/src: url\((.+)\) format\('(opentype|truetype)'\)/);

  if (resource) {
    const response = await fetch(resource[1]);
    if (response.status == 200) {
      return await response.arrayBuffer();
    }
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
    const bio = profileData?.description || 'ATProto user';
    const truncatedBio = bio.length > 120 ? bio.slice(0, 120) + '...' : bio;
    const followers = profileData?.followersCount || 0;
    const following = profileData?.followsCount || 0;

    // Load Crimson Pro font
    const allText = `${displayName} @${handleName} ${truncatedBio} ${followers.toLocaleString()} followers ${following.toLocaleString()} following aturi.to ATmosphere`;
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
            color: '#e8e8e6',
            fontFamily: 'Crimson Pro',
            padding: '70px',
            position: 'relative',
          }}
        >
          {/* Organic glow background */}
          <div
            style={{
              position: 'absolute',
              top: '-20%',
              left: '-10%',
              width: '500px',
              height: '500px',
              background: 'radial-gradient(circle, rgba(138, 154, 127, 0.15) 0%, transparent 70%)',
              filter: 'blur(80px)',
              display: 'flex',
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: '-20%',
              right: '-10%',
              width: '600px',
              height: '600px',
              background: 'radial-gradient(circle, rgba(74, 90, 63, 0.12) 0%, transparent 70%)',
              filter: 'blur(90px)',
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
                marginBottom: '60px',
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
                  fontSize: '18px',
                  color: '#686866',
                  fontWeight: 300,
                  letterSpacing: '1px',
                  display: 'flex',
                }}
              >
                ATmosphere
              </div>
            </div>

            {/* Profile Section */}
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                textAlign: 'center',
              }}
            >
              {/* Avatar with subtle glow */}
              <div
                style={{
                  width: '140px',
                  height: '140px',
                  borderRadius: '140px',
                  backgroundColor: '#4a5a3f',
                  marginBottom: '35px',
                  boxShadow: '0 0 60px rgba(138, 154, 127, 0.2)',
                  display: 'flex',
                }}
              />

              {/* Name */}
              <div
                style={{
                  fontSize: '52px',
                  fontWeight: 400,
                  marginBottom: '12px',
                  letterSpacing: '-0.5px',
                  display: 'flex',
                }}
              >
                {displayName}
              </div>

              {/* Handle */}
              <div
                style={{
                  fontSize: '26px',
                  color: '#a8a8a6',
                  fontWeight: 300,
                  marginBottom: '35px',
                  display: 'flex',
                }}
              >
                {'@' + handleName}
              </div>

              {/* Bio */}
              <div
                style={{
                  fontSize: '22px',
                  lineHeight: 1.7,
                  color: '#a8a8a6',
                  maxWidth: '700px',
                  marginBottom: '45px',
                  fontWeight: 300,
                  display: 'flex',
                }}
              >
                {truncatedBio}
              </div>

              {/* Stats with organic divider */}
              <div
                style={{
                  display: 'flex',
                  gap: '50px',
                  fontSize: '19px',
                  color: '#686866',
                  alignItems: 'center',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span
                    style={{
                      color: '#8a9a7f',
                      fontSize: '32px',
                      fontWeight: 400,
                      display: 'flex',
                    }}
                  >
                    {followers.toLocaleString()}
                  </span>
                  <span style={{ fontWeight: 300, display: 'flex' }}>followers</span>
                </div>
                <div
                  style={{
                    width: '1px',
                    height: '50px',
                    background: 'linear-gradient(to bottom, transparent, rgba(232, 232, 230, 0.1), transparent)',
                    display: 'flex',
                  }}
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <span
                    style={{
                      color: '#8a9a7f',
                      fontSize: '32px',
                      fontWeight: 400,
                      display: 'flex',
                    }}
                  >
                    {following.toLocaleString()}
                  </span>
                  <span style={{ fontWeight: 300, display: 'flex' }}>following</span>
                </div>
              </div>
            </div>

            {/* Footer tagline */}
            <div
              style={{
                marginTop: '50px',
                fontSize: '18px',
                color: '#686866',
                textAlign: 'center',
                fontWeight: 300,
                letterSpacing: '0.5px',
                display: 'flex',
                justifyContent: 'center',
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
