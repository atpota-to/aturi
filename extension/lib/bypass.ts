import type { RedirectRule } from './rules';

/**
 * Priority for redirect-bypass `allow` rules. Auto-redirect rules are emitted
 * at priority 1 (see `buildRules`), so anything above that wins. We also rely
 * on DNR's action-type precedence (`allow` beats `redirect` at equal
 * priority), but set an explicit higher number so the intent is obvious and
 * robust regardless of how the rulesets are merged.
 */
export const BYPASS_RULE_PRIORITY = 100;

/** Escape a string for safe literal use inside a DNR `regexFilter` (RE2). */
function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Build a session-scoped declarativeNetRequest `allow` rule that exempts a
 * single, exact URL from auto-redirect.
 *
 * This is the mechanism behind "an explicit pick in the popup always wins": a
 * standing redirect rule rewrites links *by pattern* (e.g. every bsky.app post
 * to your preferred client), and that pattern can match the very destination
 * the user just chose from the popup. Arming this allow-rule for the chosen
 * URL right before we open it keeps DNR from hijacking that one navigation,
 * while leaving ordinary link clicks fully redirected.
 *
 * The match is anchored to the exact URL (with an optional trailing fragment,
 * since DNR drops the fragment before matching) so the exemption is as narrow
 * as possible — it can never accidentally allow some other page through.
 */
export function buildBypassRule(url: string, id: number): RedirectRule {
  const hashIndex = url.indexOf('#');
  const base = hashIndex === -1 ? url : url.slice(0, hashIndex);
  return {
    id,
    priority: BYPASS_RULE_PRIORITY,
    action: { type: 'allow' as chrome.declarativeNetRequest.RuleActionType },
    condition: {
      regexFilter: `^${escapeRegExp(base)}(?:#.*)?$`,
      resourceTypes: ['main_frame'] as chrome.declarativeNetRequest.ResourceType[],
    },
  };
}
