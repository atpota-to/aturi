import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerAtmosphereServer } from '@/lib/mcp/registry';
import { CATALOG_TOOL_NAMES, TOOL_COUNT, TOOL_GROUPS, numberWord, toolCountWord } from '@/lib/mcp/catalog';
import { captureRegistrations } from '@/lib/mcp/__tests__/harness';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildLlmsTxt } from '@/lib/llmsTxt';
import { buildMcpPage, renderContentPageMarkdown } from '@/lib/siteContent';

const { tools, prompts } = captureRegistrations(registerAtmosphereServer);

test('the documented catalog matches the tools actually registered', () => {
  // The drift this guards: a tool shipped but never documented reads as a
  // smaller product than it is, and a tool documented but not registered
  // sends agents at something that will never answer.
  assert.deepEqual([...CATALOG_TOOL_NAMES].sort(), [...tools.keys()].sort());
});

test('every catalog entry has a group, a blurb, and a one-line summary', () => {
  for (const group of TOOL_GROUPS) {
    assert.match(group.id, /^[a-z0-9-]+$/);
    assert.ok(group.title.length > 0, `${group.id} has no title`);
    assert.ok(group.blurb.length > 20, `${group.id} blurb is too thin`);
    assert.ok(group.tools.length > 0, `${group.id} has no tools`);
    for (const tool of group.tools) {
      assert.ok(tool.summary.length > 10, `${tool.name} summary is too thin`);
      assert.ok(!tool.summary.endsWith('.'), `${tool.name} summary should not end in a period`);
    }
  }
});

test('group ids and tool names are unique across the catalog', () => {
  const ids = TOOL_GROUPS.map((g) => g.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.equal(new Set(CATALOG_TOOL_NAMES).size, CATALOG_TOOL_NAMES.length);
  assert.equal(TOOL_COUNT, CATALOG_TOOL_NAMES.length);
});

test('the spelled-out counts stay in step with the real ones', () => {
  // The landing copy reads "Thirty-four tools, eight groups". If the catalog
  // grows past the word table, the sentence silently becomes "Thirty-four
  // tools, 13 groups", which mixes a word with a numeral.
  assert.match(toolCountWord(), /^[a-z-]+$/, 'tool count has no word form; extend NUMBER_WORDS');
  assert.match(
    numberWord(TOOL_GROUPS.length),
    /^[a-z-]+$/,
    'group count has no word form; extend NUMBER_WORDS',
  );
});

test('both prompts are registered alongside the tools', () => {
  assert.deepEqual([...prompts.keys()].sort(), ['explore_account', 'whats_happening']);
});

test('no site copy hard-codes a tool count that could drift', () => {
  // The count reached /mcp, /mcp.md and /llms.txt by hand once already and
  // went stale the next time the catalog grew. Every surface must derive it.
  const sources = [
    'src/lib/llmsTxt.ts',
    'src/lib/siteContent.ts',
    'src/components/landing/McpLanding.tsx',
    'src/app/mcp/page.tsx',
  ];
  const written = /\b(sixteen|seventeen|eighteen|nineteen|twenty|twenty-four|thirty|thirty-four|thirty-five)\s+tools\b/i;
  for (const file of sources) {
    const text = readFileSync(resolve(process.cwd(), file), 'utf8');
    const match = text.match(written);
    assert.equal(match, null, `${file} hard-codes "${match?.[0]}"; interpolate toolCountWord() instead`);
  }
});

test('the rendered llms.txt and Markdown twin report the real count', () => {
  const llms = buildLlmsTxt('https://example.test');
  assert.ok(
    llms.includes(`${toolCountWord()} tools`),
    `llms.txt does not name the current count (${toolCountWord()})`,
  );
  const md = renderContentPageMarkdown(buildMcpPage('https://example.test'));
  assert.ok(md.includes(`## ${TOOL_COUNT} tools`), `mcp.md does not name ${TOOL_COUNT} tools`);
});
