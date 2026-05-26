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
  async redirects() {
    return [
      { source: '/explorer', destination: '/explore', permanent: true },
      { source: '/explorer/:path*', destination: '/explore/:path*', permanent: true },
    ];
  },
};

export default nextConfig;
