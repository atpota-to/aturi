import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Create Link - aturi.to",
  description: "Turn any ATProto URL into a universal link. Paste a Bluesky URL or AT URI and get your aturi.to link.",
  metadataBase: new URL('https://aturi.to'),
  openGraph: {
    title: "Create Link - aturi.to",
    description: "Turn any ATProto URL into a universal link",
    images: ['/api/og/static?page=create'],
  },
  twitter: {
    card: "summary_large_image",
    title: "Create Link - aturi.to",
    description: "Turn any ATProto URL into a universal link",
    images: ['/api/og/static?page=create'],
  },
};

export default function CreateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

