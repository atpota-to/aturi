'use client';

import Link from 'next/link';
import {
  ArrowRight,
  Boxes,
  Network,
  Plug,
  Radio,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import AppearIn from '@/components/explore/AppearIn';
import { TOOL_COUNT, TOOL_GROUPS, numberWord, toolCountWord } from '@/lib/mcp/catalog';
import CrossLinkCards from './CrossLinkCards';
import FeatureSection from './FeatureSection';
import McpConversationVisual from './McpConversationVisual';
import McpResultAnatomyVisual from './McpResultAnatomyVisual';
import McpFirehoseVisual from './McpFirehoseVisual';
import McpSetupVisual from './McpSetupVisual';
import McpToolCatalogVisual from './McpToolCatalogVisual';

export default function McpLanding({ endpoint }: { endpoint: string }) {
  const display = endpoint.replace(/^https?:\/\//, '');
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '4rem' }}>
      <AppearIn rise>
        <header className="landing-hero" style={{ display: 'grid', gap: '2.5rem', alignItems: 'center' }}>
          <div>
            <Badge icon={<Plug size={12} aria-hidden />}>MCP server</Badge>
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
              Claude, Cursor, or any MCP client. Your agent can then resolve any
              Atmosphere link, read any account&rsquo;s repository, trace who
              references what across every app, and watch the firehose as it
              happens. No key, no account, nothing to install.
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
              {TOOL_COUNT} read-only tools · {TOOL_GROUPS.length} groups · no API key
            </p>
            <EndpointBlock endpoint={endpoint} />
          </div>
          <div>
            <McpConversationVisual />
          </div>
        </header>
      </AppearIn>

      <FeatureSection
        badge={{ icon: <Sparkles size={12} />, label: 'What it looks like' }}
        title="Ask in plain language, get real records"
        body={
          <>
            <p>
              The agent picks the tools. &ldquo;What has this account been
              posting about, and which post landed best?&rdquo; becomes a
              handle resolved to a DID, then a feed read with engagement counts
              attached, then a summary you can check.
            </p>
            <p>
              Every answer carries the{' '}
              <code style={{ color: 'var(--text-accent)' }}>at://</code> URI of
              what it describes and an aturi.to link beside it, so anything the
              agent mentions is one click from opening in whichever client you
              already use.
            </p>
          </>
        }
        visual={<McpResultAnatomyVisual />}
        flip
      />

      <FeatureSection
        badge={{ icon: <Boxes size={12} />, label: 'The catalog' }}
        title={`${capitalize(toolCountWord())} tools, ${numberWord(TOOL_GROUPS.length)} groups`}
        body={
          <>
            <p>
              Resolution and identity, whole repositories, the network graph,
              the Bluesky social layer, custom feeds and lists, lexicon
              activity, and a live firehose tap. Each tool describes when to
              reach for it, so a model routes to the right one instead of
              guessing.
            </p>
            <p>
              Tool descriptions and this list come from the same file, checked
              by a test against the tools the server actually registers. What
              you read here is what answers.
            </p>
          </>
        }
        visual={<McpToolCatalogVisual />}
      />

      <FeatureSection
        badge={{ icon: <Network size={12} />, label: 'Beyond one app' }}
        title="Questions a single client cannot answer"
        body={
          <>
            <p>
              Most Bluesky integrations stop at Bluesky. These tools read the
              protocol underneath it: any personal data server, any lexicon,
              any record type. You can ask which apps an account actually
              writes to, when it changed hosts, or what a schema means.
            </p>
            <p>
              Backlinks come from{' '}
              <a href="https://constellation.microcosm.blue" target="_blank" rel="noreferrer">
                Constellation
              </a>
              , so &ldquo;who links to this?&rdquo; spans every lexicon rather
              than one app&rsquo;s replies. Lexicon activity comes from{' '}
              <a href="https://ufos-api.microcosm.blue" target="_blank" rel="noreferrer">
                UFOs
              </a>
              , which is how an agent finds the corners of the network nobody
              has told it about.
            </p>
          </>
        }
        visual={<NetworkReachVisual />}
        flip
      />

      <FeatureSection
        badge={{ icon: <Radio size={12} />, label: 'Live' }}
        title="A bounded window on the firehose"
        body={
          <>
            <p>
              MCP is request and response, so a socket an agent holds open does
              not fit.{' '}
              <code style={{ color: 'var(--text-accent)' }}>sample_firehose</code>{' '}
              opens Jetstream, collects until it hits an event cap or a few
              seconds pass, then closes and hands back what it saw.
            </p>
            <p>
              Filter by collection, by specific accounts, or by operation. It is
              the only tool here that sees deletions, and the only one that can
              watch one account&rsquo;s writes as they land.
            </p>
          </>
        }
        visual={<McpFirehoseVisual />}
      />

      <FeatureSection
        badge={{ icon: <Plug size={12} />, label: 'Setup' }}
        title="Add it in one line"
        body={
          <>
            <p>
              Any client that speaks Streamable HTTP works, on the 2026 spec or
              the 2025 one; the same endpoint serves both. Clients that only
              speak stdio can bridge with{' '}
              <code style={{ color: 'var(--text-accent)' }}>npx mcp-remote</code>.
            </p>
            <p>
              There is nothing to sign up for and no rate-limit registration.
              Be reasonable about volume; the services underneath are run by
              volunteers.
            </p>
          </>
        }
        visual={<McpSetupVisual endpoint={endpoint} />}
        flip
      />

      <FeatureSection
        badge={{ icon: <ShieldCheck size={12} />, label: 'Read-only' }}
        title="It reads. It never writes."
        body={
          <>
            <p>
              No tool here can post, like, follow, or edit anything, and the
              server holds no credentials to do it with. It stores nothing
              about who calls it: no accounts, no logs of what you asked.
            </p>
            <p>
              Write access is coming as a package you run on your own machine,
              holding your own keys, the same trade{' '}
              <Link href="/extension">the extension</Link> already makes. That
              keeps this endpoint something you can point an agent at without
              handing anyone your account.
            </p>
          </>
        }
        visual={<PostureVisual />}
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
          <h2
            style={{
              fontSize: '1.375rem',
              fontWeight: 300,
              margin: 0,
              color: 'var(--text-primary)',
              letterSpacing: '-0.01em',
            }}
          >
            Things to ask once it is connected
          </h2>
          <ul
            style={{
              margin: 0,
              padding: 0,
              listStyle: 'none',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            {[
              'Who links to this post, anywhere on the network?',
              'What apps does this account actually use, and when did it change servers?',
              'Which lexicons are busiest today, and what do their records look like?',
              'What is trending on Bluesky right now, and who is driving it?',
              'Show me leaflet.pub documents as people publish them.',
            ].map((question) => (
              <li
                key={question}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: '0.5rem',
                  color: 'var(--text-secondary)',
                  fontSize: '0.95rem',
                  lineHeight: 1.55,
                }}
              >
                <ArrowRight
                  size={14}
                  aria-hidden
                  style={{ color: 'var(--text-accent)', flexShrink: 0, marginTop: '0.25rem' }}
                />
                {question}
              </li>
            ))}
          </ul>
          <p style={{ margin: 0, fontSize: '0.9rem', color: 'var(--text-tertiary)', lineHeight: 1.6 }}>
            Building software instead of prompting an agent? The same answers
            are plain GET endpoints, typed in{' '}
            <a href="/openapi.json">the OpenAPI document</a> and explained in
            the <Link href="/docs">developer docs</Link>. Agents that read
            rather than call tools should start at{' '}
            <a href="/llms.txt">/llms.txt</a>.
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
        marginBottom: '1.25rem',
        lineHeight: 1,
      }}
    >
      {icon}
      {children}
    </span>
  );
}

/** The endpoint, shown the way you would paste it. */
function EndpointBlock({ endpoint }: { endpoint: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      <div
        style={{
          border: '1px solid var(--border-medium)',
          background: 'var(--bg-tertiary)',
          padding: '0.75rem 0.875rem',
          fontFamily: 'var(--font-mono)',
          fontSize: '0.9rem',
          color: 'var(--text-primary)',
          wordBreak: 'break-all',
        }}
      >
        {endpoint}
      </div>
      <span style={{ fontSize: '0.8rem', color: 'var(--text-tertiary)' }}>
        Add it as a custom connector or MCP server. Setup per client is below.
      </span>
    </div>
  );
}

/** Where the answers come from: four sources, one endpoint. */
function NetworkReachVisual() {
  const sources = [
    { name: 'Any PDS', detail: 'repositories, records, server metadata' },
    { name: 'plc.directory', detail: 'identity history, key rotations, migrations' },
    { name: 'Constellation', detail: 'backlinks across every lexicon' },
    { name: 'UFOs', detail: 'lexicon activity network-wide' },
    { name: 'Bluesky AppView', detail: 'posts, threads, graph, trends' },
    { name: 'Jetstream', detail: 'the live firehose' },
  ];
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      {sources.map((source) => (
        <div
          key={source.name}
          style={{
            display: 'flex',
            alignItems: 'baseline',
            gap: '0.75rem',
            border: '1px solid var(--border-subtle)',
            background: 'var(--bg-secondary)',
            padding: '0.5rem 0.75rem',
          }}
        >
          <span
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: '0.72rem',
              color: 'var(--text-accent)',
              minWidth: '8.5rem',
            }}
          >
            {source.name}
          </span>
          <span style={{ fontSize: '0.75rem', color: 'var(--text-tertiary)', lineHeight: 1.4 }}>
            {source.detail}
          </span>
        </div>
      ))}
    </div>
  );
}

/** What the server will and will not do, as a two-column ledger. */
function PostureVisual() {
  const rows: Array<{ can: string; cannot: string }> = [
    { can: 'Read any public record', cannot: 'Post, like, or follow' },
    { can: 'Trace links across apps', cannot: 'Edit or delete anything' },
    { can: 'Watch the live firehose', cannot: 'Hold your credentials' },
    { can: 'Answer without an account', cannot: 'Store who asked' },
  ];
  return (
    <div style={{ width: '100%', border: '1px solid var(--border-subtle)', background: 'var(--bg-secondary)' }}>
      {rows.map((row, i) => (
        <div
          key={row.can}
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            borderBottom: i === rows.length - 1 ? 'none' : '1px solid var(--border-subtle)',
          }}
        >
          <span
            style={{
              padding: '0.6rem 0.75rem',
              fontSize: '0.75rem',
              color: 'var(--text-secondary)',
              borderRight: '1px solid var(--border-subtle)',
              lineHeight: 1.4,
            }}
          >
            {row.can}
          </span>
          <span
            style={{
              padding: '0.6rem 0.75rem',
              fontSize: '0.75rem',
              color: 'var(--text-tertiary)',
              lineHeight: 1.4,
            }}
          >
            {row.cannot}
          </span>
        </div>
      ))}
    </div>
  );
}
