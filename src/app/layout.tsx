import { DEFAULT_THEME, THEME_INIT_SCRIPT } from "@/lib/theme";
import "./globals.css";

// Thin root: holds <html>, the pre-paint theme script, and global CSS.
// Per-locale layout (src/app/[locale]/layout.tsx) owns providers, metadata,
// and the lang attribute (set on a nested wrapper since the root can't see
// the route segment params).
export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html data-theme={DEFAULT_THEME} suppressHydrationWarning>
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
      <body>{children}</body>
    </html>
  );
}
