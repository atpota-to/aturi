import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

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
      // Build the full AT URI - identifier should already be a DID
      const uri = `at://${identifier}/app.bsky.graph.list/${rkey}`;
      
      // Fetch list data
      const response = await fetch(
        `${apiUrl}/xrpc/app.bsky.graph.getList?list=${encodeURIComponent(uri)}`,
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
    const listDescription = listData?.description || 'A curated list on ATProto';
    const truncatedDescription = listDescription.length > 150 
      ? listDescription.slice(0, 150) + '...' 
      : listDescription;
    const creatorName = creatorData?.displayName || creatorData?.handle || identifier;
    const creatorHandle = creatorData?.handle || identifier;

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
            fontFamily: 'system-ui, sans-serif',
            padding: '60px',
          }}
        >
          {/* Header with branding */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: '50px',
            }}
          >
            <div style={{ fontSize: '32px', color: '#8a9a7f', fontWeight: 300 }}>
              aturi.to
            </div>
            <div style={{ fontSize: '20px', color: '#686866' }}>
              Universal ATProto Links
            </div>
          </div>

          {/* List content */}
          <div
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
            }}
          >
            {/* List icon */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: '30px',
              }}
            >
              <div
                style={{
                  width: '80px',
                  height: '80px',
                  backgroundColor: '#4a5a3f',
                  marginRight: '30px',
                }}
              />
              <div style={{ fontSize: '48px', fontWeight: 400 }}>
                {listName}
              </div>
            </div>

            {/* Description */}
            <div
              style={{
                fontSize: '28px',
                lineHeight: 1.6,
                color: '#a8a8a6',
                marginBottom: '40px',
                padding: '30px',
                backgroundColor: '#151515',
                border: '1px solid rgba(232, 232, 230, 0.12)',
              }}
            >
              {truncatedDescription}
            </div>

            {/* Creator */}
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <div
                style={{
                  width: '50px',
                  height: '50px',
                  backgroundColor: '#3d3329',
                  marginRight: '20px',
                }}
              />
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <div style={{ fontSize: '24px', color: '#e8e8e6' }}>
                  {creatorName}
                </div>
                <div style={{ fontSize: '18px', color: '#a8a8a6' }}>
                  @{creatorHandle}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div
            style={{
              marginTop: '40px',
              fontSize: '20px',
              color: '#686866',
              textAlign: 'center',
            }}
          >
            Choose where to view this list
          </div>
        </div>
      ),
      {
        width: 1200,
        height: 630,
      }
    );
  } catch (error) {
    console.error('Error generating OG image:', error);
    return new Response('Error generating image', { status: 500 });
  }
}


