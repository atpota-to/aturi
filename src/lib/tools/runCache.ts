/**
 * Runs shared by every part of the page that asks the same question.
 *
 * The Explorer asks a tool about an account from several places at once:
 * the account card's rows, the badges in the rail, the tool's own view, and
 * the tool page a link opens. Each asking for itself would send the same few
 * dozen requests three or four times, so a run lives here, under a key that
 * names everything its answer depends on, and every caller with that key
 * joins it.
 *
 *   - A run starts the first time a key is asked for, and its result is kept
 *     for `ttl` after it settles. Asking again after that starts a new one.
 *   - A run that failed is kept only until something asks again, which is
 *     how a remount or a new view retries it.
 *   - A run nobody is watching is not worth finishing. When the last
 *     subscriber leaves an unsettled run, it is aborted after `grace`, long
 *     enough for a remount (a view switch, React's double mount in
 *     development) to pick it back up without starting over.
 *   - `restart` replaces a key's run whatever its state, for "Check again".
 *
 * Nothing here knows about React; `useSharedToolRun` (useToolQuery.ts) is
 * the hook over it. The store is plain so it can be tested with fake time.
 */

export type RunWork<T> = (ctx: { signal: AbortSignal; publish: (data: T) => void }) => Promise<T>;

export type RunSnapshot<T> = {
  status: 'loading' | 'done' | 'error';
  /** What the run has published so far, or its result. */
  data: T | undefined;
  error: string | undefined;
  /** When the run settled, from the store's clock. Null while it runs. */
  settledAt: number | null;
};

type Entry = {
  snapshot: RunSnapshot<unknown>;
  controller: AbortController;
  listeners: Set<() => void>;
  subscribers: number;
  abortTimer: unknown;
};

export type RunCacheOptions = {
  /** How long a settled result is kept, in milliseconds. */
  ttl: number;
  /** How long an unwatched, unsettled run is given before it is aborted. */
  grace: number;
  now?: () => number;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (timer: unknown) => void;
};

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : 'Something went wrong';
}

export class RunCache {
  private readonly entries = new Map<string, Entry>();
  private readonly ttl: number;
  private readonly grace: number;
  private readonly now: () => number;
  private readonly setTimer: (fn: () => void, ms: number) => unknown;
  private readonly clearTimer: (timer: unknown) => void;

  constructor(options: RunCacheOptions) {
    this.ttl = options.ttl;
    this.grace = options.grace;
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
    this.clearTimer = options.clearTimer ?? ((timer) => clearTimeout(timer as ReturnType<typeof setTimeout>));
  }

  /** The current state of a key's run, or undefined when there is none. */
  peek<T>(key: string): RunSnapshot<T> | undefined {
    return this.entries.get(key)?.snapshot as RunSnapshot<T> | undefined;
  }

  /**
   * Make sure a key has a run worth showing: start one when there is none,
   * when the last one failed, or when its result is older than the TTL.
   */
  ensure<T>(key: string, work: RunWork<T>): void {
    this.prune();
    const entry = this.entries.get(key);
    if (entry && !this.stale(entry)) return;
    this.start(key, work, entry);
  }

  /** Start a key's run again, whatever state the last one is in. */
  restart<T>(key: string, work: RunWork<T>): void {
    this.start(key, work, this.entries.get(key));
  }

  /**
   * Watch a key. The listener is called whenever its snapshot changes.
   * Returns the way to stop watching.
   */
  subscribe(key: string, listener: () => void): () => void {
    const entry = this.entryFor(key);
    entry.listeners.add(listener);
    entry.subscribers += 1;
    if (entry.abortTimer !== null) {
      this.clearTimer(entry.abortTimer);
      entry.abortTimer = null;
    }
    let done = false;
    return () => {
      if (done) return;
      done = true;
      const current = this.entries.get(key);
      if (!current) return;
      current.listeners.delete(listener);
      current.subscribers -= 1;
      if (current.subscribers <= 0 && current.snapshot.status === 'loading') this.scheduleAbort(key, current);
    };
  }

  private entryFor(key: string): Entry {
    let entry = this.entries.get(key);
    if (!entry) {
      // Watched before it was started: a placeholder the first `ensure`
      // fills in, so the listener is not lost.
      entry = {
        snapshot: { status: 'loading', data: undefined, error: undefined, settledAt: null },
        controller: new AbortController(),
        listeners: new Set(),
        subscribers: 0,
        abortTimer: null,
      };
      entry.controller.abort();
      this.entries.set(key, entry);
    }
    return entry;
  }

  private stale(entry: Entry): boolean {
    const { snapshot } = entry;
    // A placeholder from `subscribe`, or a run that was aborted: never started.
    if (snapshot.status === 'loading') return entry.controller.signal.aborted;
    if (snapshot.status === 'error') return true;
    return snapshot.settledAt !== null && this.now() - snapshot.settledAt >= this.ttl;
  }

  private start<T>(key: string, work: RunWork<T>, previous: Entry | undefined): void {
    previous?.controller.abort();
    if (previous && previous.abortTimer !== null) this.clearTimer(previous.abortTimer);
    const controller = new AbortController();
    const entry: Entry = {
      snapshot: { status: 'loading', data: undefined, error: undefined, settledAt: null },
      controller,
      listeners: previous?.listeners ?? new Set(),
      subscribers: previous?.subscribers ?? 0,
      abortTimer: null,
    };
    this.entries.set(key, entry);
    this.notify(entry);

    const { signal } = controller;
    const update = (snapshot: RunSnapshot<unknown>) => {
      // A run replaced by `restart`, or aborted, has no say any more.
      if (signal.aborted || this.entries.get(key) !== entry) return;
      entry.snapshot = snapshot;
      this.notify(entry);
    };
    let result: Promise<T>;
    try {
      result = work({
        signal,
        publish: (data) => update({ status: 'loading', data, error: undefined, settledAt: null }),
      });
    } catch (err) {
      result = Promise.reject(err);
    }
    result.then(
      (data) => update({ status: 'done', data, error: undefined, settledAt: this.now() }),
      (err) =>
        update({
          status: 'error',
          data: entry.snapshot.data,
          error: errorMessage(err),
          settledAt: this.now(),
        }),
    );
  }

  private scheduleAbort(key: string, entry: Entry): void {
    if (entry.abortTimer !== null) this.clearTimer(entry.abortTimer);
    entry.abortTimer = this.setTimer(() => {
      entry.abortTimer = null;
      if (this.entries.get(key) !== entry || entry.subscribers > 0) return;
      if (entry.snapshot.status !== 'loading') return;
      entry.controller.abort();
      this.entries.delete(key);
    }, this.grace);
  }

  /** Drop settled results nobody is watching once they are past the TTL. */
  private prune(): void {
    for (const [key, entry] of this.entries) {
      if (entry.subscribers > 0) continue;
      if (entry.snapshot.status === 'loading') continue;
      if (this.stale(entry)) this.entries.delete(key);
    }
  }

  private notify(entry: Entry): void {
    for (const listener of [...entry.listeners]) listener();
  }
}

/** Ten minutes: long enough to come back to an account, short enough to stay current. */
export const SHARED_RUN_TTL = 10 * 60_000;

/** The page's one store. */
export const sharedRuns = new RunCache({ ttl: SHARED_RUN_TTL, grace: 2_000 });
