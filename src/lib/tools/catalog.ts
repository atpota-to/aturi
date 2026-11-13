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
  Share2,
  SquareTerminal,
  Tags,
  type LucideIcon,
} from 'lucide-react';

export type ToolGroupId = 'network' | 'identity' | 'accounts' | 'records' | 'services';

export type ToolGroup = {
  id: ToolGroupId;
  title: string;
  /** What the group is for, one short sentence. */
  blurb: string;
};

export type ToolEntry = {
  /** The path segment under /tools. */
  slug: string;
  title: string;
  /** One sentence for the hub tile and the page's meta description. */
  desc: string;
  /** The line under the tool's own heading. May say a little more than `desc`. */
  lead: string;
  group: ToolGroupId;
  Icon: LucideIcon;
  /** Extra words the command palette matches on. */
  keywords: string[];
};

export const TOOL_GROUPS: ToolGroup[] = [
  { id: 'network', title: 'Network', blurb: 'What the network is doing, and how to ask it.' },
  { id: 'identity', title: 'Identity', blurb: 'Handles, DIDs and the identifiers records are built from.' },
  { id: 'accounts', title: 'Accounts', blurb: 'What an account has written, and what others say about it.' },
  { id: 'records', title: 'Records and lexicons', blurb: 'Check a record against its schema, and a schema against the network.' },
  { id: 'services', title: 'Services and the web', blurb: 'Feed generators, OAuth clients, and pages that point at records.' },
];

export const TOOLS: ToolEntry[] = [
  {
    slug: 'stream',
    title: 'Stream monitor',
    desc: 'Watch Jetstream and the PLC directory live, filtered by event type, account, collection or text.',
    lead: 'Records being written across the Atmosphere and every did:plc operation, as they happen.',
    group: 'network',
    Icon: Activity,
    keywords: ['jetstream', 'firehose', 'plc', 'stream', 'monitor', 'live'],
  },
  {
    slug: 'xrpc',
    title: 'XRPC console',
    desc: 'Call any atproto query: pick a method, fill in its parameters from the lexicon, and read the response.',
    lead: 'Pick a query from the atproto and Bluesky lexicons, fill in its parameters, and send it to the public AppView or any PDS.',
    group: 'network',
    Icon: SquareTerminal,
    keywords: ['xrpc', 'api', 'console', 'playground', 'query', 'endpoint', 'request'],
  },
  {
    slug: 'relay',
    title: 'Relay crawl check',
    desc: 'Ask the relays whether they are crawling a PDS, how many accounts they see on it, and how far they have read.',
    lead: 'A PDS only reaches the network through a relay. This asks each one what it knows about a host.',
    group: 'network',
    Icon: RadioTower,
    keywords: ['relay', 'crawl', 'pds', 'host', 'firehose', 'self-host', 'requestcrawl'],
  },
  {
    slug: 'handle',
    title: 'Handle debugger',
    desc: 'Check a handle step by step: the DNS record, the well-known file, the DID document and the PDS behind it.',
    lead: 'A handle is only valid when it points at a DID and that DID points back. This checks both directions and says which step fails.',
    group: 'identity',
    Icon: AtSign,
    keywords: ['handle', 'dns', 'well-known', 'did', 'verify', 'domain', 'invalid', 'debug'],
  },
  {
    slug: 'resolve',
    title: 'Bulk identity resolver',
    desc: 'Paste a list of handles and DIDs and get each one’s DID, handle and PDS as a table to copy or download.',
    lead: 'Paste handles and DIDs, one per line or separated by commas. Each is resolved to its DID, current handle and PDS.',
    group: 'identity',
    Icon: ListChecks,
    keywords: ['resolve', 'bulk', 'batch', 'did', 'handle', 'csv', 'lookup'],
  },
  {
    slug: 'decode',
    title: 'Identifier decoder',
    desc: 'Take apart a TID, CID, at:// URI, DID, NSID or JWT and see what each part means. Nothing leaves the browser.',
    lead: 'Paste a record key, CID, at:// URI, DID, NSID or a token. It is decoded here in the browser and never sent anywhere.',
    group: 'identity',
    Icon: Binary,
    keywords: ['tid', 'cid', 'rkey', 'at-uri', 'did:key', 'jwt', 'decode', 'timestamp', 'nsid'],
  },
  {
    slug: 'activity',
    title: 'Activity calendar',
    desc: 'A year of one account’s writes across every app, drawn from the timestamps inside its record keys.',
    lead: 'Every record key carries the moment it was made. This reads an account’s keys across every collection and draws the year.',
    group: 'accounts',
    Icon: CalendarDays,
    keywords: ['activity', 'calendar', 'heatmap', 'history', 'contributions', 'timeline'],
  },
  {
    slug: 'memberships',
    title: 'Lists and verifications',
    desc: 'Find the lists an account has been added to and the accounts that have verified it, from records across the network.',
    lead: 'Lists and verifications are records in other people’s repositories. This finds the ones that point at an account.',
    group: 'accounts',
    Icon: BadgeCheck,
    keywords: ['lists', 'listitem', 'verification', 'verified', 'memberships', 'starter pack', 'moderation list'],
  },
  {
    slug: 'labels',
    title: 'Label checker',
    desc: 'See the labels on an account or post, which labeler applied each one, and what that labeler says it means.',
    lead: 'Labels come from independent labelers, and an app only shows the ones it subscribes to. This asks for all of them.',
    group: 'accounts',
    Icon: Tags,
    keywords: ['labels', 'labeler', 'moderation', 'ozone', 'takedown', 'warning'],
  },
  {
    slug: 'shadowban',
    title: 'Shadowban checker',
    desc: 'Compare an account’s posts on its PDS with what an AppView returns, and find posts, replies or search results that are missing.',
    lead: 'An AppView can hide an account without labeling it. Its replies disappear from threads, or it stops showing up in search. This reads the account’s posts from its PDS and compares them with what the AppView returns.',
    group: 'accounts',
    Icon: EyeOff,
    keywords: ['shadowban', 'shadow ban', 'hidden', 'needs review', 'visibility', 'appview', 'search', 'suppressed'],
  },
  {
    slug: 'car',
    title: 'Repo archive inspector',
    desc: 'Open a repository export (a CAR file) in the browser: its commit, its collections and every record in it.',
    lead: 'A repository export is one file holding every record an account has written. Open one here, or fetch an account’s, and browse it without uploading it anywhere.',
    group: 'accounts',
    Icon: FileArchive,
    keywords: ['car', 'archive', 'backup', 'export', 'repo', 'getRepo', 'cbor', 'mst'],
  },
  {
    slug: 'validate',
    title: 'Record validator',
    desc: 'Check a record against the lexicon its author published, and list every field that does not match.',
    lead: 'Paste a record, or point at one by at:// URI. It is checked against the schema published for its type.',
    group: 'records',
    Icon: FileCheck2,
    keywords: ['validate', 'lexicon', 'schema', 'record', 'json', 'lint'],
  },
  {
    slug: 'post',
    title: 'Post inspector',
    desc: 'Open a Bluesky post’s record: facets by byte range, embeds, reply and quote rules, labels and timestamps.',
    lead: 'Everything a post record says and an app does not show: where each link and mention starts and ends, who may reply, and when it was really written.',
    group: 'records',
    Icon: ScanText,
    keywords: ['post', 'facets', 'richtext', 'bytes', 'threadgate', 'postgate', 'embed', 'inspect'],
  },
  {
    slug: 'lexicon',
    title: 'Lexicon publishing checker',
    desc: 'Follow an NSID from its DNS record to the schema record behind it, and see where the chain breaks.',
    lead: 'A lexicon is published by a DNS record that names a DID, and a schema record in that DID’s repository. This walks the chain.',
    group: 'records',
    Icon: BookCheck,
    keywords: ['lexicon', 'nsid', 'publish', '_lexicon', 'dns', 'schema', 'authority'],
  },
  {
    slug: 'feed',
    title: 'Feed inspector',
    desc: 'Look inside a custom feed: who runs it, whether its generator answers, and the raw skeleton it returns.',
    lead: 'A feed is a record that names a service. This reads the record, asks the service what it serves, and shows what comes back.',
    group: 'services',
    Icon: Rss,
    keywords: ['feed', 'generator', 'skeleton', 'algorithm', 'custom feed', 'feedgen'],
  },
  {
    slug: 'oauth',
    title: 'OAuth client checker',
    desc: 'Validate an OAuth client metadata document against the atproto profile, and build or read a scope string.',
    lead: 'Fetch a client metadata document and check it against what atproto authorization servers require, or put together the scopes an app should ask for.',
    group: 'services',
    Icon: KeyRound,
    keywords: ['oauth', 'client metadata', 'client_id', 'scope', 'dpop', 'permission', 'granular'],
  },
  {
    slug: 'share',
    title: 'Share button builder',
    desc: 'Make “share to the Atmosphere” links and buttons that open the composer in each client that supports it.',
    lead: 'Write the text once and get a link for every client with a compose route, plus markup to put on a page.',
    group: 'services',
    Icon: Share2,
    keywords: ['share', 'intent', 'compose', 'button', 'link', 'embed'],
  },
  {
    slug: 'page',
    title: 'Page checker',
    desc: 'See how a web page presents itself to the Atmosphere: its link card and the at:// records it declares.',
    lead: 'Fetch a page the way a client would, and read the link card it offers and the at:// tags that tie it to a record.',
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
