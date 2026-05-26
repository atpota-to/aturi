import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';
import { fetchImageAsDataUrl } from '@/lib/og-image';
import { BrandMark, Eyebrow, loadGoogleFont, OgFrame, OG_COLORS } from '@/lib/og-design';

export const runtime = 'edge';
export const revalidate = 3600; // Cache for 1 hour

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

    const listName = listData?.name || 'Atmosphere List';
    const listDescription = listData?.description || 'View this list in your preferred Atmosphere client';
    const truncatedDescription = listDescription.length > 120 ? listDescription.slice(0, 120) + '...' : listDescription;
    const creatorName = creatorData?.displayName || creatorData?.handle || identifier;
    const creatorHandle = creatorData?.handle || identifier;
    const creatorAvatarUrl = creatorData?.avatar || '';
    const listAvatarUrl = listData?.avatar || '';
    
    const listAvatarDataUrl = await fetchImageAsDataUrl(listAvatarUrl);
    const creatorAvatarDataUrl = await fetchImageAsDataUrl(creatorAvatarUrl);

    // Load Crimson Pro font
    const allText = `${listName} ${truncatedDescription} ${creatorName} @${creatorHandle} aturi.to Open in any Atmosphere client Universal link by aturi`;
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
                fontSize: '24px',
                color: OG_COLORS.textTertiary,
                fontWeight: 300,
                fontStyle: 'italic',
                display: 'flex',
                justifyContent: 'flex-end',
              }}
            >
              Open in any Atmosphere client →
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
      }
    );
  } catch (error) {
    console.error('Error generating OG image:', error);
    return new Response('Error generating image', { status: 500 });
  }
}
