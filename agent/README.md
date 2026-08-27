# Atmosphere agent

A Bluesky account that answers `@mentions` about the Atmosphere, using the
hosted [Atmosphere MCP server](https://aturi.to/mcp) as its source of live
network data.

Someone tags the account — "who links to this post?", "what lexicons is this
repo using?", "where else can I open this record?" — and it replies in the
thread, seconds later, having actually looked it up.

## How it works

```
Jetstream ──┐
            ├──▶ queue ──▶ guards ──▶ model + MCP tools ──▶ format ──▶ reply
notifications ┘
```

**Two sources, one queue.** Jetstream carries a mention to the queue about as
fast as the PDS can commit it. The notification API is swept every
`RECONCILE_MINUTES` as a backstop, because Jetstream is at-least-once, not
never-miss: a disconnect longer than the server's lookback window drops events
and nothing would otherwise notice. Latency comes from the stream,
completeness comes from the API, and shared dedupe means a mention arriving on
both paths is still answered once.

The stream position is persisted to `CURSOR_FILE`, so a restart resumes rather
than skipping to the live edge. The cursor is inclusive, so resuming replays
the last event — dedupe absorbs that, which is the safe direction to err in.

**Both Jetstream dialects are understood.** v2 serves
`/xrpc/network.bsky.jetstream.subscribeEvents`, takes `collections`/`kinds`,
and wraps events as `{$type, payload}` with a monotonic `seq`. v1 serves
`/subscribe`, takes `wantedCollections`, and sends a flat object keyed on
`time_us`. `parseEvent` normalises both, so `JETSTREAM_URL` can point at
whichever instance you already run.

**The queue is serial.** A thread where several people tag the account at once
arrives as several events in the same second; answering them in parallel would
mean concurrent model calls and a rate limiter that only finds out afterwards.

## The model provider

Requests go through the [Vercel AI Gateway](https://vercel.com/docs/ai-gateway),
so `AGENT_MODEL` — `anthropic/claude-opus-5`, `openai/…`, anything the gateway
routes to — is the only thing that changes when you want to compare models, and
spend shows up in one dashboard.

That choice has one architectural consequence worth stating. Anthropic's MCP
connector can run the tool loop server-side, so the agent would never see a
tool call; but `mcp_servers` is an Anthropic-API parameter that the gateway's
Messages endpoint does not document, and depending on it would break the
moment `AGENT_MODEL` named a non-Anthropic provider. So **the tool loop runs
here**, over an MCP client connected to `MCP_URL`, bounded by `MAX_STEPS`.
That works with every model the gateway can reach, which is the point.

## Formatting

Bluesky has no rich text. What it has is **facets**: byte ranges over the post
text that carry a link, a mention, or a tag. Getting them right is most of
what "formatting a post" means here.

- **Markdown is rendered down.** Asterisks post as asterisks, and a
  `[label](url)` posts as literal brackets with the URL buried where nobody can
  click it. Markdown links are unwrapped so the URL lands back in the text
  where the facet builder can find it; emphasis, headings, and code ticks are
  stripped; `- ` becomes `• `.
- **Links are shortened for display and kept whole in the facet.**
  `https://aturi.to/at/did:plc:…/app.bsky.feed.post/3lxyz` displays as
  `aturi.to/at/did:plc:…` and still resolves to the full URL when clicked,
  which buys back graphemes against the 300 cap.
- **Facets are built by hand, in UTF-8 byte offsets.** Not UTF-16, not
  characters — four emoji ahead of a link are 8 UTF-16 units and 16 bytes, and
  a facet measured in the wrong unit points into the middle of an emoji.
- **A link broken across a post boundary gets no facet** rather than a facet
  whose range points at the wrong bytes.
- **Answers split across a short self-thread** on grapheme boundaries. The
  300-cap counts graphemes, so a family emoji is one unit and `String.length`
  is the wrong ruler.

## Injection and abuse

The text of a mention is written by a stranger, and the reply is published
under your handle. That is the threat model, and prompt framing alone is not a
control — it is an instruction to something that can be argued with. The
controls that hold are enforced in code.

**No mention or tag facet is ever emitted.** This is the important one. A
mention facet notifies an account whether or not its handle appears in the
text, so handing generated text to a facet detector means anything that can
steer the model can make this account tag arbitrary people. The facet builder
only produces link facets, so that capability does not exist to be abused.
Handle-shaped text also loses its `@`, because a list of names still *reads*
as a pile-on even when it is inert. Replies notify the person who asked on
their own; no mention facet is needed for the bot to work.

**Tool output is untrusted too.** The MCP tools read public records, so
whatever they return contains other people's text. The prompt names both the
`<post>` blocks and the tool results as data rather than instruction.

**The rest:**

- Every tool the agent can reach is read-only. Nothing it can be talked into
  calling can write to the network.
- `MAX_REPLIES_PER_AUTHOR_PER_HOUR` stops one person turning the account into
  their toy; `MAX_REPLIES_PER_HOUR` bounds the bill; `MAX_STEPS` bounds tool
  calls per mention; link facets are capped per post.
- `BLOCKLIST` always wins over `ALLOWLIST`, so one entry is enough to stop an
  account.
- A reply that quotes the instructions back is dropped and logged — a backstop
  for a prompt that already refuses, not the reason it refuses.
- The agent never answers itself, and a DID that merely prefixes the bot's
  does not match.

What is *not* done: there is no classifier on the way out. If the account
starts being used as a puppet, the honest fix is to narrow what it will
answer, not to add another instruction telling it not to be fooled.

## Setup

**1. Make the account.** A normal Bluesky account. Give it a profile that says
plainly that it is automated and who runs it; people are entitled to know what
they are talking to.

**2. Make an app password.** Signed in as the bot: Settings → Privacy and
Security → App passwords → Add App Password. Leave *Allow access to your
direct messages* unchecked — the agent never reads DMs and does not need it.
The password is shown once and cannot be recovered, so copy it now. Use an app
password, never the account password: it is revocable on its own and cannot be
used to change the account's email or password.

**3. Get an AI Gateway key.** Vercel dashboard → your team → AI Gateway → API
Keys → Create key. It looks like `vck_…`. While you are there, put a
[budget](https://vercel.com/docs/ai-gateway/observability-and-spend/budgets)
on that key — it is the one hard ceiling on what a public bot can spend, and
the agent's own hourly caps are the soft one.

**4. Run it locally first, without posting.**

```bash
cd agent
npm install
cp .env.example .env      # BLUESKY_IDENTIFIER, BLUESKY_APP_PASSWORD, AI_GATEWAY_API_KEY
npm run typecheck && npm test

DRY_RUN=true ALLOWLIST=your-handle.bsky.social npm start
```

Then tag the bot from the account in `ALLOWLIST` and watch the terminal. A
`[dry-run]` line shows the exact posts it would publish and how many link
facets each carries. Nothing is written to the repo. Iterate here — on the
prompt, on `AGENT_MODEL` — until the replies read the way you want.

## Deploying to a droplet

It is a long-lived process that holds a websocket and writes one cursor file.
Any supervisor works; the unit in `deploy/` is the one that has been tried.

**Node 22.** `--experimental-transform-types` needs it, and systemd needs an
absolute path, so install it system-wide rather than under nvm:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs
command -v node          # confirm /usr/bin/node; if not, edit ExecStart
```

**A user and the code.** The service does not need root and should not have
it:

```bash
sudo useradd --system --home /opt/aturi --shell /usr/sbin/nologin aturi
sudo git clone https://github.com/atpota-to/aturi.git /opt/aturi
sudo chown -R aturi:aturi /opt/aturi
sudo -u aturi npm --prefix /opt/aturi/agent ci
```

Until this lands on `main`, check the branch out first — a clone of the
default branch has no `agent/` directory:

```bash
sudo -u aturi git -C /opt/aturi checkout claude/bluesky-atmosphere-agent-7f0xr5
```

**Secrets, outside the repo and outside the unit file:**

```bash
sudo install -o root -g aturi -m 0640 \
  /opt/aturi/agent/deploy/aturi-agent.env.example /etc/aturi-agent.env
sudo -e /etc/aturi-agent.env
```

Fill in the three credentials. Leave `CURSOR_FILE` pointing inside
`/var/lib/aturi-agent` — `ProtectSystem=strict` makes the rest of the disk
read-only to this service, and systemd creates that directory itself. Keep
`ALLOWLIST` set for the first run.

**Start it:**

```bash
sudo cp /opt/aturi/agent/deploy/aturi-agent.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now aturi-agent
journalctl -u aturi-agent -f
```

A healthy start looks like:

```
[start] your-bot.bsky.social (did:plc:…) · model anthropic/claude-opus-5 · 38 tools from https://aturi.to/api/mcp
[jetstream] connected
```

Tag the account from the allowlisted handle. Within a few seconds you should
see a `[reply]` line naming the tools the model reached for. When you are
satisfied, drop `ALLOWLIST` from `/etc/aturi-agent.env` and
`sudo systemctl restart aturi-agent` to open it up.

**Updating:**

```bash
sudo -u aturi git -C /opt/aturi pull
sudo -u aturi npm --prefix /opt/aturi/agent ci
sudo systemctl restart aturi-agent
```

A restart resumes from the persisted cursor, so nothing that arrived during
the restart is lost.

### Running it without systemd

```bash
npm start        # holds the Jetstream subscription open; this is the real mode
npm run tick     # one notification sweep, no stream, then exit
```

`npm run tick` exists for cron and for checking a config without leaving a
process behind; it skips Jetstream entirely, so it is a fallback rather than
the intended mode.

Note that this is a **separate deployment from aturi.to**. The web app is
keyless and read-only by design; this agent holds a gateway key and
credentials that can write to a repo. Keeping them apart is the point.

Two caveats worth knowing:

- **It assumes one instance.** The answered set lives in memory in front of
  the repo; two agents on one account would each hold their own copy and could
  both answer the same mention.
- **Dedupe reads the repo, not a database.** The agent's own replies are the
  record of what it has answered, so a redeploy or a lost disk cannot cause a
  double answer. The walk pages until the posts predate `LOOKBACK_MINUTES`.

## Layout

| File | What it does |
| --- | --- |
| `src/index.ts` | Wires the stream and the sweep to the queue; shutdown |
| `src/jetstream.ts` | Subscription, both dialects, cursor, reconnect |
| `src/process.ts` | The serial queue: dedupe, guards, answer, post |
| `src/answer.ts` | Gateway call and the client-side MCP tool loop |
| `src/format.ts` | Markdown, links, facets, grapheme-safe splitting |
| `src/guards.ts` | Rate limits, allow/block lists, instruction-leak check |
| `src/bluesky.ts` | Login, notifications, dedupe, thread context, posting |
| `src/config.ts` | Environment |
| `deploy/` | systemd unit and an environment-file template |

Verify with `npm run typecheck && npm test`.
