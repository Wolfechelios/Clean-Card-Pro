// src/lib/pipelineTracer.ts
// Lightweight per-stage tracer for the RapidScan pipeline.
// Pure observation layer — never throws into the caller.
//
// Stages: capture → enqueue → ocr → identify → price → save → stuck
//
// UI subscribes with subscribe(); queueProcessor + camera call record().

export type PipelineStage =
  | "capture"
  | "enqueue"
  | "ocr"
  | "identify"
  | "price"
  | "save"
  | "stuck";

export type PipelineStatus = "start" | "ok" | "fail" | "timeout" | "skip";

export type PipelineEvent = {
  ts: number;
  itemId: string;
  stage: PipelineStage;
  status: PipelineStatus;
  ms?: number;
  error?: string;
  meta?: Record<string, unknown>;
};

const RING_MAX = 400;
const STORAGE_KEY = "pipeline-tracer-ring-v1";

let ring: PipelineEvent[] = [];
const listeners = new Set<() => void>();
let hydrated = false;

function hydrate() {
  if (hydrated || typeof window === "undefined") return;
  hydrated = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) ring = parsed.slice(-RING_MAX);
    }
  } catch {
    /* ignore */
  }
}

function persist() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ring.slice(-RING_MAX)));
  } catch {
    /* ignore */
  }
}

function notify() {
  for (const l of listeners) {
    try {
      l();
    } catch {
      /* ignore */
    }
  }
}

export const pipelineTracer = {
  record(evt: Omit<PipelineEvent, "ts"> & { ts?: number }) {
    try {
      hydrate();
      const full: PipelineEvent = { ts: Date.now(), ...evt };
      ring.push(full);
      if (ring.length > RING_MAX) ring = ring.slice(-RING_MAX);
      persist();
      notify();
    } catch {
      /* swallow — must never break scan pipeline */
    }
  },

  begin(itemId: string, stage: PipelineStage, meta?: Record<string, unknown>) {
    const startedAt = performance.now();
    pipelineTracer.record({ itemId, stage, status: "start", meta });
    return (result: {
      status: Exclude<PipelineStatus, "start">;
      error?: string;
      meta?: Record<string, unknown>;
    }) => {
      pipelineTracer.record({
        itemId,
        stage,
        status: result.status,
        ms: Math.round(performance.now() - startedAt),
        error: result.error,
        meta: result.meta,
      });
    };
  },

  all(): PipelineEvent[] {
    hydrate();
    return ring.slice();
  },

  recent(n = 50): PipelineEvent[] {
    hydrate();
    return ring.slice(-n);
  },

  clear() {
    ring = [];
    persist();
    notify();
  },

  subscribe(fn: () => void): () => void {
    hydrate();
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  /** Aggregate success/fail per stage over the last `windowSize` items. */
  aggregate(windowSize = 50) {
    hydrate();
    const stages: PipelineStage[] = ["capture", "enqueue", "ocr", "identify", "price", "save"];
    const perItem = new Map<string, Map<PipelineStage, PipelineStatus>>();
    // walk newest → oldest, keep newest terminal status per (item, stage)
    for (let i = ring.length - 1; i >= 0; i--) {
      const e = ring[i];
      if (e.status === "start") continue;
      let m = perItem.get(e.itemId);
      if (!m) {
        m = new Map();
        perItem.set(e.itemId, m);
      }
      if (!m.has(e.stage)) m.set(e.stage, e.status);
      if (perItem.size >= windowSize) break;
    }
    const summary: Record<
      PipelineStage,
      { ok: number; fail: number; timeout: number; skip: number; total: number }
    > = {} as any;
    for (const s of stages) summary[s] = { ok: 0, fail: 0, timeout: 0, skip: 0, total: 0 };
    summary["stuck"] = { ok: 0, fail: 0, timeout: 0, skip: 0, total: 0 };
    for (const m of perItem.values()) {
      for (const [stage, status] of m.entries()) {
        const bucket = summary[stage];
        if (!bucket) continue;
        bucket.total += 1;
        if (status === "ok") bucket.ok += 1;
        else if (status === "fail") bucket.fail += 1;
        else if (status === "timeout") bucket.timeout += 1;
        else if (status === "skip") bucket.skip += 1;
      }
    }
    return summary;
  },
};
