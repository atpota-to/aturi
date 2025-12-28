import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

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
    const truncatedBio = bio.length > 150 ? bio.slice(0, 150) + '...' : bio;
    const followers = profileData?.followersCount || 0;
    const following = profileData?.followsCount || 0;

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

          {/* Profile content */}
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
            {/* Avatar placeholder */}
            <div
              style={{
                width: '120px',
                height: '120px',
                backgroundColor: '#4a5a3f',
                marginBottom: '30px',
              }}
            />

            {/* Name and handle */}
            <div style={{ fontSize: '48px', fontWeight: 400, marginBottom: '10px' }}>
              {displayName}
            </div>
            <div style={{ fontSize: '28px', color: '#a8a8a6', marginBottom: '30px' }}>
              {'@' + handleName}
            </div>

            {/* Bio */}
            <div
              style={{
                fontSize: '24px',
                lineHeight: 1.6,
                color: '#a8a8a6',
                maxWidth: '800px',
                marginBottom: '40px',
              }}
            >
              {truncatedBio}
            </div>

            {/* Stats */}
            <div style={{ display: 'flex', gap: '60px', fontSize: '20px', color: '#686866' }}>
              <div style={{ display: 'flex' }}>
                <span style={{ color: '#8a9a7f', fontSize: '28px', fontWeight: 500, marginRight: '8px' }}>
                  {followers.toLocaleString()}
                </span>
                <span>followers</span>
              </div>
              <div style={{ display: 'flex' }}>
                <span style={{ color: '#8a9a7f', fontSize: '28px', fontWeight: 500, marginRight: '8px' }}>
                  {following.toLocaleString()}
                </span>
                <span>following</span>
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
            Choose where to view this profile
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


