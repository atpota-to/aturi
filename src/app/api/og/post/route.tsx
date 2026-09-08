import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';
import { fetchImageAsDataUrl } from '@/lib/og-image';
import {
  BrandMark,
  FooterCta,
  loadGoogleFont,
  OgFooter,
  OgFrame,
  OG_COLORS,
  OG_GLYPH_BASELINE,
  sanitizeOgText,
} from '@/lib/og-design';
import { getEmbedImages } from '@/utils/postEmbeds';
import type { ReactNode } from 'react';

export const runtime = 'edge';
export const revalidate = 3600; // Cache for 1 hour

// ─── Layout budget ──────────────────────────────────────────────────────────
// Satori has no overflow-driven reflow: a block that doesn't fit simply paints
// over its neighbours, which is what made every media variant of this card
// collide with the stats row. So the space is divided up front — the media rail
// is a fixed box, the text column takes what's left, and the copy is truncated
// to what that column can actually hold.

// Byline and copy share a column with the media rail rather than sitting in a
// band above it, and the two are centred against each other — so a tall photo
// no longer starts level with the wordmark while the text it belongs to floats
// off in the corner. Folding the byline in also freed ~90px of height, which
// goes to the rail.
const MEDIA_W = 420;
const MEDIA_H = 340;
const TEXT_COL_W = 1060 - MEDIA_W - 28;

/**
 * Trim to a word boundary near `max`, dropping trailing punctuation so the
 * ellipsis doesn't land as "further.…".
 */
function clamp(text: string, max: number): string {
  if (text.length <= max) return text;
  const slice = text.slice(0, max);
  const lastSpace = slice.lastIndexOf(' ');
  const cut = lastSpace > max * 0.6 ? slice.slice(0, lastSpace) : slice;
  return `${cut.replace(/[\s.,;:!?·|—-]+$/, '')}…`;
}

// ─── Glyphs ─────────────────────────────────────────────────────────────────
// Inline SVG rather than emoji: a glyph Crimson Pro doesn't carry sends Satori
// to Google Fonts for a dynamic subset, which 400s and kills the whole image.

function PersonGlyph({ size = 30 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={OG_COLORS.accent}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

function QuoteGlyph({ size = 18 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={OG_COLORS.accent}
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      <path d="M10 4v6a6 6 0 0 1-6 6H3v-3h1a3 3 0 0 0 3-3H4V4zm10 0v6a6 6 0 0 1-6 6h-1v-3h1a3 3 0 0 0 3-3h-3V4z" />
    </svg>
  );
}

function ReplyGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={OG_COLORS.accent}
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      xmlns="http://www.w3.org/2000/svg"
      style={{ flexShrink: 0 }}
    >
      <path d="M15 10 L20 15 L15 20" />
      <path d="M4 4v7a4 4 0 0 0 4 4h12" />
    </svg>
  );
}

function LinkGlyph({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={OG_COLORS.accent}
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

function PlayBadge() {
  return (
    <div
      style={{
        position: 'absolute',
        top: `${Math.round(MEDIA_H / 2) - 32}px`,
        left: `${Math.round(MEDIA_W / 2) - 32}px`,
        width: '64px',
        height: '64px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(10, 10, 10, 0.72)',
        border: `1px solid ${OG_COLORS.borderAccent}`,
      }}
    >
      <svg width="26" height="26" viewBox="0 0 24 24" fill={OG_COLORS.accent} xmlns="http://www.w3.org/2000/svg">
        <path d="M8 5v14l11-7z" />
      </svg>
    </div>
  );
}

// ─── Route ────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const identifier = searchParams.get('handle'); // A DID, or a handle
    const rkey = searchParams.get('rkey');

    if (!identifier || !rkey) {
      return new Response('Missing parameters', { status: 400 });
    }

    const apiUrl = process.env.NEXT_PUBLIC_BSKY_API_URL || 'https://public.api.bsky.app';

    let postData = null;
    let authorData = null;
    let post = null;
    let parentNode = null;
    let likeCount = 0;
    let replyCount = 0;
    let repostCount = 0;

    try {
      const uri = `at://${identifier}/app.bsky.feed.post/${rkey}`;
      // parentHeight=1 buys the one post a reply needs for context; depth=0
      // drops the reply subtree, which this card never reads and which the
      // endpoint otherwise returns six levels deep.
      const response = await fetch(
        `${apiUrl}/xrpc/app.bsky.feed.getPostThread` +
          `?uri=${encodeURIComponent(uri)}&depth=0&parentHeight=1`,
        {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(5000),
          next: { revalidate: 3600 },
        },
      );

      if (response.ok) {
        const data = await response.json();
        post = data.thread?.post;
        parentNode = data.thread?.parent;
        postData = post?.record;
        authorData = post?.author;
        likeCount = post?.likeCount || 0;
        replyCount = post?.replyCount || 0;
        repostCount = post?.repostCount || 0;
      }
    } catch (error) {
      console.error('[OG Post] Error fetching post:', error);
    }

    // No post means no card worth showing — a card built from a raw DID with
    // zeroed counts looks broken. Fall back to the branded static card.
    if (!post) {
      return Response.redirect(new URL('/api/og/static', request.url), 302);
    }

    const displayName = sanitizeOgText(authorData?.displayName || authorData?.handle || identifier);
    const handleName = sanitizeOgText(authorData?.handle || identifier);
    const postText = sanitizeOgText(postData?.text || '');
    const avatarUrl = authorData?.avatar || '';

    // ── Embed shape ──────────────────────────────────────────────────────
    type Media = {
      kind: 'images' | 'video' | 'external';
      imageUrl: string;
      title?: string;
      host?: string;
    };
    type Quote = { author: string; text: string };

    // Structural shapes for the bits of the hydrated embed views this card
    // reads. The appview response is untyped here, so declare only the fields
    // we touch rather than reaching for `any`.
    type QuotedRecord = {
      author?: { displayName?: string; handle?: string };
      value?: { text?: string };
      record?: { text?: string };
    };
    type EmbedView = {
      $type?: string;
      external?: { thumb?: string; title?: string; uri?: string };
      thumbnail?: string;
      media?: EmbedView;
      record?: QuotedRecord & { record?: QuotedRecord };
    };

    const readMedia = (view: EmbedView | undefined): Media | null => {
      if (!view) return null;

      const images = getEmbedImages(view);
      if (images && images.length > 0 && images[0].thumb) {
        return { kind: 'images', imageUrl: images[0].thumb };
      }

      if (view.$type === 'app.bsky.embed.external#view' && view.external) {
        let host: string | undefined;
        try {
          host = new URL(view.external.uri || '').hostname.replace(/^www\./, '');
        } catch {
          host = undefined;
        }
        return {
          kind: 'external',
          imageUrl: view.external.thumb || '',
          title: sanitizeOgText(view.external.title || ''),
          host,
        };
      }

      if (view.$type === 'app.bsky.embed.video#view' && view.thumbnail) {
        return { kind: 'video', imageUrl: view.thumbnail };
      }

      return null;
    };

    const readQuote = (record: QuotedRecord | undefined): Quote | null => {
      if (!record) return null;
      const text = sanitizeOgText(record.value?.text || record.record?.text || '');
      if (!text) return null;
      return {
        author: sanitizeOgText(record.author?.displayName || record.author?.handle || 'Unknown'),
        text,
      };
    };

    const embed: EmbedView | undefined = post?.embed;
    let media: Media | null = null;
    let quote: Quote | null = null;

    if (embed) {
      if (embed.$type === 'app.bsky.embed.record#view') {
        quote = readQuote(embed.record);
      } else if (embed.$type === 'app.bsky.embed.recordWithMedia#view') {
        // recordWithMedia is a quote *and* media. The old card read the media
        // and silently dropped the post being quoted.
        media = readMedia(embed.media);
        quote = readQuote(embed.record?.record);
      } else {
        media = readMedia(embed);
      }
    }

    const hasMedia = Boolean(media);
    const hasQuote = Boolean(quote);

    // ── Reply context ────────────────────────────────────────────────────
    // Shared out of context a reply reads as a non-sequitur: "post em!!" over
    // a byline and three zeroed counters. The card names the relationship in
    // the chip that used to hold a generic "Bluesky post" label, so the whole
    // body stays with the post itself.
    type ThreadNode = {
      $type?: string;
      post?: { author?: { displayName?: string; handle?: string } };
    };

    const replyRef = (postData as { reply?: { parent?: { uri?: string } } } | null)?.reply;
    const isReply = Boolean(replyRef?.parent?.uri);
    // The parent's DID is the authority of its AT-URI, so a self-thread is
    // recognizable even when the parent itself never came back — which is what
    // happens when it has been deleted, blocked, or detached.
    const parentDid = /^at:\/\/([^/]+)\//.exec(replyRef?.parent?.uri || '')?.[1] || '';
    const isSelfThread = isReply && Boolean(parentDid) && parentDid === authorData?.did;

    const parentPost = (parentNode as ThreadNode | null)?.post;
    // Falling back to the handle needs the @: bare, "cppilgram.bsky.social"
    // reads as a domain rather than a person.
    const parentDisplay = sanitizeOgText(parentPost?.author?.displayName || '');
    const parentHandle = sanitizeOgText(parentPost?.author?.handle || '');
    const parentAuthor = parentDisplay || (parentHandle ? `@${parentHandle}` : '');

    // Three shapes, in the order they degrade: name whoever is being answered;
    // failing that say it's a thread; failing that just say it's a reply.
    const namesParent = isReply && !isSelfThread && Boolean(parentAuthor);
    const chipLabel = !isReply
      ? 'Bluesky post'
      : isSelfThread
        ? 'Continuing a thread'
        : namesParent
          ? 'Replying to'
          : 'Bluesky reply';
    const chipName = namesParent ? clamp(parentAuthor, 40) : '';

    // Budget the text column: media steals half the width, a quote steals
    // half the height, and both together leave room for a line or two.
    const textCap = hasMedia && hasQuote ? 90 : hasMedia || hasQuote ? 150 : 260;
    const truncatedText = clamp(postText, textCap);
    const quoteText = quote ? clamp(quote.text, hasMedia ? 70 : 120) : '';

    // A text-only post has the whole card to itself, so let it run larger.
    const textSize =
      (truncatedText.length > 150 ? 26 : truncatedText.length > 80 ? 29 : 32) +
      (!hasMedia && !hasQuote ? 4 : 0);

    const [avatarDataUrl, embedImageDataUrl] = await Promise.all([
      fetchImageAsDataUrl(avatarUrl),
      fetchImageAsDataUrl(media?.imageUrl),
    ]);

    const allText =
      `${displayName} @${handleName} ${truncatedText} ${quoteText} ${quote?.author || ''} ` +
      `${media?.title || ''} ${media?.host || ''} ${chipLabel} ${chipName} ` +
      `${likeCount.toLocaleString()} ${repostCount.toLocaleString()} ${replyCount.toLocaleString()} ` +
      'likes reposts replies Choose where to view aturi.to ' +
      OG_GLYPH_BASELINE;

    const [crimsonData, monoData] = await Promise.all([
      loadGoogleFont('Crimson+Pro:wght@300;400;600', allText),
      loadGoogleFont(
        'IBM+Plex+Mono:wght@500',
        `@${handleName} ${likeCount.toLocaleString()} ${repostCount.toLocaleString()} ` +
          `${replyCount.toLocaleString()} ${media?.host || ''} , . : / - _ ` +
          OG_GLYPH_BASELINE,
      ),
    ]);

    // ── Media rail ────────────────────────────────────────────────────────
    const isLinkCard = media?.kind === 'external';
    // Two lines of 21px title (26px each) + 32px padding + 8px gap + a 21px
    // domain line. Undersizing this is what pushed the domain onto the title.
    const linkStripH = isLinkCard ? 116 : 0;
    const imageH = MEDIA_H - linkStripH;

    const mediaRail: ReactNode = hasMedia ? (
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          flexShrink: 0,
          width: `${MEDIA_W}px`,
          height: `${MEDIA_H}px`,
          position: 'relative',
          overflow: 'hidden',
          background: OG_COLORS.bgSecondary,
          border: `1px solid ${OG_COLORS.borderSubtle}`,
        }}
      >
        {embedImageDataUrl && (
          <img
            src={embedImageDataUrl}
            alt=""
            width={MEDIA_W}
            height={imageH}
            style={{
              width: `${MEDIA_W}px`,
              height: `${imageH}px`,
              objectFit: 'cover',
            }}
          />
        )}
        {media?.kind === 'video' && embedImageDataUrl && <PlayBadge />}
        {isLinkCard && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '8px',
              height: `${linkStripH}px`,
              padding: '16px 18px',
              background: OG_COLORS.bgTertiary,
              borderTop: `1px solid ${OG_COLORS.borderSubtle}`,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: '21px',
                lineHeight: 1.25,
                color: OG_COLORS.textPrimary,
              }}
            >
              {clamp(media?.title || 'External link', 52)}
            </div>
            {media?.host && (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '8px',
                  fontFamily: 'IBM Plex Mono',
                  fontSize: '15px',
                  fontWeight: 500,
                  color: OG_COLORS.textTertiary,
                }}
              >
                <LinkGlyph size={15} />
                <span style={{ display: 'flex' }}>{media.host}</span>
              </div>
            )}
          </div>
        )}
      </div>
    ) : null;

    const content: ReactNode = (
      <OgFrame>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            flex: 1,
            gap: '24px',
            position: 'relative',
            zIndex: 1,
          }}
        >
          {/* Top row, reversed against the other cards: what the post *is*
              leads, the wordmark follows. A shared eyebrow reading "Bluesky
              post" was worth less than the corner it sat in. */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '32px',
              position: 'relative',
              zIndex: 1,
            }}
          >
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '13px',
                padding: '9px 18px 9px 15px',
                background: OG_COLORS.bgTertiary,
                border: `1px solid ${isReply ? OG_COLORS.borderAccent : OG_COLORS.borderSubtle}`,
              }}
            >
              {isReply && <ReplyGlyph size={17} />}
              <span
                style={{
                  display: 'flex',
                  fontFamily: 'IBM Plex Mono',
                  fontSize: '15px',
                  fontWeight: 500,
                  letterSpacing: '0.14em',
                  textTransform: 'uppercase',
                  color: isReply ? OG_COLORS.accent : OG_COLORS.textTertiary,
                }}
              >
                {chipLabel}
              </span>
              {chipName && (
                <span style={{ display: 'flex', fontSize: '21px', color: OG_COLORS.textPrimary }}>
                  {chipName}
                </span>
              )}
            </div>
            <BrandMark size={22} />
          </div>

          {/* Body — byline and copy on the left, media on a fixed right rail.
              alignItems: center puts the two columns on one axis, so the
              byline sits level with the middle of a tall photo instead of
              level with its top edge. */}
          <div
            style={{
              display: 'flex',
              flex: 1,
              gap: '28px',
              alignItems: 'center',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                flex: 1,
                gap: '20px',
                minWidth: 0,
                overflow: 'hidden',
              }}
            >
              {/* Byline */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
                <div
                  style={{
                    width: '64px',
                    height: '64px',
                    flexShrink: 0,
                    background: OG_COLORS.bgTertiary,
                    border: `1px solid ${OG_COLORS.borderMedium}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {avatarDataUrl ? (
                    <img
                      src={avatarDataUrl}
                      alt=""
                      width={64}
                      height={64}
                      style={{ width: '64px', height: '64px', objectFit: 'cover' }}
                    />
                  ) : (
                    <PersonGlyph size={30} />
                  )}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                  <div style={{ display: 'flex', fontSize: '30px', fontWeight: 400 }}>
                    {displayName}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      fontFamily: 'IBM Plex Mono',
                      fontSize: '20px',
                      fontWeight: 500,
                      color: OG_COLORS.textTertiary,
                    }}
                  >
                    {'@' + handleName}
                  </div>
                </div>
              </div>

              {truncatedText && (
                <div
                  style={{
                    display: 'flex',
                    fontSize: `${textSize}px`,
                    lineHeight: 1.45,
                    fontWeight: 300,
                    color: OG_COLORS.textPrimary,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxWidth: hasMedia ? `${TEXT_COL_W}px` : '1060px',
                  }}
                >
                  {truncatedText}
                </div>
              )}

              {hasQuote && (
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    gap: '8px',
                    padding: '18px 22px',
                    background: OG_COLORS.bgSecondary,
                    border: `1px solid ${OG_COLORS.borderSubtle}`,
                    borderLeft: `3px solid ${OG_COLORS.borderAccent}`,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '9px',
                      fontSize: '20px',
                      color: OG_COLORS.accent,
                    }}
                  >
                    <QuoteGlyph size={17} />
                    <span style={{ display: 'flex' }}>{quote?.author}</span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      fontSize: '22px',
                      lineHeight: 1.4,
                      fontWeight: 300,
                      color: OG_COLORS.textSecondary,
                      whiteSpace: 'pre-wrap',
                    }}
                  >
                    {quoteText}
                  </div>
                </div>
              )}
            </div>

            {mediaRail}
          </div>

          <OgFooter
            left={
              <div style={{ display: 'flex', gap: '26px', fontSize: '20px', fontWeight: 300 }}>
                {[
                  [likeCount, 'likes'],
                  [repostCount, 'reposts'],
                  [replyCount, 'replies'],
                ].map(([count, label]) => (
                  <div
                    key={label as string}
                    style={{ display: 'flex', alignItems: 'baseline', gap: '7px', color: OG_COLORS.textSecondary }}
                  >
                    <span
                      style={{
                        display: 'flex',
                        fontFamily: 'IBM Plex Mono',
                        fontSize: '20px',
                        fontWeight: 500,
                        color: OG_COLORS.accent,
                      }}
                    >
                      {(count as number).toLocaleString()}
                    </span>
                    <span style={{ display: 'flex' }}>{label}</span>
                  </div>
                ))}
              </div>
            }
            right={<FooterCta>Choose where to view</FooterCta>}
          />
        </div>
      </OgFrame>
    );

    const imageResponse = new ImageResponse(content, {
      width: 1200,
      height: 630,
      fonts: [
        { name: 'Crimson Pro', data: crimsonData, weight: 300, style: 'normal' },
        { name: 'IBM Plex Mono', data: monoData, weight: 500, style: 'normal' },
      ],
    });

    imageResponse.headers.set(
      'Cache-Control',
      'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
    );

    return imageResponse;
  } catch (error) {
    console.error('[OG Post] Error generating OG image:', error);
    // Serve the branded static card instead of a broken image (and stop
    // echoing internal error messages to the client).
    return Response.redirect(new URL('/api/og/static', request.url), 302);
  }
}
