import type { Metadata } from 'next';
import Header from '@/components/Header';
import OnboardingFlow from '@/components/onboarding/OnboardingFlow';

export const metadata: Metadata = {
  title: 'Set up Aturi · aturi.to',
  description:
    'Name the Bluesky client, publication reader and record explorer you use. Aturi puts them first on every link, and stores the choices in your own repository.',
  openGraph: {
    title: 'Set up Aturi',
    description:
      'Name the Atmosphere apps you use. Stored in your own repository, so the choices move with your account.',
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
