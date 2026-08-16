import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import LandingSection from '@/components/landing/LandingSection';

/**
 * Plain-text section. The jump visual and the waypoint carousel that used
 * to sit here are the /links hero, and /links keeps them; repeating them a
 * scroll above the link to that page is what made the homepage a digest.
 */
export default function UniversalLinksStrip() {
  return (
    <LandingSection title="A link that isn’t tied to one app">
      <p>
        An{' '}
        <code style={{ background: 'transparent', padding: 0, color: 'var(--text-accent)' }}>
          aturi.to
        </code>{' '}
        link addresses the record itself, so it works for readers who don’t
        use the app you posted from.
      </p>
      <Link
        href="/profile/aturi.to"
        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
      >
        See a universal link page
        <ArrowRight size={14} aria-hidden />
      </Link>
    </LandingSection>
  );
}
