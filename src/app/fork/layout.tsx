import type { Metadata } from "next";

// The /fork page itself is a Client Component and can't export metadata, so
// it previously shipped the root layout's generic title/OG image. This layout
// (a Server Component) restores the fork-specific metadata. metadataBase is
// inherited from the root layout (getSiteUrl()).
export const metadata: Metadata = {
  title: "Fork & Deploy - aturi.to",
  description:
    "Run your own instance with a custom domain. Open source and ready to deploy on Vercel.",
  openGraph: {
    title: "Fork & Deploy - aturi.to",
    description: "Run your own instance with a custom domain",
    images: ['/api/og/static?page=fork'],
  },
  twitter: {
    card: "summary_large_image",
    title: "Fork & Deploy - aturi.to",
    description: "Run your own instance with a custom domain",
    images: ['/api/og/static?page=fork'],
  },
};

export default function ForkLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
