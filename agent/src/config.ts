/**
 * Every knob the agent has, resolved once at startup from the environment.
 *
 * The defaults are chosen so that the only variables a deployment *must* set
 * are the three credentials. Everything else has a value that is safe to run
 * unattended: a small per-tick cap, a short lookback, and an allowlist that
 * starts closed is not the default — see ALLOWLIST below for why.
 */

export type Config = {
  service: string;
  identifier: string;
  appPassword: string;
  anthropicApiKey: string;
  mcpUrl: string;
  model: string;
  /**
   * Ceiling on replies written in one pass. The cost of a runaway loop is
   * measured in both dollars and reputation, so this is deliberately low and
   * a tick that hits it simply leaves the rest for the next pass.
   */
  maxRepliesPerTick: number;
  /** Posts per answer. Above one, the agent chains a self-reply thread. */
  maxPostsPerReply: number;
  /**
   * How far back a notification can be and still earn an answer. Anything
   * older is assumed to have been missed on purpose (an outage, a deploy)
   * and answering it hours late reads worse than not answering at all.
   */
  lookbackMinutes: number;
  pollIntervalSeconds: number;
  /**
   * Empty means "answer anyone". Populate it with handles or DIDs while
   * testing so the account can be exercised in public without answering
   * strangers, then clear it to open the bot up.
   */
  allowlist: Set<string>;
  /** Do everything except write to the repo. Prints the reply instead. */
  dryRun: boolean;
};

/** A misconfigured environment is operator error, not a bug: it is reported
 * as one line rather than a stack trace. */
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

export function loadConfig(): Config {
  return {
    service: process.env.BLUESKY_SERVICE ?? 'https://bsky.social',
    identifier: required('BLUESKY_IDENTIFIER'),
    appPassword: required('BLUESKY_APP_PASSWORD'),
    anthropicApiKey: required('ANTHROPIC_API_KEY'),
    mcpUrl: process.env.MCP_URL ?? 'https://aturi.to/api/mcp',
    model: process.env.AGENT_MODEL ?? 'claude-opus-5',
    maxRepliesPerTick: number('MAX_REPLIES_PER_TICK', 5),
    maxPostsPerReply: number('MAX_POSTS_PER_REPLY', 3),
    lookbackMinutes: number('LOOKBACK_MINUTES', 120),
    pollIntervalSeconds: number('POLL_INTERVAL_SECONDS', 60),
    allowlist: new Set(
      (process.env.ALLOWLIST ?? '')
        .split(',')
        .map((entry) => entry.trim().toLowerCase().replace(/^@/, ''))
        .filter(Boolean),
    ),
    dryRun: process.env.DRY_RUN === 'true',
  };
}
