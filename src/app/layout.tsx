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
        {/* SVG filter for subtle rough text edges */}
        <svg width="0" height="0" style={{ position: 'absolute', pointerEvents: 'none' }}>
          <defs>
            <filter id="roughEdges" x="-20%" y="-20%" width="140%" height="140%">
              <feTurbulence 
                type="fractalNoise" 
                baseFrequency="0.8" 
                numOctaves="3" 
                result="noise" 
                seed="7" 
              />
              <feDisplacementMap 
                in="SourceGraphic" 
                in2="noise" 
                scale="0.2" 
                xChannelSelector="R" 
                yChannelSelector="G" 
              />
            </filter>
          </defs>
        </svg>
        
        <main style={{ position: 'relative', zIndex: 1 }}>{children}</main>
        <Footer />
        <Analytics />
      </body>
    </html>
  );
}
