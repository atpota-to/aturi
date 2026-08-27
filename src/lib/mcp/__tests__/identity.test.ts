import { test } from 'node:test';
import assert from 'node:assert/strict';
import { registerIdentityTools } from '@/lib/mcp/tools/identity';
import {
  captureRegistrations,
  MAX_DESCRIPTION_LENGTH,
} from '@/lib/mcp/__tests__/harness';

const { tools } = captureRegistrations(registerIdentityTools);

test('registers exactly the identity tools', () => {
  assert.deepEqual(
    [...tools.keys()].sort(),
    ['get_identity_history', 'resolve_identity'],
  );
});

test('every tool carries a title, a bounded description, and read-only annotations', () => {
  for (const tool of tools.values()) {
    assert.ok(tool.config.title, `${tool.name} has no title`);
    assert.ok(tool.config.description, `${tool.name} has no description`);
    assert.ok(
      (tool.config.description ?? '').length <= MAX_DESCRIPTION_LENGTH,
      `${tool.name} description exceeds ${MAX_DESCRIPTION_LENGTH} chars`,
    );
    assert.equal(tool.config.annotations?.readOnlyHint, true);
    assert.equal(tool.config.annotations?.openWorldHint, true);
  }
});

test('input schemas reject the shapes agents actually get wrong', () => {
  for (const tool of tools.values()) {
    const schema = tool.config.inputSchema;
    assert.ok(schema, `${tool.name} has no input schema`);
    assert.equal(schema.safeParse({}).success, false, `${tool.name} accepted {}`);
    assert.equal(
      schema.safeParse({ identifier: '' }).success,
      false,
      `${tool.name} accepted an empty identifier`,
    );
    assert.equal(
      schema.safeParse({ identifier: 'a'.repeat(5000) }).success,
      false,
      `${tool.name} accepted an oversized identifier`,
    );
    assert.equal(
      schema.safeParse({ identifier: 'alice.bsky.social' }).success,
      true,
      `${tool.name} rejected a plain handle`,
    );
  }
});
