import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import Footer from "@/components/Footer";
import PageTransition from "@/components/PageTransition";
import { getSiteUrl } from "@/lib/config";
import "./globals.css";

// Force use production URL for OG images
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://aturi.to';

export const metadata: Metadata = {
  title: "aturi.to - Universal links for the ATmosphere",
  description: "Share ATProto content with anyone, let them choose where to view it",
  metadataBase: new URL(siteUrl),
  openGraph: {
    title: "aturi.to - Universal links for the ATmosphere",
    description: "Share ATProto content with anyone, let them choose where to view it",
    type: "website",
    images: ['/api/og/static?page=home'],
  },
  twitter: {
    card: "summary_large_image",
    title: "aturi.to - Universal links for the ATmosphere",
    description: "Share ATProto content with anyone, let them choose where to view it",
    images: ['/api/og/static?page=home'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>
        <PageTransition>
          <main style={{ position: 'relative', zIndex: 1 }}>{children}</main>
        </PageTransition>
        <Footer />
        <Analytics />
      </body>
    </html>
  );
}
