/**
 * The pre-paint half of auto-redirect.
 *
 * A universal-link page emits this script inline, above its own content, so
 * the parser runs it before the picker exists to be painted. That timing is
 * the whole point: preferences live in localStorage (mirrored to the PDS by
 * `AutoRedirectSync`), which is readable synchronously, long before React
 * mounts or the OAuth session is restored from IndexedDB.
 *
 * Because the page emits it, the script gets the record's context for free and
 * the server can hand it destination URLs already resolved through the real
 * `getUrl` — so there is no second copy of any URL template here, and no path
 * allowlist to drift out of step with the router.
 *
 * It is a cut-down `resolveAutoRedirectTarget`: same family order, same
 * eligibility rules, minus custom waypoints (whose templates the server can't
 * see). When a custom waypoint is configured for a family it stops walking and
 * leaves the page hidden for `AutoRedirectGate` to finish, rather than
 * skipping past that family and landing somewhere the gate wouldn't have
 * chosen. A test asserts the two agree.
 *
 * Mirrors the shape of `COLOR_SCHEME_INIT_SCRIPT` in `src/lib/colorScheme.ts`:
 * a standalone string with every constant inlined, since it executes with no
 * access to this module's exports.
 */

import {
  AUTO_REDIRECT_BREADCRUMB_KEY,
  AUTO_REDIRECT_CACHE_KEY,
  AUTO_REDIRECT_STAY_PARAM,
  BREADCRUMB_TTL_MS,
  type AutoRedirectCandidate,
} from '@/utils/autoRedirect';
import { COMPAT_FAMILY_ORDER } from '@/utils/waypoints.data';
import { serializeJsonLd } from '@/utils/sanitize';

/** Set on <html> while a redirect is pending, so CSS can hide the page. */
export const AUTO_REDIRECT_ATTR = 'data-autoredirect';

export const AUTO_REDIRECT_ARMING = 'arming';

/**
 * How long the attribute may survive before it is torn down regardless.
 *
 * The page must never be able to stay hidden, so three independent things
 * guarantee it comes back: this timer, `AutoRedirectGate` clearing the
 * attribute whenever it decides not to redirect, and the script's own catch
 * block. Any one of them is sufficient; all three are cheap.
 */
export const AUTO_REDIRECT_FAILSAFE_MS = 2500;

/**
 * Build the inline script for one page's candidates.
 *
 * The payload is embedded through `serializeJsonLd`, which escapes `<`, `>`,
 * `&` and the line separators as `\uXXXX` — valid JavaScript string escapes,
 * so the object literal still evaluates, and no waypoint URL can close the
 * script element early.
 */
export function buildAutoRedirectScript(candidates: AutoRedirectCandidate[]): string {
  const payload = serializeJsonLd(
    candidates.map((c) => ({ i: c.id, u: c.url, f: c.families })),
  );
  const order = serializeJsonLd(COMPAT_FAMILY_ORDER);

  return `(function(){var d=document.documentElement;try{
var l=window.location;
if(new URLSearchParams(l.search).get(${JSON.stringify(AUTO_REDIRECT_STAY_PARAM)})==='1')return;
var n=performance.getEntriesByType&&performance.getEntriesByType('navigation');
if(n&&n[0]&&n[0].type==='back_forward')return;
var p=l.pathname,c=null;
try{c=sessionStorage.getItem(${JSON.stringify(AUTO_REDIRECT_BREADCRUMB_KEY)})}catch(e){}
if(c){try{var b=JSON.parse(c);if(b&&b.p===p&&typeof b.t==='number'&&Date.now()-b.t<${BREADCRUMB_TTL_MS})return}catch(e){}}
var r=null;try{r=localStorage.getItem(${JSON.stringify(AUTO_REDIRECT_CACHE_KEY)})}catch(e){}
if(!r)return;
var s=null;try{s=JSON.parse(r)}catch(e){}
if(!s||s.enabled!==true)return;
var f=s.byFamily||{},o=${order},a=${payload},hit=null,wait=false;
for(var i=0;i<o.length;i++){
var id=f[o[i]];
if(!id)continue;
if(id.indexOf('custom:')===0){wait=true;break}
for(var j=0;j<a.length;j++){if(a[j].i===id&&a[j].f.indexOf(o[i])>=0){hit=a[j];break}}
if(hit)break}
if(!hit&&!wait)return;
d.setAttribute(${JSON.stringify(AUTO_REDIRECT_ATTR)},${JSON.stringify(AUTO_REDIRECT_ARMING)});
setTimeout(function(){if(d.getAttribute(${JSON.stringify(AUTO_REDIRECT_ATTR)})===${JSON.stringify(AUTO_REDIRECT_ARMING)})d.removeAttribute(${JSON.stringify(AUTO_REDIRECT_ATTR)})},${AUTO_REDIRECT_FAILSAFE_MS});
if(!hit)return;
try{sessionStorage.setItem(${JSON.stringify(AUTO_REDIRECT_BREADCRUMB_KEY)},JSON.stringify({p:p,t:Date.now()}))}catch(e){}
l.replace(hit.u);
}catch(e){try{d.removeAttribute(${JSON.stringify(AUTO_REDIRECT_ATTR)})}catch(e2){}}})();`;
}
