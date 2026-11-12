import type { Metadata } from 'next';
import { toolBySlug } from './catalog';

/**
 * Page metadata for a tool, read from its catalog entry so the tab title, the
 * hub tile and the link card all say the same thing.
 */
export function toolMetadata(slug: string): Metadata {
  const tool = toolBySlug(slug);
  const title = `${tool.title} · aturi.to`;
  return {
    title,
    description: tool.desc,
    openGraph: { title, description: tool.desc, type: 'website' },
    twitter: { card: 'summary_large_image', title, description: tool.desc },
  };
}
