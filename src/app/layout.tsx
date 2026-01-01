import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import Footer from "@/components/Footer";
import PageTransition from "@/components/PageTransition";
import "./globals.css";

export const metadata: Metadata = {
  title: "aturi.to - Universal links for the ATmosphere",
  description: "Share ATProto content with anyone, let them choose where to view it",
  metadataBase: new URL('https://aturi.to'),
  manifest: '/site.webmanifest',
  icons: {
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', sizes: '32x32' }
    ],
    apple: [
      { url: '/apple-touch-icon.svg', type: 'image/svg+xml' }
    ],
  },
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
