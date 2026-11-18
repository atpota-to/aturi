import { test } from 'node:test';
import assert from 'node:assert/strict';
import { RunCache, type RunWork } from '@/lib/tools/runCache';

/** A clock and timers the test moves by hand. */
function fakeTime() {
  let now = 1_000_000;
  let nextId = 1;
  const timers = new Map<number, { at: number; fn: () => void }>();
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => {
      const id = nextId++;
      timers.set(id, { at: now + ms, fn });
      return id;
    },
    clearTimer: (id: unknown) => {
      timers.delete(id as number);
    },
    advance(ms: number) {
      now += ms;
      for (const [id, timer] of [...timers]) {
        if (timer.at <= now) {
          timers.delete(id);
          timer.fn();
        }
      }
    },
  };
}

/** Work that settles when the test says so, and records each start. */
function controlled<T>() {
  const starts: { signal: AbortSignal; publish: (data: T) => void; resolve: (data: T) => void; reject: (err: unknown) => void }[] = [];
  const work: RunWork<T> = ({ signal, publish }) =>
    new Promise<T>((resolve, reject) => {
      starts.push({ signal, publish, resolve, reject });
    });
  return { work, starts };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

function cache(time = fakeTime()) {
  return { time, runs: new RunCache({ ttl: 10_000, grace: 500, ...time }) };
}

test('callers asking the same key share one run and its result', async () => {
  const { runs } = cache();
  const { work, starts } = controlled<number>();
  let heard = 0;
  runs.subscribe('k', () => heard++);
  runs.ensure('k', work);
  runs.ensure('k', work);
  assert.equal(starts.length, 1);
  assert.equal(runs.peek('k')?.status, 'loading');

  starts[0].publish(1);
  assert.equal(runs.peek<number>('k')?.data, 1);
  starts[0].resolve(2);
  await tick();
  const done = runs.peek<number>('k');
  assert.equal(done?.status, 'done');
  assert.equal(done?.data, 2);
  assert.ok(done?.settledAt);
  assert.ok(heard >= 3);
});

test('a kept result is reused until the TTL passes, then a new run starts', async () => {
  const { runs, time } = cache();
  const { work, starts } = controlled<string>();
  runs.ensure('k', work);
  starts[0].resolve('first');
  await tick();
  time.advance(9_000);
  runs.ensure('k', work);
  assert.equal(starts.length, 1);
  time.advance(2_000);
  runs.ensure('k', work);
  assert.equal(starts.length, 2);
  assert.equal(runs.peek('k')?.status, 'loading');
});

test('a failed run is retried by the next caller to ask', async () => {
  const { runs } = cache();
  const { work, starts } = controlled<string>();
  runs.ensure('k', work);
  starts[0].reject(new Error('the AppView answered HTTP 502'));
  await tick();
  assert.equal(runs.peek('k')?.status, 'error');
  assert.equal(runs.peek('k')?.error, 'the AppView answered HTTP 502');
  runs.ensure('k', work);
  assert.equal(starts.length, 2);
});

test('an unwatched run is aborted after the grace period, and a remount inside it keeps the run', async () => {
  const { runs, time } = cache();
  const { work, starts } = controlled<string>();
  const stop = runs.subscribe('k', () => undefined);
  runs.ensure('k', work);
  stop();
  time.advance(300);
  const again = runs.subscribe('k', () => undefined);
  runs.ensure('k', work);
  assert.equal(starts.length, 1, 'remounting inside the grace period joins the same run');
  time.advance(1_000);
  assert.equal(starts[0].signal.aborted, false);

  again();
  time.advance(600);
  assert.equal(starts[0].signal.aborted, true);
  assert.equal(runs.peek('k'), undefined);
  runs.ensure('k', work);
  assert.equal(starts.length, 2, 'asking after an abort starts afresh');
});

test('a settled run is kept even with no one watching', async () => {
  const { runs, time } = cache();
  const { work, starts } = controlled<string>();
  const stop = runs.subscribe('k', () => undefined);
  runs.ensure('k', work);
  starts[0].resolve('kept');
  await tick();
  stop();
  time.advance(5_000);
  assert.equal(runs.peek<string>('k')?.data, 'kept');
});

test('restart replaces the run for everyone watching, and the old one has no say', async () => {
  const { runs } = cache();
  const { work, starts } = controlled<string>();
  let heard = 0;
  runs.subscribe('k', () => heard++);
  runs.ensure('k', work);
  runs.restart('k', work);
  assert.equal(starts.length, 2);
  assert.equal(starts[0].signal.aborted, true);
  starts[0].resolve('stale');
  starts[1].resolve('fresh');
  await tick();
  assert.equal(runs.peek<string>('k')?.data, 'fresh');
  assert.ok(heard >= 2);
});

test('keys are separate', async () => {
  const { runs } = cache();
  const a = controlled<string>();
  const b = controlled<string>();
  runs.ensure('a', a.work);
  runs.ensure('b', b.work);
  a.starts[0].resolve('A');
  await tick();
  assert.equal(runs.peek('a')?.status, 'done');
  assert.equal(runs.peek('b')?.status, 'loading');
});
