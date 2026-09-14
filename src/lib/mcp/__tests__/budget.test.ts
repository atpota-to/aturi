import { test } from 'node:test';
import assert from 'node:assert/strict';
import { McpToolError } from '@/lib/mcp/errors';
import { DNS_BUDGET_MS, TOOL_BUDGET_MS, withBudget } from '@/lib/mcp/budget';

const later = <T,>(ms: number, value: T) =>
  new Promise<T>((resolve) => setTimeout(() => resolve(value), ms));

const failsLater = (ms: number, err: Error) =>
  new Promise<never>((_, reject) => setTimeout(() => reject(err), ms));

test('work that finishes inside the budget passes through untouched', async () => {
  assert.equal(await withBudget(later(5, 'done'), 1_000, 'too slow'), 'done');
});

test('an expired budget fails as an upstream error carrying its hint', async () => {
  await assert.rejects(
    withBudget(later(1_000, 'never'), 5, 'The PDS did not answer in time', 'Retry later.'),
    (err: unknown) => {
      assert.ok(err instanceof McpToolError);
      assert.equal(err.code, 'upstream_error');
      assert.equal(err.message, 'The PDS did not answer in time');
      assert.equal(err.hint, 'Retry later.');
      return true;
    },
  );
});

test("the work's own failure is reported as itself, not as an expiry", async () => {
  // Callers branch on McpToolError to tell the two apart — the SSRF guard
  // does exactly this to keep "does not resolve" off a name that never
  // answered — so a real failure must not be dressed up as a timeout.
  const boom = new Error('HTTP 502');
  await assert.rejects(withBudget(failsLater(5, boom), 1_000, 'too slow'), boom);
});

test('work abandoned by an expiry may still fail without crashing the process', async () => {
  // Promise.race subscribes to both branches, so the loser's rejection is
  // already handled. If it were not, this would take down the test runner
  // rather than fail an assertion.
  await assert.rejects(
    withBudget(failsLater(20, new Error('too late to matter')), 5, 'too slow'),
    McpToolError,
  );
  await later(40, null);
});

test('a budget that is never reached does not hold the process open', async () => {
  // The whole point of the module, turned on itself: an unreferenced, cleared
  // timer. If either half of that were missing, this suite would sit here for
  // ten minutes instead of finishing.
  assert.equal(await withBudget(Promise.resolve('fast'), 600_000, 'unreachable'), 'fast');
});

test('the budgets stay under the route that has to outlive them', async () => {
  // maxDuration in app/api/mcp/route.ts is 60s. A tool budget at or above it
  // would never fire — the platform would kill the invocation first, which is
  // the failure mode these numbers exist to prevent.
  assert.ok(TOOL_BUDGET_MS < 60_000);
  assert.ok(DNS_BUDGET_MS < TOOL_BUDGET_MS);
});
