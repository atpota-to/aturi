/**
 * The two launch prompts. Each demonstrates composing several tools into one
 * useful workflow, which is the fastest way for a person to see what the
 * server is for.
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/server';
import { McpToolError } from '@/lib/mcp/errors';

/**
 * A prompt argument is interpolated into text a model reads as instruction, so
 * anything that is not shaped like an identifier is refused rather than
 * escaped. Without this, a value carrying newlines and its own sentences
 * inserts directives ahead of the route the prompt lays out, and the model has
 * no way to tell them apart from the prompt's own words.
 *
 * The accepted shapes are the ones the tools take anyway: a DID, a dotted
 * handle, or an at:// URI.
 */
const SAFE_IDENTIFIER = /^(did:[a-z]+:[A-Za-z0-9._:%-]{1,256}|[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?)+|at:\/\/[A-Za-z0-9._:%-]{1,256}(\/[A-Za-z0-9._~-]{1,256}){0,2})$/;

function assertSafeIdentifier(value: string): string {
  const trimmed = value.trim();
  if (!SAFE_IDENTIFIER.test(trimmed)) {
    throw new McpToolError(
      'invalid_parameter',
      'identifier must be a handle, a DID, or an at:// URI',
      'Prompt arguments are inlined into instructions, so free text is refused.',
    );
  }
  return trimmed;
}

export function registerPrompts(server: McpServer): void {
  server.registerPrompt(
    'explore_account',
    {
      title: 'Explore an atproto account',
      description:
        'Walk one account end to end: identity, history, repository contents, and who references it.',
      argsSchema: z.object({
        identifier: z
          .string()
          .min(1)
          .max(2048)
          .describe('Handle, DID, or at:// URI of the account to explore.'),
      }),
    },
    ({ identifier }) => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              `Explore the atproto account "${assertSafeIdentifier(identifier)}" and write up what you find.`,
              '',
              'Suggested route:',
              '1. resolve_identity to get the DID, handle, and PDS.',
              '2. get_identity_history for handle changes and PDS migrations.',
              '3. describe_repo to see which lexicons the account actually uses.',
              '4. get_backlinks (mode "counts") on the DID to see how the network references it.',
              '5. get_profile for the Bluesky-layer view, if the account has one.',
              '',
              'Summarize: who this is, where their data lives, what apps they use, and anything unusual in the identity history. Include the links from the tool results so a human can open what you describe.',
            ].join('\n'),
          },
        },
      ],
    }),
  );

  server.registerPrompt(
    'whats_happening',
    {
      title: 'What is happening in the Atmosphere',
      description:
        'A pulse check on the network: which lexicons are moving, and what their activity actually looks like.',
      argsSchema: z.object({}),
    },
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: {
            type: 'text' as const,
            text: [
              'Give me a pulse check on the Atmosphere (the atproto network) right now.',
              '',
              'Suggested route:',
              '1. list_trending_lexicons to find what is most active today.',
              '2. Pick the three most interesting non-Bluesky lexicons and call sample_recent_records on each.',
              '3. For anything unfamiliar, get_lexicon_activity shows whether it is growing or a spike.',
              '',
              'Report what people are actually doing on the network beyond Bluesky, with concrete examples from the samples and links a human can open.',
            ].join('\n'),
          },
        },
      ],
    }),
  );
}
