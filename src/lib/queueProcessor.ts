// src/lib/queueProcessor.ts
// RapidScan queue worker: local browser OCR first, cloud OCR fallback second,
// PriceCharting set-code/title lookup third, Google Lens/search fallback fourth.

import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";
import { withRetry } from "@/lib/retry";
import { withTimeout } from "@/lib/async/withTimeout";
import { getScannerSettings } from "@/hooks/use-scanner-settings";
import { addRecentScan } from "@/lib/recentScans";
import { insertCardDual } from "@/lib/localCards";
import { runLocalCardOcr } from "@/lib/ocr/localCardOcr";
import {
  idbGetNextQueued,
  idbUpdateMeta,
  idbDelete,
  idbCount,
  idbCountQueued,
  idbListMetaFast,
  idbGetAll,
  type QueueItem,
  type QueueItemMeta,
} from "@/lib/idbQueue";
import {
  compactOcrText,
  hasReadablePrice,
  runRapidBasicLookup,
  type RapidBasicLookupResponse,
} from "@/lib/rapidBasicLookupClient";

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

const LOCAL_OCR_TIMEOUT_MS = 12000;
const CLOUD_OCR_TIMEOUT_MS = 3500;
const UPLOAD_TIMEOUT_MS = 8000;
const BASIC_LOOKUP_TIMEOUT_MS = 18000;
const QUEUE_REFRESH_INTERVAL_MS = 1000;
const MIN_JOB_DELAY_MS = 500;
const ANOMALY_PAUSE_STORAGE_KEY = "rapid-scan-anomaly-paused";

let workerActive = false;
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

async function getUserId(): Promise<string | null> {
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user?.id ?? null;
}

async function uploadScanImage(item: QueueItem): Promise<{ publicUrl: string | null; storagePath: string | null }> {
  const storagePath = `cards/${item.id}.jpg`;
  const file = new File([item.blob], item.filename || `${item.id}.jpg`, { type: item.mime || "image/jpeg" });

  const uploaded = await withTimeout(
    withRetry(async () => {
      const res = await supabase.storage.from("card-images").upload(storagePath, file, { upsert: false });
      if (res.error) throw new Error(res.error.message);
      return res.data;
    }),
    UPLOAD_TIMEOUT_MS,
    "Storage upload",
  ).catch((e: any) => {
    console.warn("[QueueProcessor] Upload failed; Google Lens fallback disabled:", e);
    return null;
  });

  if (!uploaded) return { publicUrl: null, storagePath: null };
  const { data } = supabase.storage.from("card-images").getPublicUrl(storagePath);
  return { publicUrl: data.publicUrl, storagePath };
}

async function runOcr(base64: string, blob?: Blob) {
  if (blob) {
    const local = await withTimeout(
      runLocalCardOcr(blob),
      LOCAL_OCR_TIMEOUT_MS,
      "Local browser OCR",
    ).catch((e: any) => {
      console.warn("[QueueProcessor] Local OCR failed; falling back to cloud OCR:", e);
      return null;
    });

    if (local && (local.rawText || local.title || local.setCode || local.cardNumber)) {
      return {
        setCode: local.setCode,
        cardNumber: local.cardNumber,
        title: local.title,
        name: local.title,
        setName: null,
        text: local.rawText,
        confidence: local.confidence,
        source: local.source,
      };
    }
  }

  const result = await withTimeout(
    supabase.functions.invoke("zai-ocr", { body: { imageUrl: base64, mode: "meta" } }),
    CLOUD_OCR_TIMEOUT_MS,
    "Z.AI OCR",
  ).catch((e: any) => {
    console.warn("[QueueProcessor] Cloud OCR failed:", e);
    return { data: null, error: e } as any;
  });

  if ((result as any).error || !(result as any).data) return null;
  return (result as any).data;
}

async function fetchPricingFallback(args: {
  cardName: string;
  cardSet: string | null;
  cardNumber: string | null;
  gameType: string | null;
  sportType: string | null;
}): Promise<{ raw: number | null; psa10: number | null; cgc10: number | null; highestSold: number | null; url: string | null } | null> {
  try {
    const res = await withTimeout(
      supabase.functions.invoke("fetch-card-prices", {
        body: {
          cardName: args.cardName,
          cardSet: args.cardSet,
          cardNumber: args.cardNumber,
          gameType: args.gameType,
          sportType: args.sportType,
          condition: "ungraded",
        },
      }),
      15000,
      "fetch-card-prices fallback",
    );
    if ((res as any).error || !(res as any).data) return null;
    const d = (res as any).data;
    const raw = d.raw ?? d.medianRaw ?? d.tcgPlayerMarket ?? d.tcgPlayerMid ?? null;
    const psa10 = d.psa10 ?? d.medianPsa10 ?? null;
    return {
      raw: typeof raw === "number" ? raw : null,
      psa10: typeof psa10 === "number" ? psa10 : null,
      cgc10: typeof d.cgc10 === "number" ? d.cgc10 : null,
      highestSold: typeof d.highestSold === "number" ? d.highestSold : null,
      url: d.ebayUrl ?? d.tcgPlayerUrl ?? null,
    };
  } catch (e) {
    console.warn("[QueueProcessor] fetch-card-prices fallback failed:", e);
    return null;
  }
}


function lookupErrorMessage(result: RapidBasicLookupResponse | null): string {
  return result?.error || "No PriceCharting match found by set code/title, Google Lens, or web search fallback";
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
    workerActive = false;
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
  if (workerActive) return;
  workerActive = true;
  void workerLoop();
}

async function workerLoop() {
  while (workerActive) {
    const store = useQueueProcessor.getState();
    if (!store.isRunning || store.isPaused) {
      workerActive = false;
      return;
    }

    const item = await idbGetNextQueued();
    if (!item) {
      useQueueProcessor.setState({ isRunning: false, currentItem: null });
      workerActive = false;
      scheduleRefresh();
      return;
    }

    try {
      await processQueueItem(item);
      useQueueProcessor.getState()._incrementProcessed();
    } catch (e: any) {
      console.error("[QueueProcessor] RapidScan item failed:", e);
      await idbUpdateMeta(item.id, { status: "error", error: e?.message || String(e) }).catch(() => undefined);
      useQueueProcessor.getState()._incrementError();
    } finally {
      useQueueProcessor.getState()._setCurrentItem(null);
      scheduleRefresh();
      await sleep(MIN_JOB_DELAY_MS);
    }
  }
}

async function processQueueItem(item: QueueItem): Promise<void> {
  const store = useQueueProcessor.getState();
  store._setCurrentItem(item.id);
  await idbUpdateMeta(item.id, { status: "processing" });

  const base64 = await blobToBase64DataUrl(item.blob, item.mime || "image/jpeg");
  const scanSettings = getScannerSettings();
  const gameTypeHint = scanSettings.gameTypeFilter !== "auto" ? scanSettings.gameTypeFilter : undefined;

  const [ocr, upload, userId] = await Promise.all([
    runOcr(base64, item.blob),
    uploadScanImage(item),
    getUserId(),
  ]);

  const ocrText = compactOcrText(
    ocr?.setCode,
    ocr?.cardNumber,
    ocr?.title,
    ocr?.name,
    ocr?.text,
  );

  if (!ocrText) {
    throw new Error("RapidScan basic lookup failed: OCR did not find set code/title text");
  }

  const lookup = await runRapidBasicLookup({
    imageUrl: upload.publicUrl,
    ocrText,
    gameTypeHint,
    allowGoogleLens: Boolean(upload.publicUrl),
    timeoutMs: BASIC_LOOKUP_TIMEOUT_MS,
  });

  if (!lookup.success || !lookup.cardData) {
    throw new Error(lookupErrorMessage(lookup));
  }

  const identify = lookup.cardData;
  const pricing = lookup.pricing ?? null;
  const cardName = String(identify.card_name || "Unknown Card").trim() || "Unknown Card";
  const confidence = Number(identify.confidence ?? 0.35);

  if (cardName === "Unknown Card" || confidence < 0.3) {
    throw new Error(`Identification confidence ${Math.round(confidence * 100)}% — capture preserved for review`);
  }

  const cardSet = identify.card_set ?? null;
  const cardNumber = identify.card_number ?? ocr?.cardNumber ?? ocr?.setCode ?? null;
  const rarity = identify.rarity ?? null;
  const gameType = identify.game_type ?? null;
  const sportType = identify.sport_type ?? null;
  const year = identify.year ?? null;
  const manufacturer = identify.manufacturer ?? null;
  const playerName = sportType ? cardName : null;
  const team = null;
  const imageUrl = upload.publicUrl ?? base64;
  const rawPrice = money(pricing?.raw ?? pricing?.highestSold ?? null);
  const psa10Price = money(pricing?.psa10 ?? pricing?.cgc10 ?? null);

  let ownedCount = 0;
  let isInLibrary = false;
  let existingId: string | undefined;

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
      // ownership lookup is non-critical
    }
  }

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
    playerName: playerName || undefined,
    team: team || undefined,
    manufacturer: manufacturer || undefined,
  };

  const confPct = confidence * 100;
  const threshold = scanSettings.autoConfirmThreshold ?? 75;

  if (scanSettings.scanMode === "SAVE" && userId && confPct >= threshold) {
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
        image_storage_path: upload.storagePath,
        image_source: "scan",
        image_status: upload.storagePath ? "stored" : "local-preview",
        image_search_status: lookup.source === "google-lens-pricecharting" ? "lens_found" : "found",
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
      processedCard.libraryQuantity = ownedCount + 1;
    } catch (e) {
      console.error("[QueueProcessor] Auto-save failed:", e);
    }
  }

  useQueueProcessor.getState()._setLastProcessedCard(processedCard);

  console.log("[QueueProcessor] Rapid basic lookup matched", cardName, {
    ocrSource: ocr?.source ?? "unknown",
    source: lookup.source,
    priceChartingUrl: lookup.priceChartingUrl,
    googleLensUrl: lookup.googleLensUrl,
    hasPrice: hasReadablePrice(pricing),
  });

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
  if (queuedCount > 0) {
    state.start();
  }
}

export { idbAdd, idbCount, idbCountQueued, idbClear, idbGetAll, idbDelete } from "@/lib/idbQueue";
