import type { Metadata } from "next";

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://aturi.to';

export const metadata: Metadata = {
  title: "Integrate - aturi.to",
  description: "Add universal sharing to your ATProto app. Simple URL patterns for seamless integration.",
  metadataBase: new URL(siteUrl),
  openGraph: {
    title: "Integrate - aturi.to",
    description: "Add universal sharing to your ATProto app",
    images: ['/api/og/static?page=integrate'],
  },
  twitter: {
    card: "summary_large_image",
    title: "Integrate - aturi.to",
    description: "Add universal sharing to your ATProto app",
    images: ['/api/og/static?page=integrate'],
  },
};

export default function IntegrateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

