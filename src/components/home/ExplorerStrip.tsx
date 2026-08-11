'use client';

import Link from 'next/link';
import { ArrowRight, Telescope } from 'lucide-react';
import SearchBox from '@/components/explore/SearchBox';
import AccountStats from '@/components/account/AccountStats';
import ProductStrip from './ProductStrip';

const DEMO_HANDLE = 'aturi.to';
// aturi.to's DID, hardcoded rather than resolved at mount: these tiles are
// the section's visual now, so they render on first paint with their own
// placeholders instead of appearing a round trip later — or not at all, on
// the visit where the handle lookup fails. A PLC DID is permanent, so the
// only thing that could stale this is aturi.to moving to another account.
const DEMO_DID = 'did:plc:6teuhlkizzebk6wdp42633el';

/**
 * Strip 3 — Atmosphere Explorer. The demo side is the "Repo at a glance"
 * stat tiles, the same component the explorer leads every repo page with:
 * a real sample of what the Explorer surfaces rather than a picture of
 * it. Copy column carries the pitch, the "Start exploring" link, and the
 * SearchBox for jumping into the explorer with any handle — stacked on
 * mobile that reads like the neighbouring strips, one visual with the
 * section's text under it.
 */
export default function ExplorerStrip() {
  return (
    <ProductStrip
      label="Atmosphere Explorer"
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
            <Telescope size={12} aria-hidden />
            Atmosphere Explorer
          </span>
          <h2>Browse through any account&rsquo;s data</h2>
          <p>
            Read every collection, record, and backlink on any account&rsquo;s
            PDS, all from your browser. Identity history, audit logs, inbound
            references, and a live view of network activity sit one tab away.
          </p>
          <p>
            Sign in with your atproto handle to edit your own records, sync
            waypoint preferences across devices, and tune how your universal
            link pages render.
          </p>
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
            <Link
              href="/explore"
              className="generate-button"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.625rem 1rem',
                background: 'var(--accent-moss)',
                color: 'var(--text-on-accent)',
                border: '1px solid var(--accent-forest)',
                fontSize: '0.9rem',
                textDecoration: 'none',
              }}
            >
              <Telescope size={14} />
              Start exploring
              <ArrowRight size={14} />
            </Link>
          </div>

          {/* Handle lookup, captioned so it reads as an offered action
              rather than a stray input. */}
          <div className="explore-small-caps" style={{ marginBottom: '0.5rem' }}>
            Or look up any account
          </div>
          <SearchBox />
        </>
      }
      demo={
        <div>
          <div
            className="explore-small-caps"
            style={{ marginBottom: '0.5rem' }}
          >
            Repo at a glance · @{DEMO_HANDLE}
          </div>
          {/* Demo surface: the strip exists to advertise what the
              Explorer shows, not to be the explorer itself, so the
              tiles render as a preview without the cred.blue link
              or per-tile hint tooltips. */}
          <AccountStats did={DEMO_DID} interactive={false} />
        </div>
      }
    />
  );
}
