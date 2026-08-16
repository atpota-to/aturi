'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import LandingSection from '@/components/landing/LandingSection';
import BrowserChrome from './BrowserChrome';
import ExtensionPopupVisual from './ExtensionPopupVisual';

/**
 * The homepage's one loud section and its only bespoke visual, which is
 * what keeps the other two products from reading as equally-weighted
 * claims. The pitch, the download button and the client count all live on
 * /extension; this section names the behaviour and hands off.
 */
export default function ExtensionStrip() {
  return (
    <LandingSection
      tone="loud"
      flip
      title="Click the leaf, pick the client"
      visual={
        <BrowserChrome>
          <ExtensionPopupVisual />
        </BrowserChrome>
      }
    >
      <p>
        Land on a Bluesky post and read it in Anisota instead, without copying
        an AT URI by hand. Set a favorite, turn auto-redirect on, and those
        links open there with no popup at all.
      </p>
      <Link
        href="/extension"
        style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}
      >
        Get the extension
        <ArrowRight size={14} aria-hidden />
      </Link>
    </LandingSection>
  );
}
