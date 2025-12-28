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
  const startTime = Date.now();
  const url = request.url;
  console.log('[OG Post] Request started:', url);
  
  try {
    const { searchParams } = new URL(request.url);
    const identifier = searchParams.get('handle'); // This should be a DID
    const rkey = searchParams.get('rkey');

    console.log('[OG Post] Params:', { identifier, rkey });

    if (!identifier || !rkey) {
      console.error('[OG Post] Missing parameters');
      return new Response('Missing parameters', { status: 400 });
    }

    // Fetch post data from Bluesky API
    const apiUrl = process.env.NEXT_PUBLIC_BSKY_API_URL || 'https://public.api.bsky.app';
    
    let postData = null;
    let authorData = null;
    let post = null;
    let likeCount = 0;
    let replyCount = 0;
    let repostCount = 0;
    
    try {
      // Build the full AT URI - identifier should already be a DID
      const uri = `at://${identifier}/app.bsky.feed.post/${rkey}`;
      
      // Fetch the post thread with timeout
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // 5 second timeout
      
      try {
        const response = await fetch(
          `${apiUrl}/xrpc/app.bsky.feed.getPostThread?uri=${encodeURIComponent(uri)}`,
          {
            headers: {
              'Accept': 'application/json',
            },
            signal: controller.signal,
            next: { revalidate: 3600 }, // Cache for 1 hour
          }
        );

        if (response.ok) {
          const data = await response.json();
          post = data.thread?.post;
          postData = post?.record;
          authorData = post?.author;
          
          // Get engagement metrics
          likeCount = post?.likeCount || 0;
          replyCount = post?.replyCount || 0;
          repostCount = post?.repostCount || 0;
        }
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      console.error('Error fetching post:', error);
    }

    const displayName = authorData?.displayName || authorData?.handle || identifier;
    const handleName = authorData?.handle || identifier;
    const postText = postData?.text || '';
    const truncatedText = postText.length > 180 ? postText.slice(0, 180) + '...' : postText;
    const avatarUrl = authorData?.avatar || '';
    
    // Get embed data if available
    const embed = post?.embed;
    let embedType = null;
    let embedImageUrl = null;
    let embedQuoteAuthor = null;
    let embedQuoteText = null;
    let embedExternalTitle = null;
    
    if (embed) {
      // Images
      if (embed.$type === 'app.bsky.embed.images#view' && embed.images && embed.images.length > 0) {
        embedType = 'images';
        embedImageUrl = embed.images[0].thumb;
      }
      // External link with thumbnail
      else if (embed.$type === 'app.bsky.embed.external#view' && embed.external) {
        embedType = 'external';
        embedImageUrl = embed.external.thumb;
        embedExternalTitle = embed.external.title;
      }
      // Quote post
      else if (embed.$type === 'app.bsky.embed.record#view' && embed.record) {
        embedType = 'quote';
        const quotedRecord = embed.record;
        embedQuoteAuthor = quotedRecord.author?.displayName || quotedRecord.author?.handle || 'Unknown';
        embedQuoteText = quotedRecord.value?.text || quotedRecord.record?.text || '';
        if (embedQuoteText.length > 120) {
          embedQuoteText = embedQuoteText.slice(0, 120) + '...';
        }
      }
      // Record with media (quote + image/video/link)
      else if (embed.$type === 'app.bsky.embed.recordWithMedia#view') {
        if (embed.media?.$type === 'app.bsky.embed.images#view' && embed.media.images?.length > 0) {
          embedType = 'images';
          embedImageUrl = embed.media.images[0].thumb;
        } else if (embed.media?.$type === 'app.bsky.embed.external#view' && embed.media.external) {
          embedType = 'external';
          embedImageUrl = embed.media.external.thumb;
          embedExternalTitle = embed.media.external.title;
        }
        // Also capture quote info if available
        if (embed.record?.record) {
          const quotedRecord = embed.record.record;
          embedQuoteAuthor = quotedRecord.author?.displayName || quotedRecord.author?.handle || 'Unknown';
          embedQuoteText = quotedRecord.value?.text || quotedRecord.record?.text || '';
          if (embedQuoteText.length > 120) {
            embedQuoteText = embedQuoteText.slice(0, 120) + '...';
          }
        }
      }
      // Video
      else if (embed.$type === 'app.bsky.embed.video#view' && embed.thumbnail) {
        embedType = 'video';
        embedImageUrl = embed.thumbnail;
      }
    }
    
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

    // Fetch embed image if available
    let embedImageDataUrl = '';
    if (embedImageUrl) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000); // 3 second timeout
        
        try {
          const embedResponse = await fetch(embedImageUrl, { signal: controller.signal });
          if (embedResponse.ok) {
            const embedBuffer = await embedResponse.arrayBuffer();
            const base64 = Buffer.from(embedBuffer).toString('base64');
            const contentType = embedResponse.headers.get('content-type') || 'image/jpeg';
            embedImageDataUrl = `data:${contentType};base64,${base64}`;
          }
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (error) {
        console.error('Error fetching embed image:', error);
        // Continue without embed image
      }
    }

    // Load Crimson Pro font
    console.log('[OG Post] Loading font...');
    const allText = `${displayName} @${handleName} ${truncatedText} ${likeCount} ${replyCount} ${repostCount} ${embedQuoteAuthor || ''} ${embedQuoteText || ''} ${embedExternalTitle || ''} Choose where to view this post aturi.to Universal ATmosphere Links Image Video Link Quote`;
    const fontData = await loadGoogleFont('Crimson+Pro:wght@300;400;600', allText);
    console.log('[OG Post] Font loaded successfully');

    console.log('[OG Post] Generating image...');
    const imageResponse = new ImageResponse(
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
                  backgroundColor: '#4a5a3f',
                  boxShadow: '0 0 30px rgba(138, 154, 127, 0.15)',
                  border: '2px solid rgba(138, 154, 127, 0.25)',
                  display: 'flex',
                  overflow: 'hidden',
                }}
              >
                {avatarDataUrl && (
                  <img
                    src={avatarDataUrl}
                    alt={displayName}
                    width="64"
                    height="64"
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
                display: 'flex',
                flexDirection: 'column',
                gap: '20px',
              }}
            >
              {/* Post text - only show if there's actual text */}
              {truncatedText && (
                <div
                  style={{
                    fontSize: '28px',
                    lineHeight: 1.7,
                    color: '#e8e8e6',
                    padding: '35px',
                    backgroundColor: 'rgba(21, 21, 21, 0.6)',
                    border: '1px solid rgba(232, 232, 230, 0.08)',
                    fontWeight: 300,
                    display: 'flex',
                    backdropFilter: 'blur(10px)',
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                  }}
                >
                  {truncatedText}
                </div>
              )}

              {/* Embed Image/Video Thumbnail */}
              {embedImageDataUrl && embedType !== 'quote' && (
                <div
                  style={{
                    position: 'relative',
                    display: 'flex',
                    overflow: 'hidden',
                    border: '1px solid rgba(232, 232, 230, 0.15)',
                    backgroundColor: 'rgba(21, 21, 21, 0.8)',
                    height: truncatedText ? '200px' : '280px',
                    padding: '8px',
                  }}
                >
                  <img
                    src={embedImageDataUrl}
                    alt=""
                    style={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover',
                      opacity: 0.95,
                    }}
                  />
                  {embedType === 'video' && (
                    <div
                      style={{
                        position: 'absolute',
                        top: '50%',
                        left: '50%',
                        transform: 'translate(-50%, -50%)',
                        width: '60px',
                        height: '60px',
                        backgroundColor: 'rgba(138, 154, 127, 0.9)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '32px',
                        color: '#0a0a0a',
                      }}
                    >
                      ▶
                    </div>
                  )}
                  {embedType === 'external' && embedExternalTitle && (
                    <div
                      style={{
                        position: 'absolute',
                        bottom: '8px',
                        left: '8px',
                        right: '8px',
                        padding: '12px 20px',
                        backgroundColor: 'rgba(10, 10, 10, 0.95)',
                        fontSize: '18px',
                        fontWeight: 400,
                        color: '#e8e8e6',
                        borderTop: '1px solid rgba(232, 232, 230, 0.1)',
                        display: 'flex',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      🔗 {embedExternalTitle}
                    </div>
                  )}
                </div>
              )}

              {/* Quote Post */}
              {embedType === 'quote' && embedQuoteAuthor && embedQuoteText && (
                <div
                  style={{
                    padding: '25px',
                    backgroundColor: 'rgba(21, 21, 21, 0.7)',
                    border: '1px solid rgba(138, 154, 127, 0.25)',
                    borderLeft: '3px solid rgba(138, 154, 127, 0.6)',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '12px',
                  }}
                >
                  <div
                    style={{
                      fontSize: '20px',
                      color: '#8a9a7f',
                      fontWeight: 400,
                      display: 'flex',
                    }}
                  >
                    💬 {embedQuoteAuthor}
                  </div>
                  <div
                    style={{
                      fontSize: '22px',
                      color: '#c8c8c6',
                      lineHeight: 1.5,
                      fontWeight: 300,
                      display: 'flex',
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {embedQuoteText}
                  </div>
                </div>
              )}
            </div>

            {/* Footer - stats on left, tagline on right */}
            <div
              style={{
                marginTop: '45px',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
              }}
            >
              {/* Left: Post stats */}
              <div
                style={{
                  display: 'flex',
                  gap: '25px',
                  fontSize: '18px',
                  fontWeight: 300,
                }}
              >
                <div style={{ display: 'flex', gap: '6px', color: '#b8b8b6' }}>
                  <span style={{ color: '#8a9a7f', fontWeight: 400 }}>{likeCount.toLocaleString()}</span>
                  <span>likes</span>
                </div>
                <div style={{ display: 'flex', gap: '6px', color: '#b8b8b6' }}>
                  <span style={{ color: '#8a9a7f', fontWeight: 400 }}>{repostCount.toLocaleString()}</span>
                  <span>reposts</span>
                </div>
                <div style={{ display: 'flex', gap: '6px', color: '#b8b8b6' }}>
                  <span style={{ color: '#8a9a7f', fontWeight: 400 }}>{replyCount.toLocaleString()}</span>
                  <span>replies</span>
                </div>
              </div>
              
              {/* Right: Tagline */}
              <div
                style={{
                  fontSize: '26px',
                  color: '#a8a8a6',
                  fontWeight: 400,
                  letterSpacing: '0.5px',
                  display: 'flex',
                }}
              >
                Choose where to view this post
              </div>
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

    const duration = Date.now() - startTime;
    console.log(`[OG Post] Image generated successfully in ${duration}ms`);
    
    // ImageResponse already returns a proper Response, just add cache headers
    imageResponse.headers.set('Cache-Control', 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400');
    
    return imageResponse;
  } catch (error) {
    const duration = Date.now() - startTime;
    console.error(`[OG Post] Error generating OG image (${duration}ms):`, error);
    console.error('[OG Post] Error stack:', error instanceof Error ? error.stack : 'No stack trace');
    
    // Return a simple error response
    return new Response(`Error generating image: ${error instanceof Error ? error.message : 'Unknown error'}`, { 
      status: 500,
      headers: {
        'Content-Type': 'text/plain',
      }
    });
  }
}
