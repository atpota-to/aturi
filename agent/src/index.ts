/**
 * Entry point. `--once` runs a single pass and exits, which is the shape a
 * cron or a serverless invocation wants; without it the process stays up and
 * polls, which is the shape a container wants. The tick itself is identical.
 */

import { ConfigError, loadConfig } from './config.ts';
import { login } from './bluesky.ts';
import { runTick } from './tick.ts';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main(): Promise<void> {
  const config = loadConfig();
  const once = process.argv.includes('--once');

  const agent = await login(config);
  console.log(
    `[start] signed in as ${config.identifier} (${agent.did}), mcp=${config.mcpUrl}${config.dryRun ? ', DRY RUN' : ''}`,
  );

  if (once) {
    console.log('[tick]', await runTick(agent, config));
    return;
  }

  let running = true;
  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.on(signal, () => {
      console.log(`\n[stop] ${signal}, finishing the current pass`);
      running = false;
    });
  }

  while (running) {
    try {
      const result = await runTick(agent, config);
      if (result.answered || result.failed) console.log('[tick]', result);
    } catch (error) {
      // Network blips and expired sessions land here. Keep polling: the next
      // pass re-reads notifications from scratch and nothing was lost.
      console.error('[tick] failed:', error);
    }
    await sleep(config.pollIntervalSeconds * 1000);
  }
}

main().catch((error) => {
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
});
