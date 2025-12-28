import type { Metadata } from "next";
import { getSiteUrl } from "@/lib/config";

const siteUrl = getSiteUrl();

export const metadata: Metadata = {
  title: "Fork & Deploy - aturi.to",
  description: "Run your own instance with a custom domain. Open source and ready to deploy on Vercel.",
  openGraph: {
    title: "Fork & Deploy - aturi.to",
    description: "Run your own instance with a custom domain",
    images: [`${siteUrl}/api/og/static?page=fork`],
  },
  twitter: {
    card: "summary_large_image",
    title: "Fork & Deploy - aturi.to",
    description: "Run your own instance with a custom domain",
    images: [`${siteUrl}/api/og/static?page=fork`],
  },
};

export default function ForkLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}

