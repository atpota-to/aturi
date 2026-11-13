import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Agent } from '@atproto/api';
import {
  DEFAULT_PREFERENCES,
  mergeWithDefaults,
  preferencesAreEqual,
  toggleLexiconExplorerPin,
  type Preferences,
} from '@/utils/preferences';
import { writePreferencesToPds } from '@/utils/atproto/preferencesPds';

test('nothing is pinned by default, or in prefs that predate the field', () => {
  assert.deepEqual(DEFAULT_PREFERENCES.lexiconExplorerPins, []);
  assert.deepEqual(mergeWithDefaults({ colorScheme: 'moss' }).lexiconExplorerPins, []);
});

test('reads a stored list leniently', () => {
  const stored = { lexiconExplorerPins: ['app.bsky.feed.post', 4, null, 'sh.tangled.*'] } as unknown as Partial<Preferences>;
  assert.deepEqual(mergeWithDefaults(stored).lexiconExplorerPins, ['app.bsky.feed.post', 'sh.tangled.*']);
  const notAList = { lexiconExplorerPins: 'app.bsky.feed.post' } as unknown as Partial<Preferences>;
  assert.deepEqual(mergeWithDefaults(notAList).lexiconExplorerPins, []);
});

test('toggling pins at the end and unpins, leaving the account explorer’s pins alone', () => {
  const base: Preferences = { ...DEFAULT_PREFERENCES, pinnedLexicons: ['app.bsky.feed.post'] };
  const one = toggleLexiconExplorerPin(base, 'app.bsky.feed.post');
  const two = toggleLexiconExplorerPin(one, 'sh.tangled.*');
  assert.deepEqual(two.lexiconExplorerPins, ['app.bsky.feed.post', 'sh.tangled.*']);
  assert.deepEqual(two.pinnedLexicons, ['app.bsky.feed.post']);
  assert.deepEqual(toggleLexiconExplorerPin(two, 'app.bsky.feed.post').lexiconExplorerPins, ['sh.tangled.*']);
});

test('a changed list makes two copies unequal, so a sign-in reconciles it', () => {
  const pinned = toggleLexiconExplorerPin(DEFAULT_PREFERENCES, 'app.bsky.feed.post');
  assert.equal(preferencesAreEqual(DEFAULT_PREFERENCES, pinned), false);
  assert.equal(preferencesAreEqual(pinned, { ...pinned }), true);
});

test('the record written to the PDS carries the list, and reads back', async () => {
  let written: Record<string, unknown> | null = null;
  const agent = {
    com: {
      atproto: {
        repo: {
          putRecord: async ({ record }: { record: Record<string, unknown> }) => {
            written = record;
            return {};
          },
        },
      },
    },
  } as unknown as Agent;
  const prefs = toggleLexiconExplorerPin(DEFAULT_PREFERENCES, 'community.lexicon.*');
  await writePreferencesToPds(agent, 'did:plc:example', prefs);
  assert.ok(written);
  assert.deepEqual((written as Record<string, unknown>).lexiconExplorerPins, ['community.lexicon.*']);
  assert.deepEqual(mergeWithDefaults(written as Partial<Preferences>).lexiconExplorerPins, ['community.lexicon.*']);
});
