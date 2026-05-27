// src/lib/queueProcessor.ts
// Standalone, resilient queue processor for rapid scan jobs.
// Fast-lane update: SCAN_ONLY now identifies cards only and defers pricing/upload/save.

import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";
import { withRetry } from "@/lib/retry";
import { withTimeout } from "@/lib/async/withTimeout";
import { getScannerSettings } from "@/hooks/use-scanner-settings";
import { canProcessFrame, markFrameStart, markFrameEnd } from "@/lib/performance/pipelineGuards";
import { hybridIdentifyCard } from "@/lib/hybridCardIdentify";
import { queueAnomalyDetector } from "@/lib/scanAnomalyDetector";
import { addRecentScan } from "@/lib/recentScans";
import { insertCardDual } from "@/lib/localCards";
import { getDeviceTier } from "@/lib/performance/deviceTier";
import { useGlobalProcessControl } from "@/hooks/use-global-process-control";
import {
  idbAdd,
  idbClaimNextQueued,
  idbUpdateMeta,
  idbDelete,
  idbCount,
  idbCountQueued,
  idbListMetaFast,
  idbGetAll,
  idbClear,
  type QueueItem,
  type QueueItemMeta,
} from "@/lib/idbQueue";

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
  start: (force?: boolean) => void;
  stop: () => void;
  pause: () => void;
  resume: () => void;
  refreshQueue: () => Promise<void>;
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

const WORKER_SCALE_INTERVAL_MS = 200;
const QUEUE_REFRESH_INTERVAL_MS = 1000;
const MIN_SERIAL_JOB_DELAY_MS = 0;
const ANOMALY_PAUSE_STORAGE_KEY = "rapid-scan-anomaly-paused";
const IDENTIFY_TIMEOUT_MS = 5000;
const UPLOAD_TIMEOUT_MS = 8000;
const PRICE_CACHE_TTL_MS = 10 * 60 * 1000;

const priceCache = new Map<string, { ts: number; value: number | null }>();
const priceInFlight = new Map<string, Promise<number | null>>();

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function money(n: number | null | undefined) {
  if (n == null || Number.isNaN(n)) return null;
  return Math.round(n * 100) / 100;
}

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
    if (isPaused) window.localStorage.setItem(ANOMALY_PAUSE_STORAGE_KEY, "1");
    else window.localStorage.removeItem(ANOMALY_PAUSE_STORAGE_KEY);
  } catch {
    // ignore storage failures
  }
}

async function recoverAnomalyErroredItems(): Promise<void> {
  try {
    const all = await idbListMetaFast(1000);
    const stuck = all.filter(
      (m) => m.status === "error" && typeof m.error === "string" && m.error.startsWith("Anomaly:")
    );
    if (stuck.length === 0) return;
    await Promise.all(stuck.map((m) => idbUpdateMeta(m.id, { status: "queued", error: undefined })));
    console.log(`[QueueProcessor] Recovered ${stuck.length} anomaly-paused items`);
  } catch (e) {
    console.warn("[QueueProcessor] recoverAnomalyErroredItems error", e);
  }
}

function priceKey(args: {
  cardName: string;
  cardSet: string | null;
  cardNumber: string | null;
  gameType: string | null;
  sportType: string | null;
}): string {
  return [args.cardName, args.cardSet ?? "", args.cardNumber ?? "", args.gameType ?? "", args.sportType ?? ""]
    .join("|")
    .toLowerCase();
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

function getJobDelayMs(): number {
  return Math.max(MIN_SERIAL_JOB_DELAY_MS, getDeviceTier().jobDelayMs || 0);
}

function getPollIntervalMs(): number {
  return Math.max(8, getDeviceTier().pollIntervalMs || 15);
}

function getMaxWorkerCount(): number {
  const tierMax = Math.max(1, getDeviceTier().maxWorkers);
  const override = getScannerSettings().maxWorkersOverride ?? 0;
  if (!override || override <= 0) return tierMax;
  return Math.max(1, Math.min(override, 8));
}

function getTargetWorkerCount(queueSize: number, maxWorkers: number): number {
  if (queueSize <= 0) return 0;
  return Math.min(queueSize, maxWorkers);
}

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

  start: (force?: boolean) => {
    if (get().isRunning) return;
    // Capture-only mode: while the scanner camera is active, defer processing
    // until the user stops scanning. Manual/explicit calls pass force=true.
    if (!force && useGlobalProcessControl.getState().scannerActive) {
      console.log("[QueueProcessor] start() skipped — scanner is active (capture-only mode)");
      return;
    }
    writeAnomalyPauseFlag(false);
    queueAnomalyDetector.resetSession();
    recoverAnomalyErroredItems().catch((e) => console.warn("[QueueProcessor] anomaly recovery failed", e));
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

  pause: () => set({ isPaused: true }),

  resume: () => {
    writeAnomalyPauseFlag(false);
    queueAnomalyDetector.resetSession();
    set({ isPaused: false, isPausedByAnomaly: false });
    recoverAnomalyErroredItems().catch(() => {});

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
    set({ queueCount: queuedCount, queueMeta: all });
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

function blobToBase64DataUrl(blob: Blob, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!blob || blob.size === 0) {
      reject(new Error(`blobToBase64DataUrl: empty blob (size=${blob?.size ?? "null"})`));
      return;
    }
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = reader.result as string;
      if (!result || typeof result !== "string" || result.length < 200 || !result.includes(",")) {
        reject(new Error(`blobToBase64DataUrl: encoded result too small (len=${result?.length ?? 0}, blobSize=${blob.size})`));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(reader.error || new Error("FileReader failed"));
    reader.readAsDataURL(new Blob([blob], { type: mime || blob.type || "image/jpeg" }));
  });
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
      return (await withTimeout(
        supabase.functions.invoke(name, { body }),
        timeoutMs,
        `Edge function ${name}`
      )) as any;
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
      { timeoutMs: 6000, retries: 0, retryDelayMs: 200 }
    );

    let v: number | null = null;
    if (!res.error && res.data) {
      v = money((res.data as any).raw ?? (res.data as any).suggested ?? null);
      psa10Value = money((res.data as any).psa10 ?? null);
    }
    priceCache.set(key, { ts: Date.now(), value: v });
    return v;
  })().finally(() => priceInFlight.delete(key));

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

let workersActive = 0;
let scalingInterval: ReturnType<typeof setInterval> | null = null;
let lowConfWarned = false;
let authPauseWarned = false;
let rateLimitUntil = 0;
let cachedQueueSize = 0;
let lastScaleCheckAt = 0;
const SCALE_CHECK_INTERVAL_MS = 500;

function isRateLimitError(e: unknown): boolean {
  return /rate limit|429/i.test(String((e as any)?.message ?? e));
}

function startWorkers() {
  if (workersActive <= 0) {
    const initialWorkers = getMaxWorkerCount();
    console.log(`[QueueProcessor] Spawning ${initialWorkers} workers`);
    for (let i = 0; i < initialWorkers; i++) {
      workersActive++;
      workerLoop(i);
    }
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
        console.log(`[QueueProcessor] Scaling up worker ${newWorkerId} (${workersActive}/${maxWorkers}, queue ${queueSize})`);
        workerLoop(newWorkerId);
      }
    }, WORKER_SCALE_INTERVAL_MS);
  }
}

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
        console.log(`[QueueProcessor] Scaling down worker ${workerId}`);
        break;
      }
    }

    const next = await idbClaimNextQueued();
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
    const delay = getJobDelayMs();
    if (delay > 0) await sleep(delay);
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

async function identifyCard(item: QueueItem, scanSettings = getScannerSettings()) {
  const base64 = await blobToBase64DataUrl(item.blob, item.mime);
  const gameTypeHint = scanSettings.gameTypeFilter !== "auto" ? scanSettings.gameTypeFilter : undefined;

  const identifyInitial = await withTimeout(
    hybridIdentifyCard(base64, {
      cloudFunction: "rapid-card-identify",
      skipOfflineGuard: false,
      gameTypeHint,
    }),
    IDENTIFY_TIMEOUT_MS,
    "Rapid identify"
  ).catch((e: any) => ({ success: false, cardData: null, source: "cloud" as const, error: e }));

  if (!(identifyInitial as any)?.error && (identifyInitial as any)?.success) {
    const identify = (identifyInitial as any).cardData;
    const confidence = Number(identify?.confidence ?? 0);
    console.log(`[QueueProcessor] Card identified via ${(identifyInitial as any).source}:`, identify?.card_name, `conf=${confidence}`);
    return identify;
  }

  const err = (identifyInitial as any)?.error;
  if (err?.message?.includes("max attempts reached")) {
    throw new Error("Offline: requires internet connection to identify this card");
  }
  throw err || new Error("Card identification failed");
}

function normalizeGameType(gameType: string | null, scanSettings = getScannerSettings()): string | null {
  if (gameType || !scanSettings.gameTypeFilter || scanSettings.gameTypeFilter === "auto") return gameType;
  const GAME_TYPE_MAP: Record<string, string> = {
    mtg: "MTG",
    yugioh: "Yu-Gi-Oh!",
    pokemon: "Pokemon",
    sports: "Sports",
    gpk: "GPK",
    marvel: "Marvel",
    onepiece: "One Piece",
  };
  return GAME_TYPE_MAP[scanSettings.gameTypeFilter] ?? gameType;
}

function makeProcessedCard(args: {
  item: QueueItem;
  cardName: string;
  cardSet: string | null;
  cardNumber: string | null;
  rarity: string | null;
  gameType: string | null;
  sportType: string | null;
  rawPrice: number | null;
  psa10Price: number | null;
  imageUrl: string;
  ownedCount: number;
  isInLibrary: boolean;
  existingId?: string;
  year: string | null;
  playerName: string | null;
  team: string | null;
  manufacturer: string | null;
}): ProcessedCard {
  return {
    id: args.item.id,
    cardName: args.cardName,
    cardSet: args.cardSet || undefined,
    cardNumber: args.cardNumber || undefined,
    rarity: args.rarity || undefined,
    gameType: args.gameType || undefined,
    sportType: args.sportType || undefined,
    value: args.rawPrice,
    psa10Price: args.psa10Price,
    imageUrl: args.imageUrl,
    isInLibrary: args.isInLibrary,
    libraryQuantity: args.ownedCount,
    dbId: args.existingId,
    year: args.year || undefined,
    playerName: args.playerName || (args.sportType ? args.cardName : undefined),
    team: args.team || undefined,
    manufacturer: args.manufacturer || undefined,
  };
}

async function processJob(item: QueueItem): Promise<void> {
  const store = useQueueProcessor.getState();
  store._setCurrentItem(item.id);

  const scanSettings = getScannerSettings();

  if (scanSettings.scanMode === "SAVE") {
    const earlyUserId = await getUserId();
    if (!earlyUserId) {
      await idbUpdateMeta(item.id, { status: "queued", error: undefined });
      useQueueProcessor.setState({ isPaused: true });
      store._setCurrentItem(null);
      if (!authPauseWarned) {
        authPauseWarned = true;
        try {
          const { toast } = await import("sonner");
          toast.error("Signed out — sign back in to resume scanning.");
        } catch {
          // ignore
        }
      }
      console.warn("[QueueProcessor] Paused: lost auth in SAVE mode, requeued", item.id);
      return;
    }
    authPauseWarned = false;
  }

  const identify = await identifyCard(item, scanSettings);
  if (!identify) throw new Error("Card identification failed");

  const cardName: string = identify?.card_name || "Unknown Card";
  const anomaly = queueAnomalyDetector.trackIdentification(cardName);
  if (anomaly.consecutiveCount >= 25) {
    writeAnomalyPauseFlag(true);
    try {
      const { toast } = await import("sonner");
      toast.warning(`Rapid scan paused — "${cardName}" identified 25 times in a row. Resume if this is intentional.`, {
        duration: 8000,
      });
    } catch {
      // ignore
    }
    useQueueProcessor.setState({ isPaused: true, isPausedByAnomaly: true });
  } else if (anomaly.consecutiveCount === 10) {
    try {
      const { toast } = await import("sonner");
      toast.info(`"${cardName}" scanned 10 times in a row — continuing.`);
    } catch {
      // ignore
    }
  }

  const cardSet: string | null = identify?.card_set ?? null;
  const cardNumber: string | null = identify?.card_number ?? null;
  const rarity: string | null = identify?.rarity ?? null;
  const gameType: string | null = normalizeGameType(identify?.game_type ?? null, scanSettings);
  const sportType: string | null = identify?.sport_type ?? null;
  const cardCondition: string | null = identify?.condition ?? null;
  const confidence: number = identify?.confidence ?? 0;
  const year: string | null = identify?.year ?? null;
  const playerName: string | null = identify?.player_name ?? null;
  const team: string | null = identify?.team ?? null;
  const manufacturer: string | null = identify?.manufacturer ?? null;

  const MIN_CONFIDENCE = 0.3;
  if (cardName === "Unknown Card" || confidence < MIN_CONFIDENCE) {
    await idbUpdateMeta(item.id, {
      status: "error",
      error: `Low confidence (${(confidence * 100).toFixed(0)}%) — needs review`,
    });
    if (!lowConfWarned) {
      lowConfWarned = true;
      try {
        const { toast } = await import("sonner");
        toast.warning("Some scans had low confidence and are flagged for review in the queue.");
      } catch {
        // ignore
      }
    }
    store._setCurrentItem(null);
    store._incrementError();
    return;
  }

  if (scanSettings.scanMode === "SCAN_ONLY") {
    const imageUrl = URL.createObjectURL(item.blob);
    const processedCard = makeProcessedCard({
      item,
      cardName,
      cardSet,
      cardNumber,
      rarity,
      gameType,
      sportType,
      rawPrice: null,
      psa10Price: null,
      imageUrl,
      ownedCount: 0,
      isInLibrary: false,
      existingId: undefined,
      year,
      playerName,
      team,
      manufacturer,
    });

    store._setLastProcessedCard(processedCard);
    store._setCurrentItem(null);

    const recentScanSaved = addRecentScan({
      id: item.id,
      card_name: cardName,
      card_set: cardSet,
      card_number: cardNumber,
      player_name: playerName || (sportType ? cardName : null),
      image_url: imageUrl,
      price: null,
      psa10Price: null,
      confidence,
      rarity,
      gameType,
      sportType,
      dbId: null,
      isInLibrary: false,
      libraryQuantity: 0,
      year,
      team,
      manufacturer,
    });
    window.dispatchEvent(new CustomEvent("recent-scan-added"));

    if (recentScanSaved) await idbDelete(item.id);
    else await idbUpdateMeta(item.id, { status: "error", error: "Scan identified but could not be stored locally" });
    return;
  }

  const filePath = `cards/${item.id}.jpg`;
  const file = new File([item.blob], item.filename, { type: item.mime });

  const uploadPromise = withTimeout(
    withRetry(async () => {
      const res = await supabase.storage.from("card-images").upload(filePath, file, { upsert: false });
      if (res.error) throw new Error(res.error.message);
      return res.data;
    }),
    UPLOAD_TIMEOUT_MS,
    "Storage upload"
  ).catch((e: any) => {
    console.warn("[QueueProcessor] Upload failed, will fall back to local preview:", e);
    return null;
  });

  const userIdPromise = getUserId();

  const [priceResult, userId, uploadResult] = await Promise.all([
    cachedFetchPrice({ cardName, cardSet, cardNumber, gameType, sportType, condition: cardCondition }).catch(() => ({
      raw: null as number | null,
      psa10: null as number | null,
    })),
    userIdPromise,
    uploadPromise,
  ]);

  const ownershipResult = userId && scanSettings.scanMode === "SAVE"
    ? await (async () => {
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
      })()
    : { ownedCount: 0, isInLibrary: false, existingId: undefined as string | undefined };

  let imageUrl: string;
  let imageStatus: "stored" | "local-only" = "stored";
  if (uploadResult) {
    try {
      const { data: publicData } = supabase.storage.from("card-images").getPublicUrl(filePath);
      imageUrl = publicData.publicUrl;
    } catch {
      imageUrl = URL.createObjectURL(item.blob);
      imageStatus = "local-only";
    }
  } else {
    imageUrl = URL.createObjectURL(item.blob);
    imageStatus = "local-only";
  }

  const rawPrice = priceResult.raw;
  const psa10Price = priceResult.psa10;
  const { ownedCount, isInLibrary, existingId } = ownershipResult;

  const processedCard = makeProcessedCard({
    item,
    cardName,
    cardSet,
    cardNumber,
    rarity,
    gameType,
    sportType,
    rawPrice,
    psa10Price,
    imageUrl,
    ownedCount,
    isInLibrary,
    existingId,
    year,
    playerName,
    team,
    manufacturer,
  });

  store._setLastProcessedCard(processedCard);
  store._setCurrentItem(null);

  const settings = getScannerSettings();
  const confPct = confidence * 100;
  const threshold = settings.autoConfirmThreshold ?? 75;

  let saveAttemptedAndFailed = false;
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
        // Never persist blob: URLs — they die when the session ends.
        image_url: imageStatus === "stored" ? imageUrl : null,
        image_storage_path: imageStatus === "stored" ? `cards/${item.id}.jpg` : null,
        image_source: imageStatus === "stored" ? "scan" : null,
        image_status: imageStatus === "stored" ? "stored" : "missing",
        image_search_status: imageStatus === "stored" ? "found" : "missing",
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
      } as any);

      processedCard.isInLibrary = true;
      processedCard.dbId = inserted.id;
      processedCard.libraryQuantity = ownedCount + 1;
    } catch (e: any) {
      console.error(`[QueueProcessor] Auto-save failed for ${cardName}:`, e);
      saveAttemptedAndFailed = true;
    }
  }

  const recentScanSaved = addRecentScan({
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

  if (saveAttemptedAndFailed && !recentScanSaved) {
    await idbUpdateMeta(item.id, { status: "error", error: "Save failed — capture preserved for retry" });
    store._incrementError();
  } else if (!recentScanSaved && settings.scanMode !== "SAVE") {
    await idbUpdateMeta(item.id, { status: "error", error: "Scan rejected (low confidence / unreadable)" });
    store._incrementError();
  } else {
    await idbDelete(item.id);
  }
}

let autoResumeChecked = false;

export async function checkAndResumeQueue(): Promise<void> {
  if (autoResumeChecked) return;
  autoResumeChecked = true;

  const state = useQueueProcessor.getState();
  const anomalyPaused = state.isPausedByAnomaly || readAnomalyPauseFlag();
  if (anomalyPaused) {
    useQueueProcessor.setState({ isPaused: true, isPausedByAnomaly: true });
    console.log("[QueueProcessor] Skipping auto-resume — paused by anomaly detection");
    return;
  }

  // Capture-only: don't auto-resume while the scanner is actively capturing.
  if (useGlobalProcessControl.getState().scannerActive) {
    console.log("[QueueProcessor] Skipping auto-resume — scanner is active");
    return;
  }

  const queuedCount = await idbCountQueued();
  if (queuedCount > 0) {
    console.log(`[QueueProcessor] Found ${queuedCount} queued items, auto-resuming...`);
    state.start();
  }
}

export { idbAdd, idbCount, idbCountQueued, idbClear, idbGetAll, idbDelete };

export async function retryAllErrors(): Promise<number> {
  const all = await idbListMetaFast(1000);
  const errs = all.filter((m) => m.status === "error");
  await Promise.all(errs.map((m) => idbUpdateMeta(m.id, { status: "queued", error: undefined })));
  useQueueProcessor.getState().refreshQueue();
  return errs.length;
}

export async function clearScanQueue(): Promise<void> {
  await idbClear();
  useQueueProcessor.getState().refreshQueue();
}
