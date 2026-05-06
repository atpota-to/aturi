import { NextRequest, NextResponse } from 'next/server';
import { resolveHandle } from '@/utils/uriParser';
import { fetchPostThread } from '@/utils/recordFetcher';

export const runtime = 'edge';
export const revalidate = 3600;

/**
 * oEmbed endpoint that mirrors Bluesky's behavior so that rich-link previewers
 * (notably Apple's LinkPresentation framework used by iMessage/Mail) can render
 * a post-text-forward card with the avatar/author/source as a footer strip,
 * instead of treating the avatar as a hero image.
 *
 * Spec: https://oembed.com/
 */

type ParsedTarget = {
  identifier: string; // handle or did
  rkey: string;
};

/**
 * Parse an aturi.to or at:// URL into a post target.
 * Supported patterns:
 *  - https://aturi.to/profile/{handle}/post/{rkey}
 *  - https://aturi.to/{handle_or_did}/app.bsky.feed.post/{rkey}
 *  - at://{did}/app.bsky.feed.post/{rkey}
 */
function parseTarget(input: string): ParsedTarget | null {
  let raw = input.trim();
  if (!raw) return null;

  if (raw.startsWith('at://')) {
    const rest = raw.slice('at://'.length);
    const segments = rest.split('/').filter(Boolean);
    if (segments.length >= 3 && segments[1] === 'app.bsky.feed.post') {
      return { identifier: decodeURIComponent(segments[0]), rkey: decodeURIComponent(segments[2]) };
    }
    return null;
  }

  let urlObj: URL;
  try {
    urlObj = new URL(raw);
  } catch {
    return null;
  }

  const segments = urlObj.pathname.split('/').filter(Boolean);

  // /profile/{handle}/post/{rkey}
  if (segments[0] === 'profile' && segments[2] === 'post' && segments[1] && segments[3]) {
    let identifier = decodeURIComponent(segments[1]);
    if (identifier.startsWith('@')) identifier = identifier.slice(1);
    return { identifier, rkey: decodeURIComponent(segments[3]) };
  }

  // /{handle_or_did}/app.bsky.feed.post/{rkey}
  if (segments.length >= 3 && segments[1] === 'app.bsky.feed.post') {
    let identifier = decodeURIComponent(segments[0]);
    if (identifier.startsWith('@')) identifier = identifier.slice(1);
    return { identifier, rkey: decodeURIComponent(segments[2]) };
  }

  return null;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const targetUrl = searchParams.get('url');
  const format = (searchParams.get('format') || 'json').toLowerCase();
  const maxwidthParam = searchParams.get('maxwidth');

  // Bluesky's oEmbed spec: maxwidth in [220..550], default 325. maxheight unsupported.
  let maxwidth = 325;
  if (maxwidthParam) {
    const parsed = parseInt(maxwidthParam, 10);
    if (!Number.isNaN(parsed)) {
      maxwidth = Math.min(550, Math.max(220, parsed));
    }
  }

  if (!targetUrl) {
    return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
  }

  // oEmbed spec: servers must support json. xml is optional; we 501 it for now.
  if (format !== 'json') {
    return NextResponse.json(
      { error: 'Only json format is supported' },
      { status: 501 }
    );
  }

  const target = parseTarget(targetUrl);
  if (!target) {
    return NextResponse.json(
      { error: 'Unrecognized URL. Expected an aturi.to post URL or at:// post URI.' },
      { status: 404 }
    );
  }

  try {
    const did = await resolveHandle(target.identifier);
    if (!did) {
      return NextResponse.json({ error: 'Could not resolve identifier' }, { status: 404 });
    }

    const atUri = `at://${did}/app.bsky.feed.post/${target.rkey}`;
    const thread = await fetchPostThread(atUri);
    const post = thread?.thread?.[0]?.value?.post;

    if (!post) {
      return NextResponse.json({ error: 'Post not found' }, { status: 404 });
    }

    const author = post.author;
    const handle = author.handle;
    const displayName = author.displayName || handle;
    const postText = post.record?.text || '';
    const indexedAt = post.indexedAt || post.record?.createdAt || '';

    const profileUrl = `https://aturi.to/profile/${handle}`;

    const escapedText = escapeHtml(postText);
    const escapedDisplayName = escapeHtml(displayName);
    const escapedHandle = escapeHtml(handle);
    const escapedAtUri = escapeHtml(atUri);

    // Mirrors Bluesky's oEmbed html structure so that Apple LinkPresentation
    // (and inline-embed renderers) can construct a rich, post-text-forward
    // preview. The blockquote loads bsky.app's embed.js for full styling on
    // websites that render the html.
    const html = `<blockquote class="bluesky-embed" data-bluesky-uri="${escapedAtUri}" data-bluesky-cid="${escapeHtml(post.cid || '')}"><p lang="en">${escapedText}</p>&mdash; <a href="${escapeHtml(`https://bsky.app/profile/${did}?ref_src=embed`)}">${escapedDisplayName} (@${escapedHandle})</a> <a href="${escapeHtml(`https://bsky.app/profile/${did}/post/${target.rkey}?ref_src=embed`)}">${escapeHtml(indexedAt)}</a></blockquote><script async src="https://embed.bsky.app/static/embed.js" charset="utf-8"></script>`;

    // Match Bluesky's exact response shape: do NOT include title or
    // thumbnail_* — they alter how Apple LP renders the card.
    const body = {
      type: 'rich' as const,
      version: '1.0' as const,
      author_name: `${displayName} (@${handle})`,
      author_url: profileUrl,
      provider_name: 'Aturi',
      provider_url: 'https://aturi.to',
      cache_age: 86400,
      width: maxwidth,
      height: null,
      html,
    };

    return NextResponse.json(body, {
      headers: {
        'Cache-Control': 'public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (error) {
    console.error('[oEmbed] Error:', error);
    return NextResponse.json(
      { error: 'Internal error' },
      { status: 500 }
    );
  }
}
