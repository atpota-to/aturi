import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WAYPOINT_DESTINATIONS_DATA } from '@/utils/waypoints.data';
import {
  POST_GRAPHEME_LIMIT,
  anchorSnippet,
  buttonSnippet,
  composeText,
  countGraphemes,
  shareTargets,
  shareUrlProblem,
} from '@/lib/tools/share';

test('countGraphemes counts what a reader sees', () => {
  assert.equal(countGraphemes(''), 0);
  assert.equal(countGraphemes('hello'), 5);
  assert.equal(countGraphemes('café'), 4);
  // One family, seven code points.
  assert.equal(countGraphemes('👨‍👩‍👧‍👦'), 1);
  assert.equal(countGraphemes('👍🏽 ok'), 4);
  assert.equal(POST_GRAPHEME_LIMIT, 300);
});

test('composeText puts the link on a line of its own', () => {
  assert.equal(composeText(' Reading this ', ' https://example.com/a '), 'Reading this\nhttps://example.com/a');
  assert.equal(composeText('Just text', ''), 'Just text');
  assert.equal(composeText('', 'https://example.com'), 'https://example.com');
  assert.equal(composeText('', ''), '');
});

test('shareUrlProblem accepts web addresses and an empty field', () => {
  assert.equal(shareUrlProblem(''), null);
  assert.equal(shareUrlProblem('https://example.com/post?a=1'), null);
  assert.ok(shareUrlProblem('example.com/post'));
  assert.ok(shareUrlProblem('javascript:alert(1)'));
});

test('every target comes from the catalog, and only clients with a compose route', () => {
  const targets = shareTargets('hello');
  const withIntent = Object.values(WAYPOINT_DESTINATIONS_DATA).filter((w) => w.composeIntent);
  assert.equal(targets.length, withIntent.length);
  assert.ok(targets.length > 0);
  for (const target of targets) {
    const intent = WAYPOINT_DESTINATIONS_DATA[target.id].composeIntent;
    assert.ok(intent, `${target.id} has no compose intent in the catalog`);
    assert.ok(target.url.startsWith(intent.url));
    assert.equal(target.prefillsText, Boolean(intent.textParam));
  }
});

test('the text is URL-encoded into clients that read it, and left off those that do not', () => {
  const post = composeText('50% off & more?', 'https://example.com/a?b=1#c');
  const targets = shareTargets(post);
  const bluesky = targets.find((t) => t.id === 'bluesky');
  assert.ok(bluesky);
  assert.equal(
    bluesky.url,
    'https://bsky.app/intent/compose?text=50%25%20off%20%26%20more%3F%0Ahttps%3A%2F%2Fexample.com%2Fa%3Fb%3D1%23c',
  );
  assert.equal(new URL(bluesky.url).searchParams.get('text'), post);
  assert.ok(bluesky.appUrl?.startsWith('bluesky://intent/compose?text='));

  for (const target of targets.filter((t) => !t.prefillsText)) {
    assert.ok(!target.url.includes('?'), `${target.id} ignores the text, so its link carries none`);
  }
  // With nothing to say the link is the bare route.
  assert.equal(shareTargets('').find((t) => t.id === 'bluesky')?.url, 'https://bsky.app/intent/compose');
});

test('the snippets escape what goes into them', () => {
  const target = { url: 'https://bsky.app/intent/compose?text=a%26b&x="y"' };
  const anchor = anchorSnippet(target, 'Share <now> & "then"');
  assert.equal(
    anchor,
    '<a href="https://bsky.app/intent/compose?text=a%26b&amp;x=&quot;y&quot;" target="_blank" rel="noopener noreferrer">Share &lt;now&gt; &amp; &quot;then&quot;</a>',
  );
  const button = buttonSnippet(target, 'Share on Bluesky');
  assert.match(button, /style="display:inline-flex;/);
  assert.match(button, /rel="noopener noreferrer"/);
  assert.ok(!button.includes('x="y"'));
});
