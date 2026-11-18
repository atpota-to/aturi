'use client';

import { useCallback, useEffect, useEffectEvent, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import { sharedRuns, type RunWork } from '@/lib/tools/runCache';

/**
 * A tool's input, kept in the query string so any result can be shared or
 * bookmarked, as the stream monitor keeps its filters.
 *
 * The address bar is the source of truth: values are read from
 * `useSearchParams`, and a change is written with `history.pushState`, which
 * Next's router picks up without a round trip to the server. A submitted
 * input is a new history entry, so Back returns to the one before it; pass
 * `replace` for changes that should not be (a toggle, a tab).
 *
 * Needs a Suspense boundary above it, like anything that reads the query
 * string on a statically rendered page.
 */
export function useToolQuery<K extends string>(
  keys: readonly K[],
): [Record<K, string>, (next: Partial<Record<K, string>>, options?: { replace?: boolean }) => void] {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const serialized = searchParams.toString();

  const values = useMemo(() => {
    const params = new URLSearchParams(serialized);
    const out = {} as Record<K, string>;
    for (const key of keys) out[key] = params.get(key) ?? '';
    return out;
    // `keys` is a literal at every call site; its contents never change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serialized]);

  const set = useCallback(
    (next: Partial<Record<K, string>>, options?: { replace?: boolean }) => {
      const params = new URLSearchParams(window.location.search);
      for (const [key, value] of Object.entries(next) as [K, string | undefined][]) {
        if (value) params.set(key, value);
        else params.delete(key);
      }
      const query = params.toString();
      const url = `${pathname}${query ? `?${query}` : ''}`;
      if (url === `${window.location.pathname}${window.location.search}`) return;
      if (options?.replace) window.history.replaceState(null, '', url);
      else window.history.pushState(null, '', url);
    },
    [pathname],
  );

  return [values, set];
}

export type ToolRun<T> =
  | { status: 'idle'; data: undefined; error: undefined }
  /** Running. `data` holds whatever the run has published so far. */
  | { status: 'loading'; data: T | undefined; error: undefined }
  | { status: 'done'; data: T; error: undefined }
  | { status: 'error'; data: T | undefined; error: string };

type RunState<T> = { id: string; data?: T; error?: string; settled: boolean };

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return typeof err === 'string' ? err : 'Something went wrong';
}

/**
 * Run a tool's work for an input and report where it has got to.
 *
 * `input` identifies the run: a new value aborts the one in flight and starts
 * again, and `null` means there is nothing to run. Results belong to the
 * input that produced them, so a slow answer to an earlier input can never
 * land on a later one.
 *
 * `work` may call `publish` as it goes, which is how a check list fills in
 * step by step and a long scan shows its progress; what it returns replaces
 * the last published value. `rerun` runs the same input again.
 */
export function useToolRun<T>(
  input: string | null,
  work: (ctx: { signal: AbortSignal; publish: (data: T) => void }) => Promise<T>,
): ToolRun<T> & { rerun: () => void } {
  const [state, setState] = useState<RunState<T> | null>(null);
  const [attempt, setAttempt] = useState(0);
  const id = input === null ? null : `${attempt}:${input}`;
  const start = useEffectEvent(work);

  useEffect(() => {
    if (id === null) return undefined;
    const controller = new AbortController();
    const { signal } = controller;
    start({
      signal,
      publish: (data) => {
        if (!signal.aborted) setState({ id, data, settled: false });
      },
    }).then(
      (data) => {
        if (!signal.aborted) setState({ id, data, settled: true });
      },
      (err) => {
        if (signal.aborted) return;
        setState((prev) => ({
          id,
          data: prev?.id === id ? prev.data : undefined,
          error: errorMessage(err),
          settled: true,
        }));
      },
    );
    return () => controller.abort();
  }, [id]);

  const rerun = useCallback(() => setAttempt((n) => n + 1), []);

  if (id === null) return { status: 'idle', data: undefined, error: undefined, rerun };
  const current = state?.id === id ? state : null;
  if (!current || !current.settled) {
    return { status: 'loading', data: current?.data, error: undefined, rerun };
  }
  if (current.error !== undefined) {
    return { status: 'error', data: current.data, error: current.error, rerun };
  }
  return { status: 'done', data: current.data as T, error: undefined, rerun };
}

const NO_SUBSCRIPTION = () => () => undefined;
const noSnapshot = () => undefined;

/**
 * `useToolRun`, joined to the page's shared runs (src/lib/tools/runCache.ts):
 * every caller with the same `input` shares one run and its result, which is
 * kept for ten minutes. For a check the Explorer asks from several places at
 * once, such as the account card and the tool's own view.
 *
 * `input` must name everything the answer depends on, since another caller's
 * `work` may be the one that runs. `settledAt` says how old a kept result
 * is; `rerun` starts the run again for every caller.
 */
export function useSharedToolRun<T>(
  input: string | null,
  work: RunWork<T>,
): ToolRun<T> & { rerun: () => void; settledAt: number | null } {
  // The latest `work`, for a run started from an effect or a click.
  const workRef = useRef(work);
  useLayoutEffect(() => {
    workRef.current = work;
  });

  const subscribe = useMemo(
    () => (input === null ? NO_SUBSCRIPTION : (listener: () => void) => sharedRuns.subscribe(input, listener)),
    [input],
  );
  const getSnapshot = useCallback(() => (input === null ? undefined : sharedRuns.peek<T>(input)), [input]);
  // The server, and hydration, see a run that has not started, so a result
  // kept from earlier in the visit never makes the first render disagree.
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, noSnapshot);

  useEffect(() => {
    if (input === null) return;
    sharedRuns.ensure<T>(input, (ctx) => workRef.current(ctx));
  }, [input]);

  const rerun = useCallback(() => {
    if (input !== null) sharedRuns.restart<T>(input, (ctx) => workRef.current(ctx));
  }, [input]);

  if (input === null) return { status: 'idle', data: undefined, error: undefined, rerun, settledAt: null };
  if (!snapshot || snapshot.status === 'loading') {
    return { status: 'loading', data: snapshot?.data, error: undefined, rerun, settledAt: null };
  }
  if (snapshot.status === 'error') {
    return { status: 'error', data: snapshot.data, error: snapshot.error ?? 'Something went wrong', rerun, settledAt: snapshot.settledAt };
  }
  return { status: 'done', data: snapshot.data as T, error: undefined, rerun, settledAt: snapshot.settledAt };
}
