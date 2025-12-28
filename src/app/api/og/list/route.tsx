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
              top: '-10%',
              left: '20%',
              width: '450px',
              height: '450px',
              background: 'radial-gradient(circle, rgba(138, 154, 127, 0.14) 0%, transparent 70%)',
              filter: 'blur(85px)',
              display: 'flex',
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: '-10%',
              right: '20%',
              width: '500px',
              height: '500px',
              background: 'radial-gradient(circle, rgba(74, 90, 63, 0.11) 0%, transparent 70%)',
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
                    display: 'flex',
                  }}
                />
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
                  backgroundColor: 'rgba(21, 21, 21, 0.5)',
                  border: '1px solid rgba(232, 232, 230, 0.08)',
                  fontWeight: 300,
                  display: 'flex',
                  backdropFilter: 'blur(10px)',
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
                    borderRadius: '56px',
                    backgroundColor: '#3d3329',
                    boxShadow: '0 0 25px rgba(138, 154, 127, 0.12)',
                    display: 'flex',
                  }}
                />
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
                fontSize: '18px',
                color: '#686866',
                textAlign: 'center',
                fontWeight: 300,
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
