import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { AtprotoSessionProvider } from "@/components/AtprotoSessionProvider";
import { PreferencesProvider } from "@/components/PreferencesProvider";
import { KeyboardShortcutsProvider } from "@/components/KeyboardShortcutsProvider";
import Footer from "@/components/Footer";
import PageTransition from "@/components/PageTransition";
import ThemeSync from "@/components/ThemeSync";
import FontScaleSync from "@/components/FontScaleSync";
import A11ySync from "@/components/A11ySync";
import { DEFAULT_THEME, THEME_INIT_SCRIPT } from "@/lib/theme";
import { FONT_SCALE_INIT_SCRIPT } from "@/lib/fontScale";
import { A11Y_INIT_SCRIPT } from "@/lib/a11y";
import { getSiteUrl } from "@/lib/config";
import "./globals.css";

export const metadata: Metadata = {
  title: "aturi.to: Tour the Atmosphere",
  description: "Travel between clients with the browser extension, share universal Atmosphere links, and explore any account's PDS data.",
  // Use the deploy's actual origin (testing.aturi.to on staging, a preview
  // URL on Vercel previews) so OG image URLs resolve against THIS deploy
  // and not production. Without this, embeds on staging would render
  // whatever OG image production happened to have built.
  metadataBase: new URL(getSiteUrl()),
  manifest: '/site.webmanifest',
  openGraph: {
    title: "aturi.to: Tour the Atmosphere",
    description: "Travel between clients with the browser extension, share universal Atmosphere links, and explore any account's PDS data.",
    type: "website",
    images: [
      {
        url: '/og-images/aturi-home.png',
        width: 1200,
        height: 672,
        alt: 'aturi.to: three tools for one Atmosphere',
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "aturi.to: Tour the Atmosphere",
    description: "Travel between clients with the browser extension, share universal Atmosphere links, and explore any account's PDS data.",
    images: ['/og-images/aturi-home.png'],
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
        {/* Apply the saved font scale before first paint to avoid a reflow
            on cold loads. Reads from localStorage and sets the root
            font-size on <html> synchronously; "default" resolves to the
            same 16px the CSS already sets, so the baseline is unchanged. */}
        <script dangerouslySetInnerHTML={{ __html: FONT_SCALE_INIT_SCRIPT }} />
        {/* Apply saved reduce-motion / high-contrast choices before first
            paint so cold loads don't flash the motion background or a
            low-contrast palette. Each falls back to the matching OS
            preference when the user hasn't chosen explicitly. */}
        <script dangerouslySetInnerHTML={{ __html: A11Y_INIT_SCRIPT }} />
      </head>
      <body>
        <ThemeSync />
        <FontScaleSync />
        <A11ySync />
        <AtprotoSessionProvider>
          <PreferencesProvider>
            <KeyboardShortcutsProvider>
              <PageTransition>
                {/* Above the footer (z 1), not just the motion background
                    (z 0): the explorer's chrome bar is fixed inside <main>
                    and overlaps the footer near the end of a page. At equal
                    z-index the footer would win on DOM order and swallow
                    clicks meant for the bar. */}
                <main style={{ position: 'relative', zIndex: 2 }}>{children}</main>
              </PageTransition>
            </KeyboardShortcutsProvider>
          </PreferencesProvider>
        </AtprotoSessionProvider>
        <Footer />
        <Analytics />
      </body>
    </html>
  );
}
