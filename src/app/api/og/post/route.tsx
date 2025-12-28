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

    // Fetch post data from Bluesky API
    const apiUrl = process.env.NEXT_PUBLIC_BSKY_API_URL || 'https://public.api.bsky.app';
    
    let postData = null;
    let authorData = null;
    
    try {
      // Build the full AT URI - identifier should already be a DID
      const uri = `at://${identifier}/app.bsky.feed.post/${rkey}`;
      
      // Fetch the post thread
      const response = await fetch(
        `${apiUrl}/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}`,
        {
          headers: {
            'Accept': 'application/json',
          },
          next: { revalidate: 3600 }, // Cache for 1 hour
        }
      );

      if (response.ok) {
        const data = await response.json();
        postData = data.thread?.post?.record;
        authorData = data.thread?.post?.author;
      }
    } catch (error) {
      console.error('Error fetching post:', error);
    }

    const displayName = authorData?.displayName || authorData?.handle || identifier;
    const handleName = authorData?.handle || identifier;
    const postText = postData?.text || 'Post content';
    const truncatedText = postText.length > 180 ? postText.slice(0, 180) + '...' : postText;

    // Load Crimson Pro font
    const allText = `${displayName} @${handleName} ${truncatedText} aturi.to ATmosphere`;
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
              top: '10%',
              right: '-5%',
              width: '400px',
              height: '400px',
              background: 'radial-gradient(circle, rgba(138, 154, 127, 0.12) 0%, transparent 70%)',
              filter: 'blur(70px)',
              display: 'flex',
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: '10%',
              left: '-5%',
              width: '350px',
              height: '350px',
              background: 'radial-gradient(circle, rgba(74, 90, 63, 0.1) 0%, transparent 70%)',
              filter: 'blur(80px)',
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
                marginBottom: '45px',
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

            {/* Author */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                marginBottom: '35px',
                gap: '18px',
              }}
            >
              <div
                style={{
                  width: '64px',
                  height: '64px',
                  borderRadius: '64px',
                  backgroundColor: '#4a5a3f',
                  boxShadow: '0 0 30px rgba(138, 154, 127, 0.15)',
                  display: 'flex',
                }}
              />
              <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                <div
                  style={{
                    fontSize: '28px',
                    fontWeight: 400,
                    display: 'flex',
                  }}
                >
                  {displayName}
                </div>
                <div
                  style={{
                    fontSize: '20px',
                    color: '#a8a8a6',
                    fontWeight: 300,
                    display: 'flex',
                  }}
                >
                  {'@' + handleName}
                </div>
              </div>
            </div>

            {/* Post Content - organic container */}
            <div
              style={{
                flex: 1,
                fontSize: '28px',
                lineHeight: 1.7,
                color: '#e8e8e6',
                padding: '35px',
                backgroundColor: 'rgba(21, 21, 21, 0.6)',
                border: '1px solid rgba(232, 232, 230, 0.08)',
                fontWeight: 300,
                display: 'flex',
                backdropFilter: 'blur(10px)',
              }}
            >
              {truncatedText}
            </div>

            {/* Footer */}
            <div
              style={{
                marginTop: '45px',
                fontSize: '18px',
                color: '#686866',
                textAlign: 'center',
                fontWeight: 300,
                letterSpacing: '0.5px',
                display: 'flex',
                justifyContent: 'center',
              }}
            >
              Choose where to view this post
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
