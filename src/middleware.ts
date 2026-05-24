import createMiddleware from 'next-intl/middleware';
import { routing } from './i18n/routing';

export default createMiddleware(routing);

export const config = {
  // Match everything except locale-agnostic routes:
  //   - /api/*                       REST handlers
  //   - /oauth/callback              fixed atproto OAuth redirect URI
  //   - /oauth-client-metadata.json  static client metadata
  //   - /at:* and /at/*              AT-URI catch-all redirectors
  //   - /_next/*, /_vercel/*         framework internals
  //   - paths with a file extension  static assets, favicons, manifests
  matcher: [
    '/((?!api|oauth/callback|oauth-client-metadata\\.json|at:|at/|_next|_vercel|.*\\..*).*)',
  ],
};
