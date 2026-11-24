/**
 * Every tool under /tools, in the order the hub lists them.
 *
 * This is the single source for each place a tool is named: the hub's tiles,
 * each tool page's title, lead and metadata, the sitemap, and the keywords the
 * command palette matches "Go to tools" on. A new tool is a route under
 * /tools plus an entry here; nothing else needs to learn its name.
 *
 * All of them are static pages that do their work in the browser, so links to
 * them keep Next's default prefetch (AGENTS.md, rule 7).
 */

import {
  Activity,
  AtSign,
  BadgeCheck,
  Binary,
  BookCheck,
  CalendarDays,
  EyeOff,
  FileArchive,
  FileCheck2,
  KeyRound,
  ListChecks,
  PanelTop,
  RadioTower,
  Rss,
  ScanText,
  ServerCog,
  Share2,
  SquareTerminal,
  Tags,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';

export type ToolGroupId = 'network' | 'identity' | 'accounts' | 'records' | 'services';

export type ToolGroup = {
  id: ToolGroupId;
  title: string;
};

export type ToolEntry = {
  /** The path segment under /tools. */
  slug: string;
  title: string;
  /** One sentence for the page's meta description and link card. */
  desc: string;
  /** One short line for the hub tile. */
  tile: string;
  /**
   * A line under the tool's own heading, only where the user needs to know
   * something before using it (what leaves the browser, what is compared).
   */
  lead?: string;
  group: ToolGroupId;
  Icon: LucideIcon;
  /** Extra words the command palette matches on. */
  keywords: string[];
};

export const TOOL_GROUPS: ToolGroup[] = [
  { id: 'network', title: 'Network' },
  { id: 'identity', title: 'Identity' },
  { id: 'accounts', title: 'Accounts' },
  { id: 'records', title: 'Records and lexicons' },
  { id: 'services', title: 'Services and the web' },
];

export const TOOLS: ToolEntry[] = [
  {
    slug: 'stream',
    title: 'Stream monitor',
    desc: 'Watch Jetstream and the PLC directory live, filtered by event type, account, collection or text.',
    tile: 'Live Jetstream and PLC events, filtered.',
    group: 'network',
    Icon: Activity,
    keywords: ['jetstream', 'firehose', 'plc', 'stream', 'monitor', 'live'],
  },
  {
    slug: 'xrpc',
    title: 'XRPC console',
    desc: 'Call any atproto query: pick a method, fill in its parameters from the lexicon, and read the response.',
    tile: 'Call any atproto query and read the response.',
    group: 'network',
    Icon: SquareTerminal,
    keywords: ['xrpc', 'api', 'console', 'playground', 'query', 'endpoint', 'request'],
  },
  {
    slug: 'relay',
    title: 'Relay crawl check',
    desc: 'Ask the relays whether they are crawling a PDS, how many accounts they see on it, and how far they have read.',
    tile: 'Check whether relays are crawling a PDS.',
    group: 'network',
    Icon: RadioTower,
    keywords: ['relay', 'crawl', 'pds', 'host', 'firehose', 'self-host', 'requestcrawl'],
  },
  {
    slug: 'pds',
    title: 'PDS version check',
    desc: 'See whether a PDS runs the latest release of the reference PDS, how many releases behind it is, and since when.',
    tile: 'Check whether a PDS runs the latest release.',
    lead: 'Compared with releases of the reference PDS. Other PDS software can’t be compared.',
    group: 'network',
    Icon: ServerCog,
    keywords: ['pds', 'version', 'update', 'up to date', 'outdated', 'release', 'self-host', 'pdsadmin', 'health'],
  },
  {
    slug: 'handle',
    title: 'Handle debugger',
    desc: 'Check a handle step by step: the DNS record, the well-known file, the DID document and the PDS behind it.',
    tile: 'Find the step where a handle stops resolving.',
    group: 'identity',
    Icon: AtSign,
    keywords: ['handle', 'dns', 'well-known', 'did', 'verify', 'domain', 'invalid', 'debug'],
  },
  {
    slug: 'resolve',
    title: 'Bulk identity resolver',
    desc: 'Paste a list of handles and DIDs and get each one’s DID, handle and PDS as a table to copy or download.',
    tile: 'Resolve a list of handles and DIDs to a table.',
    group: 'identity',
    Icon: ListChecks,
    keywords: ['resolve', 'bulk', 'batch', 'did', 'handle', 'csv', 'lookup'],
  },
  {
    slug: 'decode',
    title: 'Identifier decoder',
    desc: 'Take apart a TID, CID, at:// URI, DID, NSID or JWT and see what each part means. Nothing leaves the browser.',
    tile: 'Take apart a TID, CID, at:// URI, DID, NSID or JWT.',
    lead: 'Decoded in the browser. Nothing is sent.',
    group: 'identity',
    Icon: Binary,
    keywords: ['tid', 'cid', 'rkey', 'at-uri', 'did:key', 'jwt', 'decode', 'timestamp', 'nsid'],
  },
  {
    slug: 'activity',
    title: 'Activity calendar',
    desc: 'A year of one account’s writes across every app, drawn from the timestamps inside its record keys.',
    tile: 'A year of an account’s writes, across every app.',
    group: 'accounts',
    Icon: CalendarDays,
    keywords: ['activity', 'calendar', 'heatmap', 'history', 'contributions', 'timeline'],
  },
  {
    slug: 'memberships',
    title: 'Lists and verifications',
    desc: 'Find the lists an account has been added to and the accounts that have verified it, from records across the network.',
    tile: 'Lists an account is on, and who verified it.',
    group: 'accounts',
    Icon: BadgeCheck,
    keywords: ['lists', 'listitem', 'verification', 'verified', 'memberships', 'starter pack', 'moderation list'],
  },
  {
    slug: 'labels',
    title: 'Label checker',
    desc: 'See the labels on an account or post, which labeler applied each one, and what that labeler says it means.',
    tile: 'Every label on an account or post, and who applied it.',
    lead: 'From every labeler, not only the ones your app subscribes to.',
    group: 'accounts',
    Icon: Tags,
    keywords: ['labels', 'labeler', 'moderation', 'ozone', 'takedown', 'warning'],
  },
  {
    slug: 'shadowban',
    title: 'Shadowban checker',
    desc: 'Compare an account’s posts on its PDS with what an AppView returns, and find posts, replies or search results that are missing.',
    tile: 'Find posts, replies or search results an AppView hides.',
    lead: 'Compares an account’s posts on its PDS with what the AppView returns.',
    group: 'accounts',
    Icon: EyeOff,
    keywords: ['shadowban', 'shadow ban', 'hidden', 'needs review', 'visibility', 'appview', 'search', 'suppressed'],
  },
  {
    slug: 'mutuals',
    title: 'Mutuals’ blocks',
    desc: 'See which accounts your mutuals block most, map how their blocks overlap, and save the ones you pick as a moderation list.',
    tile: 'Which accounts your mutuals block, and how much they agree.',
    group: 'accounts',
    Icon: UsersRound,
    keywords: ['mutuals', 'moots', 'blocks', 'blocked', 'block list', 'moderation list', 'modlist', 'six degrees'],
  },
  {
    slug: 'car',
    title: 'Repo archive inspector',
    desc: 'Open a repository export (a CAR file) in the browser: its commit, its collections and every record in it.',
    tile: 'Browse a repository export (CAR file).',
    lead: 'Opened in the browser. Nothing is uploaded.',
    group: 'accounts',
    Icon: FileArchive,
    keywords: ['car', 'archive', 'backup', 'export', 'repo', 'getRepo', 'cbor', 'mst'],
  },
  {
    slug: 'validate',
    title: 'Record validator',
    desc: 'Check a record against the lexicon its author published, and list every field that does not match.',
    tile: 'Check a record against its published lexicon.',
    group: 'records',
    Icon: FileCheck2,
    keywords: ['validate', 'lexicon', 'schema', 'record', 'json', 'lint'],
  },
  {
    slug: 'post',
    title: 'Post inspector',
    desc: 'Open a Bluesky post’s record: facets by byte range, embeds, reply and quote rules, labels and timestamps.',
    tile: 'A post record’s facets, embeds, gates and timestamps.',
    group: 'records',
    Icon: ScanText,
    keywords: ['post', 'facets', 'richtext', 'bytes', 'threadgate', 'postgate', 'embed', 'inspect'],
  },
  {
    slug: 'lexicon',
    title: 'Lexicon publishing checker',
    desc: 'Follow an NSID from its DNS record to the schema record behind it, and see where the chain breaks.',
    tile: 'Trace an NSID from DNS to its schema record.',
    group: 'records',
    Icon: BookCheck,
    keywords: ['lexicon', 'nsid', 'publish', '_lexicon', 'dns', 'schema', 'authority'],
  },
  {
    slug: 'feed',
    title: 'Feed inspector',
    desc: 'Look inside a custom feed: who runs it, whether its generator answers, and the raw skeleton it returns.',
    tile: 'Check a custom feed and what its generator returns.',
    group: 'services',
    Icon: Rss,
    keywords: ['feed', 'generator', 'skeleton', 'algorithm', 'custom feed', 'feedgen'],
  },
  {
    slug: 'oauth',
    title: 'OAuth client checker',
    desc: 'Validate an OAuth client metadata document against the atproto profile, and build or read a scope string.',
    tile: 'Validate OAuth client metadata and build scopes.',
    group: 'services',
    Icon: KeyRound,
    keywords: ['oauth', 'client metadata', 'client_id', 'scope', 'dpop', 'permission', 'granular'],
  },
  {
    slug: 'share',
    title: 'Share button builder',
    desc: 'Make “share to the Atmosphere” links and buttons that open the composer in each client that supports it.',
    tile: 'Make share links and buttons for every client.',
    group: 'services',
    Icon: Share2,
    keywords: ['share', 'intent', 'compose', 'button', 'link', 'embed'],
  },
  {
    slug: 'page',
    title: 'Page checker',
    desc: 'See how a web page presents itself to the Atmosphere: its link card and the at:// records it declares.',
    tile: 'A web page’s link card and at:// tags.',
    group: 'services',
    Icon: PanelTop,
    keywords: ['page', 'link card', 'open graph', 'og', 'at tags', 'preview', 'meta'],
  },
];

const BY_SLUG = new Map(TOOLS.map((tool) => [tool.slug, tool]));

/** The catalog entry for a slug. Throws on a slug that is not listed, at build time. */
export function toolBySlug(slug: string): ToolEntry {
  const tool = BY_SLUG.get(slug);
  if (!tool) throw new Error(`No tool is registered for "${slug}"`);
  return tool;
}

export function toolHref(slug: string): string {
  return `/tools/${slug}`;
}

/** Tools by group, in catalog order, skipping any group left empty. */
export function toolsByGroup(): { group: ToolGroup; tools: ToolEntry[] }[] {
  return TOOL_GROUPS.map((group) => ({
    group,
    tools: TOOLS.filter((tool) => tool.group === group.id),
  })).filter((entry) => entry.tools.length > 0);
}
