/**
 * Entry point: a long-lived process holding a Jetstream subscription open.
 *
 * Two sources feed the same queue. Jetstream is the fast one — a mention
 * reaches the queue about as fast as the network can carry it. The
 * notification sweep is the slow, complete one: Jetstream is at-least-once
 * rather than never-miss, and a disconnect longer than the server's lookback
 * drops events silently. Running both means latency comes from the stream and
 * completeness comes from the API, and the shared dedupe means a mention that
 * arrives on both paths is still answered once.
 *
 * `--once` skips the stream, runs a single sweep, and exits — useful for a
 * cron deployment or for checking a configuration without leaving a process
 * behind.
 */

import { ConfigError, loadConfig } from './config.ts';
import { fetchMentions, login } from './bluesky.ts';
import { closeTools, connectTools } from './answer.ts';
import { watchMentions } from './jetstream.ts';
import { createProcessor } from './process.ts';

async function main(): Promise<void> {
  const config = loadConfig();
  const once = process.argv.includes('--once');

  const agent = await login(config);
  const botDid = agent.did!;
  const botHandle = config.identifier.replace(/^@/, '');

  const toolNames = await connectTools(config);
  console.log(
    `[start] ${botHandle} (${botDid}) · model ${config.model} · ${toolNames.length} tools from ${config.mcpUrl}${config.dryRun ? ' · DRY RUN' : ''}`,
  );

  const processor = createProcessor(agent, config, botHandle);
  await processor.refreshAnswered();

  async function sweep(): Promise<void> {
    for (const mention of await fetchMentions(agent, config)) {
      processor.submit(mention);
    }
  }

  if (once) {
    await sweep();
    await processor.idle();
    await closeTools();
    return;
  }

  const watcher = watchMentions(config, botDid, (mention) =>
    processor.submit(mention),
  );

  // The first sweep catches anything that landed while the process was down;
  // later ones catch whatever the stream dropped.
  await sweep();
  const reconcile = setInterval(() => {
    void processor
      .refreshAnswered()
      .then(sweep)
      .catch((error) => console.error('[reconcile] failed:', error));
  }, config.reconcileMinutes * 60_000);

  await new Promise<void>((resolve) => {
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.on(signal, () => {
        console.log(`\n[stop] ${signal}, draining`);
        clearInterval(reconcile);
        watcher.stop();
        resolve();
      });
    }
  });

  await processor.idle();
  await closeTools();
}

main().catch((error) => {
  console.error(error instanceof ConfigError ? error.message : error);
  process.exit(1);
});
