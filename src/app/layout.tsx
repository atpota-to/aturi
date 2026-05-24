import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { AtprotoSessionProvider } from "@/components/AtprotoSessionProvider";
import { PreferencesProvider } from "@/components/PreferencesProvider";
import Footer from "@/components/Footer";
import PageTransition from "@/components/PageTransition";
import ThemeSync from "@/components/ThemeSync";
import { DEFAULT_THEME, THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

export const metadata: Metadata = {
  title: "aturi.to — Tour the Atmosphere",
  description: "Travel between clients with the browser extension, share universal Atmosphere links, and explore any account's PDS data.",
  metadataBase: new URL('https://aturi.to'),
  manifest: '/site.webmanifest',
  openGraph: {
    title: "aturi.to — Tour the Atmosphere",
    description: "Travel between clients with the browser extension, share universal Atmosphere links, and explore any account's PDS data.",
    type: "website",
    images: ['/api/og/static?page=home'],
  },
  twitter: {
    card: "summary_large_image",
    title: "aturi.to — Tour the Atmosphere",
    description: "Travel between clients with the browser extension, share universal Atmosphere links, and explore any account's PDS data.",
    images: ['/api/og/static?page=home'],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme={DEFAULT_THEME} suppressHydrationWarning>
      <head>
        {/* Apple TN3156 requires an `application/activity+json` link element
            on social-network post pages for rich previews in Messages.
            Bluesky's bskyweb base template emits this with an empty href on
            EVERY page; we mirror that exactly. */}
        <link type="application/activity+json" href="" />
        {/* Apply the saved theme before first paint to avoid a dark/light
            flash on cold loads. The script reads from localStorage and sets
            data-theme on <html> synchronously. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ThemeSync />
        <AtprotoSessionProvider>
          <PreferencesProvider>
            <PageTransition>
              <main style={{ position: 'relative', zIndex: 1 }}>{children}</main>
            </PageTransition>
          </PreferencesProvider>
        </AtprotoSessionProvider>
        <Footer />
        <Analytics />
      </body>
    </html>
  );
}
