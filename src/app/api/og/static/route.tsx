import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';

export const runtime = 'edge';

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
    const page = searchParams.get('page') || 'home';
    
    // Define content for each page
    const pageContent: Record<string, { title: string; subtitle: string; tagline: string; showBranding: boolean }> = {
      home: {
        title: 'aturi.to',
        subtitle: 'Universal links for the ATmosphere',
        tagline: 'Share ATProto content with anyone, let them choose where to view it',
        showBranding: false, // Home already shows aturi.to as main title
      },
      create: {
        title: 'Create Link',
        subtitle: 'Turn any ATProto URL into a universal link',
        tagline: 'Paste a Bluesky URL or AT URI and get an aturi.to link',
        showBranding: true,
      },
      integrate: {
        title: 'Integrate',
        subtitle: 'Add universal sharing to your ATmosphere app',
        tagline: 'Simple URL patterns for seamless ATProto integration',
        showBranding: true,
      },
      fork: {
        title: 'Fork & Deploy',
        subtitle: 'Run your own instance with a custom domain',
        tagline: 'Open source and ready to deploy',
        showBranding: true,
      },
    };

    const content = pageContent[page] || pageContent.home;
    
    // Load Crimson Pro font
    const allText = `${content.title} ${content.subtitle} ${content.tagline} aturi.to Universal ATmosphere Links`;
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

          {/* Organic decorative blobs */}
          <div
            style={{
              position: 'absolute',
              top: '15%',
              right: '8%',
              width: '180px',
              height: '180px',
              background: 'radial-gradient(circle, rgba(138, 154, 127, 0.08) 0%, transparent 70%)',
              filter: 'blur(40px)',
              display: 'flex',
            }}
          />
          <div
            style={{
              position: 'absolute',
              bottom: '20%',
              left: '12%',
              width: '220px',
              height: '220px',
              background: 'radial-gradient(circle, rgba(74, 90, 63, 0.06) 0%, transparent 70%)',
              filter: 'blur(50px)',
              display: 'flex',
            }}
          />

          {/* Main Content Container */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              flex: 1,
              position: 'relative',
              zIndex: 1,
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            {/* Main card - slightly rotated for organic feel */}
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                maxWidth: '950px',
                width: '100%',
                padding: '70px 80px',
                backgroundColor: 'rgba(26, 26, 26, 0.85)',
                border: '1px solid rgba(138, 154, 127, 0.15)',
                backdropFilter: 'blur(15px)',
                boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(232, 232, 230, 0.05)',
                transform: 'rotate(-0.5deg)',
              }}
            >
              {/* Accent bar - organic touch */}
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: '35%',
                  width: '4px',
                  height: '120px',
                  background: 'linear-gradient(to bottom, rgba(138, 154, 127, 0.6), rgba(74, 90, 63, 0.3))',
                  display: 'flex',
                }}
              />

              {/* Top branding for non-home pages - inside card */}
              {content.showBranding && (
                <div
                  style={{
                    fontSize: '28px',
                    color: '#8a9a7f',
                    fontWeight: 300,
                    letterSpacing: '0.5px',
                    marginBottom: '40px',
                    display: 'flex',
                    opacity: 0.9,
                  }}
                >
                  aturi.to
                </div>
              )}

              {/* Main Title with decorative element */}
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  marginBottom: '35px',
                }}
              >
                <div
                  style={{
                    fontSize: '76px',
                    fontWeight: content.showBranding ? 400 : 300,
                    color: '#e8e8e6',
                    letterSpacing: '-0.02em',
                    lineHeight: 1,
                    marginBottom: '15px',
                    display: 'flex',
                  }}
                >
                  {content.title}
                </div>
                {/* Decorative underline */}
                <div
                  style={{
                    width: '140px',
                    height: '2px',
                    background: 'linear-gradient(to right, rgba(138, 154, 127, 0.5), transparent)',
                    display: 'flex',
                  }}
                />
              </div>

              {/* Subtitle with more prominence */}
              <div
                style={{
                  fontSize: '40px',
                  color: '#8a9a7f',
                  fontWeight: 300,
                  marginBottom: '30px',
                  letterSpacing: '0.3px',
                  lineHeight: 1.3,
                  display: 'flex',
                }}
              >
                {content.subtitle}
              </div>

              {/* Tagline in a nested organic container */}
              <div
                style={{
                  display: 'flex',
                  padding: '28px 32px',
                  backgroundColor: 'rgba(21, 21, 21, 0.6)',
                  border: '1px solid rgba(232, 232, 230, 0.06)',
                  marginTop: '10px',
                  transform: 'rotate(0.3deg)',
                }}
              >
                <div
                  style={{
                    fontSize: '26px',
                    color: '#a8a8a6',
                    fontWeight: 300,
                    lineHeight: 1.6,
                    display: 'flex',
                  }}
                >
                  {content.tagline}
                </div>
              </div>

              {/* Organic corner accent */}
              <div
                style={{
                  position: 'absolute',
                  bottom: 0,
                  right: 0,
                  width: '100px',
                  height: '100px',
                  background: 'radial-gradient(circle at bottom right, rgba(138, 154, 127, 0.08), transparent 60%)',
                  display: 'flex',
                }}
              />
            </div>
          </div>

          {/* Footer branding - only for home */}
          {!content.showBranding && (
            <div
              style={{
                position: 'absolute',
                bottom: '70px',
                right: '70px',
                fontSize: '22px',
                color: '#686866',
                fontWeight: 400,
                letterSpacing: '0.5px',
                display: 'flex',
              }}
            >
              Universal ATmosphere Links
            </div>
          )}
        </div>
      ),
      {
        width: 1200,
        height: 630,
        fonts: [
          {
            name: 'Crimson Pro',
            data: fontData,
            style: 'normal',
            weight: 300,
          },
        ],
      }
    );
  } catch (error) {
    console.error('Error generating OG image:', error);
    return new Response('Error generating image', { status: 500 });
  }
}

