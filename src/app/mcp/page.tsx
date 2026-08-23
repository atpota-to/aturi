import type { Metadata } from 'next';
import ContentPageView from '@/components/ContentPageView';
import { buildMcpPage } from '@/lib/siteContent';
import { getSiteUrl } from '@/lib/config';

const page = buildMcpPage(getSiteUrl());

export const metadata: Metadata = {
  title: 'MCP server · aturi.to',
  description: page.description,
  alternates: { canonical: `${getSiteUrl()}/mcp` },
  openGraph: {
    title: 'MCP server · aturi.to',
    description: page.description,
    type: 'website',
    url: `${getSiteUrl()}/mcp`,
  },
};

export default function McpPage() {
  return <ContentPageView page={page} />;
}
