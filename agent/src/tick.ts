/**
 * One pass: read the mentions, answer the ones not yet answered, write the
 * replies. Everything the loop does is in here, so a cron-driven deployment
 * and a long-running one share exactly the same behaviour.
 */

import type { AtpAgent } from '@atproto/api';
import type { Config } from './config.ts';
import { composeAnswer } from './answer.ts';
import { splitIntoPosts } from './thread.ts';
import {
  fetchMentions,
  markSeen,
  postReply,
  repliedParents,
  threadContext,
} from './bluesky.ts';

export type TickResult = {
  seen: number;
  answered: number;
  skipped: number;
  failed: number;
};

export async function runTick(
  agent: AtpAgent,
  config: Config,
): Promise<TickResult> {
  const [mentions, answeredAlready] = await Promise.all([
    fetchMentions(agent, config),
    repliedParents(agent, config),
  ]);

  const pending = mentions.filter((mention) => !answeredAlready.has(mention.uri));
  const batch = pending.slice(0, config.maxRepliesPerTick);
  const result: TickResult = {
    seen: mentions.length,
    answered: 0,
    skipped: mentions.length - batch.length,
    failed: 0,
  };

  const botHandle = config.identifier.replace(/^@/, '');

  for (const mention of batch) {
    try {
      const context = await threadContext(agent, mention.uri);
      const answer = await composeAnswer(config, botHandle, mention, context);

      if (!answer.text) {
        // A refusal that produced no prose, or an empty completion. Saying
        // nothing is the right outcome; log it so it is not invisible.
        console.warn(
          `[skip] ${mention.uri} produced no text (refused=${answer.refused})`,
        );
        result.skipped += 1;
        continue;
      }

      const chunks = splitIntoPosts(answer.text, config.maxPostsPerReply);

      if (config.dryRun) {
        console.log(
          `[dry-run] would answer @${mention.authorHandle} using [${answer.toolsUsed.join(', ')}]:\n${chunks.map((c, i) => `  ${i + 1}. ${c}`).join('\n')}`,
        );
        result.answered += 1;
        continue;
      }

      const written = await postReply(agent, chunks, mention);
      console.log(
        `[reply] @${mention.authorHandle} -> ${written.length} post(s), tools: [${answer.toolsUsed.join(', ')}]`,
      );
      result.answered += 1;
    } catch (error) {
      // One bad mention must not take the pass down with it: the rest of the
      // batch is still answerable, and the next tick retries this one because
      // no reply was written for it.
      result.failed += 1;
      console.error(`[error] ${mention.uri}:`, error);
    }
  }

  if (!config.dryRun) await markSeen(agent);
  return result;
}
