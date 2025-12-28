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
    const identifier = searchParams.get('handle'); // This should be a DID
    const rkey = searchParams.get('rkey');

    if (!identifier || !rkey) {
      return new Response('Missing parameters', { status: 400 });
    }

    // Fetch list data from Bluesky API
    const apiUrl = process.env.NEXT_PUBLIC_BSKY_API_URL || 'https://public.api.bsky.app';
    
    let listData = null;
    let creatorData = null;
    
    try {
      // Build the full AT URI
      const uri = `at://${identifier}/app.bsky.graph.list/${rkey}`;
      
      // Fetch the list
      const response = await fetch(
        `${apiUrl}/xrpc/app.bsky.graph.getList?list=${encodeURIComponent(uri)}&limit=1`,
        {
          headers: {
            'Accept': 'application/json',
          },
          next: { revalidate: 3600 }, // Cache for 1 hour
        }
      );

      if (response.ok) {
        const data = await response.json();
        listData = data.list;
        creatorData = data.list?.creator;
      }
    } catch (error) {
      console.error('Error fetching list:', error);
    }

    const listName = listData?.name || 'ATProto List';
    const listDescription = listData?.description || 'View this list on your preferred ATProto app';
    const truncatedDescription = listDescription.length > 120 ? listDescription.slice(0, 120) + '...' : listDescription;
    const creatorName = creatorData?.displayName || creatorData?.handle || identifier;
    const creatorHandle = creatorData?.handle || identifier;
    const creatorAvatarUrl = creatorData?.avatar || '';
    const listAvatarUrl = listData?.avatar || '';
    
    // Fetch list avatar image and convert to base64 with timeout
    let listAvatarDataUrl = '';
    if (listAvatarUrl) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
        
        try {
          const avatarResponse = await fetch(listAvatarUrl, { signal: controller.signal });
          if (avatarResponse.ok) {
            const avatarBuffer = await avatarResponse.arrayBuffer();
            const base64 = Buffer.from(avatarBuffer).toString('base64');
            const contentType = avatarResponse.headers.get('content-type') || 'image/jpeg';
            listAvatarDataUrl = `data:${contentType};base64,${base64}`;
          }
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        console.error('Error fetching list avatar:', error);
        // Continue without avatar
      }
    }
    
    // Fetch creator avatar image and convert to base64 with timeout
    let creatorAvatarDataUrl = '';
    if (creatorAvatarUrl) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
        
        try {
          const avatarResponse = await fetch(creatorAvatarUrl, { signal: controller.signal });
          if (avatarResponse.ok) {
            const avatarBuffer = await avatarResponse.arrayBuffer();
            const base64 = Buffer.from(avatarBuffer).toString('base64');
            const contentType = avatarResponse.headers.get('content-type') || 'image/jpeg';
            creatorAvatarDataUrl = `data:${contentType};base64,${base64}`;
          }
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        console.error('Error fetching creator avatar:', error);
        // Continue without avatar
      }
    }

    // Load Crimson Pro font
    const allText = `${listName} ${truncatedDescription} ${creatorName} @${creatorHandle} aturi.to ATmosphere`;
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
                  fontSize: '28px',
                  color: '#a8a8a6',
                  fontWeight: 400,
                  letterSpacing: '1px',
                  display: 'flex',
                }}
              >
                Universal ATmosphere Links
              </div>
            </div>

            {/* List Content */}
            <div
              style={{
                flex: 1,
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'center',
              }}
            >
              {/* List icon and name */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  marginBottom: '35px',
                  gap: '25px',
                }}
              >
                <div
                  style={{
                    width: '90px',
                    height: '90px',
                    backgroundColor: '#4a5a3f',
                    boxShadow: '0 0 40px rgba(138, 154, 127, 0.18)',
                    border: '2px solid rgba(138, 154, 127, 0.3)',
                    display: 'flex',
                    overflow: 'hidden',
                  }}
                >
                  {listAvatarDataUrl && (
                    <img
                      src={listAvatarDataUrl}
                      alt={listName}
                      width="90"
                      height="90"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                      }}
                    />
                  )}
                </div>
                <div
                  style={{
                    fontSize: '46px',
                    fontWeight: 400,
                    display: 'flex',
                  }}
                >
                  {listName}
                </div>
              </div>

              {/* Description */}
              <div
                style={{
                  fontSize: '24px',
                  lineHeight: 1.7,
                  color: '#a8a8a6',
                  marginBottom: '45px',
                  padding: '30px',
                  backgroundColor: 'rgba(26, 26, 26, 0.8)',
                  border: '1px solid rgba(232, 232, 230, 0.08)',
                  fontWeight: 300,
                  display: 'flex',
                  backdropFilter: 'blur(10px)',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {truncatedDescription}
              </div>

              {/* Creator */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '18px',
                }}
              >
                <div
                  style={{
                    width: '56px',
                    height: '56px',
                    backgroundColor: '#3d3329',
                    boxShadow: '0 0 25px rgba(138, 154, 127, 0.12)',
                    border: '2px solid rgba(138, 154, 127, 0.2)',
                    display: 'flex',
                    overflow: 'hidden',
                  }}
                >
                  {creatorAvatarDataUrl && (
                    <img
                      src={creatorAvatarDataUrl}
                      alt={creatorName}
                      width="56"
                      height="56"
                      style={{
                        width: '100%',
                        height: '100%',
                        objectFit: 'cover',
                      }}
                    />
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                  <div
                    style={{
                      fontSize: '24px',
                      color: '#e8e8e6',
                      fontWeight: 400,
                      display: 'flex',
                    }}
                  >
                    {creatorName}
                  </div>
                  <div
                    style={{
                      fontSize: '19px',
                      color: '#a8a8a6',
                      fontWeight: 300,
                      display: 'flex',
                    }}
                  >
                    {'@' + creatorHandle}
                  </div>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div
              style={{
                marginTop: '50px',
                fontSize: '26px',
                color: '#a8a8a6',
                textAlign: 'center',
                fontWeight: 400,
                letterSpacing: '0.5px',
                display: 'flex',
                justifyContent: 'center',
              }}
            >
              Choose where to view this list
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
