/**
 * Every knob the agent has, resolved once at startup from the environment.
 *
 * The defaults are chosen so that the only variables a deployment *must* set
 * are the three credentials. Everything else has a value that is safe to run
 * unattended: conservative rate caps, a bounded lookback, and an allowlist
 * that starts open but is trivial to close — see ALLOWLIST below.
 */

export type Config = {
  service: string;
  identifier: string;
  appPassword: string;
  gatewayApiKey: string;
  /**
   * A Vercel AI Gateway model id, `provider/model`. Swapping providers is a
   * change to this string and nothing else, which is the whole reason the
   * agent talks to the gateway rather than to one vendor's API.
   */
  model: string;
  mcpUrl: string;
  /**
   * Jetstream endpoint. Both the v2 path
   * (`/xrpc/network.bsky.jetstream.subscribeEvents`, `collections=`) and the
   * older v1 path (`/subscribe`, `wantedCollections=`) work — the event
   * parser detects which envelope it is looking at, so this can point at
   * whichever instance a deployment already runs.
   */
  jetstreamUrl: string;
  /** Where the last seen Jetstream position is persisted across restarts. */
  cursorFile: string;
  /**
   * How often the notification API is swept as a backstop. Jetstream is
   * at-least-once but not never-miss: a disconnect longer than the server's
   * lookback window drops events on the floor, and nothing would ever notice.
   */
  reconcileMinutes: number;
  /** Ignore mentions older than this on the reconcile sweep. */
  lookbackMinutes: number;
  /** Posts per answer. Above one, the agent chains a self-reply thread. */
  maxPostsPerReply: number;
  /** Answers one account can draw in an hour. Abuse and cost control. */
  maxRepliesPerAuthorPerHour: number;
  /** Answers the account will write in an hour, across everyone. */
  maxRepliesPerHour: number;
  /** Model steps per answer, which bounds tool calls per mention. */
  maxSteps: number;
  /**
   * Empty means "answer anyone". Populate it with handles or DIDs while
   * testing so the account can be exercised in public without answering
   * strangers, then clear it to open the bot up.
   */
  allowlist: Set<string>;
  /** Handles or DIDs that are never answered, whatever the allowlist says. */
  blocklist: Set<string>;
  /** Do everything except write to the repo. Prints the reply instead. */
  dryRun: boolean;
};

/**
 * A misconfigured environment is operator error, not a bug: it is reported as
 * one line rather than a stack trace.
 */
export class ConfigError extends Error {}

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new ConfigError(
      `Missing required environment variable ${name}. See agent/.env.example.`,
    );
  }
  return value;
}

function number(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new ConfigError(
      `${name} must be a positive number, got ${JSON.stringify(raw)}`,
    );
  }
  return parsed;
}

function identifiers(name: string): Set<string> {
  return new Set(
    (process.env[name] ?? '')
      .split(',')
      .map((entry) => entry.trim().toLowerCase().replace(/^@/, ''))
      .filter(Boolean),
  );
}

export function loadConfig(): Config {
  return {
    service: process.env.BLUESKY_SERVICE ?? 'https://bsky.social',
    identifier: required('BLUESKY_IDENTIFIER'),
    appPassword: required('BLUESKY_APP_PASSWORD'),
    gatewayApiKey: required('AI_GATEWAY_API_KEY'),
    model: process.env.AGENT_MODEL ?? 'anthropic/claude-opus-5',
    mcpUrl: process.env.MCP_URL ?? 'https://aturi.to/api/mcp',
    jetstreamUrl:
      process.env.JETSTREAM_URL ??
      'wss://jetstream.us-east.bsky.network/xrpc/network.bsky.jetstream.subscribeEvents',
    cursorFile: process.env.CURSOR_FILE ?? '.jetstream-cursor',
    reconcileMinutes: number('RECONCILE_MINUTES', 10),
    lookbackMinutes: number('LOOKBACK_MINUTES', 120),
    maxPostsPerReply: number('MAX_POSTS_PER_REPLY', 3),
    maxRepliesPerAuthorPerHour: number('MAX_REPLIES_PER_AUTHOR_PER_HOUR', 6),
    maxRepliesPerHour: number('MAX_REPLIES_PER_HOUR', 60),
    maxSteps: number('MAX_STEPS', 8),
    allowlist: identifiers('ALLOWLIST'),
    blocklist: identifiers('BLOCKLIST'),
    dryRun: process.env.DRY_RUN === 'true',
  };
}
