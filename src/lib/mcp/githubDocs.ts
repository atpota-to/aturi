/**
 * Builder-facing repository documents not published on the three docs sites.
 * Unlike docsManifest.ts, this is a deliberately small, hand-curated index.
 * Bodies are fetched from the listed repositories at request time; review
 * titles and headings when an upstream document changes.
 */

import type { DocPage } from '@/lib/mcp/docsManifest';

export type GithubDocPage = Omit<DocPage, 'source'> & {
  source: 'github';
  /** Distinguishes examples and proposals from published protocol guidance. */
  note?: string;
};

function repoDoc(
  repo: string,
  path: string,
  id: string,
  title: string,
  description: string,
  headings: string[],
  note?: string,
): GithubDocPage {
  const base = `https://github.com/bluesky-social/${repo}`;
  return {
    id: `github/${id}`,
    source: 'github',
    title,
    description,
    url: `${base}/blob/main/${path}`,
    raw: `https://raw.githubusercontent.com/bluesky-social/${repo}/main/${path}`,
    headings,
    ...(note ? { note } : {}),
  };
}

export const GITHUB_DOC_PAGES: GithubDocPage[] = [
  repoDoc(
    'atproto', 'README.md', 'atproto', 'AT Protocol reference implementation',
    'Repository map for the atproto TypeScript packages, Lexicons, PDS, AppView, and OAuth implementations.',
    ['About AT Protocol', 'What is in here?', 'What is not in here?'],
    'Implementation overview; use the published specs for protocol requirements.',
  ),
  repoDoc(
    'atproto', 'packages/lex/lex/README.md', 'atproto-lex', '@atproto/lex TypeScript SDK',
    'Type-safe Lexicon schemas, XRPC client, record operations, authentication, and schema validation.',
    ['Quick Start', 'Lexicon Schemas', 'TypeScript Schemas', 'Making simple XRPC Requests', 'Client API', 'Error Handling'],
  ),
  repoDoc(
    'atproto', 'packages/oauth/oauth-client-browser/README.md', 'oauth-client-browser',
    '@atproto/oauth-client-browser',
    'Browser OAuth client setup, client metadata, handle resolution, sign-in, and session restoration.',
    ['Setup', 'Client Metadata', 'Handle Resolver', 'Usage', 'Restoring a session'],
  ),
  repoDoc(
    'atproto', 'packages/oauth/oauth-client-node/README.md', 'oauth-client-node',
    '@atproto/oauth-client-node',
    'Server-side OAuth client setup, client metadata, session and state stores, and refresh locking.',
    ['Setup', 'Client configuration', 'Common configuration options', 'sessionStore', 'stateStore', 'requestLock'],
  ),
  repoDoc(
    'atproto', 'packages/sync/README.md', 'atproto-sync', '@atproto/sync firehose client',
    'TypeScript firehose subscriptions, event verification, collection filters, and cursor-aware processing.',
    ['Usage'],
  ),
  repoDoc(
    'social-app', 'README.md', 'social-app', 'Bluesky Social app',
    'React Native app overview, development resources, contributions, and forking guidelines.',
    ['Development Resources', 'Contributions', 'Forking guidelines'],
    'Bluesky app contributor guidance, not an AT Protocol specification.',
  ),
  repoDoc(
    'social-app', 'docs/build.md', 'social-app-build', 'Build the Bluesky Social app',
    'Run the Bluesky web, iOS, or Android app locally; set up its development environment.',
    ['Running Web App', 'iOS/Android Build', 'Running the Native App', 'Running the Backend Locally'],
    'Instructions for building the Bluesky app itself, not a guide to implementing AT Protocol.',
  ),
  repoDoc(
    'jetstream', 'README.md', 'jetstream', 'Jetstream implementation',
    'Full-network archive, replay, and streaming service; local development and example programs.',
    ['User Documentation', 'Examples', 'Developing Locally'],
    'Implementation README; bsky.network has the service usage documentation.',
  ),
  repoDoc(
    'feed-generator', 'README.md', 'feed-generator', 'Feed generator starter kit',
    'Example custom feed generator with feed skeletons, publishing, pagination, and indexing.',
    ['Overview', 'Getting Started', 'Publishing your feed', 'Pagination', 'Suggestions for Implementation'],
    'Starter kit example; check current specs and bsky.network guides before following its authentication or service-hosting advice.',
  ),
  repoDoc(
    'statusphere-example-app', 'README.md', 'statusphere', 'Statusphere example app',
    'Example custom atproto app with OAuth, custom records, Tap firehose sync, and Next.js.',
    ['Getting Started'],
    'Example app; use the linked atproto.com tutorial for step-by-step guidance.',
  ),
  repoDoc(
    'proposals', 'README.md', 'proposals', 'Bluesky proposals',
    'Index of informal proposals on OAuth, moderation, sync, auth scopes, JSON event streams, and permissioned data.',
    ['OAuth', 'AT Protocol Sync v1.1', 'Auth Scopes', 'JSON Event Stream Encoding', 'Permissioned Data'],
    'Informal proposals for feedback, not adopted specifications or current service behavior.',
  ),
];
