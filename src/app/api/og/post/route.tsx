import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const handle = searchParams.get('handle');
    const rkey = searchParams.get('rkey');

    if (!handle || !rkey) {
      return new Response('Missing parameters', { status: 400 });
    }

    // Fetch post data from Bluesky API
    const apiUrl = process.env.NEXT_PUBLIC_BSKY_API_URL || 'https://public.api.bsky.app';
    
    let postData = null;
    let authorData = null;
    
    try {
      // Build the full AT URI
      const did = handle.startsWith('did:') ? handle : handle;
      const uri = `at://${did}/app.bsky.feed.post/${rkey}`;
      
      // Fetch the post thread
      const response = await fetch(
        `${apiUrl}/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}`,
        {
          headers: {
            'Accept': 'application/json',
          },
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

    const displayName = authorData?.displayName || authorData?.handle || handle;
    const handleName = authorData?.handle || handle;
    const postText = postData?.text || 'Post content';
    const truncatedText = postText.length > 200 ? postText.slice(0, 200) + '...' : postText;

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
              marginBottom: '40px',
            }}
          >
            <div style={{ fontSize: '32px', color: '#8a9a7f', fontWeight: 300 }}>
              aturi.to
            </div>
            <div style={{ fontSize: '20px', color: '#686866' }}>
              Universal ATProto Links
            </div>
          </div>

          {/* Author info */}
          <div style={{ display: 'flex', alignItems: 'center', marginBottom: '30px' }}>
            <div
              style={{
                width: '60px',
                height: '60px',
                backgroundColor: '#4a5a3f',
                marginRight: '20px',
              }}
            />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ fontSize: '28px', fontWeight: 400, marginBottom: '5px' }}>
                {displayName}
              </div>
              <div style={{ fontSize: '20px', color: '#a8a8a6' }}>
                @{handleName}
              </div>
            </div>
          </div>

          {/* Post content */}
          <div
            style={{
              flex: 1,
              fontSize: '32px',
              lineHeight: 1.5,
              color: '#e8e8e6',
              padding: '30px',
              backgroundColor: '#151515',
              border: '1px solid rgba(232, 232, 230, 0.12)',
            }}
          >
            {truncatedText}
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
            Choose where to view this post
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


