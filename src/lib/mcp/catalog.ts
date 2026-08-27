/**
 * The tool catalog as prose: what each tool is for, in the words a person
 * reads rather than the dispatch criteria an agent routes on.
 *
 * This is the single source for every human-facing listing of the server —
 * the /mcp landing page and its Markdown twin both render it, so the tool
 * count and names in the copy cannot drift from the ones actually served. A
 * test asserts this list matches what registry.ts registers, which is the
 * failure mode worth guarding: a tool added to the code and forgotten in the
 * docs reads as a smaller product than it is, and a tool named here but not
 * registered sends agents at something that will never answer.
 */

export type CatalogTool = {
  name: string;
  /** One line, sentence case, no trailing period. */
  summary: string;
};

export type CatalogGroup = {
  id: string;
  title: string;
  /** What the group is for, one sentence. */
  blurb: string;
  tools: CatalogTool[];
};

export const TOOL_GROUPS: CatalogGroup[] = [
  {
    id: 'resolve',
    title: 'Resolve and open',
    blurb: 'Turn any Atmosphere link into the record behind it, and into every client that can open it.',
    tools: [
      { name: 'resolve_link', summary: 'Any URL or at:// URI in, the record and every client that renders it out' },
      { name: 'list_waypoints', summary: 'The client catalog itself, filterable by record type and compose support' },
    ],
  },
  {
    id: 'identity',
    title: 'Identity',
    blurb: 'Who an account is, where its data lives, and how that changed over time.',
    tools: [
      { name: 'resolve_identity', summary: 'Handle to DID to PDS, with the DID document summary' },
      { name: 'get_identity_history', summary: 'The PLC audit log: handle changes, server migrations, key rotations' },
    ],
  },
  {
    id: 'repos',
    title: 'Repositories',
    blurb: 'Read any account’s repository directly from its PDS, whatever apps wrote to it.',
    tools: [
      { name: 'describe_repo', summary: 'Which lexicons an account actually uses, plus its host and last write' },
      { name: 'list_records', summary: 'Page through any collection in any repo' },
      { name: 'get_record', summary: 'One record by at:// URI, edge-cached with a direct-PDS fallback' },
      { name: 'describe_pds', summary: 'A server’s metadata, version, and a sample of who it hosts' },
    ],
  },
  {
    id: 'graph',
    title: 'Network graph',
    blurb: 'What references a record or an account, across every app rather than one.',
    tools: [
      { name: 'get_backlinks', summary: 'Who links here, grouped by lexicon and link path, from the Constellation index' },
    ],
  },
  {
    id: 'bluesky',
    title: 'Bluesky layer',
    blurb: 'The social reading most people mean by Bluesky: posts, threads, graph, engagement.',
    tools: [
      { name: 'get_profile', summary: 'Up to 25 profile cards in one call' },
      { name: 'get_author_feed', summary: 'Recent posts with like, repost, reply, and quote counts' },
      { name: 'get_thread', summary: 'A conversation as a depth-capped tree' },
      { name: 'get_posts', summary: 'Hydrate up to 25 post URIs into readable posts' },
      { name: 'get_post_engagement', summary: 'Who liked, reposted, or quoted a post' },
      { name: 'get_follows', summary: 'Accounts an actor follows' },
      { name: 'get_followers', summary: 'Accounts that follow an actor' },
      { name: 'get_suggested_follows', summary: 'Accounts the graph considers similar to one actor' },
      { name: 'get_trends', summary: 'What is trending now, with volume and the accounts driving it' },
      { name: 'search_actors', summary: 'Find accounts by name, handle, or bio' },
      { name: 'search_posts', summary: 'Full-text post search, where the upstream allows it' },
      { name: 'get_starter_packs', summary: 'Curated bundles of accounts an author published' },
      { name: 'get_labeler_services', summary: 'What a moderation labeler publishes, by DID' },
    ],
  },
  {
    id: 'feeds',
    title: 'Feeds and lists',
    blurb: 'The timelines and collections people build for each other.',
    tools: [
      { name: 'list_feeds', summary: 'Custom feeds by author, by popularity, or Bluesky’s picks' },
      { name: 'get_feed_info', summary: 'What a feed is and who runs it, before you read it' },
      { name: 'get_feed', summary: 'The posts an algorithm someone published is serving now' },
      { name: 'list_lists', summary: 'Curation and moderation lists an account has published' },
      { name: 'get_list', summary: 'A list plus its members as profile cards' },
      { name: 'get_list_feed', summary: 'What the members of a list are posting' },
    ],
  },
  {
    id: 'lexicons',
    title: 'Lexicon ecosystem',
    blurb: 'What the wider network is doing, beyond any single app.',
    tools: [
      { name: 'list_trending_lexicons', summary: 'Which record types saw the most activity in a window' },
      { name: 'get_lexicon_activity', summary: 'One lexicon’s volume over time: growing, steady, or a spike' },
      { name: 'search_lexicons', summary: 'Find record types by name when you don’t know the NSID' },
      { name: 'sample_recent_records', summary: 'Recent records network-wide in one collection' },
      { name: 'get_lexicon_schema', summary: 'A published schema, found through the _lexicon DNS method' },
    ],
  },
  {
    id: 'docs',
    title: 'Protocol documentation',
    blurb: 'How atproto works and what each endpoint takes, read from the current docs rather than memory.',
    tools: [
      { name: 'search_atproto_docs', summary: 'Search the specs and guides on atproto.com, docs.bsky.app and bsky.network' },
      { name: 'read_atproto_doc', summary: 'One documentation page in full' },
      { name: 'search_api_methods', summary: 'Find an XRPC method or record type by name or by what it does' },
      { name: 'get_api_method', summary: 'The exact lexicon: parameters, schemas, and named errors' },
    ],
  },
  {
    id: 'jetstream',
    title: 'Jetstream',
    blurb: 'A live window onto the network, bounded so an agent can hold it.',
    tools: [
      { name: 'sample_jetstream', summary: 'Open the live event stream for a few seconds; filter by collection, account, or operation' },
    ],
  },
];

/** Every tool name in the catalog, in group order. */
export const CATALOG_TOOL_NAMES: string[] = TOOL_GROUPS.flatMap((g) => g.tools.map((t) => t.name));

export const TOOL_COUNT = CATALOG_TOOL_NAMES.length;

/**
 * Counts spelled out, for prose that reads better with a word than a
 * numeral. Falls back to the numeral past the range the copy uses, which a
 * test flags so the sentence never ends up mixing the two.
 */
export const NUMBER_WORDS: Record<number, string> = {
  1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven',
  8: 'eight', 9: 'nine', 10: 'ten', 11: 'eleven', 12: 'twelve',
  30: 'thirty', 31: 'thirty-one', 32: 'thirty-two', 33: 'thirty-three',
  34: 'thirty-four', 35: 'thirty-five', 36: 'thirty-six', 37: 'thirty-seven',
  38: 'thirty-eight', 39: 'thirty-nine', 40: 'forty',
};

export function numberWord(count: number): string {
  return NUMBER_WORDS[count] ?? String(count);
}

export function toolCountWord(count: number = TOOL_COUNT): string {
  return numberWord(count);
}
