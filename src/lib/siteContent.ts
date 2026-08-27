/**
 * Structured copy for the plain content pages (/about, /contact).
 *
 * Each page is defined once here and rendered twice: as styled HTML by the
 * route under src/app, and as Markdown by the matching `.md` route that
 * Accept-negotiation rewrites to. Keeping one source is the point — a trust
 * page whose Markdown twin has drifted out of date is worse than not having
 * one, because an agent reading the Markdown has no way to tell.
 *
 * Inline links use Markdown link syntax in the strings. `parseInlineLinks`
 * turns them into segments the HTML renderer walks; the Markdown renderer
 * emits the strings unchanged.
 */

import { TOOL_COUNT, TOOL_GROUPS } from '@/lib/mcp/catalog';
import { MCP_LIMITS, MCP_NAME, MCP_STAGE } from '@/lib/mcp/about';

export type ContentBlock =
  | { kind: 'p'; text: string }
  | { kind: 'ul'; items: string[] };

export type ContentSection = {
  /** Anchor id, also used as the React key. */
  id: string;
  heading: string;
  blocks: ContentBlock[];
};

export type ContentPage = {
  title: string;
  /** Meta description, and the blockquote summary in the Markdown twin. */
  description: string;
  /** Lead paragraph, above the first section heading. */
  intro: string;
  sections: ContentSection[];
};

/** One piece of an inline string after the mini-Markdown pass. */
export type InlineSegment =
  | { kind: 'text'; text: string }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'strong'; text: string }
  | { kind: 'code'; text: string };

/**
 * The three inline constructs the copy above uses, in one alternation so a
 * single left-to-right pass can't nest or double-consume them:
 * `[label](href)`, `**strong**`, and `` `code` ``.
 */
const INLINE_PATTERN = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;

/**
 * Split a content string into renderable segments.
 *
 * Deliberately narrow: it recognises exactly the three constructs above and
 * leaves every other character alone, including the typographic quotes and em
 * dashes the copy uses. Content here is authored in this repo, never user
 * input, so it doesn't need to survive hostile Markdown — but React escapes
 * the text of every segment on output regardless.
 */
export function parseInline(input: string): InlineSegment[] {
  const segments: InlineSegment[] = [];
  let cursor = 0;

  // A fresh regex per call: INLINE_PATTERN carries /g lastIndex state, and
  // sharing it across calls would make this non-reentrant.
  for (const match of input.matchAll(new RegExp(INLINE_PATTERN))) {
    const start = match.index ?? 0;
    if (start > cursor) {
      segments.push({ kind: 'text', text: input.slice(cursor, start) });
    }

    const [full, linkText, href, strong, code] = match;
    if (linkText !== undefined) {
      segments.push({ kind: 'link', text: linkText, href });
    } else if (strong !== undefined) {
      segments.push({ kind: 'strong', text: strong });
    } else {
      segments.push({ kind: 'code', text: code });
    }

    cursor = start + full.length;
  }

  if (cursor < input.length) {
    segments.push({ kind: 'text', text: input.slice(cursor) });
  }

  return segments;
}

/** Render a ContentPage as a standalone Markdown document. */
export function renderContentPageMarkdown(page: ContentPage): string {
  const lines: string[] = [`# ${page.title}`, '', `> ${page.description}`, '', page.intro, ''];

  for (const section of page.sections) {
    lines.push(`## ${section.heading}`, '');
    for (const block of section.blocks) {
      if (block.kind === 'p') {
        lines.push(block.text, '');
      } else {
        for (const item of block.items) lines.push(`- ${item}`);
        lines.push('');
      }
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

export const ABOUT_PAGE: ContentPage = {
  title: 'About aturi.to',
  description:
    'aturi.to is a free, open-source toolkit for navigating the Atmosphere — the network of apps built on atproto. It is built and maintained by one person, funded by nobody, and stores no accounts.',
  intro:
    'aturi.to is a toolkit for navigating the Atmosphere: the federated network of apps built on the AT Protocol (atproto), the protocol behind Bluesky, Leaflet, Tangled, Grain and dozens of other clients. Its premise is that a record in the Atmosphere belongs to the person who wrote it, not to the app that happened to render it — so any link to that record should be openable anywhere. Everything here follows from that.',
  sections: [
    {
      id: 'what-it-does',
      heading: 'What it does',
      blocks: [
        {
          kind: 'p',
          text: 'Five surfaces share one catalog of clients and one URI parser, so they never disagree about where a record can be opened:',
        },
        {
          kind: 'ul',
          items: [
            '**Universal links.** Drop an `aturi.to/…` URL into a DM, a footer or a bio. The recipient lands on a preview of the record and picks which Atmosphere client to open it in. No login, no client lock-in.',
            '**The [Atmosphere Explorer](/explore).** Browse any account\'s PDS: every collection, every record, identity history, the PLC audit log, inbound backlinks, trending lexicons, and a live view of the firehose. Sign in with atproto OAuth to edit records in your own repo.',
            '**A [browser extension](/extension)** for Chrome, Firefox and Safari. Jump from a post in one client to the same post in another in one click, or flip on auto-redirect and have links rewritten to your preferred client before they load.',
            '**The [waypoints packages](/docs).** The same catalog, link builders and URI resolution the other three run on, published to npm as `@aturi.to/waypoints` (zero runtime dependencies) and `@aturi.to/waypoints-react`, both MIT-licensed, so any app can add the same picker.',
            '**The [Atmosphere MCP](/mcp).** The same reads, as tools an AI agent can call: resolve a link, read any repository, trace backlinks across every app, sample Jetstream. Keyless, read-only, and in beta.',
          ],
        },
      ],
    },
    {
      id: 'who',
      heading: 'Who makes it',
      blocks: [
        {
          kind: 'p',
          text: 'aturi.to is built and maintained by [dame](https://atpota.to), a solo developer working on atproto tooling. It is not a company, has no investors, and sells nothing. There is no team behind it, which is worth knowing before you depend on it: expect the response times of one person, not of a support desk.',
        },
        {
          kind: 'p',
          text: 'The whole thing is open source under GPL-3.0-or-later (the two npm packages are MIT so they can be embedded anywhere). The [source is on GitHub](https://github.com/atpota-to/aturi) and mirrored to [Tangled](https://tangled.org/atpota.to/aturi). You can read every line that runs, file an issue, or fork it and run your own instance on your own domain.',
        },
      ],
    },
    {
      id: 'accounts-and-data',
      heading: 'Accounts and data',
      blocks: [
        {
          kind: 'p',
          text: 'There is no aturi.to account. Signing in uses standard atproto OAuth against your existing PDS, so there is no password here to leak and no user database to breach. Access tokens are DPoP-bound and stay in your browser.',
        },
        {
          kind: 'p',
          text: 'Your personalization — waypoint groups, ordering, pins, custom waypoints, colour scheme — is written to a `to.aturi.actor.preferences/self` record in your own repository, not to a server here. Move to a different PDS and it moves with you. The browser extension makes no background network calls at all and keeps its preferences in local storage. The [Terms and Privacy Policy](/terms) spell out what each surface touches.',
        },
      ],
    },
    {
      id: 'for-agents',
      heading: 'For developers and agents',
      blocks: [
        {
          kind: 'p',
          text: 'The public API is read-only, needs no key and no account, and sends permissive CORS headers on every endpoint. Start at [/llms.txt](/llms.txt) for an overview written for automated clients, [/openapi.json](/openapi.json) for the typed OpenAPI 3.1 specification, or [/docs.md](/docs.md) for the whole developer guide as one Markdown fetch.',
        },
      ],
    },
  ],
};

export const CONTACT_PAGE: ContentPage = {
  title: 'Contact aturi.to',
  description:
    'How to report a bug, request a feature, disclose a security issue, or otherwise reach the person who maintains aturi.to.',
  intro:
    'aturi.to is maintained by one person, so there is no support queue and no ticket number — but every route below is read. Pick whichever matches what you need; the feedback board is the best default, because it is public and other people can vote on the same thing rather than filing it twice.',
  sections: [
    {
      id: 'bugs-and-features',
      heading: 'Bugs and feature requests',
      blocks: [
        {
          kind: 'p',
          text: 'The [feedback board](/feedback) is the fastest route. Post a bug or an idea, or vote on someone else\'s. It runs on the userinput.app lexicons, so every post you make lands as a record in your own repository rather than in a database here.',
        },
        {
          kind: 'p',
          text: 'If you would rather work in Git, [open an issue on GitHub](https://github.com/atpota-to/aturi/issues). Pull requests are welcome; read [CONTRIBUTING.md](https://github.com/atpota-to/aturi/blob/main/CONTRIBUTING.md) first for how the repository is laid out.',
        },
      ],
    },
    {
      id: 'security',
      heading: 'Security disclosure',
      blocks: [
        {
          kind: 'p',
          text: 'Do not open a public issue for a vulnerability. Report it privately through [GitHub Security Advisories](https://github.com/atpota-to/aturi/security/advisories/new), or email `aturi@atpota.to`. Expect an acknowledgement within a week; if you hear nothing after that, DM [@aturi.to on Bluesky](https://bsky.app/profile/aturi.to) referencing the report without describing the issue publicly.',
        },
      ],
    },
    {
      id: 'general',
      heading: 'Everything else',
      blocks: [
        {
          kind: 'p',
          text: 'For anything that is not a bug, a feature or a vulnerability — press, takedown requests, questions about the packages, or wanting to add a client to the waypoint catalog — email `contact@aturi.to`.',
        },
        {
          kind: 'ul',
          items: [
            'Email: `contact@aturi.to` (general) · `aturi@atpota.to` (security)',
            'Bluesky: [@aturi.to](https://bsky.app/profile/aturi.to)',
            'Maintainer: [dame](https://atpota.to)',
            'Source: [github.com/atpota-to/aturi](https://github.com/atpota-to/aturi)',
          ],
        },
        {
          kind: 'p',
          text: 'To add a client to the waypoint catalog, an issue or a pull request is better than an email — the catalog lives in one file and the [developer docs](/docs) describe its shape.',
        },
      ],
    },
  ],
};

/**
 * The homepage's Markdown twin, served at /index.md and at `/` under Accept
 * negotiation.
 *
 * A deliberate summary rather than a transcription: the rendered homepage is
 * three interactive product strips whose copy only makes sense next to the
 * demos it labels. What an agent needs from `/` is what this site is, what it
 * can do, and where to go next — which is what this says, in about 2% of the
 * bytes the HTML costs.
 */
export const HOME_PAGE: ContentPage = {
  title: 'aturi.to',
  description:
    'Tour the Atmosphere: jump between atproto clients in one click, share universal links that open anywhere, and browse any account\'s PDS data.',
  intro:
    'aturi.to is a free, open-source toolkit for navigating the Atmosphere — the federated network of apps built on the AT Protocol (atproto), including Bluesky, Leaflet, Tangled, Grain, Margin and dozens more. It exists because a record in the Atmosphere belongs to whoever wrote it, not to the app that rendered it, so any link to that record should open anywhere. Three surfaces and a set of npm packages share one catalog of clients and one URI parser.',
  sections: [
    {
      id: 'universal-links',
      heading: 'Universal links',
      blocks: [
        {
          kind: 'p',
          text: 'Put an `aturi.to/…` URL anywhere — a DM, a footer, a bio — and the recipient lands on a preview of the record with every client that can open it. Handles, DIDs and full `at://` URIs all work as input, and no one has to log in.',
        },
        {
          kind: 'ul',
          items: [
            '`aturi.to/{handle}` — a profile, e.g. [aturi.to/aturi.to](/aturi.to)',
            '`aturi.to/profile/{handle}/post/{rkey}` — a Bluesky post',
            '`aturi.to/{handle}/{collection}/{rkey}` — any record in any lexicon',
            'More detail at [/links](/links).',
          ],
        },
      ],
    },
    {
      id: 'explorer',
      heading: 'Atmosphere Explorer',
      blocks: [
        {
          kind: 'p',
          text: 'At [/explore](/explore). Browse any account\'s personal data server: every collection, every record, identity history, the PLC audit log, inbound backlinks, a live firehose view and a trending-lexicon leaderboard. Sign in with atproto OAuth to edit records in your own repository — there is no aturi.to account and no password to create.',
        },
      ],
    },
    {
      id: 'extension',
      heading: 'Browser extension',
      blocks: [
        {
          kind: 'p',
          text: 'At [/extension](/extension), for Chrome, Firefox and Safari. Jump from a post in one client to the same post in another in one click, or turn on auto-redirect and have Atmosphere links rewritten to your preferred client before they load. No account, no telemetry, no background network calls.',
        },
      ],
    },
    {
      id: 'developers',
      heading: 'For developers and agents',
      blocks: [
        {
          kind: 'p',
          text: 'The public API is read-only and keyless: no account, no API key, no rate-limit registration, permissive CORS on every endpoint. The npm packages do the same resolution locally with zero runtime dependencies.',
        },
        {
          kind: 'ul',
          items: [
            '[/llms.txt](/llms.txt) — overview written for automated clients, including when *not* to use this site',
            '[/openapi.json](/openapi.json) — typed OpenAPI 3.1 specification for all five endpoints',
            '[/docs.md](/docs.md) — the whole developer guide as one Markdown fetch ([HTML](/docs))',
            '`@aturi.to/waypoints` and `@aturi.to/waypoints-react` — the catalog and picker as MIT npm packages',
          ],
        },
      ],
    },
    {
      id: 'project',
      heading: 'About the project',
      blocks: [
        {
          kind: 'p',
          text: 'Built and maintained by one person, [dame](https://atpota.to). Open source under GPL-3.0-or-later at [github.com/atpota-to/aturi](https://github.com/atpota-to/aturi). More at [/about](/about), [/contact](/contact) and [/terms](/terms).',
        },
      ],
    },
  ],
};

/**
 * The Markdown twin of /mcp, at /mcp.md.
 *
 * The HTML page is a landing page with visuals; this is the same facts as
 * plain prose, which is what an agent fetching the page actually wants. The
 * tool list is generated from src/lib/mcp/catalog.ts rather than retyped, so
 * the two representations cannot disagree about what the server offers.
 *
 * A builder rather than a const because the copy names the endpoint URL,
 * which must track the deploy's own origin: a fork serves an MCP page that
 * points at itself.
 */
export function buildMcpPage(baseUrl: string): ContentPage {
  const origin = baseUrl.replace(/\/$/, '');
  const endpoint = `${origin}/api/mcp`;

  return {
    title: `${MCP_NAME} (${MCP_STAGE})`,
    description:
      `${MCP_NAME} is a free, keyless, read-only MCP server from aturi.to: ${TOOL_COUNT} tools for exploring the Atmosphere, covering link resolution, identity, repositories, network-wide backlinks, the Bluesky social layer, custom feeds and lists, lexicon activity, a live Jetstream tap, and the protocol documentation itself.`,
    intro:
      `The Atmosphere Explorer, as tools. Point an MCP-capable agent at \`${endpoint}\` and it can resolve any Atmosphere link, read any repo, trace backlinks across every app, and follow Jetstream. No key, no account, nothing to install. It is in ${MCP_STAGE}: read "Before you rely on it" below before building on it.`,
    sections: [
      {
        id: 'add',
        heading: 'Add it to your agent',
        blocks: [
          {
            kind: 'ul',
            items: [
              `**Claude** (web or desktop): Settings, then Connectors, then Add custom connector, with the URL \`${endpoint}\`.`,
              `**Claude Code**: \`claude mcp add --transport http atmosphere ${endpoint}\``,
              `**Codex**: \`codex mcp add atmosphere --url ${endpoint}\``,
              `**Cursor / VS Code**: add \`{"atmosphere": {"url": "${endpoint}"}}\` to the editor's MCP servers setting.`,
              `**opencode**: add \`{"atmosphere": {"type": "remote", "url": "${endpoint}"}}\` under \`mcp\` in your opencode config. Without \`type\` it is read as a local command.`,
              `**Anything else**: any client that speaks Streamable HTTP works; the endpoint negotiates every MCP revision from 2024-10-07 through 2025-11-25. stdio-only clients can bridge with \`npx mcp-remote ${endpoint}\`.`,
            ],
          },
        ],
      },
      {
        id: 'tools',
        heading: `${TOOL_COUNT} tools`,
        blocks: [
          {
            kind: 'p',
            text: 'Every tool is read-only, and every answer carries `at://` URIs plus aturi.to universal links, so an agent can always hand a human something to open.',
          },
          // One paragraph per group, then its tools as a list: nested lists
          // aren't part of the ContentBlock vocabulary, and a flat list of
          // headings and tools reads as one undifferentiated run.
          ...TOOL_GROUPS.flatMap((group) => [
            { kind: 'p' as const, text: `**${group.title}.** ${group.blurb}` },
            {
              kind: 'ul' as const,
              items: group.tools.map((tool) => `\`${tool.name}\`: ${tool.summary}`),
            },
          ]),
        ],
      },
      {
        id: 'questions',
        heading: 'Questions it answers well',
        blocks: [
          {
            kind: 'ul',
            items: [
              '"What has this account been posting about, and which posts got the most engagement?"',
              '"Who links to this post, anywhere on the network?"',
              '"What apps does this account actually use, and when did it change servers?"',
              '"What is trending on Bluesky right now, and who is driving it?"',
              '"Show me `com.whtwnd.blog.entry` records as they are posted."',
              '"Give me a link my friend can open in her own client."',
            ],
          },
        ],
      },
      {
        id: 'limits',
        heading: 'Before you rely on it',
        blocks: [
          { kind: 'ul', items: MCP_LIMITS },
        ],
      },
      {
        id: 'posture',
        heading: 'No key, no account, read-only',
        blocks: [
          {
            kind: 'p',
            text: 'The server is keyless: no account to make and no database of queries, like the rest of the [public API](/docs). There is no paid tier, so there is nothing to upgrade to; just be reasonable about volume.',
          },
          {
            kind: 'p',
            text: 'It is strictly read-only. Nothing here can post, like, follow, or edit, by design: the hosted surface holds no write credentials. Write tools are planned as a separate package that runs on your own machine with your own keys.',
          },
          {
            kind: 'p',
            text: 'Answers come from the same public infrastructure the Explorer reads: the Bluesky public AppView, plc.directory, Jetstream, and microcosm\u2019s Constellation, Slingshot, and UFOs services.',
          },
        ],
      },
      {
        id: 'rest',
        heading: 'The REST twin',
        blocks: [
          {
            kind: 'p',
            text: 'Building software rather than prompting an agent? The resolution and catalog answers are also plain GET endpoints, typed by [the OpenAPI document](/openapi.json) and explained in the [developer docs](/docs). Both surfaces wrap the same code, so neither drifts from the other.',
          },
        ],
      },
    ],
  };
}
