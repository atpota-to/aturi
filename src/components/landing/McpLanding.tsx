'use client';

import { ArrowRight, Boxes, Plug } from 'lucide-react';
import AppearIn from '@/components/explore/AppearIn';
import { TOOL_COUNT, toolCountWord } from '@/lib/mcp/catalog';
import { MCP_NAME, MCP_STAGE } from '@/lib/mcp/about';
import CopyButton from '@/components/explore/CopyButton';
import CrossLinkCards from './CrossLinkCards';
import FeatureSection from './FeatureSection';
import McpConversationVisual from './McpConversationVisual';
import McpSetupVisual from './McpSetupVisual';
import McpToolCatalogVisual from './McpToolCatalogVisual';

/**
 * Questions that need the whole network, not one app. Spread across the
 * groups on purpose: a backlink, a repo read, PLC history, a lexicon from an
 * app that is not Bluesky, the docs, and a link to hand a person. Mixed
 * questions and instructions, because that is how people talk to an agent.
 */
const EXAMPLES = [
  'Who links to this post, from any app?',
  'What has this account been posting about, and which post did best?',
  'When did this account last change servers?',
  'What is flushes.app writing to my repo?',
  'What parameters does getAuthorFeed take?',
  'How do record keys work in atproto?',
  'Which version of Jetstream is current?',
  'Give me a link my friend can open in her own client.',
];

export default function McpLanding({ endpoint }: { endpoint: string }) {
  const display = endpoint.replace(/^https?:\/\//, '');
  return (
    <div className="fl-page">
      <AppearIn rise>
        <header className="fl-hero">
          <div className="fl-hero-copy">
            <span className="fl-pill">
              <Plug size={13} aria-hidden /> {MCP_NAME}
              <span className="fl-pill-tag">{MCP_STAGE}</span>
            </span>
            <h1 className="fl-title">
              One URL makes the Atmosphere{' '}
              <span className="fl-title-accent">more traversable for agents</span>
            </h1>
            <p className="fl-lede">
              Add <code>{display}</code> to your AI&rsquo;s interface to get
              structured and contextual access to the Atmosphere. Analyze any
              repository, explore backlinks, learn how the protocol works, and
              ask clarifying questions. No key, no account, nothing to install.
            </p>
            <p className="fl-meta">
              <Boxes size={14} aria-hidden />
              {TOOL_COUNT} read-only tools · no API key
            </p>
            <EndpointBlock endpoint={endpoint} />
          </div>
          <div className="fl-hero-visual">
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
            <code>npx mcp-remote</code>.
          </p>
        }
        visual={<McpSetupVisual endpoint={endpoint} />}
      />

      <section className="fl-section">
        <div className="fl-section-head">
          <span className="fl-kicker">
            <Boxes size={14} /> The tools
          </span>
          <h2 className="fl-h2">{`${capitalize(toolCountWord())} tools`}</h2>
          {/* The grid below already names all ten groups, so the prose says
              what the grid cannot. */}
          <p className="fl-body">
            Every tool is read-only. Most work against any repository on any
            PDS, so reading a Leaflet document or a Tangled repo takes the
            same call as reading a Bluesky post.
          </p>
        </div>
        <div className="fl-card fl-asks">
          <span className="fl-mock-label">Things to ask</span>
          <ul>
            {EXAMPLES.map((question) => (
              <li key={question}>
                <ArrowRight size={14} aria-hidden />
                {question}
              </li>
            ))}
          </ul>
        </div>
        <McpToolCatalogVisual />
      </section>

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

/** The endpoint, shown the way you would paste it, with a one-click copy. */
function EndpointBlock({ endpoint }: { endpoint: string }) {
  return (
    <div className="fl-endpoint">
      <code>{endpoint}</code>
      <CopyButton value={endpoint} label="Copy" compact />
    </div>
  );
}
