'use client';

import Link from 'next/link';
import { ArrowRight, Link2 } from 'lucide-react';
import ProductStrip from './ProductStrip';
import WaypointJumpVisual from './WaypointJumpVisual';
import WaypointCarousel from './WaypointCarousel';

const DEMO_HANDLE = 'aturi.to';
// Aturi's own DID — hardcoded so the carousel chips can build proper
// did-aware URLs without a runtime profile fetch. (The carousel is
// just a demo; resolved handles still take the visitor to the right
// destinations.)
const DEMO_DID = 'did:plc:gq4fo3u6tqzzdkjlwzpb23tj';

/**
 * Strip 1 — Universal Links. Pure animated demo: an abstract
 * \"jumping between waypoints\" visual on top, followed by the
 * rotating carousel of three real, tappable waypoint chips. No
 * heavyweight ProfilePreview fetch — the strip's job here is to
 * communicate the IDEA of one link routing to many clients, not to
 * recreate a real universal link page on the homepage.
 */
export default function UniversalLinksStrip() {
  return (
    <ProductStrip
      label="Universal links"
      copy={
        <>
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              padding: '0.2rem 0.6rem',
              border: '1px solid var(--border-subtle)',
              background: 'var(--bg-tertiary)',
              color: 'var(--text-tertiary)',
              fontSize: '0.7rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              marginBottom: '1rem',
              lineHeight: 1,
            }}
          >
            <Link2 size={12} aria-hidden />
            Universal links
          </span>
          <h2>One link, every client</h2>
          <p>
            Drop an{' '}
            <code style={{ background: 'transparent', padding: 0, color: 'var(--text-accent)' }}>
              aturi.to
            </code>{' '}
            link anywhere — a DM, a footer, a bio. Your visitors land on a
            friendly preview of the record and pick the Atmosphere client they
            want to read it in.
          </p>
          <p>
            No client lock-in. No login. Every record, profile, and list resolves
            to the right destination across 25+ curated Atmosphere clients.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Link
              href={`/profile/${DEMO_HANDLE}`}
              className="generate-button"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.625rem 1rem',
                background: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--text-accent)',
                fontSize: '0.9rem',
                textDecoration: 'none',
              }}
            >
              See a universal link page
              <ArrowRight size={14} style={{ color: 'var(--text-tertiary)' }} />
            </Link>
          </div>
        </>
      }
      demo={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <WaypointJumpVisual handle={DEMO_HANDLE} />
          <WaypointCarousel handle={DEMO_HANDLE} did={DEMO_DID} />
        </div>
      }
    />
  );
}
