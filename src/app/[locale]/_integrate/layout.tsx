import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ locale: string }>;
}): Promise<Metadata> {
  const { locale } = await params;
  const t = await getTranslations({ locale, namespace: "meta.integrate" });
  const title = t("title");
  const description = t("description");
  const ogDescription = t("ogDescription");
  return {
    title,
    description,
    metadataBase: new URL("https://aturi.to"),
    openGraph: {
      title,
      description: ogDescription,
      images: ["/api/og/static?page=integrate"],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: ogDescription,
      images: ["/api/og/static?page=integrate"],
    },
  };
}

export default function IntegrateLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
