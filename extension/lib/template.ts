import type { WaypointType, WaypointData } from '@aturi/waypoints.data';
import type { ParsedURI } from '@aturi/uriParser';
import type { ReverseMatch } from '@aturi/reverseParsers';
import type { CustomWaypoint } from './prefs';

export type TemplateTokens = {
  handle: string;
  did?: string;
  collection?: string;
  rkey?: string;
  domain?: string;
};

const TOKEN_REGEX = /\{(handle|did|collection|rkey|domain)\}/g;

/**
 * Substitute `{handle}`, `{did}`, `{collection}`, `{rkey}`, `{domain}` tokens
 * in a template string. Missing tokens become empty strings.
 */
export function fillTemplate(template: string, tokens: TemplateTokens): string {
  return template.replace(TOKEN_REGEX, (_, key: keyof TemplateTokens) => {
    const value = tokens[key];
    return value ?? '';
  });
}

export type CompiledTemplate = {
  regex: RegExp;
  tokenOrder: Array<'handle' | 'did' | 'collection' | 'rkey' | 'domain'>;
  substitution: string;
};

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Strip a trailing `/` from a path/template, leaving a bare `/` alone so we
 * don't accidentally turn the root into the empty string.
 */
function stripTrailingSlash(input: string): string {
  if (input.length > 1 && input.endsWith('/')) {
    return input.slice(0, -1);
  }
  return input;
}

/**
 * Compile a URL template into a regex that can match real URLs against it
 * (used for both reverse detection and for generating DNR regexSubstitution
 * strings). The returned `regex` has one capture group per token in order,
 * and `substitution` is the template with `{handle}` etc. replaced by `\1`
 * backrefs suitable for declarativeNetRequest regexSubstitution.
 *
 * Trailing slashes are normalised: a template ending in `/` matches URLs
 * with or without one, and vice versa.
 */
export function templateToRegex(template: string): CompiledTemplate {
  const normalized = stripTrailingSlash(template);
  const tokenOrder: CompiledTemplate['tokenOrder'] = [];
  let regexSource = '';
  let substitution = '';
  let cursor = 0;

  const matches = [...normalized.matchAll(TOKEN_REGEX)];

  for (const match of matches) {
    const idx = match.index ?? 0;
    const literal = normalized.slice(cursor, idx);
    regexSource += escapeRegex(literal);
    substitution += literal;

    const token = match[1] as CompiledTemplate['tokenOrder'][number];
    tokenOrder.push(token);
    regexSource += '([^/?#]+)';
    substitution += `\\${tokenOrder.length}`;

    cursor = idx + match[0].length;
  }

  const tail = normalized.slice(cursor);
  regexSource += escapeRegex(tail);
  substitution += tail;

  const anchored = normalized === '/' ? `^${regexSource}$` : `^${regexSource}/?$`;
  return {
    regex: new RegExp(anchored),
    tokenOrder,
    substitution,
  };
}

/**
 * Try to reverse-match a URL against one of the user's custom waypoint
 * templates. Custom waypoints store only a path template per content type and
 * a `domain` - we join them to check the URL.
 */
export function matchCustomUrl(
  url: URL,
  customWaypoints: CustomWaypoint[]
): ReverseMatch | null {
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const pathAndSearch = `${stripTrailingSlash(url.pathname)}${url.search}`;

  for (const cw of customWaypoints) {
    const cwDomain = cw.domain.toLowerCase().replace(/^www\./, '');
    if (host !== cwDomain) continue;

    for (const type of cw.supportedTypes) {
      const template = cw.templates[type];
      if (!template) continue;

      const { regex, tokenOrder } = templateToRegex(template);
      const match = regex.exec(pathAndSearch);
      if (!match) continue;

      const tokens: Record<string, string | undefined> = {};
      for (let i = 0; i < tokenOrder.length; i++) {
        tokens[tokenOrder[i]] = match[i + 1];
      }

      const handle = tokens.handle ?? tokens.did ?? '';
      if (!handle) continue;
      const did = tokens.did ?? (handle.startsWith('did:') ? handle : undefined);
      const collection = tokens.collection;
      const rkey = tokens.rkey;

      let inferredType: ParsedURI['type'] = type;
      if (type === 'record' && !collection) inferredType = 'record';

      const parsed: ParsedURI = {
        type: inferredType,
        uri: collection && rkey
          ? `at://${handle}/${collection}/${rkey}`
          : `at://${handle}`,
        handle,
        did,
        collection,
        rkey,
      };

      return { source: cw.id as ReverseMatch['source'], parsed };
    }
  }

  return null;
}

/**
 * Build a synthetic WaypointData for a CustomWaypoint so it can be rendered
 * and routed through the same code paths as built-in waypoints.
 */
export function customWaypointToData(cw: CustomWaypoint): WaypointData {
  return {
    id: cw.id,
    name: cw.name,
    description: `View on ${cw.domain}`,
    supportedTypes: cw.supportedTypes,
    category: cw.category || 'custom',
    redirectCompat: cw.redirectCompat ?? [],
    getUrl: (handle, collection, rkey, did) => {
      let type: WaypointType = 'profile';
      if (collection === 'app.bsky.feed.post') type = 'post';
      else if (collection === 'app.bsky.graph.list') type = 'list';
      else if (collection && rkey) type = 'record';

      let template = cw.templates[type] ?? cw.templates.profile ?? cw.templates.record;
      if (!template) return null;
      if (!template.startsWith('/')) template = `/${template}`;

      const path = fillTemplate(template, {
        handle,
        did,
        collection,
        rkey,
        domain: cw.domain,
      });
      return `https://${cw.domain}${path}`;
    },
  };
}
