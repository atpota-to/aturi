import { ImageResponse } from '@vercel/og';
import { NextRequest } from 'next/server';
import { fetchImageAsDataUrl } from '@/lib/og-image';
import {
  Avatar,
  BlueskyIcon,
  BrandMark,
  Folder,
  FooterCta,
  LinkGlyph,
  loadOgFonts,
  OgFrame,
  OG_COLORS,
  OG_RADIUS,
  PANEL_CONTENT_W,
  PersonGlyph,
  sanitizeOgText,
  StatLine,
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
const MEDIA_H = 330;
const TEXT_COL_W = PANEL_CONTENT_W - MEDIA_W - 28;
/** The byline row (a 58px avatar) and the gap under it. */
const BYLINE_H = 58 + 18;

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

/**
 * Fit text to a line budget on top of clamp's character cap.
 *
 * A character cap alone does not bound height: line breaks do, and a post
 * written as short paragraphs overflowed the sheet at well under the cap,
 * which with the body centred pushed the byline out through the top. Blank
 * lines between paragraphs are folded away (each one costs a whole line on a
 * card with five to spare), then paragraphs are kept while their estimated
 * wrapped lines fit, and the first that does not is clamped into the rest.
 * `perLine` is an estimate, so pass a conservative one: words wrap whole.
 */
function fitLines(text: string, { maxLines, perLine }: { maxLines: number; perLine: number }): string {
  const paragraphs = text.replace(/\n\s*\n+/g, '\n').trim().split('\n');
  const out: string[] = [];
  let used = 0;
  for (const para of paragraphs) {
    const need = Math.max(1, Math.ceil(para.length / perLine));
    if (used + need <= maxLines) {
      out.push(para);
      used += need;
      continue;
    }
    const room = maxLines - used;
    if (room > 0) {
      out.push(clamp(para, room * perLine));
    } else if (out.length > 0) {
      out[out.length - 1] = `${out[out.length - 1].replace(/[\s.,;:!?·|—…-]+$/, '')}…`;
    }
    break;
  }
  return out.join('\n');
}

/** Average Figtree advance as a share of the size, rounded up for safety. */
const FIGTREE_EM = 0.48;

// ─── Glyphs ─────────────────────────────────────────────────────────────────
// Inline SVG rather than emoji: a glyph Figtree doesn't carry sends Satori to
// Google Fonts for a dynamic subset, which 400s and kills the whole image.

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

function PlayBadge() {
  return (
    <div
      style={{
        position: 'absolute',
        top: `${Math.round(MEDIA_H / 2) - 34}px`,
        left: `${Math.round(MEDIA_W / 2) - 34}px`,
        width: '68px',
        height: '68px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: OG_COLORS.bgSecondary,
        border: `1px solid ${OG_COLORS.borderMedium}`,
        borderRadius: `${OG_RADIUS.pill}px`,
      }}
    >
      <svg width="28" height="28" viewBox="0 0 24 24" fill={OG_COLORS.accentFill} xmlns="http://www.w3.org/2000/svg">
        <path d="M9 5.5v13l10-6.5z" />
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
    const cappedText = clamp(postText, textCap);

    // A text-only post has the whole card to itself, so let it run larger.
    const textSize =
      (cappedText.length > 150 ? 24 : cappedText.length > 80 ? 27 : 30) +
      (!hasMedia && !hasQuote ? 4 : 0);

    // Then hold the copy to the lines the column has room for: the rail's
    // height, less the byline and any quote (two lines of quoted text).
    const textColW = hasMedia ? TEXT_COL_W : PANEL_CONTENT_W;
    const quoteLines = 2;
    const quoteH = hasQuote ? 18 + 30 + 29 + quoteLines * 28 : 0;
    const truncatedText = fitLines(cappedText, {
      maxLines: Math.max(1, Math.floor((MEDIA_H - BYLINE_H - quoteH) / (textSize * 1.45))),
      perLine: Math.floor(textColW / (textSize * FIGTREE_EM)),
    });
    const quoteText = quote
      ? fitLines(clamp(quote.text, hasMedia ? 70 : 120), {
          maxLines: quoteLines,
          perLine: Math.floor((textColW - 38) / (20 * FIGTREE_EM)),
        })
      : '';

    const [avatarDataUrl, embedImageDataUrl] = await Promise.all([
      fetchImageAsDataUrl(avatarUrl),
      fetchImageAsDataUrl(media?.imageUrl),
    ]);

    const stats: [number, string][] = [
      [likeCount, likeCount === 1 ? 'like' : 'likes'],
      [repostCount, repostCount === 1 ? 'repost' : 'reposts'],
      [replyCount, replyCount === 1 ? 'reply' : 'replies'],
    ];

    const fonts = await loadOgFonts(
      `${displayName} ${truncatedText} ${quoteText} ${quote?.author || ''} ` +
        `${media?.title || ''} ${chipLabel} ${chipName} Choose where to view ` +
        `${stats.map(([n, label]) => `${n.toLocaleString()} ${label}`).join(' ')}`,
      `@${handleName} ${media?.host || ''}`,
    );

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
          background: OG_COLORS.bgTertiary,
          border: `1px solid ${OG_COLORS.borderMedium}`,
          borderRadius: `${OG_RADIUS.control}px`,
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
        {/* A link card with no thumbnail (or one we could not decode) would
            otherwise leave an empty well above its title. */}
        {isLinkCard && !embedImageDataUrl && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              height: `${imageH}px`,
            }}
          >
            <LinkGlyph size={56} color={OG_COLORS.textFaint} />
          </div>
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
              background: OG_COLORS.surfaceSubtle,
              borderTop: `1px solid ${OG_COLORS.borderSubtle}`,
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'flex',
                fontSize: '20px',
                fontWeight: 600,
                lineHeight: 1.3,
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

    // The tab names what the post *is*: a post, or a reply and to whom. A
    // shared label reading "Bluesky post" was worth less than the corner it
    // sat in, so the tab carries the relationship instead.
    const tab: ReactNode = chipName ? (
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '9px' }}>
        <span style={{ display: 'flex', color: OG_COLORS.textSecondary, fontWeight: 500 }}>{chipLabel}</span>
        <span style={{ display: 'flex' }}>{chipName}</span>
      </div>
    ) : (
      chipLabel
    );

    const content: ReactNode = (
      <OgFrame>
        <Folder
          tab={tab}
          tabIcon={
            isReply ? <ReplyGlyph size={20} /> : <BlueskyIcon size={20} color={OG_COLORS.brandBluesky} />
          }
          aside={<BrandMark />}
          footerLeft={<StatLine stats={stats} />}
          footerRight={<FooterCta>Choose where to view</FooterCta>}
        >
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
                gap: '18px',
                minWidth: 0,
                overflow: 'hidden',
              }}
            >
              {/* Byline */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <Avatar src={avatarDataUrl} size={58} fallback={<PersonGlyph size={28} />} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', minWidth: 0 }}>
                  <div
                    style={{
                      display: 'flex',
                      fontSize: '27px',
                      fontWeight: 700,
                      letterSpacing: '-0.015em',
                      lineHeight: 1.15,
                    }}
                  >
                    {displayName}
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      fontFamily: 'IBM Plex Mono',
                      fontSize: '19px',
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
                    color: OG_COLORS.textPrimary,
                    whiteSpace: 'pre-wrap',
                    wordBreak: 'break-word',
                    maxWidth: hasMedia ? `${TEXT_COL_W}px` : `${PANEL_CONTENT_W}px`,
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
                    gap: '6px',
                    padding: '14px 18px',
                    background: OG_COLORS.surfaceSubtle,
                    border: `1px solid ${OG_COLORS.borderMedium}`,
                    borderRadius: `${OG_RADIUS.control}px`,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: '9px',
                      fontSize: '19px',
                      fontWeight: 700,
                      color: OG_COLORS.textPrimary,
                    }}
                  >
                    <QuoteGlyph size={16} />
                    <span style={{ display: 'flex' }}>{quote?.author}</span>
                  </div>
                  <div
                    style={{
                      display: 'flex',
                      fontSize: '20px',
                      lineHeight: 1.4,
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
        </Folder>
      </OgFrame>
    );

    const imageResponse = new ImageResponse(content, {
      width: 1200,
      height: 630,
      fonts,
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
