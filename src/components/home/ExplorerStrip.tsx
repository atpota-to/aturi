import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import LandingSection from '@/components/landing/LandingSection';

/**
 * Plain-text section: the explorer's search box already leads the hero and
 * its stat tiles now live on /explore, so this one only has to name what
 * the explorer reads and point at it.
 */
export default function ExplorerStrip() {
  return (
    <LandingSection title="Read any account’s repository">
      <p>
        Any handle or DID resolves to its collections, the records inside them,
        and the backlinks pointing in.
      </p>
      <Link
        href="/explore"
        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
      >
        Start exploring
        <ArrowRight size={14} aria-hidden />
      </Link>
    </LandingSection>
  );
}
