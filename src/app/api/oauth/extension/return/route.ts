/**
 * Where a Safari extension sign-in lands.
 *
 * Safari has no `identity.launchWebAuthFlow`, so the Safari build runs sign-in
 * in an ordinary tab and the callback sends that tab here with a one-time code
 * in the fragment (`#code=…`), or here with `?oauth_error=…` when it fails.
 * The extension reads the tab's URL itself, redeems the code with the verifier
 * only it holds, and closes the tab. This page has nothing to do but sit there
 * for the moment that takes. `validateReturn` in `../../login/route.ts`
 * accepts exactly this path on the request's own origin.
 *
 * Everything below follows from the URL carrying a live code:
 *
 * - No script, so nothing on the page can read the fragment, and no
 *   `<Analytics />` (a route handler bypasses `src/app/layout.tsx`). With no
 *   script the URL also never changes after it loads, so the extension never
 *   races the page for it.
 * - Nothing from the query or fragment is echoed. The error message is shown
 *   by the extension, which got it from the URL, so this page cannot be used
 *   to put attacker-chosen text on aturi.to.
 * - `default-src 'none'`: the page loads nothing, so a stray subresource or an
 *   injected tag has nowhere to send the URL. `Referrer-Policy: no-referrer`
 *   for the same reason (a Referer never carries the fragment, but there is no
 *   reason to send even the path).
 * - `frame-ancestors 'none'`, so another site cannot frame it.
 * - `no-store` and `noindex`, since a copy of it in a cache or a search index
 *   is never useful.
 *
 * It must stay out of IOS_UNIVERSAL_LINK_PATHS (`src/lib/iosApp.ts`): if iOS
 * handed this URL to the app instead of Safari, the code would leave the
 * browser the extension is waiting in.
 *
 * Plain `Response` rather than `NextResponse` so the module has no imports and
 * `src/lib/__tests__/oauthExtensionReturn.test.ts` can load it directly.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Aturi sign-in</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    font: 16px/1.5 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: #fafaf9;
    color: #1c1917;
  }
  main { max-width: 28rem; padding: 2rem 1.5rem; }
  h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
  p { margin: 0; color: #57534e; }
  @media (prefers-color-scheme: dark) {
    body { background: #1c1917; color: #fafaf9; }
    p { color: #a8a29e; }
  }
</style>
</head>
<body>
<main>
<h1>You can close this tab</h1>
<p>The Aturi extension finishes signing in on its own and shows the result on its Account settings page. If this tab is still open, close it and go back there.</p>
</main>
</body>
</html>
`;

// Module-private: a Next route module may only export route fields.
const RETURN_PAGE_HEADERS: Record<string, string> = {
  'Content-Type': 'text/html; charset=utf-8',
  'Content-Security-Policy':
    "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'Referrer-Policy': 'no-referrer',
  'Cache-Control': 'no-store',
  'X-Robots-Tag': 'noindex',
};

export function GET(): Response {
  return new Response(HTML, { status: 200, headers: RETURN_PAGE_HEADERS });
}
