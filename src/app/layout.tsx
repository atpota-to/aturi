import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import Footer from "@/components/Footer";
import "./globals.css";

export const metadata: Metadata = {
  title: "aturi.to - Universal links for the ATmosphere",
  description: "Share ATProto content with anyone, let them choose where to view it",
  openGraph: {
    title: "aturi.to - Universal links for the ATmosphere",
    description: "Share ATProto content with anyone, let them choose where to view it",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "aturi.to - Universal links for the ATmosphere",
    description: "Share ATProto content with anyone, let them choose where to view it",
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
        <main style={{ position: 'relative', zIndex: 1 }}>{children}</main>
        <Footer />
        <Analytics />
      </body>
    </html>
  );
}
