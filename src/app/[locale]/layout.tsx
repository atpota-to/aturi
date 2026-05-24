import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { NextIntlClientProvider, hasLocale } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { Analytics } from "@vercel/analytics/next";
import { AtprotoSessionProvider } from "@/components/AtprotoSessionProvider";
import { PreferencesProvider } from "@/components/PreferencesProvider";
import Footer from "@/components/Footer";
import PageTransition from "@/components/PageTransition";
import ThemeSync from "@/components/ThemeSync";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export async function generateMetadata(props: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await props.params;
  const t = await getTranslations({ locale, namespace: "meta.home" });
  return {
    title: t("title"),
    description: t("description"),
    metadataBase: new URL("https://aturi.to"),
    manifest: "/site.webmanifest",
    openGraph: {
      title: t("title"),
      description: t("description"),
      type: "website",
      images: ["/api/og/static?page=home"],
    },
    twitter: {
      card: "summary_large_image",
      title: t("title"),
      description: t("description"),
      images: ["/api/og/static?page=home"],
    },
    alternates: {
      languages: Object.fromEntries(
        routing.locales.map((l) => [l, l === routing.defaultLocale ? "/" : `/${l}`]),
      ),
    },
  };
}

export default async function LocaleLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { locale } = await params;
  if (!hasLocale(routing.locales, locale)) notFound();
  setRequestLocale(locale);

  return (
    <NextIntlClientProvider>
      <div lang={locale} style={{ display: "contents" }}>
        <ThemeSync />
        <AtprotoSessionProvider>
          <PreferencesProvider>
            <PageTransition>
              <main style={{ position: "relative", zIndex: 1 }}>{children}</main>
            </PageTransition>
          </PreferencesProvider>
        </AtprotoSessionProvider>
        <Footer />
        <Analytics />
      </div>
    </NextIntlClientProvider>
  );
}
