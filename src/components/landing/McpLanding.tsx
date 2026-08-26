'use client';

import Link from 'next/link';
import { ArrowRight, Boxes, Plug, ShieldCheck } from 'lucide-react';
import AppearIn from '@/components/explore/AppearIn';
import { TOOL_COUNT, toolCountWord } from '@/lib/mcp/catalog';
import { MCP_LIMITS, MCP_NAME, MCP_STAGE } from '@/lib/mcp/about';
import { parseInline } from '@/lib/siteContent';
import CopyButton from '@/components/explore/CopyButton';
import CrossLinkCards from './CrossLinkCards';
import FeatureSection from './FeatureSection';
import McpConversationVisual from './McpConversationVisual';
import McpSetupVisual from './McpSetupVisual';
import McpToolCatalogVisual from './McpToolCatalogVisual';

/** Three questions that need the whole network, not one app. */
const EXAMPLES = [
  'Who links to this post, from any app?',
  'What parameters does getAuthorFeed take?',
  'How do record keys work in atproto?',
];

export default function McpLanding({ endpoint }: { endpoint: string }) {
  const display = endpoint.replace(/^https?:\/\//, '');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4rem' }}>
      <AppearIn rise>
        <header className="landing-hero" style={{ display: 'grid', gap: '2.5rem', alignItems: 'center' }}>
          <div>
            <span
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                flexWrap: 'wrap',
                marginBottom: '1.25rem',
              }}
            >
              <Badge icon={<Plug size={12} aria-hidden />}>{MCP_NAME}</Badge>
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  padding: '0.25rem 0.5rem',
                  border: '1px solid var(--text-accent)',
                  color: 'var(--text-accent)',
                  fontFamily: 'var(--font-mono)',
                  fontSize: '0.68rem',
                  letterSpacing: '0.1em',
                  textTransform: 'uppercase',
                  lineHeight: 1,
                }}
              >
                {MCP_STAGE}
              </span>
            </span>
            <h1
              style={{
                fontSize: '2.5rem',
                fontWeight: 300,
                marginBottom: '0.75rem',
                color: 'var(--text-primary)',
                lineHeight: 1.15,
              }}
            >
              One URL, and your agent can read the Atmosphere
            </h1>
            <p
              style={{
                fontSize: '1.05rem',
                lineHeight: 1.6,
                color: 'var(--text-secondary)',
                maxWidth: '34rem',
                marginBottom: '1rem',
              }}
            >
              Add <code style={{ color: 'var(--text-accent)' }}>{display}</code> to
              Claude, Cursor, or any MCP client. Your agent can then read any
              account&rsquo;s repository, trace who references what across every
              app, and follow Jetstream as records land. No key, no account, nothing to
              install.
            </p>
            <p
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.4rem',
                fontSize: '0.85rem',
                color: 'var(--text-accent)',
                fontFamily: 'var(--font-mono)',
                marginBottom: '1.25rem',
              }}
            >
              <Boxes size={14} aria-hidden />
              {TOOL_COUNT} read-only tools · no API key
            </p>
            <EndpointBlock endpoint={endpoint} />
          </div>
          <div>
            <McpConversationVisual />
          </div>
        </header>
      </AppearIn>

      <FeatureSection
        badge={{ icon: <Plug size={12} />, label: 'Setup' }}
        title="Add it in one line"
        body={
          <p>
            Any client that speaks Streamable HTTP works. Clients that only
            speak stdio can bridge with{' '}
            <code style={{ color: 'var(--text-accent)' }}>npx mcp-remote</code>.
          </p>
        }
        visual={<McpSetupVisual endpoint={endpoint} />}
      />

      <FeatureSection
        flip
        badge={{ icon: <Boxes size={12} />, label: 'The tools' }}
        title={`${capitalize(toolCountWord())} tools`}
        body={
          <>
            <p>
              Identity and repositories on any personal data server, the network
              graph, the Bluesky social layer, feeds and lists, lexicon
              activity, a live Jetstream tap, and the protocol docs themselves.
              Most of it reaches past Bluesky into the rest of atproto, which is
              where the questions get interesting.
            </p>
            <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {EXAMPLES.map((question) => (
                <li
                  key={question}
                  style={{ display: 'flex', alignItems: 'flex-start', gap: '0.5rem', fontSize: '0.95rem' }}
                >
                  <ArrowRight
                    size={14}
                    aria-hidden
                    style={{ color: 'var(--text-accent)', flexShrink: 0, marginTop: '0.3rem' }}
                  />
                  {question}
                </li>
              ))}
            </ul>
          </>
        }
        visual={<McpToolCatalogVisual />}
      />

      <AppearIn>
        <section
          style={{
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-secondary)',
            padding: '1.5rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
          }}
        >
          <span
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.4rem',
              color: 'var(--text-accent)',
              fontSize: '0.75rem',
              letterSpacing: '0.12em',
              textTransform: 'uppercase',
              fontFamily: 'var(--font-serif)',
              lineHeight: 1,
            }}
          >
            <ShieldCheck size={14} aria-hidden /> Before you rely on it
          </span>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.6rem',
            }}
          >
            {MCP_LIMITS.map((limit) => (
              <li
                key={limit}
                style={{
                  color: 'var(--text-secondary)',
                  fontSize: '0.95rem',
                  lineHeight: 1.55,
                  paddingLeft: '0.875rem',
                  borderLeft: '2px solid var(--border-subtle)',
                }}
              >
                <Inline text={limit} />
              </li>
            ))}
          </ul>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
            Building software instead of prompting an agent? The same answers
            are plain GET endpoints, typed in{' '}
            <a href="/openapi.json">the OpenAPI document</a> and explained in the{' '}
            <Link href="/docs">developer docs</Link>.
          </p>
        </section>
      </AppearIn>

      <CrossLinkCards current="mcp" />
    </div>
  );
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

/**
 * Render the backticked spans in a limit as code. Reuses the site's own
 * inline parser so this page and the Markdown twin read the same strings the
 * same way.
 */
function Inline({ text }: { text: string }) {
  return (
    <>
      {parseInline(text).map((segment, i) =>
        segment.kind === 'code' ? (
          <code key={i} style={{ color: 'var(--text-accent)', fontSize: '0.88em' }}>
            {segment.text}
          </code>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </>
  );
}

function Badge({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.4rem',
        padding: '0.25rem 0.625rem',
        border: '1px solid var(--border-subtle)',
        background: 'var(--bg-tertiary)',
        color: 'var(--text-tertiary)',
        fontSize: '0.75rem',
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        fontFamily: 'var(--font-serif)',
        lineHeight: 1,
      }}
    >
      {icon}
      {children}
    </span>
  );
}

/** The endpoint, shown the way you would paste it, with a one-click copy. */
function EndpointBlock({ endpoint }: { endpoint: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.75rem',
        border: '1px solid var(--border-medium)',
        background: 'var(--bg-tertiary)',
        padding: '0.625rem 0.625rem 0.625rem 0.875rem',
      }}
    >
      <code
        style={{
          minWidth: 0,
          flex: 1,
          fontFamily: 'var(--font-mono)',
          fontSize: '0.9rem',
          color: 'var(--text-primary)',
          wordBreak: 'break-all',
        }}
      >
        {endpoint}
      </code>
      <span style={{ flexShrink: 0 }}>
        <CopyButton value={endpoint} label="Copy" compact />
      </span>
    </div>
  );
}
