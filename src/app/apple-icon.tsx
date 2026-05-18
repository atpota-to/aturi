import { ImageResponse } from 'next/og';

// Apple's LinkPresentation framework (used by iMessage, Messages on macOS,
// Mail, etc.) reads <link rel="apple-touch-icon"> to render the small icon
// shown next to the title in a rich-link preview. Next.js's file-based
// `apple-icon.*` convention only supports raster formats — an SVG sibling is
// silently ignored — so we generate the icon dynamically as a PNG instead.

export const size = { width: 180, height: 180 };
export const contentType = 'image/png';

export default function AppleIcon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0a0f0d',
        }}
      >
        <svg
          width="135"
          height="135"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#8a9a7f"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
          <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
        </svg>
      </div>
    ),
    size
  );
}
