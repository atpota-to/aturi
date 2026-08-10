import type { Metadata } from 'next';
import Header from '@/components/Header';
import OnboardingFlow from '@/components/onboarding/OnboardingFlow';

export const metadata: Metadata = {
  title: 'Set up Aturi · aturi.to',
  description:
    'Pick the Bluesky client, publication reader, and record explorer you actually use. Aturi leads with them everywhere, and saves them to your own repository.',
  openGraph: {
    title: 'Set up Aturi',
    description:
      'Pick the Atmosphere apps you actually use. Saved to your own repository, so they travel with you.',
    images: ['/api/og/static?page=home'],
  },
};

export default function WelcomePage() {
  return (
    <>
      <Header compact />
      <div
        className="container-narrow"
        style={{ padding: '0 2rem 4rem', minHeight: '80dvh' }}
      >
        <OnboardingFlow />
      </div>
    </>
  );
}
