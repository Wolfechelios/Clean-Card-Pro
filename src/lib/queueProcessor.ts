// src/lib/queueProcessor.ts
// Standalone, resilient queue processor for rapid scan jobs.
// Runs independently of the RapidScanCamera component.
// Auto-resumes on app start if there are queued items.

import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";
import { withRetry } from "@/lib/retry";
import { getScannerSettings } from "@/hooks/use-scanner-settings";
import {
  idbGetNextQueued,
  idbUpdateMeta,
  idbDelete,
  idbCount,
  idbGetAll,
  type QueueItem,
  type QueueItemMeta,
} from "@/lib/idbQueue";

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type ProcessedCard = {
  id: string;
  cardName: string;
  cardSet?: string;
  cardNumber?: string;
  rarity?: string;
  gameType?: string;
  sportType?: string;
  value: number | null;
  imageUrl: string;
  isInLibrary: boolean;
  libraryQuantity: number;
  dbId?: string;
};

export type ProcessorState = {
  isRunning: boolean;
  isPaused: boolean;
  queueCount: number;
  processedCount: number;
  errorCount: number;
  currentItem: string | null;
  lastProcessedCard: ProcessedCard | null;
  queueMeta: QueueItemMeta[];
};

type ProcessorStore = ProcessorState & {
  // Actions
  start: () => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  refreshQueue: () => Promise<void>;
  // Internal setters
  _setRunning: (v: boolean) => void;
  _setPaused: (v: boolean) => void;
  _setQueueCount: (v: number) => void;
  _setProcessedCount: (v: number) => void;
  _setErrorCount: (v: number) => void;
  _setCurrentItem: (v: string | null) => void;
  _setLastProcessedCard: (v: ProcessedCard | null) => void;
  _setQueueMeta: (v: QueueItemMeta[]) => void;
  _incrementProcessed: () => void;
  _incrementError: () => void;
};

// ─────────────────────────────────────────────────────────────────────────────
// CONFIG
// ─────────────────────────────────────────────────────────────────────────────

const SIGNED_URL_TTL_SECONDS = 60 * 60 * 24; // 24h
const JOB_DELAY_MS = 800;
const POLL_INTERVAL_MS = 500;
const WORKER_SCALE_INTERVAL_MS = 2000; // How often to check if we can scale up

function getMaxWorkerCount(): number {
  return getScannerSettings().batchScanSize || 3;
}

// Adaptive scaling: start with fewer workers and scale up based on queue size
function getTargetWorkerCount(queueSize: number, maxWorkers: number): number {
  if (queueSize === 0) return 1;
  // Scale workers proportionally: 1 worker per 2 queue items, capped at max
  const proportional = Math.ceil(queueSize / 2);
  return Math.min(Math.max(1, proportional), maxWorkers);
}

// ─────────────────────────────────────────────────────────────────────────────
// ZUSTAND STORE
// ─────────────────────────────────────────────────────────────────────────────

export const useQueueProcessor = create<ProcessorStore>((set, get) => ({
  isRunning: false,
  isPaused: false,
  queueCount: 0,
  processedCount: 0,
  errorCount: 0,
  currentItem: null,
  lastProcessedCard: null,
  queueMeta: [],

  start: () => {
    if (get().isRunning) return;
    set({ isRunning: true, isPaused: false });
    startWorkers();
  },

  stop: () => {
    set({ isRunning: false, isPaused: false });
  },

  pause: () => {
    set({ isPaused: true });
  },

  resume: () => {
    set({ isPaused: false });
  },

  refreshQueue: async () => {
    const count = await idbCount();
    const all = await idbGetAll();
    set({
      queueCount: count,
      queueMeta: all.map(({ blob: _blob, ...rest }) => rest),
    });
  },

  _setRunning: (v) => set({ isRunning: v }),
  _setPaused: (v) => set({ isPaused: v }),
  _setQueueCount: (v) => set({ queueCount: v }),
  _setProcessedCount: (v) => set({ processedCount: v }),
  _setErrorCount: (v) => set({ errorCount: v }),
  _setCurrentItem: (v) => set({ currentItem: v }),
  _setLastProcessedCard: (v) => set({ lastProcessedCard: v }),
  _setQueueMeta: (v) => set({ queueMeta: v }),
  _incrementProcessed: () => set((s) => ({ processedCount: s.processedCount + 1 })),
  _incrementError: () => set((s) => ({ errorCount: s.errorCount + 1 })),
}));

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function money(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return null;
  return Math.round(n * 100) / 100;
}

async function getUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// WORKER POOL
// ─────────────────────────────────────────────────────────────────────────────

let workersActive = 0;
let scalingInterval: ReturnType<typeof setInterval> | null = null;

function startWorkers() {
  // Start with just 1 worker initially
  if (workersActive === 0) {
    workersActive++;
    workerLoop(0);
  }
  
  // Start adaptive scaling interval
  if (!scalingInterval) {
    scalingInterval = setInterval(async () => {
      const store = useQueueProcessor.getState();
      if (!store.isRunning) {
        if (scalingInterval) {
          clearInterval(scalingInterval);
          scalingInterval = null;
        }
        return;
      }
      
      const queueSize = await idbCount();
      const maxWorkers = getMaxWorkerCount();
      const targetWorkers = getTargetWorkerCount(queueSize, maxWorkers);
      
      // Scale up if needed
      while (workersActive < targetWorkers && store.isRunning) {
        const newWorkerId = workersActive;
        workersActive++;
        console.log(`[QueueProcessor] Scaling up: starting worker ${newWorkerId} (${workersActive}/${maxWorkers} active, queue: ${queueSize})`);
        workerLoop(newWorkerId);
      }
    }, WORKER_SCALE_INTERVAL_MS);
  }
}

async function workerLoop(workerId: number) {
  const store = useQueueProcessor.getState;

  while (store().isRunning) {
    // Paused? Wait
    if (store().isPaused) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    // Check if this worker should scale down (we have more workers than needed)
    const queueSize = await idbCount();
    const maxWorkers = getMaxWorkerCount();
    const targetWorkers = getTargetWorkerCount(queueSize, maxWorkers);
    
    if (workerId >= targetWorkers && workersActive > targetWorkers) {
      console.log(`[QueueProcessor] Scaling down: stopping worker ${workerId} (target: ${targetWorkers}, active: ${workersActive})`);
      break; // Exit this worker loop
    }

    const next = await idbGetNextQueued();
    if (!next) {
      // No work - check if we should auto-stop
      const count = await idbCount();
      useQueueProcessor.getState()._setQueueCount(count);
      
      if (count === 0) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      await sleep(200);
      continue;
    }

    try {
      await processJob(next);
      store()._incrementProcessed();
    } catch (e: any) {
      console.error(`[Worker ${workerId}] Job failed:`, e);
      store()._incrementError();
      
      // Mark as error in queue
      await idbUpdateMeta(next.id, { status: "error", error: String(e?.message ?? e) });
    }

    // Refresh queue meta
    await store().refreshQueue();

    // Small delay between jobs
    await sleep(JOB_DELAY_MS);
  }

  workersActive--;
  if (workersActive === 0) {
    useQueueProcessor.getState()._setRunning(false);
    if (scalingInterval) {
      clearInterval(scalingInterval);
      scalingInterval = null;
    }
  }
}

async function processJob(item: QueueItem): Promise<void> {
  const store = useQueueProcessor.getState();
  store._setCurrentItem(item.id);

  // Mark processing
  await idbUpdateMeta(item.id, { status: "processing" });

  // Upload to storage
  const filePath = `cards/${item.id}.jpg`;
  const file = new File([item.blob], item.filename, { type: item.mime });

  await withRetry(async () => {
    const res = await supabase.storage
      .from("card-images")
      .upload(filePath, file, { upsert: false });
    if (res.error) throw new Error(res.error.message);
    return res.data;
  });

  // Get signed URL
  const imageUrl = await withRetry(async () => {
    const res = await supabase.storage
      .from("card-images")
      .createSignedUrl(filePath, SIGNED_URL_TTL_SECONDS);
    if (res.error) throw new Error(res.error.message);
    if (!res.data?.signedUrl) throw new Error("Signed URL missing");
    return res.data.signedUrl;
  });

  // Identify card
  const identify = await withRetry(
    async () => {
      const res = await supabase.functions.invoke("rapid-card-identify", {
        body: { imageUrl },
      });
      if (res.error) throw new Error(res.error.message);
      if (!res.data?.success) throw new Error(res.data?.error || "Identify failed");
      return res.data.cardData as any;
    },
    {
      retries: 2,
      baseMs: 2000,
      maxMs: 10000,
      shouldRetry: (e) => /timeout|network|502|503|504/i.test(String(e?.message ?? e)),
    }
  );

  const cardName: string = identify?.card_name || "Unknown Card";
  const cardSet: string | null = identify?.card_set ?? null;
  const cardNumber: string | null = identify?.card_number ?? null;
  const rarity: string | null = identify?.rarity ?? null;
  const gameType: string | null = identify?.game_type ?? null;
  const sportType: string | null = identify?.sport_type ?? null;

  // Fetch price
  let rawPrice: number | null = null;
  try {
    const p = await supabase.functions.invoke("fetch-card-prices", {
      body: { cardName, cardSet, cardNumber, gameType, sportType },
    });
    if (!p.error && p.data) {
      rawPrice = money(p.data.raw ?? p.data.suggested ?? null);
    }
  } catch {
    rawPrice = null;
  }

  // Check library ownership
  const userId = await getUserId();
  let ownedCount = 0;
  let isInLibrary = false;
  let existingId: string | undefined = undefined;

  if (userId) {
    try {
      const { count } = await supabase
        .from("cards")
        .select("id", { count: "exact", head: true })
        .eq("user_id", userId)
        .ilike("card_name", cardName);

      ownedCount = count || 0;
      isInLibrary = ownedCount > 0;

      if (isInLibrary) {
        const { data } = await supabase
          .from("cards")
          .select("id")
          .eq("user_id", userId)
          .ilike("card_name", cardName)
          .limit(1);
        existingId = data?.[0]?.id;
      }
    } catch {
      ownedCount = 0;
      isInLibrary = false;
    }
  }

  // Store processed result
  const processedCard: ProcessedCard = {
    id: item.id,
    cardName,
    cardSet: cardSet || undefined,
    cardNumber: cardNumber || undefined,
    rarity: rarity || undefined,
    gameType: gameType || undefined,
    sportType: sportType || undefined,
    value: rawPrice,
    imageUrl,
    isInLibrary,
    libraryQuantity: ownedCount,
    dbId: existingId,
  };

  store._setLastProcessedCard(processedCard);
  store._setCurrentItem(null);

  // Success - remove from queue
  await idbDelete(item.id);
}

// ─────────────────────────────────────────────────────────────────────────────
// AUTO-RESUME ON APP START
// ─────────────────────────────────────────────────────────────────────────────

let autoResumeChecked = false;

export async function checkAndResumeQueue(): Promise<void> {
  if (autoResumeChecked) return;
  autoResumeChecked = true;

  const count = await idbCount();
  if (count > 0) {
    console.log(`[QueueProcessor] Found ${count} items in queue, auto-resuming...`);
    useQueueProcessor.getState().start();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS FOR EXTERNAL USE
// ─────────────────────────────────────────────────────────────────────────────

export { idbAdd, idbCount, idbClear, idbGetAll, idbDelete } from "@/lib/idbQueue";
