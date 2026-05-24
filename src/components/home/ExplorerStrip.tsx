'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Telescope } from 'lucide-react';
import JetstreamFeed from '@/components/explore/JetstreamFeed';
import SearchBox from '@/components/explore/SearchBox';
import AccountStats from '@/components/account/AccountStats';
import { resolveHandle } from '@/utils/uriParser';
import ProductStrip from './ProductStrip';

const DEMO_HANDLE = 'aturi.to';

/**
 * Strip 3 — Atmosphere Explorer. Two stacked demos on the demo side:
 *
 *   1. Live JetstreamFeed (the actual component from /explore) so
 *      visitors see real network activity ticking past on the homepage.
 *   2. SearchBox for jumping into the explorer with any handle.
 *
 * Plus the "Repo at a glance" stat tiles for a stable handle below the
 * copy column — concrete evidence of what the Explorer surfaces.
 */
export default function ExplorerStrip() {
  const [demoDid, setDemoDid] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    resolveHandle(DEMO_HANDLE).then((did) => {
      if (!cancelled) setDemoDid(did);
    });
    return () => {
      cancelled = true;
    };
  }, []);

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
            Browse every collection, every record, every backlink across the
            Atmosphere — from any account&rsquo;s PDS, in your browser. Identity
            history, audit log, inbound references, and a live view of the
            firehose are all one click away.
          </p>
          <p>
            Sign in with your atproto handle to edit your own records directly,
            sync waypoint preferences across devices, and customize how every
            universal link page renders.
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

          {/* Isolated AccountStats row — concrete preview of what the
              explorer shows per repo. Renders for a stable DID we
              resolve at mount; tile placeholders fill the space while
              the lookup is in flight. */}
          {demoDid && (
            <div
              style={{
                marginTop: '1rem',
                paddingTop: '1rem',
                borderTop: '1px solid var(--border-subtle)',
              }}
            >
              <div
                className="explore-small-caps"
                style={{ marginBottom: '0.5rem' }}
              >
                Repo at a glance · @{DEMO_HANDLE}
              </div>
              <AccountStats did={demoDid} />
            </div>
          )}
        </>
      }
      demo={
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.875rem' }}>
          <JetstreamFeed />
          <SearchBox />
        </div>
      }
    />
  );
}
