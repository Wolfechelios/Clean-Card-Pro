// src/lib/queueProcessor.ts
// Standalone, resilient queue processor for rapid scan jobs.
// Runs independently of the RapidScanCamera component.
// Auto-resumes on app start if there are queued items.
// Now supports hybrid offline/cloud LLM routing.

import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";
import { withRetry } from "@/lib/retry";
import { withTimeout } from "@/lib/async/withTimeout";
import { getScannerSettings } from "@/hooks/use-scanner-settings";
import { canProcessFrame, markFrameStart, markFrameEnd } from "@/lib/performance/pipelineGuards";
import { MEMORY_CONFIG } from "@/lib/performance/memoryConfig";
import { hybridIdentifyCard, clearOfflineAttempt } from "@/lib/hybridCardIdentify";
import { queueAnomalyDetector } from "@/lib/scanAnomalyDetector";
import { addRecentScan } from "@/lib/recentScans";
import { insertCardDual } from "@/lib/localCards";
import {
  idbGetNextQueued,
  idbUpdateMeta,
  idbDelete,
  idbCount,
  idbCountQueued,
  idbListMetaFast,
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
  psa10Price: number | null;
  imageUrl: string;
  isInLibrary: boolean;
  libraryQuantity: number;
  dbId?: string;
  year?: string;
  playerName?: string;
  team?: string;
  manufacturer?: string;
};

export type ProcessorState = {
  isRunning: boolean;
  isPaused: boolean;
  isPausedByAnomaly: boolean;
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
const WORKER_SCALE_INTERVAL_MS = 500;
const QUEUE_REFRESH_INTERVAL_MS = 1000;
const MIN_SERIAL_JOB_DELAY_MS = 800;
const ANOMALY_PAUSE_STORAGE_KEY = "rapid-scan-anomaly-paused";

function readAnomalyPauseFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ANOMALY_PAUSE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeAnomalyPauseFlag(isPaused: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (isPaused) {
      window.localStorage.setItem(ANOMALY_PAUSE_STORAGE_KEY, "1");
    } else {
      window.localStorage.removeItem(ANOMALY_PAUSE_STORAGE_KEY);
    }
  } catch {
    // ignore storage failures
  }
}

// Pricing cache: reduces repeated edge-function calls during rapid scanning
const PRICE_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
const priceCache = new Map<string, { ts: number; value: number | null }>();
const priceInFlight = new Map<string, Promise<number | null>>();

function priceKey(args: {
  cardName: string;
  cardSet: string | null;
  cardNumber: string | null;
  gameType: string | null;
  sportType: string | null;
}): string {
  return [
    args.cardName,
    args.cardSet ?? "",
    args.cardNumber ?? "",
    args.gameType ?? "",
    args.sportType ?? "",
  ].join("|").toLowerCase();
}

function getCachedPrice(key: string): number | null | undefined {
  const hit = priceCache.get(key);
  if (!hit) return undefined;
  if (Date.now() - hit.ts > PRICE_CACHE_TTL_MS) {
    priceCache.delete(key);
    return undefined;
  }
  return hit.value;
}

// Dynamic config from device tier
import { getDeviceTier } from "@/lib/performance/deviceTier";

function getJobDelayMs(): number { return Math.max(getDeviceTier().jobDelayMs, MIN_SERIAL_JOB_DELAY_MS); }
function getPollIntervalMs(): number { return getDeviceTier().pollIntervalMs; }

function getMaxWorkerCount(): number {
  // Rapid queue must stay serialized to avoid cross-card result collapse.
  return 1;
}

// Adaptive scaling
function getTargetWorkerCount(queueSize: number, maxWorkers: number): number {
  if (queueSize <= 0) return 0;
  return Math.min(queueSize, maxWorkers);
}

// Throttled queue refresh tracking
let lastQueueRefreshAt = 0;
let pendingQueueRefresh: ReturnType<typeof setTimeout> | null = null;

function scheduleQueueRefresh() {
  const now = Date.now();
  if (now - lastQueueRefreshAt >= QUEUE_REFRESH_INTERVAL_MS) {
    lastQueueRefreshAt = now;
    useQueueProcessor.getState().refreshQueue();
    return;
  }
  if (!pendingQueueRefresh) {
    const delay = QUEUE_REFRESH_INTERVAL_MS - (now - lastQueueRefreshAt);
    pendingQueueRefresh = setTimeout(() => {
      pendingQueueRefresh = null;
      lastQueueRefreshAt = Date.now();
      useQueueProcessor.getState().refreshQueue();
    }, delay);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// ZUSTAND STORE
// ─────────────────────────────────────────────────────────────────────────────

const initialAnomalyPause = readAnomalyPauseFlag();

export const useQueueProcessor = create<ProcessorStore>((set, get) => ({
  isRunning: false,
  isPaused: initialAnomalyPause,
  isPausedByAnomaly: initialAnomalyPause,
  queueCount: 0,
  processedCount: 0,
  errorCount: 0,
  currentItem: null,
  lastProcessedCard: null,
  queueMeta: [],

  start: () => {
    if (get().isRunning) return;
    if (readAnomalyPauseFlag()) {
      set({ isPaused: true, isPausedByAnomaly: true });
      return;
    }
    queueAnomalyDetector.resetSession();
    set({ isRunning: true, isPaused: false, isPausedByAnomaly: false });
    startWorkers();
  },

  stop: () => {
    set({ isRunning: false, isPaused: false, currentItem: null });
    workersActive = 0;
    if (scalingInterval) {
      clearInterval(scalingInterval);
      scalingInterval = null;
    }
  },

  pause: () => {
    set({ isPaused: true });
  },

  resume: () => {
    writeAnomalyPauseFlag(false);
    set({ isPaused: false, isPausedByAnomaly: false });

    if (!get().isRunning) {
      idbCountQueued()
        .then((queuedCount) => {
          if (queuedCount > 0 && !get().isRunning) {
            set({ isRunning: true });
            startWorkers();
          }
          scheduleQueueRefresh();
        })
        .catch(() => {
          if (!get().isRunning) {
            set({ isRunning: true });
            startWorkers();
          }
        });
    }
  },

  refreshQueue: async () => {
    const queuedCount = await idbCountQueued();
    const all = await idbListMetaFast();
    set({
      queueCount: queuedCount,
      queueMeta: all,
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

function blobToBase64DataUrl(blob: Blob, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(new Blob([blob], { type: mime }));
  });
}

function money(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return null;
  return Math.round(n * 100) / 100;
}

async function invokeEdgeFunction<T = any>(
  name: string,
  body: any,
  opts?: { timeoutMs?: number; retries?: number; retryDelayMs?: number }
): Promise<{ data?: T; error?: any }> {
  const timeoutMs = opts?.timeoutMs ?? 6000;
  const retries = Math.max(0, Math.min(opts?.retries ?? 2, 3));
  const retryDelayMs = opts?.retryDelayMs ?? 250;

  let lastErr: any = null;
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await withTimeout(
        supabase.functions.invoke(name, { body }),
        timeoutMs,
        `Edge function ${name}`
      );
      return res as any;
    } catch (e: any) {
      lastErr = e;
      if (i < retries) await sleep(retryDelayMs * (i + 1));
    }
  }
  return { error: lastErr };
}

async function cachedFetchPrice(args: {
  cardName: string;
  cardSet: string | null;
  cardNumber: string | null;
  gameType: string | null;
  sportType: string | null;
  condition?: string | null;
}): Promise<{ raw: number | null; psa10: number | null }> {
  const key = priceKey(args);

  const cached = getCachedPrice(key);
  if (cached !== undefined) return { raw: cached, psa10: null };

  const existing = priceInFlight.get(key);
  if (existing) {
    const raw = await existing;
    return { raw, psa10: null };
  }

  let psa10Value: number | null = null;

  const p = (async () => {
    const res = await invokeEdgeFunction<any>(
      "fetch-card-prices",
      {
        cardName: args.cardName,
        cardSet: args.cardSet,
        cardNumber: args.cardNumber,
        gameType: args.gameType,
        sportType: args.sportType,
        condition: args.condition,
      },
      { timeoutMs: 6000, retries: 1, retryDelayMs: 200 }
    );

    let v: number | null = null;
    if (!res.error && res.data) {
      v = money((res.data as any).raw ?? (res.data as any).suggested ?? null);
      psa10Value = money((res.data as any).psa10 ?? null);
    }

    priceCache.set(key, { ts: Date.now(), value: v });
    return v;
  })().finally(() => {
    priceInFlight.delete(key);
  });

  priceInFlight.set(key, p);
  const raw = await p;
  return { raw, psa10: psa10Value };
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

let rateLimitUntil = 0;
function isRateLimitError(e: unknown): boolean {
  return /rate limit|429/i.test(String((e as any)?.message ?? e));
}

function startWorkers() {
  if (workersActive <= 0) {
    workersActive = 1;
    workerLoop(0);
  }
  
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
      
      const queueSize = await idbCountQueued();
      const maxWorkers = getMaxWorkerCount();
      const targetWorkers = getTargetWorkerCount(queueSize, maxWorkers);
      
      while (workersActive < targetWorkers && store.isRunning) {
        const newWorkerId = workersActive;
        workersActive++;
        console.log(`[QueueProcessor] Scaling up: starting worker ${newWorkerId} (${workersActive}/${maxWorkers} active, queue: ${queueSize})`);
        workerLoop(newWorkerId);
      }
    }, WORKER_SCALE_INTERVAL_MS);
  }
}

let cachedQueueSize = 0;
let lastScaleCheckAt = 0;
const SCALE_CHECK_INTERVAL_MS = 500;

async function workerLoop(workerId: number) {
  const store = useQueueProcessor.getState;
  let consecutiveEmpty = 0;

  while (store().isRunning) {
    if (store().isPaused) {
      await sleep(getPollIntervalMs());
      continue;
    }

    const now = Date.now();
    if (rateLimitUntil > now) {
      await sleep(Math.min(getPollIntervalMs(), rateLimitUntil - now));
      continue;
    }

    // Max in-flight guard (prevents worker pileups under load / mobile thermals)
    if (!canProcessFrame()) {
      await sleep(getPollIntervalMs());
      continue;
    }

    if (workerId > 0 && now - lastScaleCheckAt > SCALE_CHECK_INTERVAL_MS) {
      lastScaleCheckAt = now;
      cachedQueueSize = await idbCountQueued();
      const maxWorkers = getMaxWorkerCount();
      const targetWorkers = getTargetWorkerCount(cachedQueueSize, maxWorkers);
      
      if (workerId >= targetWorkers && workersActive > targetWorkers) {
        console.log(`[QueueProcessor] Scaling down: stopping worker ${workerId}`);
        break;
      }
    }

    const next = await idbGetNextQueued();
    if (!next) {
      consecutiveEmpty++;
      
      if (consecutiveEmpty >= 3) {
        const queuedCount = await idbCountQueued();
        store()._setQueueCount(queuedCount);
        
        if (queuedCount === 0) {
          store()._setRunning(false);
          break;
        }
        consecutiveEmpty = 0;
      }
      
      await sleep(getPollIntervalMs());
      continue;
    }

    consecutiveEmpty = 0;

    try {
      markFrameStart();
      try {
        await processJob(next);
        store()._incrementProcessed();
      } finally {
        markFrameEnd();
      }
    } catch (e: any) {
      const msg = String(e?.message ?? e);
      console.error(`[Worker ${workerId}] Job failed:`, e);

      if (isRateLimitError(e)) {
        rateLimitUntil = Math.max(rateLimitUntil, Date.now() + 5000);
        await idbUpdateMeta(next.id, { status: "queued", error: msg });
      } else {
        store()._incrementError();
        await idbUpdateMeta(next.id, { status: "error", error: msg });
      }

      store()._setCurrentItem(null);
    }

    scheduleQueueRefresh();
    await sleep(getJobDelayMs());
  }

  workersActive = Math.max(0, workersActive - 1);
  if (workersActive === 0) {
    store()._setRunning(false);
    if (scalingInterval) {
      clearInterval(scalingInterval);
      scalingInterval = null;
    }
  }
}

async function processJob(item: QueueItem): Promise<void> {
  const store = useQueueProcessor.getState();
  store._setCurrentItem(item.id);

  await idbUpdateMeta(item.id, { status: "processing" });

  const filePath = `cards/${item.id}.jpg`;
  const file = new File([item.blob], item.filename, { type: item.mime });

  // Create a base64 data URL for immediate AI identification
  const base64 = await blobToBase64DataUrl(item.blob, item.mime);

  // ─── PARALLEL: Upload + OCR + Identify all at once ───
  const uploadPromise = withTimeout(
    withRetry(async () => {
      const res = await supabase.storage
        .from("card-images")
        .upload(filePath, file, { upsert: false });
      if (res.error) throw new Error(res.error.message);
      return res.data;
    }),
    10000,
    "Storage upload"
  ).catch((e: any) => {
    console.warn("[QueueProcessor] Upload failed, will retry later:", e);
    return null;
  });

  const ocrPromise = withTimeout(
    supabase.functions.invoke("zai-ocr", {
      body: { imageUrl: base64, mode: "meta" },
    }),
    4000,
    "Z.AI OCR"
  ).catch((e: any) => {
    console.warn("[QueueProcessor] Z.AI OCR skipped:", e);
    return { data: null, error: e };
  });

  // Start identification immediately with base64 (no need to wait for upload)
  const identifyPromise = hybridIdentifyCard(base64, {
    cloudFunction: "rapid-card-identify",
    skipOfflineGuard: false,
  }).catch((e: any) => ({ success: false, cardData: null, source: "cloud" as const, error: e }));

  // Wait for all three in parallel
  const [_uploadResult, ocrResult, identifyResult] = await Promise.all([
    uploadPromise,
    ocrPromise,
    identifyPromise,
  ]);

  // Get public URL for storage
  const { data: publicUrlData } = supabase.storage
    .from("card-images")
    .getPublicUrl(filePath);
  const imageUrl = publicUrlData.publicUrl;

  // Extract OCR data
  let ocrText: string | null = null;
  let ocrSetCode: string | null = null;
  let ocrCardNumber: string | null = null;
  let ocrConfidence = 0;

  if (ocrResult && (ocrResult as any).data && !(ocrResult as any).error) {
    const ocr = (ocrResult as any).data;
    ocrText = ocr.text || null;
    ocrSetCode = ocr.setCode || null;
    ocrCardNumber = ocr.cardNumber || null;
    ocrConfidence = ocr.confidence || 0;
    console.log(`[QueueProcessor] Z.AI OCR: "${ocrText?.substring(0, 60)}" conf=${ocrConfidence} set=${ocrSetCode} num=${ocrCardNumber}`);
  }

  // Process identification result
  let identify: any;

  if ((identifyResult as any).error || !(identifyResult as any).success) {
    const err = (identifyResult as any).error;
    if (err?.message?.includes("max attempts reached")) {
      throw new Error("Offline: requires internet connection to identify this card");
    }
    // If first attempt failed and we now have OCR, retry with OCR text
    if (ocrText) {
      const retryResult = await hybridIdentifyCard(base64, {
        cloudFunction: "rapid-card-identify",
        skipOfflineGuard: false,
        ocrText,
      });
      identify = retryResult.cardData;
      console.log(`[QueueProcessor] Card identified via ${retryResult.source} (OCR retry):`, identify?.card_name);
    } else {
      throw err || new Error("Card identification failed");
    }
  } else {
    identify = (identifyResult as any).cardData;
    console.log(`[QueueProcessor] Card identified via ${(identifyResult as any).source}:`, identify?.card_name);
  }

  // Enrich with OCR structured data
  if (ocrConfidence >= 0.5) {
    if (ocrCardNumber && (!identify?.card_number || identify.confidence < 0.7)) {
      identify.card_number = ocrCardNumber;
    }
    if (ocrSetCode && (!identify?.card_set || identify.confidence < 0.7)) {
      if (!identify?.card_set) {
        identify.card_set = ocrSetCode;
      }
    }
  }

  const cardName: string = identify?.card_name || "Unknown Card";

  // ─── Anomaly detection ───
  const anomaly = queueAnomalyDetector.trackIdentification(cardName);
  if (anomaly.consecutiveCount >= 10) {
    writeAnomalyPauseFlag(true);
    const { toast } = await import("sonner");
    toast.error(`Rapid scan stopped — "${cardName}" repeated 10 times. Clear the bad batch before continuing.`);
    console.error(`[QueueProcessor] Auto-stopped: ${anomaly.message}`);
    // Hard stop — mark remaining queued items as error
    const remaining = await idbListMetaFast(1000);
    await Promise.all(
      remaining
        .filter((meta) => meta.status === "queued")
        .map((meta) =>
          idbUpdateMeta(meta.id, {
            status: "error",
            error: `Anomaly: repeated identification "${cardName}"`,
          })
        )
    );
    useQueueProcessor.getState().stop();
    useQueueProcessor.setState({ isPaused: true, isPausedByAnomaly: true });
    throw new Error(`Rapid scan stopped after repeated "${cardName}" identifications`);
  } else if (anomaly.consecutiveCount >= 5) {
    writeAnomalyPauseFlag(true);
    const { toast } = await import("sonner");
    toast.warning(`Rapid scan paused — "${cardName}" keeps repeating. Resume manually or clear the bad batch.`);
    useQueueProcessor.setState({ isPaused: true, isPausedByAnomaly: true });
    console.warn(`[QueueProcessor] Auto-paused: ${anomaly.message}`);
    throw new Error(`Rapid scan paused after repeated "${cardName}" identifications`);
  } else if (anomaly.isAnomaly) {
    const { toast } = await import("sonner");
    toast.warning(anomaly.message);
  }
  const cardSet: string | null = identify?.card_set ?? null;
  const cardNumber: string | null = identify?.card_number ?? null;
  const rarity: string | null = identify?.rarity ?? null;
  const gameType: string | null = identify?.game_type ?? null;
  const sportType: string | null = identify?.sport_type ?? null;
  const cardCondition: string | null = identify?.condition ?? null;
  const confidence: number = identify?.confidence ?? 0;
  const year: string | null = identify?.year ?? null;
  const playerName: string | null = identify?.player_name ?? null;
  const team: string | null = identify?.team ?? null;
  const manufacturer: string | null = identify?.manufacturer ?? null;

  // Filter out unreadable/blurry cards
  const MIN_CONFIDENCE = 0.3;
  if (cardName === "Unknown Card" || confidence < MIN_CONFIDENCE) {
    console.log(`[QueueProcessor] Discarding unreadable card (confidence: ${(confidence * 100).toFixed(0)}%, name: ${cardName})`);
    await idbDelete(item.id);
    store._setCurrentItem(null);
    return;
  }

  // Fetch price + check library ownership in parallel
  const userId = await getUserId();

  const [priceResult, ownershipResult] = await Promise.all([
    cachedFetchPrice({ cardName, cardSet, cardNumber, gameType, sportType })
      .catch(() => ({ raw: null as number | null, psa10: null as number | null })),
    (async () => {
      if (!userId) return { ownedCount: 0, isInLibrary: false, existingId: undefined as string | undefined };
      try {
        const { count } = await supabase
          .from("cards")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId)
          .ilike("card_name", cardName);
        const ownedCount = count || 0;
        const isInLibrary = ownedCount > 0;
        let existingId: string | undefined = undefined;
        if (isInLibrary) {
          const { data } = await supabase
            .from("cards")
            .select("id")
            .eq("user_id", userId)
            .ilike("card_name", cardName)
            .limit(1);
          existingId = data?.[0]?.id;
        }
        return { ownedCount, isInLibrary, existingId };
      } catch {
        return { ownedCount: 0, isInLibrary: false, existingId: undefined as string | undefined };
      }
    })(),
  ]);

  const rawPrice = priceResult.raw;
  const psa10Price = priceResult.psa10;
  const { ownedCount, isInLibrary, existingId } = ownershipResult;

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
    psa10Price,
    imageUrl,
    isInLibrary,
    libraryQuantity: ownedCount,
    dbId: existingId,
    year: year || undefined,
    playerName: playerName || (sportType ? cardName : undefined),
    team: team || undefined,
    manufacturer: manufacturer || undefined,
  };

  store._setLastProcessedCard(processedCard);
  store._setCurrentItem(null);

  // Auto-save to database when scanMode is SAVE and confidence is sufficient
  const settings = getScannerSettings();
  const confPct = confidence * 100;
  const threshold = settings.autoConfirmThreshold ?? 75;

  if (settings.scanMode === "SAVE" && userId && confPct >= threshold) {
    try {
      const inserted = await insertCardDual({
        user_id: userId,
        card_name: cardName,
        card_set: cardSet,
        card_number: cardNumber,
        rarity,
        game_type: gameType,
        sport_type: sportType,
        image_url: imageUrl,
        image_storage_path: `cards/${item.id}.jpg`,
        image_source: "scan",
        image_status: "stored",
        image_search_status: "found",
        current_price_raw: rawPrice,
        suggested_price: rawPrice,
        last_price_update: rawPrice ? new Date().toISOString() : null,
        condition: "ungraded",
        year: year ? parseInt(year, 10) || null : null,
        player_name: playerName || (sportType ? cardName : null),
        team,
        manufacturer,
        raw_name: cardName,
        raw_set: cardSet,
        raw_number: cardNumber,
        raw_year: year,
        raw_manufacturer: manufacturer,
        ocr_confidence: confidence,
      });

      processedCard.isInLibrary = true;
      processedCard.dbId = inserted.id;
      processedCard.libraryQuantity = ownedCount + 1;

      console.log(`[QueueProcessor] Auto-saved to library: ${cardName} (${confPct.toFixed(0)}% confidence)`);
    } catch (e: any) {
      console.error(`[QueueProcessor] Auto-save failed for ${cardName}:`, e);
      // Don't fail the whole job — card is still in recent scans
    }
  }

  // Track in recent scans
  addRecentScan({
    id: item.id,
    card_name: cardName,
    card_set: cardSet,
    card_number: cardNumber,
    player_name: playerName || (sportType ? cardName : null),
    image_url: imageUrl,
    price: rawPrice,
    psa10Price,
    confidence,
    rarity,
    gameType,
    sportType,
    dbId: processedCard.dbId ?? null,
    isInLibrary: processedCard.isInLibrary,
    libraryQuantity: processedCard.libraryQuantity,
    year,
    team,
    manufacturer,
  });
  window.dispatchEvent(new CustomEvent("recent-scan-added"));

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

  const state = useQueueProcessor.getState();
  const anomalyPaused = state.isPausedByAnomaly || readAnomalyPauseFlag();
  if (anomalyPaused) {
    useQueueProcessor.setState({ isPaused: true, isPausedByAnomaly: true });
    console.log(`[QueueProcessor] Skipping auto-resume — paused by anomaly detection`);
    return;
  }

  const queuedCount = await idbCountQueued();
  if (queuedCount > 0) {
    console.log(`[QueueProcessor] Found ${queuedCount} queued items, auto-resuming...`);
    state.start();
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORTS FOR EXTERNAL USE
// ─────────────────────────────────────────────────────────────────────────────

export { idbAdd, idbCount, idbCountQueued, idbClear, idbGetAll, idbDelete } from "@/lib/idbQueue";
