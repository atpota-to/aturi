import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'cdn.bsky.app',
      },
    ],
  },
  // /explorer is an obvious typo / synonym for the canonical /explore
  // route. Send it (and every nested path under it) to the matching
  // /explore URL so deep links keep working when someone fat-fingers
  // or copies from a referrer that included the "r".
  //
  // /universal-links and then /links were the universal links landing
  // page, which grew into the Waypoints page (universal links plus the
  // packages and API behind them). Both old URLs redirect so existing
  // shares and bookmarks don't break. The iOS app claims /links as its
  // Links tab (src/lib/iosApp.ts); that is decided on the device before any
  // request is made, so the redirect doesn't reach it.
  // Apple fetches the universal-links association from a dot-folder path the
  // App Router cannot host, so it is served by a route handler and rewritten
  // here. The handler answers 404 until IOS_APP_TEAM_ID is configured.
  async rewrites() {
    return [
      {
        source: '/.well-known/apple-app-site-association',
        destination: '/api/apple-app-site-association',
      },
    ];
  },
  async redirects() {
    return [
      { source: '/explorer', destination: '/explore', permanent: true },
      { source: '/explorer/:path*', destination: '/explore/:path*', permanent: true },
      { source: '/universal-links', destination: '/waypoints', permanent: true },
      { source: '/links', destination: '/waypoints', permanent: true },
    ];
  },
};

export default nextConfig;
