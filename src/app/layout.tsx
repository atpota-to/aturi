import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import Footer from "@/components/Footer";
import PageTransition from "@/components/PageTransition";
import { getSiteUrl } from "@/lib/config";
import "./globals.css";

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  title: "aturi.to - Universal links for the ATmosphere",
  description: "Share ATProto content with anyone, let them choose where to view it",
  openGraph: {
    title: "aturi.to - Universal links for the ATmosphere",
    description: "Share ATProto content with anyone, let them choose where to view it",
    type: "website",
    images: [`${siteUrl}/api/og/static?page=home`],
  },
  twitter: {
    card: "summary_large_image",
    title: "aturi.to - Universal links for the ATmosphere",
    description: "Share ATProto content with anyone, let them choose where to view it",
    images: [`${siteUrl}/api/og/static?page=home`],
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
