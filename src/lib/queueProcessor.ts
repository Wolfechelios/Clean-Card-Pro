// src/lib/queueProcessor.ts
// Fully local-first RapidScan queue worker.
// Local image blob -> browser OCR -> direct printed-code lookup -> local/LocalOnly save only after match.

import { create } from "zustand";
import { getScannerSettings } from "@/hooks/use-scanner-settings";
import { addRecentScan } from "@/lib/recentScans";
import { insertCardDual } from "@/lib/localCards";
import { runLocalCardOcr } from "@/lib/ocr/localCardOcr";
import { withTimeout } from "@/lib/async/withTimeout";
import {
  idbAdd,
  idbClear,
  idbCount,
  idbCountQueued,
  idbDelete,
  idbGetAll,
  idbGetNextQueued,
  idbListMetaFast,
  idbUpdateMeta,
  type QueueItem,
  type QueueItemMeta,
} from "@/lib/idbQueue";
import { compactOcrText, hasReadablePrice, runRapidBasicLookup } from "@/lib/rapidBasicLookupClient";
import { logTrace } from "@/lib/rapidDebug";
import { isReadableTitle, isValidPrintedCode } from "@/lib/ocr/ocrQuality";
import { pipelineTracer } from "@/lib/pipelineTracer";

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
  start: () => void;
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

const QUEUE_REFRESH_INTERVAL_MS = 1000;
const MIN_JOB_DELAY_MS = 100;
const LOCAL_OCR_TIMEOUT_MS = 12000;
const LOCAL_LOOKUP_TIMEOUT_MS = 8000;
const ANOMALY_PAUSE_STORAGE_KEY = "rapid-scan-anomaly-paused";
const WORKER_CONCURRENCY = 3;

let activeWorkers = 0;
let queueTimer: ReturnType<typeof setTimeout> | null = null;
let refreshTimer: ReturnType<typeof setTimeout> | null = null;
let autoResumeChecked = false;



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

function getLocalUserId(): string {
  const key = "clean_card_local_user_id";
  const existing = localStorage.getItem(key);
  if (existing) return existing;
  const id = `local-${crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
  localStorage.setItem(key, id);
  return id;
}

function scheduleRefresh() {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void useQueueProcessor.getState().refreshQueue();
  }, QUEUE_REFRESH_INTERVAL_MS);
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function money(n: number | null | undefined) {
  if (n == null || Number.isNaN(Number(n))) return null;
  return Math.round(Number(n) * 100) / 100;
}

function blobToBase64DataUrl(blob: Blob, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(new Blob([blob], { type: mime }));
  });
}

function firstValidPrintedIdentifier(...parts: Array<string | null | undefined>): string | null {
  for (const part of parts) {
    const value = String(part ?? "").trim();
    if (isValidPrintedCode(value)) return value;
  }
  return null;
}

function markQueueItemError(id: string, error: string): Promise<void> {
  logTrace(id, "error", { message: error });
  pipelineTracer.record({ itemId: id, stage: "save", status: "fail", error });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("rapid-scan-item-error", { detail: { id, error } }));
  }
  // Delete the failed item so it never gets re-picked and doesn't clog IDB.
  return idbDelete(id).catch(() => undefined);
}


export const useQueueProcessor = create<ProcessorStore>((set, get) => ({
  isRunning: false,
  isPaused: readAnomalyPauseFlag(),
  isPausedByAnomaly: readAnomalyPauseFlag(),
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
    set({ isRunning: true, isPaused: false, isPausedByAnomaly: false });
    startWorker();
  },

  stop: () => {
    if (queueTimer) clearTimeout(queueTimer);
    queueTimer = null;
    activeWorkers = 0;
    set({ isRunning: false, isPaused: false, currentItem: null });
  },

  pause: () => set({ isPaused: true }),

  resume: () => {
    writeAnomalyPauseFlag(false);
    set({ isPaused: false, isPausedByAnomaly: false });
    if (!get().isRunning) set({ isRunning: true });
    startWorker();
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

function startWorker() {
  while (activeWorkers < WORKER_CONCURRENCY) {
    activeWorkers++;
    void workerLoop();
  }
}

async function workerLoop() {
  try {
    while (true) {
      const store = useQueueProcessor.getState();
      if (!store.isRunning || store.isPaused) {
        scheduleRefresh();
        return;
      }

      const item = await idbGetNextQueued();
      if (!item) {
        // Only mark not-running once the last worker exits
        if (activeWorkers <= 1) {
          useQueueProcessor.setState({ isRunning: false, currentItem: null });
        }
        scheduleRefresh();
        return;
      }

      try {
        await processQueueItem(item);
        useQueueProcessor.getState()._incrementProcessed();
      } catch (e: any) {
        console.error("[QueueProcessor] RapidScan item failed:", e);
        await markQueueItemError(item.id, e?.message || String(e));
        useQueueProcessor.getState()._incrementError();
      } finally {
        useQueueProcessor.getState()._setCurrentItem(null);
        scheduleRefresh();
        await sleep(MIN_JOB_DELAY_MS);
      }
    }
  } finally {
    activeWorkers = Math.max(0, activeWorkers - 1);
  }
}



async function processQueueItem(item: QueueItem): Promise<void> {
  const store = useQueueProcessor.getState();
  store._setCurrentItem(item.id);
  await idbUpdateMeta(item.id, { status: "processing" });
  pipelineTracer.record({ itemId: item.id, stage: "enqueue", status: "ok" });

  const base64 = await blobToBase64DataUrl(item.blob, item.mime || "image/jpeg");
  const scanSettings = getScannerSettings();
  const gameTypeHint = scanSettings.gameTypeFilter !== "auto" ? scanSettings.gameTypeFilter : undefined;
  const userId = getLocalUserId();

  logTrace(item.id, "ocr-start");
  const endOcr = pipelineTracer.begin(item.id, "ocr");
  const ocrStartedAt = performance.now();
  let ocr: Awaited<ReturnType<typeof runLocalCardOcr>>;
  try {
    ocr = await withTimeout(runLocalCardOcr(item.blob), LOCAL_OCR_TIMEOUT_MS, "Local OCR");
  } catch (e: any) {
    endOcr({ status: /timeout/i.test(e?.message || "") ? "timeout" : "fail", error: e?.message || String(e) });
    throw e;
  }
  const ocrDurationMs = Math.round(performance.now() - ocrStartedAt);
  const ocrText = compactOcrText(ocr?.setCode, ocr?.cardNumber, ocr?.title, ocr?.fullCode, ocr?.rawText);
  endOcr({
    status: ocr ? "ok" : "fail",
    meta: {
      hasText: Boolean(ocrText),
      title: ocr?.title ?? null,
      setCode: ocr?.setCode ?? null,
      cardNumber: ocr?.cardNumber ?? null,
      confidence: ocr?.confidence ?? null,
    },
  });
  logTrace(item.id, "ocr-result", {
    durationMs: ocrDurationMs,
    data: {
      title: ocr?.title,
      setCode: ocr?.setCode,
      cardNumber: ocr?.cardNumber,
      fullCode: ocr?.fullCode,
      game: ocr?.game,
      confidence: ocr?.confidence,
      rawText: ocr?.rawText ? ocr.rawText.slice(0, 600) : "",
    },
  });

  const hasStructured = Boolean(ocr?.title || ocr?.setCode || ocr?.cardNumber || ocr?.fullCode);
  if (!ocrText && !hasStructured) {
    pipelineTracer.record({ itemId: item.id, stage: "identify", status: "skip", error: "unreadable OCR" });
    await markQueueItemError(item.id, "Unreadable scan — retake photo");
    return;
  }

  const printedIdentifier = firstValidPrintedIdentifier(ocr?.setCode, ocr?.fullCode, ocr?.cardNumber);
  const hasValidTitle = isReadableTitle(ocr?.title);
  if (!printedIdentifier) {
    pipelineTracer.record({ itemId: item.id, stage: "identify", status: "skip", error: "no printed code" });
    await markQueueItemError(item.id, "No printed set/card code found — retake photo closer to the code");
    return;
  }

  logTrace(item.id, "lookup-start", { data: { setCode: printedIdentifier, cardNumber: ocr?.cardNumber ?? null, game: ocr?.game ?? null } });
  const lookupStartedAt = performance.now();
  const lookup = await withTimeout(
    runRapidBasicLookup({
      imageUrl: null,
      ocrText,
      title: hasValidTitle ? ocr?.title ?? null : null,
      setName: null,
      setCode: printedIdentifier,
      cardNumber: ocr?.cardNumber ?? null,
      edition: ocr?.edition ?? null,
      game: ocr?.game ?? null,
      gameTypeHint,
      allowGoogleLens: false,
    }),
    LOCAL_LOOKUP_TIMEOUT_MS,
    "Printed-code card lookup",
  );
  const lookupDurationMs = Math.round(performance.now() - lookupStartedAt);

  const identify = lookup.cardData;
  const pricing = lookup.pricing ?? null;
  logTrace(item.id, "lookup-result", {
    durationMs: lookupDurationMs,
    data: {
      success: lookup.success,
      source: (lookup as any).source ?? null,
      cardName: identify?.card_name ?? null,
      error: lookup.error ?? null,
      hasPrice: hasReadablePrice(pricing),
    },
  });

  if (!lookup.success || !identify?.card_name) {
    await markQueueItemError(item.id, lookup.error || "No printed-code lookup match — retake photo closer to the printed code");
    return;
  }

  const cardName = String(identify.card_name || "").trim();
  const confidence = Number(identify.confidence ?? 0.98);
  const cardSet = identify.card_set ?? null;
  const cardNumber = identify.card_number ?? ocr?.cardNumber ?? ocr?.setCode ?? null;
  const rarity = identify.rarity ?? null;
  const gameType = identify.game_type ?? null;
  const sportType = identify.sport_type ?? null;
  const year = identify.year ?? null;
  const manufacturer = identify.manufacturer ?? null;
  const playerName = sportType ? cardName : null;
  const team = null;
  const imageUrl = base64;
  const rawPrice = money(pricing?.raw ?? pricing?.highestSold ?? null);
  const psa10Price = money(pricing?.psa10 ?? pricing?.cgc10 ?? null);

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
    isInLibrary: false,
    libraryQuantity: 0,
    year: year || undefined,
    playerName: playerName || undefined,
    team: team || undefined,
    manufacturer: manufacturer || undefined,
  };

  const confPct = confidence * 100;
  const threshold = scanSettings.autoConfirmThreshold ?? 75;

  if (scanSettings.scanMode === "SAVE" && confPct >= threshold) {
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
        image_source: "scan",
        image_status: "local-preview",
        image_search_status: "found",
        current_price_raw: rawPrice,
        suggested_price: rawPrice,
        last_price_update: rawPrice ? new Date().toISOString() : null,
        condition: "ungraded",
        year: year ? parseInt(year, 10) || null : null,
        player_name: playerName,
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
      processedCard.libraryQuantity = 1;
    } catch (e) {
      console.error("[QueueProcessor] auto-save failed:", e);
    }
  }

  useQueueProcessor.getState()._setLastProcessedCard(processedCard);
  console.log("[QueueProcessor] Printed-code lookup matched", cardName, { ocrSource: ocr?.source ?? "local-browser-ocr", source: lookup.source, hasPrice: hasReadablePrice(pricing) });

  addRecentScan({
    id: item.id,
    card_name: cardName,
    card_set: cardSet,
    card_number: cardNumber,
    player_name: playerName,
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

  logTrace(item.id, "success", {
    message: cardName,
    data: { cardName, cardSet, cardNumber, value: rawPrice, source: (lookup as any).source ?? null },
  });
  window.dispatchEvent(new CustomEvent("recent-scan-added"));
  await idbDelete(item.id);
}

export async function checkAndResumeQueue(): Promise<void> {
  if (autoResumeChecked) return;
  autoResumeChecked = true;
  const state = useQueueProcessor.getState();
  const anomalyPaused = state.isPausedByAnomaly || readAnomalyPauseFlag();
  if (anomalyPaused) {
    useQueueProcessor.setState({ isPaused: true, isPausedByAnomaly: true });
    return;
  }
  const queuedCount = await idbCountQueued();
  if (queuedCount > 0) state.start();
}

export { idbAdd, idbCount, idbCountQueued, idbClear, idbGetAll, idbDelete } from "@/lib/idbQueue";
