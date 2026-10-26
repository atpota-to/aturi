import type { Metadata } from 'next';
import ContentPageView from '@/components/ContentPageView';
import { CONTACT_PAGE } from '@/lib/siteContent';
import { getSiteUrl } from '@/lib/config';

export const metadata: Metadata = {
  title: 'Contact · aturi.to',
  description: CONTACT_PAGE.description,
  alternates: { canonical: `${getSiteUrl()}/contact` },
  openGraph: {
    title: 'Contact · aturi.to',
    description: CONTACT_PAGE.description,
    type: 'website',
    url: `${getSiteUrl()}/contact`,
  },
};

export default function ContactPage() {
  return <ContentPageView page={CONTACT_PAGE} />;
}
