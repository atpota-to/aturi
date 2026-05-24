import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Integrate - aturi.to",
  description: "Add universal sharing to your Atmosphere app. Simple URL patterns for easy integration.",
  metadataBase: new URL('https://aturi.to'),
  openGraph: {
    title: "Integrate - aturi.to",
    description: "Add universal sharing to your Atmosphere app",
    images: ['/api/og/static?page=integrate'],
  },
  twitter: {
    card: "summary_large_image",
    title: "Integrate - aturi.to",
    description: "Add universal sharing to your Atmosphere app",
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

