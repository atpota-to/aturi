import type { Metadata } from "next";
import { Analytics } from "@vercel/analytics/next";
import { AtprotoSessionProvider } from "@/components/AtprotoSessionProvider";
import { PreferencesProvider } from "@/components/PreferencesProvider";
import { KeyboardShortcutsProvider } from "@/components/KeyboardShortcutsProvider";
import Footer from "@/components/Footer";
import PageTransition from "@/components/PageTransition";
import ThemeSync from "@/components/ThemeSync";
import ColorSchemeSync from "@/components/ColorSchemeSync";
import WhatsNewModal from "@/components/whatsnew/WhatsNewModal";
import FontScaleSync from "@/components/FontScaleSync";
import A11ySync from "@/components/A11ySync";
import { DEFAULT_THEME, THEME_INIT_SCRIPT } from "@/lib/theme";
import {
  COLOR_SCHEME_INIT_SCRIPT,
  DEFAULT_COLOR_SCHEME,
} from "@/lib/colorScheme";
import { FONT_SCALE_INIT_SCRIPT } from "@/lib/fontScale";
import { A11Y_INIT_SCRIPT } from "@/lib/a11y";
import { getSiteUrl } from "@/lib/config";
import { buildSiteJsonLd } from "@/lib/structuredData";
import { serializeJsonLd } from "@/utils/sanitize";
import "./globals.css";

export const metadata: Metadata = {
  title: "aturi.to: Tour the Atmosphere",
  description: "Travel between clients with the browser extension, share universal Atmosphere links, and explore any account's PDS data.",
  // Use the deploy's actual origin (testing.aturi.to on staging, a preview
  // URL on Vercel previews) so OG image URLs resolve against THIS deploy
  // and not production. Without this, embeds on staging would render
  // whatever OG image production happened to have built.
  metadataBase: new URL(getSiteUrl()),
  // A relative canonical resolves against metadataBase *and the current
  // route*, so every page canonicalizes to itself rather than to the origin.
  // Routes that need a different target — the profile and record pages, which
  // canonicalize the handle spelling onto the DID one — set their own and
  // override this.
  alternates: { canonical: './' },
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
    <html
      lang="en"
      data-theme={DEFAULT_THEME}
      data-scheme={DEFAULT_COLOR_SCHEME}
      suppressHydrationWarning
    >
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
        {/* Same idea for the color scheme (the hue family each theme is
            painted in). Preferences are the source of truth and sync to the
            PDS, but they aren't readable until React mounts — this reads the
            localStorage cache ColorSchemeSync keeps current so a cold load
            doesn't paint the default palette first. */}
        <script dangerouslySetInnerHTML={{ __html: COLOR_SCHEME_INIT_SCRIPT }} />
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
        {/* Site-level identity for machine readers: who runs this, what the
            site is, what the software does. Record and profile pages add
            their own more specific JSON-LD alongside it. */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: serializeJsonLd(buildSiteJsonLd()) }}
        />
        <ThemeSync />
        <FontScaleSync />
        <A11ySync />
        <AtprotoSessionProvider>
          <PreferencesProvider>
            <ColorSchemeSync />
            {/* Self-triggering: decides once, after preferences settle, and
                renders nothing for a reader who is already caught up. */}
            <WhatsNewModal />
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
