/**
 * Shared visual primitives for /api/og/* route handlers.
 *
 * @vercel/og's Satori renderer accepts a small subset of CSS + a small set
 * of inline SVGs. These helpers centralize the bits every OG route needs
 * (font loading, the paper ground, the brand mark, the folder-and-sheet
 * panel) so the per-page route can focus on the unique product visual it's
 * rendering.
 *
 * The cards wear the site's Field Notes look in its default light theme:
 * paper ground, white sheets with hairline edges and rounded corners, a
 * folder tab naming what the sheet holds, Figtree for type and IBM Plex Mono
 * for identifiers. Sizes run at roughly twice the site's, because an unfurl
 * shows the 1200px card at half that width or less.
 *
 * Every cache miss renders a card on billed function CPU, and resvg's wasm
 * build makes some styles expensive. Solid fills, borders, radii and text are
 * cheap. CSS gradients and `boxShadow` (a blur filter) each cost hundreds of
 * milliseconds per card, so the cards use neither: the site's pill ring is a
 * border here, not an inset shadow. `overflow: 'hidden'` puts a clip and mask
 * on every descendant, so keep it on small boxes that need it rather than
 * around a whole layout. Each inline <svg> or <img> carries a clip and mask
 * of its own, roughly 50ms apiece.
 */

import type { ReactNode } from 'react';

// Site colors mirrored from the [data-theme='light'] block in globals.css, so
// the OG card matches what the visitor sees once they click through. Light is
// the site's default theme (src/lib/theme.ts).
export const OG_COLORS = {
  /** --bg-primary: the paper the sheets lie on. */
  bgPrimary: '#f6f4ee',
  /** --bg-secondary: a sheet (card, panel, open folder tab). */
  bgSecondary: '#ffffff',
  /** --bg-tertiary: inset wells, and folders filed behind the open one. */
  bgTertiary: '#f1eee6',
  /** --surface-subtle: the off-white strip for footers and header rows. */
  surfaceSubtle: '#faf9f5',
  textPrimary: '#1c1e19',
  textSecondary: '#4a4c44',
  textTertiary: '#6b6d64',
  textFaint: '#a3a59c',
  /** --text-accent: green type, icons and links. */
  accent: '#3f5e2e',
  /** --accent-moss: the filled-button green, under --text-on-accent. */
  accentFill: '#3f5e2e',
  textOnAccent: '#ffffff',
  /** --accent-soft / -fg / -ring: the pale green pill and its outline. */
  accentSoft: '#e5ecdc',
  accentSoftFg: '#2b4320',
  accentSoftRing: '#bac7af',
  borderSubtle: '#edeae2',
  borderMedium: '#e2ded3',
  borderStrong: '#d9d4c7',
  /** --brand-bluesky, for the butterfly where it stands for Bluesky itself. */
  brandBluesky: '#1d6fd8',
};

/**
 * Corner radii. The site's are 12px cards, 8px controls and round pills;
 * these are scaled with the type so they read the same at unfurl size.
 */
export const OG_RADIUS = {
  card: 24,
  control: 14,
  pill: 999,
};

/** Canvas width and the frame's inset, from which routes budget their width. */
const OG_WIDTH = 1200;
const OG_PAD_X = 56;
const OG_PAD_Y = 44;
/** Inner padding of a Folder's sheet. */
const PANEL_PAD = 40;
/** Width a Folder's sheet leaves for content: frame inset, padding, hairlines. */
export const PANEL_CONTENT_W = OG_WIDTH - 2 * OG_PAD_X - 2 * PANEL_PAD - 2;

type FontWeight = 400 | 500 | 600 | 700 | 800;
type OgFont = { name: string; data: ArrayBuffer; weight: FontWeight; style: 'normal' };

const fontCache = new Map<string, OgFont[]>();

// A Fluid instance lives across many requests, so an unbounded cache keeps
// one set of subsets for every distinct character set it has ever rendered.
// Map iterates in insertion order, which makes eviction oldest-first.
const FONT_CACHE_LIMIT = 64;

/**
 * Strip glyphs that break @vercel/og image generation from user-supplied
 * text (display names, bios, post text).
 *
 * When the rendered text contains characters missing from the Figtree
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
  { maxWidth = PANEL_CONTENT_W, padEm = 0.34, min = 18 }: { maxWidth?: number; padEm?: number; min?: number } = {},
): number {
  const size = maxWidth / (0.6 * len + 2 * padEm);
  return Math.max(min, Math.min(cap, Math.floor(size)));
}

/**
 * Every ASCII letter + digit. Append this to a route's font-subset request
 * text so the subset always carries glyphs for CSS-transformed copy.
 *
 * Satori applies `text-transform` *after* the Google Fonts subset has been
 * built from the literal `&text=` characters, so an uppercased `Kicker`
 * (e.g. "Recommended for posts" → "RECOMMENDED FOR POSTS") asks the
 * renderer for capital glyphs — O, E, M, D… — that never appear verbatim in
 * the card's copy and are therefore missing from the subset. The renderer
 * then falls back to mismatched glyphs, which is the jumbled-caps look on
 * the kicker. Including the full alphabet guarantees coverage.
 */
export const OG_GLYPH_BASELINE =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Fetch Google Font subsets for the characters in `text`, one per weight.
 * Google answers a multi-weight request with one @font-face per weight, so a
 * family costs one stylesheet round trip plus the weight files in parallel.
 * Cached in module memory and short-circuited on a 3s timeout — image
 * generation has to stay fast even when the font CDN is slow.
 */
async function loadGoogleFontFaces(
  family: string,
  weights: FontWeight[],
  text: string,
): Promise<OgFont[]> {
  // A subset depends only on which characters it covers, not their order or
  // how often they repeat, so request and cache by the sorted set. Keying on
  // a prefix of `text` missed the cache on nearly every explore card and
  // could hand two cards sharing a prefix a subset missing the second
  // card's glyphs.
  const chars = [...new Set(text)].sort().join('');
  const cacheKey = `${family}:${weights.join(',')}-${chars}`;
  const cached = fontCache.get(cacheKey);
  if (cached) return cached;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 3000);

  try {
    const url =
      `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, '+')}:wght@${weights.join(';')}` +
      `&text=${encodeURIComponent(chars)}`;
    const css = await fetch(url, { signal: controller.signal }).then((r) => r.text());

    const faces = [...css.matchAll(/font-weight:\s*(\d+);[^}]*?src:\s*url\((.+?)\)\s*format\('(?:opentype|truetype)'\)/g)]
      .map((m) => ({ weight: Number(m[1]) as FontWeight, src: m[2] }))
      .filter((f) => weights.includes(f.weight));
    if (faces.length !== weights.length) throw new Error(`missing weights for ${family}`);

    const fonts = await Promise.all(
      faces.map(async ({ weight, src }): Promise<OgFont> => {
        const res = await fetch(src, { signal: controller.signal });
        if (res.status !== 200) throw new Error(`font fetch ${res.status}`);
        return { name: family, data: await res.arrayBuffer(), weight, style: 'normal' };
      }),
    );

    fontCache.set(cacheKey, fonts);
    if (fontCache.size > FONT_CACHE_LIMIT) {
      const oldest = fontCache.keys().next().value;
      if (oldest !== undefined) fontCache.delete(oldest);
    }
    return fonts;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * The fonts every card renders with, ready for ImageResponse's `fonts`.
 *
 * `text` is everything set in Figtree and `monoText` everything set in IBM
 * Plex Mono. Both get OG_GLYPH_BASELINE appended here, so uppercased labels
 * and the wordmark always have their glyphs, and Figtree also gets the
 * punctuation the shared pieces add on their own (StatLine's middle dot, the
 * clamps' ellipsis, a curly apostrophe), which would otherwise send Satori
 * to Google for a fallback font on every card. Figtree comes in the five
 * weights the site uses (400 body, 500 the wordmark's ".to", 600 pills and
 * labels, 700 names, 800 headlines); mono in the one the cards use.
 */
export async function loadOgFonts(text: string, monoText = ''): Promise<OgFont[]> {
  const [sans, mono] = await Promise.all([
    loadGoogleFontFaces('Figtree', [400, 500, 600, 700, 800], `${text} aturi.to ·…’ ${OG_GLYPH_BASELINE}`),
    loadGoogleFontFaces('IBM Plex Mono', [500], `${monoText} @ . : / - _ ${OG_GLYPH_BASELINE}`),
  ]);
  return [...sans, ...mono];
}

/**
 * Full-bleed paper frame. Wrap a route's content in this so every OG card
 * shares the same ground.
 *
 * Deliberately a flat fill: the site's page is flat paper too. Satori lowers
 * each CSS gradient to an SVG <pattern> behind a full-canvas mask, and
 * resvg's wasm build rasterizes those slowly (an old three-layer wash was
 * ~700ms of a ~900ms card), so a solid colour keeps every route on resvg's
 * fast path.
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
        color: OG_COLORS.textPrimary,
        fontFamily: 'Figtree',
        fontWeight: 400,
        padding: `${OG_PAD_Y}px ${OG_PAD_X}px`,
        position: 'relative',
      }}
    >
      {children}
    </div>
  );
}

/** The Lucide leaf the site's header uses as its brand mark. */
export function LeafGlyph({
  size = 30,
  color = OG_COLORS.accent,
  strokeWidth = 2.2,
}: { size?: number; color?: string; strokeWidth?: number } = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      <path d="M11 20A7 7 0 0 1 9.8 6.1C15.5 5 17 4.48 19 2c1 2 2 4.18 2 8 0 5.5-4.78 10-10 10Z" />
      <path d="M2 21c0-3 1.85-5.36 5.08-6C9.5 14.52 12 13 13 12" />
    </svg>
  );
}

/**
 * Leaf + wordmark, as in the site header (Header.tsx, .fn-brand): a green
 * leaf, "aturi" in 700, ".to" in 500 and a quieter ink.
 */
export function BrandMark({ size = 32 }: { size?: number } = {}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: `${Math.round(size * 0.4)}px`,
        flexShrink: 0,
      }}
    >
      <LeafGlyph size={Math.round(size * 1.1)} />
      {/* The wordmark is one word. Its two halves sit in their own row so the
          gap above separates the leaf from the text and nothing else — as
          direct children they picked up the same gap and rendered
          "aturi .to". */}
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          fontSize: `${size}px`,
          letterSpacing: '-0.02em',
          lineHeight: 1,
        }}
      >
        <span style={{ display: 'flex', fontWeight: 700, color: OG_COLORS.textPrimary }}>aturi</span>
        <span style={{ display: 'flex', fontWeight: 500, color: OG_COLORS.textTertiary }}>.to</span>
      </div>
    </div>
  );
}

/**
 * The pale green pill (.fl-pill) the landing pages set above their titles:
 * soft fill, a firmer ring, 600-weight green type.
 */
export function SoftPill({
  children,
  icon,
  size = 21,
}: {
  children: ReactNode;
  icon?: ReactNode;
  size?: number;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: `${Math.round(size * 0.45)}px`,
        padding: `${Math.round(size * 0.4)}px ${Math.round(size * 0.9)}px`,
        background: OG_COLORS.accentSoft,
        border: `1.5px solid ${OG_COLORS.accentSoftRing}`,
        borderRadius: `${OG_RADIUS.pill}px`,
        color: OG_COLORS.accentSoftFg,
        fontSize: `${size}px`,
        fontWeight: 600,
        lineHeight: 1.2,
        flexShrink: 0,
      }}
    >
      {icon}
      <span style={{ display: 'flex' }}>{children}</span>
    </div>
  );
}

/**
 * Small-caps label (.fl-kicker): green, 700, lightly tracked. Names a group
 * or the kind of thing a sheet holds.
 */
export function Kicker({
  children,
  size = 17,
  color = OG_COLORS.accent,
}: {
  children: ReactNode;
  size?: number;
  color?: string;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: `${Math.round(size * 0.5)}px`,
        fontSize: `${size}px`,
        fontWeight: 700,
        letterSpacing: '0.06em',
        lineHeight: 1.2,
        textTransform: 'uppercase',
        color,
      }}
    >
      {children}
    </div>
  );
}

const TAB_H = 50;

/**
 * The open folder tab (tabs.css, .fx-tab): the sheet's own white, its sides
 * and top a hairline, standing on the sheet's top border so the two read as
 * one folder. Folder draws it from its `tab` and `tabIcon` props.
 */
function FolderTab({ children, icon }: { children: ReactNode; icon?: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '11px',
        height: `${TAB_H + 1}px`,
        padding: '0 24px',
        background: OG_COLORS.bgSecondary,
        borderTop: `1px solid ${OG_COLORS.borderMedium}`,
        borderLeft: `1px solid ${OG_COLORS.borderMedium}`,
        borderRight: `1px solid ${OG_COLORS.borderMedium}`,
        borderTopLeftRadius: `${OG_RADIUS.control}px`,
        borderTopRightRadius: `${OG_RADIUS.control}px`,
        fontSize: '21px',
        fontWeight: 600,
        color: OG_COLORS.textPrimary,
        whiteSpace: 'nowrap',
      }}
    >
      {icon}
      {children}
    </div>
  );
}

/**
 * The card's sheet: a white panel with a folder tab on its top edge naming
 * what it holds, and `aside` (usually the brand mark) on the paper to the
 * tab's right. `footerLeft` / `footerRight` fill an off-white strip closing
 * the sheet, the way the site's profile card closes on its "View repo in the
 * Explorer" row. Two slots rather than one: a fragment passed as a single
 * child is a layout node to Satori, and collapses the row's spacing.
 *
 * The tab is painted after the panel and overlaps it by one pixel, so its
 * white covers the panel's top border where the two meet. Satori paints in
 * document order, so that order is what makes the join.
 */
export function Folder({
  tab,
  tabIcon,
  aside,
  footerLeft,
  footerRight,
  children,
}: {
  tab: ReactNode;
  tabIcon?: ReactNode;
  aside?: ReactNode;
  footerLeft?: ReactNode;
  footerRight?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, position: 'relative' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'flex-end',
          height: `${TAB_H}px`,
          paddingRight: '6px',
        }}
      >
        {aside}
      </div>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          background: OG_COLORS.bgSecondary,
          border: `1px solid ${OG_COLORS.borderMedium}`,
          borderRadius: `${OG_RADIUS.card}px`,
          // The tab sits over the top-left corner's straight run, clear of
          // the curve, as the site's tabs are inset by the card radius.
          borderTopLeftRadius: `${OG_RADIUS.control}px`,
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            padding: `${PANEL_PAD - 4}px ${PANEL_PAD}px`,
          }}
        >
          {children}
        </div>
        {(footerLeft || footerRight) && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '32px',
              padding: `20px ${PANEL_PAD}px`,
              background: OG_COLORS.surfaceSubtle,
              borderTop: `1px solid ${OG_COLORS.borderSubtle}`,
              borderBottomLeftRadius: `${OG_RADIUS.card - 1}px`,
              borderBottomRightRadius: `${OG_RADIUS.card - 1}px`,
            }}
          >
            {footerLeft ?? <div style={{ display: 'flex' }} />}
            {footerRight ?? <div style={{ display: 'flex' }} />}
          </div>
        )}
      </div>
      <div style={{ display: 'flex', position: 'absolute', top: 0, left: 0 }}>
        <FolderTab icon={tabIcon}>{tab}</FolderTab>
      </div>
    </div>
  );
}

/**
 * Footer CTA in the site's text-link style (.fn-home-textlink): green, 600,
 * a trailing arrow.
 */
export function FooterCta({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        flexShrink: 0,
        fontSize: '22px',
        fontWeight: 600,
        color: OG_COLORS.accent,
      }}
    >
      <span style={{ display: 'flex' }}>{children}</span>
      <ArrowRight size={22} color={OG_COLORS.accent} />
    </div>
  );
}

/**
 * Counts as the site's profile card sets them: the number in 700 ink, the
 * label in secondary, a middle dot between each.
 */
export function StatLine({ stats, size = 22 }: { stats: [number, string][]; size?: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'baseline', gap: '14px', fontSize: `${size}px` }}>
      {stats.map(([count, label], i) => (
        <div key={label} style={{ display: 'flex', alignItems: 'baseline', gap: '14px' }}>
          {i > 0 && <span style={{ display: 'flex', color: OG_COLORS.textFaint }}>·</span>}
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '7px' }}>
            <span style={{ display: 'flex', fontWeight: 700, color: OG_COLORS.textPrimary }}>
              {count.toLocaleString()}
            </span>
            <span style={{ display: 'flex', color: OG_COLORS.textSecondary }}>{label}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Avatar well: the image when there is one, else `fallback` on the inset
 * tone. Profiles are round on the site; lists and feeds are rounded squares.
 */
export function Avatar({
  src,
  size,
  shape = 'round',
  fallback,
}: {
  src?: string;
  size: number;
  shape?: 'round' | 'square';
  fallback?: ReactNode;
}) {
  const radius = shape === 'round' ? size / 2 : Math.round(size * 0.18);
  return (
    <div
      style={{
        width: `${size}px`,
        height: `${size}px`,
        flexShrink: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: OG_COLORS.bgTertiary,
        border: `1px solid ${OG_COLORS.borderMedium}`,
        borderRadius: `${radius}px`,
        overflow: 'hidden',
      }}
    >
      {src ? (
        <img
          src={src}
          alt=""
          width={size}
          height={size}
          style={{ width: `${size}px`, height: `${size}px`, objectFit: 'cover' }}
        />
      ) : (
        fallback
      )}
    </div>
  );
}

/** Lucide user glyph, for an avatar well with no image. */
export function PersonGlyph({ size = 30, color = OG_COLORS.textTertiary }: IconProps = {}) {
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
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
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

/** Lucide link glyph, beside a universal-link URL. */
export function LinkGlyph({ size = 18, color = OG_COLORS.accent }: IconProps = {}) {
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
      style={{ flexShrink: 0 }}
    >
      <path d="M9 17H7A5 5 0 0 1 7 7h2" />
      <path d="M15 7h2a5 5 0 1 1 0 10h-2" />
      <line x1="8" y1="12" x2="16" y2="12" />
    </svg>
  );
}

/**
 * The explore card's headline unit: a shrink-wrapped mono chip carrying one
 * segment of an AT URI (a handle, an NSID, an rkey), in the soft code-chip
 * style the site sets identifiers in — an off-white well, a hairline, a
 * control radius.
 *
 * Every chip wears identical chrome, so the only things separating them are
 * size and text colour. That keeps the hierarchy readable at unfurl scale:
 * the segment the route actually points at is the biggest and the darkest,
 * and everything above it steps back.
 */
export function IdentityChip({
  text,
  size,
  tone = 'primary',
  icon,
}: {
  text: string;
  size: number;
  /** Distance from the leaf: `primary` is the leaf, then `accent`, then `muted`. */
  tone?: 'primary' | 'accent' | 'muted';
  icon?: ReactNode;
}) {
  const color =
    tone === 'accent'
      ? OG_COLORS.accent
      : tone === 'muted'
      ? OG_COLORS.textTertiary
      : OG_COLORS.textPrimary;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: `${Math.round(size * 0.3)}px`,
        padding: `${Math.round(size * 0.2)}px ${Math.round(size * 0.34)}px`,
        background: OG_COLORS.surfaceSubtle,
        border: `1px solid ${OG_COLORS.borderMedium}`,
        borderRadius: `${Math.max(8, Math.round(size * 0.2))}px`,
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
 * Path separator set outside the chips, between one segment and the next.
 * The chips stack rather than run inline (an NSID at headline size is wider
 * than the card), so the slash is what tells you you're reading a trail.
 */
export function ChipSlash({ size }: { size: number }) {
  return (
    <div
      style={{
        display: 'flex',
        flexShrink: 0,
        fontFamily: 'IBM Plex Mono',
        fontSize: `${Math.round(size * 0.86)}px`,
        fontWeight: 500,
        color: OG_COLORS.textFaint,
        lineHeight: 1.1,
      }}
    >
      /
    </div>
  );
}

// ─── Waypoint icon SVGs ────────────────────────────────────────────────────
// Inlined from src/utils/waypointIcons.tsx so the OG route doesn't have to
// import the full catalog into the edge bundle. Each accepts a size + color.
// Only the marks a card draws live here; the static route imports Anisota's
// full logo directly, since the one-path stand-in here smudged at row size.

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

/**
 * Right arrow for "Open in …" CTAs. Inline SVG rather than a literal '→':
 * Figtree's subset has no glyph for it, and Satori's dynamic-font request
 * for the arrows block 400s and kills the whole image.
 */
export function ArrowRight({ size = 22, color = 'currentColor' }: { size?: number; color?: string } = {}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={2.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      <line x1="5" y1="12" x2="19" y2="12" />
      <polyline points="12 5 19 12 12 19" />
    </svg>
  );
}

/**
 * Headline + subhead block used by every product OG, in the landing pages'
 * title style (.fl-title): Figtree 800, tight tracking, with the closing
 * phrase in green (.fl-title-accent).
 *
 * Title may contain '\n' newlines — each becomes its own line (we split
 * explicitly so line-height stays predictable). A line wrapped in asterisks
 * ("*the Atmosphere.*") is set in the accent. Whole lines rather than
 * phrases, because Satori lays each styled run out as its own flex item and
 * cannot flow one run into the next mid-line.
 */
export function Headline({
  title,
  tagline,
  size = 74,
  taglineSize,
}: {
  title: string;
  tagline?: string;
  /** Display size. Split layouts pass a smaller value to fit a half-width column. */
  size?: number;
  taglineSize?: number;
}) {
  const lines = title.split('\n').map((line) => {
    const accent = line.length > 2 && line.startsWith('*') && line.endsWith('*');
    return { text: accent ? line.slice(1, -1) : line, accent };
  });
  const subSize = taglineSize ?? Math.max(22, Math.round(size * 0.36));
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          fontSize: `${size}px`,
          fontWeight: 800,
          letterSpacing: '-0.035em',
          lineHeight: 1.06,
        }}
      >
        {lines.map((line, i) => (
          <div
            key={i}
            style={{
              display: 'flex',
              color: line.accent ? OG_COLORS.accent : OG_COLORS.textPrimary,
            }}
          >
            {line.text}
          </div>
        ))}
      </div>
      {tagline && (
        <div
          style={{
            marginTop: `${Math.round(size * 0.32)}px`,
            fontSize: `${subSize}px`,
            fontWeight: 400,
            color: OG_COLORS.textSecondary,
            lineHeight: 1.5,
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
