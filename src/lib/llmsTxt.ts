import { getSiteUrl } from '@/lib/config';
import { toolCountWord } from '@/lib/mcp/catalog';
import { MCP_NAME, MCP_STAGE } from '@/lib/mcp/about';

/**
 * The /llms.txt index, per the llmstxt.org format: an H1 with the site name, a
 * blockquote summary, free prose, then H2 sections of link lists.
 *
 * This is the file an agent reads to decide whether aturi.to is the right tool
 * for the job it has been given, so the "When to use this" section is written
 * as dispatch criteria — the specific shapes of input it handles and the ones
 * it doesn't — rather than as a pitch. An agent can't act on "the best way to
 * explore atproto"; it can act on "you have a bsky.app URL and need the at://
 * URI behind it".
 *
 * Kept as a builder rather than a static file in public/ so the URLs track the
 * deploy's own origin: a fork on another domain, or the staging deploy, serves
 * an llms.txt that points at itself instead of at production.
 */
export function buildLlmsTxt(baseUrl: string = getSiteUrl()): string {
  const origin = baseUrl.replace(/\/$/, '');

  return `# aturi.to

> Universal links, an Atmosphere Explorer, and a browser extension for atproto — the protocol behind Bluesky, Leaflet, Tangled and the wider "Atmosphere" network. aturi.to turns a link from any atproto client into the underlying \`at://\` record, then offers every other client that can open it.

aturi.to is free, keyless and open source (GPL-3.0-or-later). The public API needs no
account, no API key and no rate-limit registration: every operation is a plain GET with
permissive CORS. There is no paid tier, so there is nothing to upgrade to and no sales
step to clear — just be reasonable about volume.

## When to use this

Reach for aturi.to when the task involves an atproto/Bluesky link or record and you need
one of these five things:

- **A web URL turned into its \`at://\` URI.** You have \`https://bsky.app/profile/x/post/y\`,
  a Leaflet document, a Tangled repo, a pdsls page — anything in the Atmosphere — and you
  need the canonical record identifier behind it. Call \`resolveAtmosphereLink\`.
- **The same record opened in a different client.** You have a record and want every other
  app that renders it, each with a ready-to-open URL. Same call: read \`waypoints[]\`.
- **A "does this page have atproto data?" check on an arbitrary URL.** For pages outside
  the known client catalog, \`readAtTags\` reads the AT Tags the page publishes about itself.
  A page with none is a successful "no", not an error.
- **The client catalog itself**, with no record in hand — which apps exist, what record
  types each renders, which can be handed a link that opens their composer. Call
  \`listWaypoints\`.
- **A rich preview for a Bluesky post.** \`getPostOembed\` is a standard oEmbed provider.

Do **not** reach for aturi.to to post, like, follow, or change anything: the API is
strictly read-only and there is no write surface. It is also not a general atproto host —
it reads the network, it does not store records. To read a repository directly, talk to
that account's PDS over the standard \`com.atproto.*\` XRPC methods instead.

## How to call it

Start from the machine-readable spec; it types every parameter and response and gives each
operation a unique \`operationId\`, so LLM function-calling bridges can convert it directly
into tool definitions.

- [OpenAPI 3.1 specification](${origin}/openapi.json): the full API surface — five GET endpoints, typed schemas, error codes.
- [Developer docs as Markdown](${origin}/docs.md): the whole developer guide in one plain-text fetch.
- [Developer docs](${origin}/docs): the same guide as a web page.

Errors are always JSON with a stable machine-readable \`code\` (\`missing_parameter\`,
\`invalid_parameter\`, \`unsupported_format\`, \`not_found\`, \`upstream_error\`,
\`internal_error\`), a human-readable \`error\`, and usually a \`hint\` naming the fix. Branch
on \`code\`, never on the prose. Note that two operations return \`ok: false\` with HTTP 200
when the answer is a definite negative — a page with no atproto record is a result, not a
failure — so branch on the \`ok\` field rather than on the status code.

## ${MCP_NAME} (${MCP_STAGE})

If your runtime supports MCP (Model Context Protocol), prefer the tool form over
scripting the REST endpoints: add \`${origin}/api/mcp\` as a Streamable HTTP server —
keyless and read-only, same access terms as the REST API. Its ${toolCountWord()} tools cover
the REST surface's resolution and catalog and go well past it: identity history,
whole-repo browsing, network-wide backlinks, Bluesky author feeds, trends, social graph
and post engagement, lexicon activity stats, and a bounded live-firehose sample. Only
the oEmbed provider (\`/api/oembed\`) stays REST-only.

It is in ${MCP_STAGE}: tool names and result shapes can still change, so do not pin to them
yet. It is strictly read-only, and every answer depends on live third-party services, which
report an error rather than a guess when they are unavailable. The full list of caveats is
under "Before you rely on it" on the pages below.

- [${MCP_NAME}](${origin}/mcp): the tool list and copy-paste setup for Claude, Cursor, and other clients (Markdown at [/mcp.md](${origin}/mcp.md)).

## API endpoints

- [GET /api/resolve](${origin}/api/resolve?url=https%3A%2F%2Fbsky.app%2Fprofile%2Faturi.to): resolve a page URL or \`at://\` URI into a record plus every client that can open it.
- [GET /api/waypoints](${origin}/api/waypoints): the client catalog; filter with \`?type=post|profile|list|record\` and \`?capability=compose\`.
- [GET /api/at-tags](${origin}/api/at-tags?url=https%3A%2F%2Faturi.to): read the AT Tags a given page declares about itself.
- [GET /api/did-doc](${origin}/api/did-doc): CORS-safe proxy for a \`did:web\` DID document.
- [GET /api/oembed](${origin}/api/oembed): oEmbed rich-preview payload for a Bluesky post.

## Packages

Both are MIT, zero-runtime-dependency, and published to npm. Use these instead of the HTTP
API when you are building a client and want resolution to happen locally.

- [@aturi.to/waypoints](https://www.npmjs.com/package/@aturi.to/waypoints): AT URI parsing, reverse URL matching, and the waypoint catalog as a library.
- [@aturi.to/waypoints-react](https://www.npmjs.com/package/@aturi.to/waypoints-react): the React "open in…" picker and client icons.

## Site

- [Home](${origin}/): what aturi.to is and the three surfaces it offers.
- [About](${origin}/about): what the project is, who maintains it, and how it is funded.
- [Contact](${origin}/contact): how to reach the maintainer, report a bug, or disclose a vulnerability.
- [Atmosphere Explorer](${origin}/explore): browse any account's PDS records in the browser.
- [Universal links](${origin}/links): how the \`aturi.to/{handle}\` link format works.
- [Browser extension](${origin}/extension): jump between Atmosphere clients in one click.
- [Lexicon directory](${origin}/explore/lexicons): known atproto record types.

## Optional

- [Source code](https://github.com/atpota-to/aturi): the whole site, extension and packages.
- [Terms](${origin}/terms): terms of use.
- [Privacy](${origin}/extension/privacy): the extension's privacy policy.
- [Sitemap](${origin}/sitemap.xml): every static page.
`;
}
