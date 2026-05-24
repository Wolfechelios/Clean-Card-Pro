import { useCallback, useEffect, useRef, useState } from "react";

export interface BulkJobItem {
  id: string;
}

export interface BulkJobOptions<TItem extends BulkJobItem, TResult> {
  /** Stable id used for localStorage persistence */
  jobKey: string;
  /** How many items per concurrent worker invocation */
  batchSize?: number;
  /** How many workers to run in parallel */
  concurrency?: number;
  /** Throttle between successive batch dispatches per worker (ms) */
  throttleMs?: number;
  /** Process a single batch — must return per-item results (each with id) */
  runBatch: (batch: TItem[]) => Promise<TResult[]>;
}

export interface BulkJobState<TResult> {
  running: boolean;
  paused: boolean;
  progress: number; // 0-100
  processed: number;
  total: number;
  results: TResult[];
  error: string | null;
}

const STORAGE_PREFIX = "bulkjob:";

function loadState<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function saveState<T>(key: string, value: T) {
  try { localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value)); } catch { /* quota */ }
}

function clearState(key: string) {
  try { localStorage.removeItem(STORAGE_PREFIX + key); } catch { /* noop */ }
}

/**
 * Generic bulk-job runner with controlled concurrency, throttle, persistence,
 * pause/resume, and resumable progress across reloads.
 */
export function useBulkJob<TItem extends BulkJobItem, TResult extends { id: string }>(
  opts: BulkJobOptions<TItem, TResult>
) {
  const { jobKey, batchSize = 10, concurrency = 3, throttleMs = 0 } = opts;

  const persisted = loadState<BulkJobState<TResult>>(jobKey);
  const [state, setState] = useState<BulkJobState<TResult>>(persisted || {
    running: false,
    paused: false,
    progress: 0,
    processed: 0,
    total: 0,
    results: [],
    error: null,
  });

  const pausedRef = useRef(state.paused);
  const cancelRef = useRef(false);
  const runBatchRef = useRef(opts.runBatch);
  runBatchRef.current = opts.runBatch;

  useEffect(() => { pausedRef.current = state.paused; }, [state.paused]);

  // Persist on every meaningful change
  useEffect(() => {
    if (state.running || state.processed > 0) saveState(jobKey, state);
  }, [jobKey, state]);

  const start = useCallback(async (items: TItem[]) => {
    if (items.length === 0) return;
    cancelRef.current = false;

    // Resume support: skip ids already processed
    const previousIds = new Set(state.results.map((r) => r.id));
    const remaining = items.filter((i) => !previousIds.has(i.id));

    setState((s) => ({
      ...s,
      running: true,
      paused: false,
      error: null,
      total: items.length,
      processed: items.length - remaining.length,
      progress: items.length === 0 ? 0 : Math.round(((items.length - remaining.length) / items.length) * 100),
    }));

    // Build batches
    const batches: TItem[][] = [];
    for (let i = 0; i < remaining.length; i += batchSize) {
      batches.push(remaining.slice(i, i + batchSize));
    }

    let nextIdx = 0;
    const runWorker = async () => {
      while (nextIdx < batches.length) {
        if (cancelRef.current) return;
        // Pause loop
        while (pausedRef.current) {
          await new Promise((r) => setTimeout(r, 250));
          if (cancelRef.current) return;
        }
        const myIdx = nextIdx++;
        const batch = batches[myIdx];
        if (!batch) return;
        try {
          const out = await runBatchRef.current(batch);
          setState((s) => {
            const merged = [...s.results, ...out];
            const processed = s.processed + batch.length;
            return {
              ...s,
              results: merged,
              processed,
              progress: s.total === 0 ? 0 : Math.round((processed / s.total) * 100),
            };
          });
        } catch (e) {
          setState((s) => ({ ...s, error: (e as Error).message || String(e) }));
        }
        if (throttleMs > 0) await new Promise((r) => setTimeout(r, throttleMs));
      }
    };

    const workers = Array.from({ length: Math.max(1, concurrency) }, runWorker);
    await Promise.all(workers);

    setState((s) => ({ ...s, running: false }));
  }, [batchSize, concurrency, throttleMs, jobKey, state.results]);

  const pause = useCallback(() => setState((s) => ({ ...s, paused: true })), []);
  const resume = useCallback(() => setState((s) => ({ ...s, paused: false })), []);
  const cancel = useCallback(() => {
    cancelRef.current = true;
    setState((s) => ({ ...s, running: false, paused: false }));
  }, []);
  const reset = useCallback(() => {
    cancelRef.current = true;
    clearState(jobKey);
    setState({
      running: false, paused: false, progress: 0, processed: 0,
      total: 0, results: [], error: null,
    });
  }, [jobKey]);

  return { state, start, pause, resume, cancel, reset };
}
