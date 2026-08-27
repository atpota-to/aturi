# Atmosphere agent

A Bluesky account that answers `@mentions` about the Atmosphere, using the
hosted [Atmosphere MCP server](https://aturi.to/mcp) as its only source of
live network data.

Someone asks the account a question — "who links to this post?", "what
lexicons is this repo using?", "where else can I open this record?" — and the
account replies in the thread, having actually looked it up.

## How it works

Three moving parts, and only one of them is interesting:

1. **Poll.** `app.bsky.notification.listNotifications` with
   `reasons: ['mention', 'reply']`, so likes and follows never reach the
   agent.
2. **Answer.** One call to the Messages API with `mcp_servers` pointing at
   `https://aturi.to/api/mcp`. Claude calls the Atmosphere tools *server-side*
   and returns finished prose. There is no MCP client here and no tool loop —
   that is the whole reason this codebase is a few hundred lines.
3. **Reply.** `app.bsky.feed.post` with the right `root`/`parent` refs, split
   across a short self-thread when one post cannot hold the answer.

The MCP server is keyless, public, and **read-only**. Its 38 tools can read
any repository, resolve any identity, trace backlinks and sample Jetstream;
none of them can write anything. That property is what makes it safe to put
behind an account that answers strangers.

## The state problem, and why there is no database

The agent must not answer the same mention twice. It works that out by
reading its own repository: `com.atproto.repo.listRecords` over its own recent
posts, collecting every `reply.parent.uri`. Those replies *are* the record of
what has been answered.

This means a redeploy, a lost disk, or two instances running at once cannot
produce a double answer, and there is nothing to provision. The cost is one
extra request per pass — occasionally more, because the walk keeps paging
until the posts it is reading are older than `LOOKBACK_MINUTES`. A single page
of 100 posts is only about seven saturated passes, so on a busy day a mention
could otherwise age out of the dedupe set while still being inside the
lookback window, and get answered twice.

## Setup

**1. Make the account.** A normal Bluesky account. Give it a profile that says
plainly that it is automated and who runs it; people are entitled to know what
they are talking to.

**2. Make an app password.** In that account: Settings → Privacy and security
→ App passwords. Use the app password, never the account password — it is
revocable on its own and cannot be used to change the account's email or
password.

**3. Configure.**

```bash
cd agent
npm install
cp .env.example .env
# fill in BLUESKY_IDENTIFIER, BLUESKY_APP_PASSWORD, ANTHROPIC_API_KEY
```

**4. Watch it before you trust it.** Two settings exist for exactly this:

```bash
DRY_RUN=true ALLOWLIST=you.bsky.social npm run tick
```

`ALLOWLIST` restricts the agent to accounts you name, so you can exercise it
in public without answering strangers. `DRY_RUN` composes the answer and
prints it instead of posting. Clear both when the replies read the way you
want.

## Running it

Both modes run the identical pass; pick whichever matches your hosting.

```bash
npm start        # stays up, polls every POLL_INTERVAL_SECONDS
npm run tick     # one pass, then exits — for cron or a serverless invocation
```

**A long-running process** (Railway, Fly, Render, a VPS, a Pi under a desk) is
the least work: set the environment variables, run `npm start`, done.

**Vercel Cron** is worth it if you are already on a Pro plan — the Hobby plan
caps cron at once per day, which is not a mention bot. It needs a route that
calls the same tick:

```ts
// app/api/tick/route.ts, in its own Vercel project rooted at agent/
import { loadConfig } from '@/src/config.ts';
import { login } from '@/src/bluesky.ts';
import { runTick } from '@/src/tick.ts';

export const maxDuration = 60;

export async function GET(request: Request) {
  if (request.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response('Unauthorized', { status: 401 });
  }
  const config = loadConfig();
  return Response.json(await runTick(await login(config), config));
}
```

with `{"crons": [{"path": "/api/tick", "schedule": "* * * * *"}]}` in that
project's `vercel.json`.

**GitHub Actions** works and costs nothing, but its cron is best-effort and
routinely runs ten or more minutes late. Fine for a digest, poor for a bot
someone is waiting on.

Note that this is a **separate deployment from aturi.to**. The web app is
keyless and read-only by design; this agent holds an Anthropic key and
credentials that can write to a repo. Keeping them apart is the point.

## Latency

Polling means a mention waits up to `POLL_INTERVAL_SECONDS` before the agent
sees it, plus however long the answer takes to compose. At the default that is
under two minutes, which is fine for a bot people tag and walk away from.

If that is not fast enough, the replacement is Jetstream: subscribe to
`app.bsky.feed.post`, filter for the account's DID in the facets, and answer
on arrival. That needs a process holding a websocket open, so it rules out
cron and serverless. Start with polling.

## What it costs

One Messages API call per mention, on a model that thinks and calls tools.
Three things hold the bill down, and all three are worth keeping:

- `MAX_REPLIES_PER_TICK` caps a runaway loop at a known number of calls.
- The system prompt and the 38 tool definitions are identical on every
  mention and carry a cache breakpoint, so a burst of questions pays for that
  prefix roughly once.
- If you want to cut input tokens further, allowlist the tools the account
  actually needs. `mcp_toolset` takes `default_config: { enabled: false }`
  plus a `configs` entry per tool you want on.

## Prompt injection

The post text is written by the public, and the answer is published under your
handle. That is the whole threat model.

What is done about it: the mention arrives inside a delimited block that the
system prompt names as untrusted and non-authoritative; the tools reachable
through MCP cannot write; every reply is length-capped; and `ALLOWLIST` exists
for when you want the door mostly shut.

What is not done: there is no classifier on the way out. If the account starts
being used as a puppet, the honest fix is to narrow what it will answer, not
to add another instruction telling it not to be fooled.

## Layout

| File | What it does |
| --- | --- |
| `src/index.ts` | CLI: one pass with `--once`, otherwise a polling loop |
| `src/tick.ts` | One pass: read, answer, reply, mark seen |
| `src/bluesky.ts` | Login, notifications, dedupe, thread context, posting |
| `src/answer.ts` | The single Messages API call, with the MCP connector |
| `src/thread.ts` | Fitting an answer into 300-grapheme posts |
| `src/config.ts` | Environment |

Verify with `npm run typecheck && npm test`.
