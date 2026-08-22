import type { Metadata } from 'next';
import ContentPageView from '@/components/ContentPageView';
import { ABOUT_PAGE } from '@/lib/siteContent';
import { getSiteUrl } from '@/lib/config';

export const metadata: Metadata = {
  title: 'About · aturi.to',
  description: ABOUT_PAGE.description,
  alternates: { canonical: `${getSiteUrl()}/about` },
  openGraph: {
    title: 'About · aturi.to',
    description: ABOUT_PAGE.description,
    type: 'website',
    url: `${getSiteUrl()}/about`,
  },
};

export default function AboutPage() {
  return <ContentPageView page={ABOUT_PAGE} />;
}
