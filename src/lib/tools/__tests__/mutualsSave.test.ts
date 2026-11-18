import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addMembers, createModList, type AddProgress } from '@/lib/tools/mutualsSave';

const OWNER = 'did:plc:oooooooooooooooooooooooo';
const LIST = `at://${OWNER}/app.bsky.graph.list/3kabc`;
const subjects = (n: number) => Array.from({ length: n }, (_, i) => `did:plc:${String(i).padStart(24, 'a')}`);

type Call = { method: string; input: Record<string, unknown> };

/** An agent whose writes are recorded, and fail on the batches `failOn` names. */
function fakeAgent(failOn: Record<number, unknown> = {}) {
  const calls: Call[] = [];
  let batch = 0;
  const repo = {
    createRecord: async (input: Record<string, unknown>) => {
      calls.push({ method: 'createRecord', input });
      return { data: { uri: LIST, cid: 'bafy' } };
    },
    applyWrites: async (input: Record<string, unknown>) => {
      const n = batch++;
      calls.push({ method: 'applyWrites', input });
      if (n in failOn) throw failOn[n];
      return { data: {} };
    },
  };
  return { agent: { com: { atproto: { repo } } } as never, calls };
}

test('the list is created as a moderation list in the signed-in repository', async () => {
  const { agent, calls } = fakeAgent();
  const uri = await createModList(agent, OWNER, ' Mine ', 'Why');
  assert.equal(uri, LIST);
  assert.equal(calls[0].input.repo, OWNER);
  assert.equal(calls[0].input.collection, 'app.bsky.graph.list');
  const record = calls[0].input.record as Record<string, unknown>;
  assert.equal(record.purpose, 'app.bsky.graph.defs#modlist');
  assert.equal(record.name, 'Mine');
});

test('members are added in batches of 200, in order', async () => {
  const { agent, calls } = fakeAgent();
  const progress: AddProgress[] = [];
  const outcome = await addMembers(agent, OWNER, LIST, subjects(450), {
    stopper: { stop: false },
    onProgress: (p) => progress.push(p),
  });
  assert.deepEqual(outcome, { added: 450, remaining: [] });
  const batches = calls.map((c) => c.input.writes as { value: { subject: string; list: string } }[]);
  assert.deepEqual(batches.map((b) => b.length), [200, 200, 50]);
  assert.deepEqual(
    batches.flat().map((w) => w.value.subject),
    subjects(450),
  );
  assert.ok(batches.flat().every((w) => w.value.list === LIST));
  assert.equal(progress.at(-1)?.done, 450);
});

test('a refused batch stops the run and leaves it, and everything after, to add again', async () => {
  const limited = Object.assign(new Error('Rate Limit Exceeded'), { status: 429, headers: {} });
  const { agent } = fakeAgent({ 1: limited });
  const outcome = await addMembers(agent, OWNER, LIST, subjects(450), {
    stopper: { stop: false },
    onProgress: () => undefined,
  });
  assert.equal(outcome.added, 200);
  assert.equal(outcome.endedBy, 'rate-limit');
  assert.deepEqual(outcome.remaining, subjects(450).slice(200));

  const { agent: failing } = fakeAgent({ 0: new Error('InvalidRequest') });
  const failed = await addMembers(failing, OWNER, LIST, subjects(10), {
    stopper: { stop: false },
    onProgress: () => undefined,
  });
  assert.equal(failed.endedBy, 'error');
  assert.equal(failed.error, 'InvalidRequest');
  assert.deepEqual(failed.remaining, subjects(10));
});

test('Stop ends the run after the batch in flight', async () => {
  const { agent, calls } = fakeAgent();
  const stopper = { stop: false };
  const outcome = await addMembers(agent, OWNER, LIST, subjects(450), {
    stopper,
    onProgress: (p) => {
      if (p.done === 200) stopper.stop = true;
    },
  });
  assert.equal(calls.length, 1);
  assert.equal(outcome.added, 200);
  assert.equal(outcome.endedBy, 'stop');
  assert.equal(outcome.remaining.length, 250);
});
