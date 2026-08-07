/**
 * Shared visual primitives for /api/og/* route handlers.
 *
 * @vercel/og's Satori renderer accepts a small subset of CSS + a small set
 * of inline SVGs. These helpers centralize the bits every OG route needs
 * (font loading, the dark gradient + grain background, the brand mark) so
 * the per-page route can focus on the unique product visual it's rendering.
 */

import type { ReactNode } from 'react';

// Site colors mirrored from globals.css so the OG card matches what the
// visitor sees once they click through.
export const OG_COLORS = {
  bgPrimary: '#0a0a0a',
  bgSecondary: '#151515',
  bgTertiary: '#1a1a1a',
  bgElevated: '#202020',
  textPrimary: '#e8e8e6',
  textSecondary: '#b8b8b6',
  textTertiary: '#888884',
  accent: '#8a9a7f',
  accentDark: '#4a5a3f',
  borderSubtle: 'rgba(232, 232, 230, 0.08)',
  borderMedium: 'rgba(138, 154, 127, 0.18)',
  borderAccent: 'rgba(138, 154, 127, 0.45)',
};

const fontCache = new Map<string, ArrayBuffer>();

/**
 * Strip glyphs that break @vercel/og image generation from user-supplied
 * text (display names, bios, post text).
 *
 * When the rendered text contains characters missing from the Crimson Pro
 * subset, Satori asks Google Fonts for a dynamic fallback subset. For
 * decorative symbols — arrows, stars, geometric shapes (U+2190–U+2BFF) —
 * that request returns HTTP 400 and @vercel/og throws, failing the WHOLE
 * image (observed in production for display names like "⊱⋅⊰⋆⟡─"). Letters
 * in real scripts (CJK, Cyrillic, Arabic…) resolve fine via Noto fallbacks,
 * so only the symbol blocks are stripped.
 */
export function sanitizeOgText(text: string): string {
  return text
    // Take the whole ZWJ sequence when one of its parts is in range, rather
    // than just the offending codepoint: 🏳️‍⚧️ is flag + ZWJ + ⚧ + VS16, and
    // dropping only the ⚧ left a plain white flag standing in for a trans
    // flag — a wrong glyph is worse than no glyph.
    .replace(/(?:\p{Extended_Pictographic}️?‍)?[←-⯿]️?/gu, '')
    .replace(/ {2,}/g, ' ');
}

/**
 * Largest font size at which `len` monospace characters still fit inside
 * `maxWidth`, accounting for the chip's own horizontal padding.
 *
 * IBM Plex Mono advances exactly 0.6em per character, so the fit is closed
 * form — no measuring pass needed, which matters because Satori gives us no
 * way to measure text before layout.
 */
export function fitMonoSize(
  len: number,
  cap: number,
  { maxWidth = 1060, padEm = 0.34, min = 18 }: { maxWidth?: number; padEm?: number; min?: number } = {},
): number {
  const size = maxWidth / (0.6 * len + 2 * padEm);
  return Math.max(min, Math.min(cap, Math.floor(size)));
}

/**
 * Every ASCII letter + digit. Append this to a route's font-subset request
 * text so the subset always carries glyphs for CSS-transformed copy.
 *
 * Satori applies `text-transform` *after* the Google Fonts subset has been
 * built from the literal `&text=` characters, so an uppercased `Eyebrow`
 * (e.g. "Atmosphere data explorer" → "ATMOSPHERE DATA EXPLORER") asks the
 * renderer for capital glyphs — O, E, H, X… — that never appear verbatim in
 * the card's copy and are therefore missing from the subset. The renderer
 * then falls back to mismatched glyphs, which is the jumbled-caps look on
 * the eyebrow chip. Including the full alphabet guarantees coverage.
 */
export const OG_GLYPH_BASELINE =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Fetch a Google Font subset for the characters in `text`. Cached in
 * module memory and short-circuited on a 3s timeout — image generation
 * has to stay fast even when the font CDN is slow.
 */
export async function loadGoogleFont(font: string, text: string): Promise<ArrayBuffer> {
  const cacheKey = `${font}-${text.slice(0, 50)}`;
  const cached = fontCache.get(cacheKey);
  if (cached) return cached;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);

  try {
    const url = `https://fonts.googleapis.com/css2?family=${font}&text=${encodeURIComponent(text)}`;
    const css = await fetch(url, { signal: controller.signal }).then((r) => r.text());
    const match = css.match(/src: url\((.+)\) format\('(opentype|truetype)'\)/);
    if (match) {
      const res = await fetch(match[1], { signal: controller.signal });
      if (res.status === 200) {
        const data = await res.arrayBuffer();
        fontCache.set(cacheKey, data);
        return data;
      }
    }
  } finally {
    clearTimeout(timeoutId);
  }

  throw new Error('failed to load font data');
}

/**
 * Full-bleed dark frame with the site's signature radial-gradient wash
 * and SVG grain overlay. Wrap a route's content in this so every OG card
 * shares the same atmosphere.
 */
export function OgFrame({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        height: '100%',
        width: '100%',
        display: 'flex',
        flexDirection: 'column',
        backgroundColor: OG_COLORS.bgPrimary,
        backgroundImage:
          'radial-gradient(ellipse at 20% 30%, rgba(138, 154, 127, 0.18) 0%, rgba(10, 10, 10, 0) 85%), radial-gradient(ellipse at 80% 70%, rgba(74, 90, 63, 0.15) 0%, rgba(10, 10, 10, 0) 85%), radial-gradient(ellipse at 50% 50%, rgba(61, 51, 41, 0.12) 0%, rgba(10, 10, 10, 0) 90%)',
        color: OG_COLORS.textPrimary,
        fontFamily: 'Crimson Pro',
        padding: '60px 70px',
        position: 'relative',
      }}
    >
      <div
        style={{
          position: 'absolute',
          inset: 0,
          backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 800 800' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='noise'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='1.8' numOctaves='5' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23noise)' opacity='0.03'/%3E%3C/svg%3E")`,
          opacity: 0.6,
          display: 'flex',
        }}
      />
      {children}
    </div>
  );
}

/**
 * Leaf wordmark — the site's brand lockup, used in the top-left of every
 * landing-page OG. Lucide-style outlined leaf so it stays light at large
 * sizes without competing with the headline below.
 */
export function BrandMark({ size = 30 }: { size?: number } = {}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        position: 'relative',
        zIndex: 1,
      }}
    >
      <svg
        width={size + 6}
        height={size + 6}
        viewBox="0 0 24 24"
        fill="none"
        stroke={OG_COLORS.accent}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
        <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
      </svg>
      <span
        style={{
          fontSize: `${size}px`,
          fontWeight: 300,
          letterSpacing: '-0.01em',
          color: OG_COLORS.textPrimary,
          display: 'flex',
        }}
      >
        aturi
      </span>
      <span
        style={{
          fontSize: `${size}px`,
          fontWeight: 300,
          color: OG_COLORS.textTertiary,
          display: 'flex',
        }}
      >
        .to
      </span>
    </div>
  );
}

/**
 * Right-side eyebrow line — a small-caps section label that mirrors the
 * "ATMOSPHERE DATA EXPLORER" badge used on the in-product landing pages.
 */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        padding: '6px 14px',
        background: OG_COLORS.bgTertiary,
        border: `1px solid ${OG_COLORS.borderSubtle}`,
        color: OG_COLORS.textTertiary,
        fontSize: '16px',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
      }}
    >
      {children}
    </div>
  );
}

/**
 * Top row used by every landing-page OG: brand on the left, eyebrow tag
 * on the right.
 */
export function TopRow({ eyebrow }: { eyebrow?: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        position: 'relative',
        zIndex: 1,
      }}
    >
      <BrandMark />
      {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : <div style={{ display: 'flex' }} />}
    </div>
  );
}

/**
 * Small-caps mono label — the accent-coloured kicker that names what kind of
 * thing the card is about ("COLLECTION", "RECORD", "BLUESKY POST").
 */
export function ContextLabel({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        fontFamily: 'IBM Plex Mono',
        fontSize: '20px',
        fontWeight: 500,
        letterSpacing: '0.18em',
        textTransform: 'uppercase',
        color: OG_COLORS.accent,
      }}
    >
      {children}
    </div>
  );
}

/** Stacked-drive glyph, used wherever a PDS hostname appears. */
export function ServerGlyph({ size = 22, color = OG_COLORS.textTertiary }: IconProps = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      <rect width="20" height="8" x="2" y="2" rx="2" ry="2" />
      <rect width="20" height="8" x="2" y="14" rx="2" ry="2" />
      <path d="M6 6h.01" />
      <path d="M6 18h.01" />
    </svg>
  );
}

/**
 * The card's headline unit: a shrink-wrapped mono chip carrying one piece of
 * an AT URI (a handle, an NSID, an rkey). Sized by `fitMonoSize` so the
 * longest realistic NSID still lands large instead of being scaled into the
 * body copy.
 */
export function IdentityChip({
  text,
  size,
  tone = 'primary',
  icon,
}: {
  text: string;
  size: number;
  tone?: 'primary' | 'accent' | 'muted';
  icon?: ReactNode;
}) {
  const color =
    tone === 'accent'
      ? OG_COLORS.accent
      : tone === 'muted'
      ? OG_COLORS.textTertiary
      : OG_COLORS.textPrimary;
  const border = tone === 'accent' ? OG_COLORS.borderAccent : OG_COLORS.borderSubtle;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: `${Math.round(size * 0.3)}px`,
        padding: `${Math.round(size * 0.2)}px ${Math.round(size * 0.34)}px`,
        background: tone === 'muted' ? 'transparent' : OG_COLORS.bgSecondary,
        border: `1px solid ${border}`,
        fontFamily: 'IBM Plex Mono',
        fontSize: `${size}px`,
        fontWeight: 500,
        color,
        lineHeight: 1.1,
      }}
    >
      {icon}
      <span style={{ display: 'flex' }}>{text}</span>
    </div>
  );
}

/**
 * Hairline rule + a left/right row, pinned to the bottom of a card. Gives
 * every data card the same closing line so the bottom third stops reading as
 * unused space.
 */
export function OgFooter({ left, right }: { left?: ReactNode; right?: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '18px',
        position: 'relative',
        zIndex: 1,
      }}
    >
      <div style={{ display: 'flex', height: '1px', background: OG_COLORS.borderSubtle }} />
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '32px',
        }}
      >
        {left ?? <div style={{ display: 'flex' }} />}
        {right ?? <div style={{ display: 'flex' }} />}
      </div>
    </div>
  );
}

/** Right-hand footer CTA: "Open in any Atmosphere client →". */
export function FooterCta({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        flexShrink: 0,
        fontFamily: 'Crimson Pro',
        fontSize: '24px',
        fontWeight: 300,
        fontStyle: 'italic',
        color: OG_COLORS.textTertiary,
      }}
    >
      <span style={{ display: 'flex' }}>{children}</span>
      <ArrowRight size={22} color={OG_COLORS.textTertiary} />
    </div>
  );
}

// ─── Waypoint icon SVGs ────────────────────────────────────────────────────
// Inlined from src/utils/waypointIcons.tsx so the OG route doesn't have to
// import the full catalog into the edge bundle. Each accepts a size + color.

type IconProps = { size?: number; color?: string };

export function BlueskyIcon({ size = 28, color = OG_COLORS.textPrimary }: IconProps = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <path
        fill={color}
        d="M111.8 62.2C170.2 105.9 233 194.7 256 242.4c23-47.6 85.8-136.4 144.2-180.2c42.1-31.6 110.3-56 110.3 21.8c0 15.5-8.9 130.5-14.1 149.2C478.2 298 412 314.6 353.1 304.5c102.9 17.5 129.1 75.5 72.5 133.5c-107.4 110.2-154.3-27.6-166.3-62.9l0 0c-1.7-4.9-2.6-7.8-3.3-7.8s-1.6 3-3.3 7.8l0 0c-12 35.3-59 173.1-166.3 62.9c-56.5-58-30.4-116 72.5-133.5C100 314.6 33.8 298 15.7 233.1C10.4 214.4 1.5 99.4 1.5 83.9c0-77.8 68.2-53.4 110.3-21.8z"
      />
    </svg>
  );
}

export function LeafletIcon({ size = 28, color = OG_COLORS.textPrimary }: IconProps = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        fill={color}
        d="M6.19354 43.7615C4.02326 47.9529 2.3971 50.6787 0.825968 54.5903C-0.40065 57.6442 1.08066 61.1142 4.13453 62.3408C7.18841 63.5675 10.6584 62.0862 11.8851 59.0323C12.1956 58.2591 12.4949 57.4976 12.784 56.7619L12.7867 56.755C13.8877 53.9534 14.8372 51.5562 15.9859 49.3971C17.2796 49.3269 18.7589 49.3161 20.4268 49.3067L20.6365 49.3056C23.6784 49.2888 27.3433 49.2687 30.5036 48.629C33.6657 47.989 37.5791 46.476 39.3089 42.4233C39.7772 41.3263 40.2521 39.7069 39.8363 38.0619C39.9611 38.0618 40.0889 38.0618 40.2201 38.0618C40.2903 38.0618 40.3619 38.0618 40.4348 38.0619C42.1036 38.063 44.452 38.0645 46.5513 37.4934C49.0009 36.8271 51.5766 35.2492 52.7066 31.9254C53.115 30.7244 53.1906 29.4632 52.8381 28.2712C52.9461 28.2521 53.0569 28.2327 53.1706 28.2127C53.2252 28.2032 53.2807 28.1935 53.3369 28.1837C54.7713 27.933 56.6912 27.5974 58.3315 26.9838C59.9271 26.3869 62.5489 25.0534 63.3345 21.9971C63.7822 20.2552 63.7353 18.411 62.7294 16.7456C62.3111 16.0531 61.779 15.5078 61.3069 15.1057C61.7466 14.5555 62.3058 13.79 62.6909 12.9455C63.3591 11.4803 63.7036 9.32754 62.3369 7.22123C60.7856 4.83067 58.1256 4.41306 56.8098 4.30487C55.4415 4.19236 53.9707 4.31254 52.9137 4.40806C52.7702 4.05645 52.5725 3.68669 52.2993 3.32178C50.832 1.36219 48.5559 1.19749 47.2748 1.23194C44.6865 1.30155 42.6621 2.45002 41.1987 3.64119C40.4307 4.26635 38.6031 6.82233 38.0052 7.48715C38.0052 5.10325 35.7086 3.89003 34.0939 3.64119C30.959 3.15806 29.0173 5.17673 27.2122 7.48715C24.962 10.3672 23.22 14.0741 21.1617 16.8593C20.4523 16.3978 19.6125 15.3179 18.2694 15.3803C16.0564 15.4831 14.5863 16.9832 13.6351 18.0097C11.9797 19.796 10.9264 23.0413 10.2095 25.4575C9.43004 28.9535 8.89843 30.4276 8.26688 34.2604C7.8913 36.5398 7.70089 38.3385 7.70089 40.8839C7.27002 41.7282 6.77687 42.635 6.19354 43.7615Z"
      />
    </svg>
  );
}

export function TangledIcon({ size = 28, color = OG_COLORS.textPrimary }: IconProps = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 25 25" xmlns="http://www.w3.org/2000/svg">
      <path
        fill={color}
        d="m 16.775491,24.987061 c -0.78517,-0.0064 -1.384202,-0.234614 -2.033994,-0.631295 -0.931792,-0.490188 -1.643475,-1.31368 -2.152014,-2.221647 C 11.781409,23.136647 10.701392,23.744942 9.4922931,24.0886 8.9774725,24.238111 8.0757679,24.389777 6.5811304,23.84827 4.4270703,23.124679 2.8580086,20.883331 3.0363279,18.599583 3.0037061,17.652919 3.3488675,16.723769 3.8381157,15.925061 2.5329485,15.224503 1.4686756,14.048584 1.0611184,12.606459 0.81344502,11.816973 0.82385989,10.966486 0.91519098,10.154906 1.2422711,8.2387903 2.6795811,6.5725716 4.5299585,5.9732484 5.2685364,4.290122 6.8802592,3.0349975 8.706276,2.7794663 c 1.2124148,-0.1688264 2.46744,0.084987 3.52811,0.7011837 1.545426,-1.7139736 4.237779,-2.2205077 6.293579,-1.1676231 1.568222,0.7488935 2.689625,2.3113526 2.961888,4.0151464 1.492195,0.5977882 2.749007,1.8168898 3.242225,3.3644951 0.329805,0.9581836 0.340709,2.0135956 0.127128,2.9974286 -0.381606,1.535184 -1.465322,2.842146 -2.868035,3.556463 0.0034,0.273204 0.901506,2.243045 0.751284,3.729647 -0.03281,1.858525 -1.211631,3.619894 -2.846433,4.475452 -0.953967,0.556812 -2.084452,0.546309 -3.120531,0.535398 z m -4.470079,-5.349839 c 1.322246,-0.147248 2.189053,-1.300106 2.862307,-2.338363 0.318287,-0.472954 0.561404,-1.002348 0.803,-1.505815 0.313265,0.287151 0.578698,0.828085 1.074141,0.956909 0.521892,0.162542 1.133743,0.03052 1.45325,-0.443554 0.611414,-1.140449 0.31004,-2.516537 -0.04602,-3.698347 C 18.232844,11.92927 17.945151,11.232927 17.397785,10.751793 17.514522,9.9283111 17.026575,9.0919791 16.332883,8.6609491 15.741721,9.1323278 14.842258,9.1294949 14.271975,8.6252369 13.178927,9.7400102 12.177239,9.7029996 11.209704,8.8195135 10.992255,8.6209543 10.577326,10.031484 9.1211947,9.2324497 8.2846288,9.9333947 7.6359672,10.607693 7.0611981,11.578553 6.5026891,12.62523 5.9177873,13.554793 5.867393,14.69141 c -0.024234,0.66432 0.4948601,1.360337 1.1982269,1.306329 0.702996,0.06277 1.1815208,-0.629091 1.7138087,-0.916491 0.079382,0.927141 0.1688108,1.923227 0.4821259,2.828358 0.3596254,1.171275 1.6262605,1.915695 2.8251855,1.745211 0.08481,-0.0066 0.218672,-0.01769 0.218672,-0.0176 z m 0.686342,-3.497495 c -0.643126,-0.394168 -0.33365,-1.249599 -0.359402,-1.870938 0.064,-0.749774 0.115321,-1.538054 0.452402,-2.221125 0.356724,-0.487008 1.226721,-0.299139 1.265134,0.325689 -0.02558,0.628509 -0.314101,1.25416 -0.279646,1.9057 -0.07482,0.544043 0.05418,1.155133 -0.186476,1.652391 -0.197455,0.275121 -0.599638,0.355105 -0.892012,0.208283 z m -2.808766,-0.358124 c -0.605767,-0.328664 -0.4133176,-1.155655 -0.5083256,-1.73063 0.078762,-0.66567 0.013203,-1.510085 0.5705316,-1.976886 0.545037,-0.380109 1.286917,0.270803 1.029164,0.868384 -0.274913,0.755214 -0.09475,1.580345 -0.08893,2.34609 -0.104009,0.451702 -0.587146,0.691508 -1.002445,0.493042 z"
      />
    </svg>
  );
}

export function MarginIcon({ size = 28, color = OG_COLORS.textPrimary }: IconProps = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 265 231" xmlns="http://www.w3.org/2000/svg">
      <path fill={color} d="M0 230 V0 H199 V65.7156 H149.5 V115.216 H182.5 L199 131.716 V230 Z" />
      <path
        fill={color}
        d="M215 214.224 V230 H264.5 V0 H215.07 V16.2242 H248.5 V214.224 H215 Z"
      />
    </svg>
  );
}

export function DeerIcon({ size = 28, color = OG_COLORS.textPrimary }: IconProps = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 512 512" xmlns="http://www.w3.org/2000/svg">
      <path
        fill={color}
        d="m 149.96484,186.56641 46.09766,152.95898 c 0,0 -6.30222,-9.61174 -15.60547,-17.47656 -8.87322,-7.50128 -28.4082,-4.04492 -28.4082,-4.04492 0,0 6.14721,39.88867 15.53125,44.39843 10.71251,5.1482 22.19726,0.16993 22.19726,0.16993 0,0 11.7613,-4.87282 22.82032,31.82421 5.26534,17.47196 15.33258,50.877 20.9707,69.58594 2.16717,7.1913 8.83789,7.25781 8.83789,7.25781 0,0 6.67072,-0.0665 8.83789,-7.25781 5.63812,-18.70894 15.70536,-52.11398 20.9707,-69.58594 11.05902,-36.69703 22.82032,-31.82421 22.82032,-31.82421 0,0 11.48475,4.97827 22.19726,-0.16993 9.38404,-4.50976 15.5332,-44.39843 15.5332,-44.39843 0,0 -19.53693,-3.45636 -28.41015,4.04492 -9.30325,7.86482 -15.60547,17.47656 -15.60547,17.47656 l 46.09766,-152.95898 -49.32618,83.84179 -20.34375,-31.1914 6.35547,54.96875 -23.1582,39.36132 c 0,0 -2.97595,5.06226 -5.94336,4.68946 -0.009,-0.001 -0.0169,0.003 -0.0254,0.01 -0.008,-0.007 -0.0167,-0.0109 -0.0254,-0.01 -2.96741,0.3728 -5.94336,-4.68946 -5.94336,-4.68946 l -23.1582,-39.36132 6.35547,-54.96875 -20.34375,31.1914 z"
        transform="matrix(2.6921023,0,0,1.7145911,-396.58283,-308.01527)"
      />
    </svg>
  );
}

export function GrainIcon({ size = 28, color = OG_COLORS.textPrimary }: IconProps = {}) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" xmlns="http://www.w3.org/2000/svg">
      <path
        fill={color}
        d="M28.9823 37.4693C22.5838 37.4693 17.3117 36.9511 13.1662 35.9147C9.02069 34.8333 5.95661 33.2336 3.97396 31.1158C1.99132 28.9529 1 26.2493 1 23.005C1 19.986 1.96879 17.3725 3.90637 15.1645C5.84396 12.9115 8.86298 11.1542 12.9634 9.89252C17.109 8.63084 22.4486 8 28.9823 8C30.289 8 31.6183 8 32.9701 8C34.3219 8 35.6512 8 36.9579 8H62.7773V16.5163C59.8484 16.6515 56.8745 16.5164 53.8554 16.1108C50.8815 15.6602 48.1328 15.0744 45.6095 14.3535L44.866 13.3396C46.8937 13.9705 48.8087 14.7815 50.6111 15.7729C52.4586 16.7642 53.9456 17.9583 55.0721 19.3551C56.1986 20.752 56.7618 22.4192 56.7618 24.3568C56.7618 27.1505 55.793 29.5387 53.8554 31.5214C51.9629 33.4589 48.9664 34.9459 44.866 35.9823C40.8106 36.9736 35.516 37.4693 28.9823 37.4693ZM43.379 56.6649V54.8399C43.379 53.4881 42.7707 52.677 41.5541 52.4067C40.3825 52.1814 38.5125 52.0687 35.9441 52.0687H17.0864C13.8872 52.0687 11.2962 51.8434 9.31358 51.3928C7.376 50.9422 5.88902 50.3339 4.85264 49.5679C3.86131 48.8019 3.18541 47.9457 2.82493 46.9995C2.50951 46.0983 2.3518 45.1971 2.3518 44.2959C2.3518 42.3583 3.07276 40.8488 4.51468 39.7673C5.95661 38.6408 8.16455 37.8523 11.1385 37.4017C14.1125 36.9511 17.8975 36.7258 22.4936 36.7258L28.9823 37.4693C25.1973 37.4693 22.5612 37.672 21.0743 38.0776C19.5873 38.4381 18.8438 39.1816 18.8438 40.3081C18.8438 40.9389 19.1367 41.412 19.7225 41.7275C20.3082 41.9978 21.0968 42.133 22.0881 42.133H42.0272C46.4881 42.133 50.0028 42.4484 52.5712 43.0793C55.1397 43.7552 56.9421 44.8591 57.9784 46.3912C59.0599 47.9683 59.6006 50.1086 59.6006 52.8122V56.6649H43.379Z"
      />
    </svg>
  );
}

/**
 * The Anisota brand mark. Tall portrait aspect — pass a height instead of
 * a uniform size so it doesn't get letterboxed into a square box.
 */
export function AnisotaIcon({
  height = 28,
  color = OG_COLORS.textPrimary,
}: { height?: number; color?: string } = {}) {
  const width = Math.round(height * 0.696);
  return (
    <svg
      width={width}
      height={height}
      viewBox="0 0 516.02 741.26"
      xmlns="http://www.w3.org/2000/svg"
    >
      {/* Stylised wordmark — three glyph paths from the brand sheet. */}
      <path
        fill={color}
        d="M419.35,737.26l-1.55,1.09c-8.99,1.34-9.75-.68-17.05.26-1.52.2-3.67-.13-4.94-1.05-1.96-1.41-4.49-3.84-8.32-4.61-2.5-.5-5.6-2.46-7.86-3.59-2.74-1.37-7.5-3.84-8.36-7.96-.51-2.46-.95-7.61-.99-10.13-.07-3.69-.79-8.78-2.21-12.43-2.18-5.61-2.55-8.45-5.31-13.97-1.65-3.31-3.62-7.31-3.49-11.16,0-.16-1.4-2.42-1.34-2.83,0-.06-1.66-2.94-1.73-3.16-.43-1.46-.95-5.65-1.6-7.05-3.46-7.46-12.61-21.84-20.85-26.04-3.57-1.82-6.36-3.94-9.71-6.36-1.78-1.28-7.13-3.94-8.51-4.65-6.21-3.19-13.07-6.81-16.93-12.92,0-.04-.39-2.97-.46-3.21-1.18-3.59-3.55-12.18-2.86-15.32,7.83-2.83,12.7-3.31,18.8-9.45,1.31-1.31,5.27-7.94,5.84-9.81.96-3.12,1.65-7.79,2.33-11.65.27-1.59.27-3.49.59-5.07.31-1.5.93-2.66.46-4.31-.43-1.55-4.55-3.7-6.69-4.18-2.86-.65-5.51,0-7.62-2.05-1.92-1.88-3.92-3.13-3.43-4.46.61-1.65,4.42-1.4,5.4-2.27,2.31-2.07-.07-4.63.42-7.16.27-1.41.65-2.7,1.21-3.49.69-.98,1.91-1.6,2.43-2.61.7-1.39.66-3.55.56-5.05-.16-2.37,2.61-9.36-4.51-7.21-1.46.44-2.51,2.39-3.83,3.49-2.79,2.31-7.07,5.66-9.94,1.6-1.92-2.74-1.93-9.92-2.92-13.49-.31-1.13-3.36-6.91-3.92-8.31-.93-2.31-2.11-4.74-4.61-7.69-.04-.04-4.46-2.6-4.59-2.74-2.16-2.05-3.55-3.51-3.61-6.16-.13-2.1.27-4.69.14-7.07,0-.31-2.07-2.66-1.84-3.74.16-.79,5.6-1.55,6.27-1.8,5.55-2,8.21-6.51,10.36-11.4,1.93-4.42,1.41-6.95,4.42-11.18.85-1.2,2.04-1.51,2.42-3.18.59-2.74-.42-4.61-2.51-6.46-2.65-2.31-9.36-4.18-10.97-7.13-2.05-3.76,1.65-12.45,2.93-15.39,5.95-13.42,15.96-30.46,32.54-30.46,7.31,0,15.79,7.61,15.79,17.39,0,4.27-.83,9.79-.16,14.4.66,4.55,2.18,11.55,5.65,15.45,3.06,3.46,4.61,8.42,6.32,12.83,3.06,8.05,12.21,11.04,19.45,11.93,2.83.35,7.65,1.39,9.92,3.05,2.39,1.76,3.84,6.46,3.84,9.16,0,9.69-10.55,15.92-13.51,24.18-1.85,5.07-3.18,11.34-2.39,16.86.79,5.21,2.95,5.13,6.21,8.85,5.66,6.46,4.84,8.31,3.94,16.16-.79,7.05-.69,13.83-.31,21.06.39,7.55,3.96,18.05,2.71,25.51-1.66,9.95-2.69,18.36-1.16,28.46.7,4.62,1.74,12.65,3.55,17.05,1.96,4.74,5.16,8.96,7.21,13.42,8.65,18.92,8.78,40.04,12.34,60.07,1.34,7.45,1.61,15.6,7.27,21.04,5.83,5.59,11.27,4.78,18.4,7.92,5.44,2.39,16.93,7.96,18.65,14.04Z"
      />
    </svg>
  );
}

/**
 * Generic compass dial. Stand-in for the universal-links waypoint icon row
 * when a specific app icon isn't a fit.
 */
export function CompassIcon({ size = 28, color = OG_COLORS.textPrimary }: IconProps = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <circle cx="12" cy="12" r="10" />
      <polygon points="16.24 7.76 14.12 14.12 7.76 16.24 9.88 9.88 16.24 7.76" />
    </svg>
  );
}

/**
 * "aturi.to/profile/..." pill used in the home + universal-links visuals.
 */
export function UrlPill({ url, fontSize = 26 }: { url: string; fontSize?: number }) {
  return (
    <div
      style={{
        // Satori only supports flex/block/none/-webkit-box — "inline-flex"
        // throws and 500s the whole card. The parent centers this row, so
        // plain "flex" reads identically.
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        padding: '16px 22px',
        background: OG_COLORS.bgSecondary,
        border: `1px solid ${OG_COLORS.borderMedium}`,
        fontFamily: 'Crimson Pro',
        fontSize: `${fontSize}px`,
        color: OG_COLORS.textSecondary,
      }}
    >
      <svg
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke={OG_COLORS.accent}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        xmlns="http://www.w3.org/2000/svg"
      >
        <path d="M9 17H7A5 5 0 0 1 7 7h2" />
        <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
        <line x1="8" y1="12" x2="16" y2="12" />
      </svg>
      <span style={{ display: 'flex' }}>{url}</span>
    </div>
  );
}

/**
 * Downward chevron used between the URL pill and the waypoint icon row,
 * mirroring the WaypointJumpVisual on the home page.
 */
export function DropChevron({ color = OG_COLORS.accent }: { color?: string } = {}) {
  // Inline SVG rather than the '▾' glyph: Crimson Pro has no glyph for it,
  // which forces Satori into a Google Fonts dynamic-subset request that 400s
  // and kills the whole image (seen in production on /api/og/static).
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <svg width="26" height="26" viewBox="0 0 24 24" fill={color} xmlns="http://www.w3.org/2000/svg">
        <path d="M6 9l6 7 6-7z" />
      </svg>
    </div>
  );
}

/**
 * Right arrow for "Open in …" CTAs. SVG for the same reason as DropChevron —
 * a literal '→' has no Crimson Pro glyph and trips the dynamic-font 400.
 */
export function ArrowRight({ size = 22, color = 'currentColor' }: { size?: number; color?: string } = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <line x1="4" y1="12" x2="20" y2="12" />
      <polyline points="13 5 20 12 13 19" />
    </svg>
  );
}

/**
 * A row of waypoint icon cells, with one optionally highlighted to indicate
 * a "recommended" pick. Mirrors the home page's WaypointJumpVisual.
 */
export function WaypointRow({
  highlightIndex,
  iconSize = 36,
}: {
  highlightIndex?: number;
  iconSize?: number;
}) {
  const items: { key: string; node: ReactNode }[] = [
    { key: 'bluesky', node: <BlueskyIcon size={iconSize} /> },
    // Anisota's mark is a single tall hairline stroke — matched to the others
    // on height it reads as a smudge, so give it ~30% more and let it run
    // taller than the square marks to even out the optical weight.
    { key: 'anisota', node: <AnisotaIcon height={Math.round(iconSize * 1.3)} /> },
    { key: 'leaflet', node: <LeafletIcon size={iconSize} /> },
    { key: 'tangled', node: <TangledIcon size={iconSize} /> },
    { key: 'margin', node: <MarginIcon size={iconSize} /> },
    { key: 'deer', node: <DeerIcon size={iconSize} /> },
    { key: 'grain', node: <GrainIcon size={iconSize} /> },
  ];

  return (
    <div
      style={{
        display: 'flex',
        gap: '14px',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      {items.map((item, i) => {
        const isActive = i === highlightIndex;
        return (
          <div
            key={item.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: iconSize + 24,
              height: iconSize + 24,
              background: isActive ? OG_COLORS.bgTertiary : 'transparent',
              border: `1px solid ${isActive ? OG_COLORS.accent : OG_COLORS.borderSubtle}`,
              color: isActive ? OG_COLORS.accent : OG_COLORS.textSecondary,
              // Satori rejects `boxShadow: undefined`, so only set it when the
              // cell is highlighted instead of passing an undefined value.
              ...(isActive
                ? { boxShadow: '0 0 32px rgba(138, 154, 127, 0.25)' }
                : {}),
            }}
          >
            {item.node}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Headline + subhead block used by every product OG. Title may contain
 * '\n' newlines — each becomes its own line (Satori's text wrapper
 * handles raw block children; we explicitly split so line-height
 * stays predictable regardless of CSS whitespace support).
 */
export function Headline({
  title,
  tagline,
  size = 78,
  taglineSize,
}: {
  title: string;
  tagline?: string;
  /** Display size. Split layouts pass a smaller value to fit a half-width column. */
  size?: number;
  taglineSize?: number;
}) {
  const lines = title.split('\n');
  const subSize = taglineSize ?? Math.max(22, Math.round(size * 0.36));
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        position: 'relative',
        zIndex: 1,
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          fontSize: `${size}px`,
          fontWeight: 300,
          letterSpacing: '-0.02em',
          color: OG_COLORS.textPrimary,
          lineHeight: 1.05,
        }}
      >
        {lines.map((line, i) => (
          <div key={i} style={{ display: 'flex' }}>
            {line}
          </div>
        ))}
      </div>
      {tagline && (
        <div
          style={{
            marginTop: '18px',
            fontSize: `${subSize}px`,
            fontWeight: 300,
            color: OG_COLORS.textSecondary,
            lineHeight: 1.4,
            maxWidth: '900px',
            display: 'flex',
          }}
        >
          {tagline}
        </div>
      )}
    </div>
  );
}
