/**
 * The share button builder's logic: one piece of text, and the link that
 * opens each client's composer with it.
 *
 * Bluesky defined the route (`/intent/compose?text=…`, see
 * https://docs.bsky.app/docs/advanced-guides/intent-links) and the clients
 * built on its app inherit it. Which clients have one, and whether each reads
 * the text, comes from the waypoint catalog (src/utils/waypoints.data.ts) and
 * nowhere else: an entry is only added there once the client's own route has
 * been confirmed, and a link to a client without one lands on a 404.
 *
 * Pure, so the page and the tests share it.
 */

import {
  getComposeIntentAppUrl,
  getComposeIntentUrl,
  getComposeIntentWaypoints,
} from '@/utils/waypoints.data';

/** Bluesky's post limit, in grapheme clusters. */
export const POST_GRAPHEME_LIMIT = 300;

/**
 * Count what a reader would call characters: an emoji with a skin tone, or a
 * family joined by zero-width joiners, is one. Falls back to code points
 * where the runtime has no segmenter, which over-counts those and nothing
 * else.
 */
export function countGraphemes(text: string): number {
  if (!text) return 0;
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(text)].length;
  }
  return [...text].length;
}

/**
 * The post: the text, then the link on a line of its own, as the example in
 * Bluesky's own intent-link guide puts them together.
 */
export function composeText(text: string, url: string): string {
  return [text.trim(), url.trim()].filter(Boolean).join('\n');
}

/** Why a link is not one to share, or null when it is fine (or absent). */
export function shareUrlProblem(url: string): string | null {
  const value = url.trim();
  if (!value) return null;
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 'That is not a full address. Start it with https://.';
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return 'A link to share has to be an http or https address.';
  }
  return null;
}

export type ShareTarget = {
  /** The waypoint id, which also keys its icon. */
  id: string;
  name: string;
  /** The link that opens the client's composer. */
  url: string;
  /** The same intent as a deep link into the client's own app, when it has one. */
  appUrl: string | null;
  /** False when the client opens its composer but ignores the text. */
  prefillsText: boolean;
};

/** Every client with a compose route, in catalog order, with `post` filled in. */
export function shareTargets(post: string): ShareTarget[] {
  return getComposeIntentWaypoints().map((waypoint) => ({
    id: waypoint.id,
    name: waypoint.name,
    url: getComposeIntentUrl(waypoint, post) as string,
    appUrl: getComposeIntentAppUrl(waypoint, post),
    prefillsText: Boolean(waypoint.composeIntent?.textParam),
  }));
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** A plain link, to style however the page it goes on is styled. */
export function anchorSnippet(target: Pick<ShareTarget, 'url'>, label: string): string {
  return `<a href="${escapeHtml(target.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
}

/**
 * The inline style of the self-contained button. Shared with the page's
 * preview, so what is shown is what the snippet draws. The green is the
 * site's moss, which holds white text and reads on a light page or a dark
 * one, since the snippet cannot know which it will land on.
 */
export const SHARE_BUTTON_STYLE = {
  display: 'inline-flex',
  alignItems: 'center',
  padding: '9px 16px',
  borderRadius: '8px',
  background: '#3f5e2e',
  color: '#ffffff',
  font: '600 14px/1.2 system-ui, -apple-system, sans-serif',
  textDecoration: 'none',
} as const;

const SHARE_BUTTON_CSS =
  'display:inline-flex;align-items:center;padding:9px 16px;border-radius:8px;background:#3f5e2e;color:#ffffff;font:600 14px/1.2 system-ui,-apple-system,sans-serif;text-decoration:none';

/** The same link, carrying its own styling, for a page with no stylesheet to lean on. */
export function buttonSnippet(target: Pick<ShareTarget, 'url'>, label: string): string {
  return [
    `<a href="${escapeHtml(target.url)}" target="_blank" rel="noopener noreferrer"`,
    `   style="${SHARE_BUTTON_CSS}">${escapeHtml(label)}</a>`,
  ].join('\n');
}
