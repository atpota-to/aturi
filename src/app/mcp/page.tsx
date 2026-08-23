import type { Metadata } from 'next';
import Header from '@/components/Header';
import McpLanding from '@/components/landing/McpLanding';
import { getSiteUrl } from '@/lib/config';
import { TOOL_COUNT } from '@/lib/mcp/catalog';

const endpoint = `${getSiteUrl()}/api/mcp`;
const description =
  `A keyless, read-only MCP server for atproto: ${TOOL_COUNT} tools that let an AI agent resolve any ` +
  'Atmosphere link, read any repository, trace backlinks across every app, and sample the live firehose.';

export const metadata: Metadata = {
  title: 'MCP server · aturi.to',
  description,
  alternates: { canonical: `${getSiteUrl()}/mcp` },
  openGraph: {
    title: 'MCP server · aturi.to',
    description,
    type: 'website',
    url: `${getSiteUrl()}/mcp`,
  },
  twitter: {
    card: 'summary_large_image',
    title: 'MCP server · aturi.to',
    description,
  },
};

export default function McpPage() {
  return (
    <>
      <Header compact />
      <div className="container-narrow" style={{ padding: '0 2rem 4rem', minHeight: '80dvh' }}>
        <McpLanding endpoint={endpoint} />
      </div>
    </>
  );
}
