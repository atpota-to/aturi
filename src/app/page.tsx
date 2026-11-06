'use client';

import Header from '@/components/Header';
import HomeHero from '@/components/HomeHero';
import { FadeIn } from '@/components/FadeIn';
import ProductCards from '@/components/home/ProductCards';
import DeveloperCards from '@/components/home/DeveloperCards';
import { Code2, GitFork, Mail, MessageCircle, Scale } from 'lucide-react';

/** The example AT URI in "Why aturi?", split into the parts it labels. */
const URI_PARTS: Array<{ text: string; short?: string; label: string }> = [
  { text: 'at://', label: 'scheme' },
  { text: 'did:plc:lcieujcfkv4jx7gehsvok3pr', short: 'did:plc:lcieujcf\u2026ok3pr', label: 'who: the account' },
  { text: 'app.bsky.feed.post', label: 'what: the record type' },
  { text: '3mi2mcc5lxj2y', label: 'which: the record' },
];
const EXAMPLE_URI = `at://${URI_PARTS.slice(1).map((p) => p.text).join('/')}`;

export default function HomePage() {
  return (
    <div className="fn-home">
      {/* Compact nav card — same shape used by /explore, /profile/*, and
          /account so the homepage doesn't fork its own header treatment.
          Rendered as a direct child of the page wrapper so position:
          sticky has the full page height as its containing block. */}
      <Header compact />

      <HomeHero />

      <div className="fn-home-body">
        {/* Products, led by the extension (the hero's download CTA), then
            the explorer (the hero's search), then universal links. */}
        <ProductCards />

        <FadeIn>
          <DeveloperCards />
        </FadeIn>

        <FadeIn>
          <section className="fn-home-why" aria-labelledby="fn-home-why">
            <div className="fn-home-why-copy">
              <h2 id="fn-home-why">Why &ldquo;aturi&rdquo;?</h2>
              <p>
                It&rsquo;s a playful blend of <strong>AT URI</strong>, the
                address the AT Protocol gives every record, profile, and
                resource. Say it like &ldquo;Atari&rdquo; with &ldquo;turi&rdquo;
                at the end: <em>uh-tour-ee</em>.
              </p>
              <p>
                Every piece of content in the Atmosphere has an AT URI that works
                regardless of which app or server you&apos;re using. We thought it
                deserved a friendly name that&apos;s easy to remember and share.
              </p>
            </div>
            <div
              className="fn-home-anatomy"
              role="img"
              aria-label={`Parts of an example AT URI: ${EXAMPLE_URI}`}
            >
              {URI_PARTS.map((part) => (
                <span key={part.label} className="fn-home-anatomy-part">
                  <span className="fn-home-anatomy-text" title={part.text}>
                    {part.short ?? part.text}
                  </span>
                  <span className="fn-home-anatomy-label">{part.label}</span>
                </span>
              ))}
            </div>
          </section>
        </FadeIn>

        <FadeIn>
          <div className="fn-home-pair">
            {/* Submit your app card */}
            <section className="fn-card fn-home-devcard" aria-labelledby="fn-home-submit">
              <span className="fn-home-kicker">Waypoints</span>
              <h3 id="fn-home-submit">Submit your app as a waypoint</h3>
              <p>
                Building an Atmosphere client or tool? We&apos;d love to consider
                adding it to our curated list of waypoints.
              </p>
              <div className="fn-home-actions">
                <a href="mailto:aturi@atpota.to" className="fn-home-button">
                  <Mail size={14} aria-hidden /> Email aturi@atpota.to
                </a>
                <a
                  href="https://bsky.app/profile/aturi.to"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="fn-home-button"
                >
                  <MessageCircle size={14} aria-hidden /> DM on Bluesky
                </a>
              </div>
            </section>

            {/* Open source card. Sits at the bottom of the home page so it
                reads as "by the way, this thing is yours to fork" rather
                than leading with it. Three links cover the three things
                people usually want next: the code, the license, and the
                mirror. */}
            <section className="fn-card fn-home-devcard" aria-labelledby="fn-home-oss">
              <span className="fn-home-kicker">Open source</span>
              <h3 id="fn-home-oss">GPL v3, built in the open, ready to fork.</h3>
              <p>
                Every line of aturi.to lives on{' '}
                <a href="https://github.com/atpota-to/aturi" target="_blank" rel="noopener noreferrer">
                  GitHub
                </a>
                , mirrored to{' '}
                <a href="https://tangled.org/atpota.to/aturi" target="_blank" rel="noopener noreferrer">
                  tangled.org
                </a>
                . Run your own instance on a custom domain, audit the source
                code, or contribute a waypoint.
              </p>
              <div className="fn-home-actions">
                <a
                  href="https://github.com/atpota-to/aturi"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="fn-home-button"
                >
                  <Code2 size={14} aria-hidden /> Source code
                </a>
                <a
                  href="https://github.com/atpota-to/aturi/blob/main/LICENSE"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="fn-home-button"
                >
                  <Scale size={14} aria-hidden /> GPL v3 license
                </a>
                <a
                  href="https://tangled.org/atpota.to/aturi"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="fn-home-button"
                >
                  <GitFork size={14} aria-hidden /> Tangled mirror
                </a>
              </div>
            </section>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}
