import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";
import { withRetry } from "@/lib/retry";
import { withTimeout } from "@/lib/async/withTimeout";
import { getScannerSettings } from "@/hooks/use-scanner-settings";
import { hybridIdentifyCard, type IdentifiedCardData } from "@/lib/hybridCardIdentify";
import { resolveRapidLocalVision, type RapidLocalVisionResult } from "@/lib/vision/rapidLocalVision";
import { queueAnomalyDetector } from "@/lib/scanAnomalyDetector";
import { addRecentScan } from "@/lib/recentScans";
import { insertCardDual } from "@/lib/localCards";
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
  _incrementProcessed: () => void;
  _incrementError: () => void;
};

type PriceResult = {
  raw: number | null;
  psa10: number | null;
};

type IdentificationResult = {
  identity: IdentifiedCardData;
  source: "learned" | "local-ocr" | "cloud" | "local-llm";
  localVision: RapidLocalVisionResult;
};

const LOCAL_VISION_TIMEOUT_MS = 90_000;
const CLOUD_IDENTIFY_TIMEOUT_MS = 30_000;
const PRICE_TIMEOUT_MS = 20_000;
const UPLOAD_TIMEOUT_MS = 25_000;
const PRICE_CACHE_TTL_MS = 10 * 60 * 1000;
const POLL_INTERVAL_MS = 75;
const ANOMALY_PAUSE_STORAGE_KEY = "rapid-scan-anomaly-paused";

const activeClaims = new Set<string>();
const priceCache = new Map<string, { timestamp: number; result: PriceResult }>();
const priceInFlight = new Map<string, Promise<PriceResult>>();
let runGeneration = 0;
let missingPriceWarned = false;
let authWarned = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeConfidence(value: number | null | undefined): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric));
}

function money(value: unknown): number | null {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return null;
  return Math.round(numeric * 100) / 100;
}

function readAnomalyPauseFlag(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(ANOMALY_PAUSE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function writeAnomalyPauseFlag(paused: boolean) {
  if (typeof window === "undefined") return;
  try {
    if (paused) window.localStorage.setItem(ANOMALY_PAUSE_STORAGE_KEY, "1");
    else window.localStorage.removeItem(ANOMALY_PAUSE_STORAGE_KEY);
  } catch {
    // Storage failure must not stop scanning.
  }
}

function dispatchJobError(itemId: string, error: string) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("rapid-scan-job-error", { detail: { id: itemId, error } }));
}

function dispatchRecentScan() {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("recent-scan-added"));
}

function gameTypeHint(): string | undefined {
  const selected = getScannerSettings().gameTypeFilter;
  return selected && selected !== "auto" ? selected : undefined;
}

function normalizeGameType(value: string | null | undefined): string | null {
  if (value) return value;
  const hint = gameTypeHint();
  if (!hint) return null;
  const map: Record<string, string> = {
    mtg: "MTG",
    yugioh: "Yu-Gi-Oh!",
    pokemon: "Pokemon",
    sports: "Sports",
    gpk: "GPK",
    marvel: "Marvel",
    onepiece: "One Piece",
    lorcana: "Lorcana",
  };
  return map[hint.toLowerCase()] ?? hint;
}

function blobToBase64DataUrl(blob: Blob, mime: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!blob || blob.size === 0) {
      reject(new Error("Captured image is empty"));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== "string" || result.length < 200) {
        reject(new Error("Captured image could not be encoded"));
        return;
      }
      resolve(result);
    };
    reader.onerror = () => reject(reader.error || new Error("Captured image could not be read"));
    reader.readAsDataURL(new Blob([blob], { type: mime || blob.type || "image/jpeg" }));
  });
}

async function getUserId(): Promise<string | null> {
  try {
    const { data } = await supabase.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

function priceKey(identity: IdentifiedCardData): string {
  return [
    identity.card_name,
    identity.card_set || "",
    identity.card_number || "",
    identity.game_type || "",
    identity.sport_type || "",
  ].join("|").toLowerCase();
}

async function fetchPrice(identity: IdentifiedCardData): Promise<PriceResult> {
  const key = priceKey(identity);
  const cached = priceCache.get(key);
  if (cached && Date.now() - cached.timestamp < PRICE_CACHE_TTL_MS) return cached.result;

  const pending = priceInFlight.get(key);
  if (pending) return pending;

  const request = withRetry(
    async () => {
      const response = await withTimeout(
        supabase.functions.invoke("fetch-card-prices", {
          body: {
            cardName: identity.card_name,
            cardSet: identity.card_set,
            cardNumber: identity.card_number,
            gameType: identity.game_type,
            sportType: identity.sport_type,
            condition: (identity as IdentifiedCardData & { condition?: string | null }).condition || "ungraded",
          },
        }),
        PRICE_TIMEOUT_MS,
        "Rapid price lookup",
      );

      if (response.error) throw new Error(response.error.message || "Pricing service failed");
      const data = response.data as Record<string, unknown> | null;
      const result: PriceResult = {
        raw: money(data?.raw ?? data?.suggested ?? data?.currentPriceRaw),
        psa10: money(data?.psa10 ?? data?.currentPricePsa10),
      };
      priceCache.set(key, { timestamp: Date.now(), result });
      return result;
    },
    { retries: 1, baseMs: 700, maxMs: 2500 },
  ).finally(() => priceInFlight.delete(key));

  priceInFlight.set(key, request);
  return request;
}

function mergeIdentity(local: IdentifiedCardData | null, cloud: IdentifiedCardData): IdentifiedCardData {
  return {
    ...cloud,
    card_name: cloud.card_name || local?.card_name || "Unknown Card",
    card_set: cloud.card_set || local?.card_set || null,
    card_number: cloud.card_number || local?.card_number || null,
    rarity: cloud.rarity || local?.rarity || null,
    edition: cloud.edition || local?.edition || null,
    game_type: normalizeGameType(cloud.game_type || local?.game_type),
    sport_type: cloud.sport_type || local?.sport_type || null,
    year: cloud.year || local?.year || null,
    manufacturer: cloud.manufacturer || local?.manufacturer || null,
    confidence: Math.max(normalizeConfidence(cloud.confidence), normalizeConfidence(local?.confidence)),
    description: cloud.description || local?.description,
  };
}

async function identifyCard(item: QueueItem): Promise<IdentificationResult> {
  const hint = gameTypeHint();
  const localVision = await withTimeout(
    resolveRapidLocalVision(item.blob, { gameTypeHint: hint }),
    LOCAL_VISION_TIMEOUT_MS,
    "Rapid local vision",
  );

  if (localVision.accepted && localVision.identity) {
    const identity = {
      ...localVision.identity,
      game_type: normalizeGameType(localVision.identity.game_type),
      confidence: normalizeConfidence(localVision.identity.confidence),
    };
    console.log(`[RapidPipeline] ${item.id} resolved by ${localVision.source}: ${identity.card_name}`);
    return {
      identity,
      source: localVision.source === "learned" ? "learned" : "local-ocr",
      localVision,
    };
  }

  const imageUrl = await blobToBase64DataUrl(item.blob, item.mime);
  const cloudResult = await withTimeout(
    hybridIdentifyCard(imageUrl, {
      cloudFunction: "rapid-card-identify",
      skipOfflineGuard: false,
      usePaddleOCR: false,
      ocrText: localVision.ocrText || undefined,
      gameTypeHint: hint,
    }),
    CLOUD_IDENTIFY_TIMEOUT_MS,
    "Rapid cloud identify",
  );

  if (!cloudResult.success || !cloudResult.cardData) {
    throw new Error(cloudResult.error || localVision.reason || "Card identification failed");
  }

  const identity = mergeIdentity(localVision.identity, cloudResult.cardData);
  console.log(
    `[RapidPipeline] ${item.id} cloud fallback after local vision (${Math.round(localVision.candidateConfidence * 100)}%): ${identity.card_name}`,
  );
  return {
    identity,
    source: cloudResult.source === "local" ? "local-llm" : "cloud",
    localVision,
  };
}

function makeProcessedCard(args: {
  item: QueueItem;
  identity: IdentifiedCardData;
  price: PriceResult;
  imageUrl: string;
  ownedCount: number;
  isInLibrary: boolean;
  dbId?: string;
}): ProcessedCard {
  const identity = args.identity as IdentifiedCardData & {
    player_name?: string | null;
    team?: string | null;
  };
  return {
    id: args.item.id,
    cardName: identity.card_name,
    cardSet: identity.card_set || undefined,
    cardNumber: identity.card_number || undefined,
    rarity: identity.rarity || undefined,
    gameType: identity.game_type || undefined,
    sportType: identity.sport_type || undefined,
    value: args.price.raw,
    psa10Price: args.price.psa10,
    imageUrl: args.imageUrl,
    isInLibrary: args.isInLibrary,
    libraryQuantity: args.ownedCount,
    dbId: args.dbId,
    year: identity.year || undefined,
    playerName: identity.player_name || (identity.sport_type ? identity.card_name : undefined),
    team: identity.team || undefined,
    manufacturer: identity.manufacturer || undefined,
  };
}

async function warnMissingPrice(cardName: string) {
  if (missingPriceWarned) return;
  missingPriceWarned = true;
  try {
    const { toast } = await import("sonner");
    toast.info(`Card identified as ${cardName}, but no current price match was found.`);
  } catch {
    // Notification failure is non-fatal.
  }
}

async function processPreviewOnly(item: QueueItem, identity: IdentifiedCardData, price: PriceResult) {
  const imageUrl = URL.createObjectURL(item.blob);
  const confidence = normalizeConfidence(identity.confidence);
  const identityWithExtras = identity as IdentifiedCardData & {
    player_name?: string | null;
    team?: string | null;
  };
  const processed = makeProcessedCard({
    item,
    identity,
    price,
    imageUrl,
    ownedCount: 0,
    isInLibrary: false,
  });

  const stored = addRecentScan({
    id: item.id,
    card_name: identity.card_name,
    card_set: identity.card_set,
    card_number: identity.card_number,
    player_name: identityWithExtras.player_name || (identity.sport_type ? identity.card_name : null),
    image_url: imageUrl,
    price: price.raw,
    psa10Price: price.psa10,
    confidence,
    rarity: identity.rarity,
    gameType: identity.game_type,
    sportType: identity.sport_type,
    dbId: null,
    isInLibrary: false,
    libraryQuantity: 0,
    year: identity.year,
    team: identityWithExtras.team || null,
    manufacturer: identity.manufacturer,
  });

  if (!stored) throw new Error("Card was identified but could not be added to recent scans");
  useQueueProcessor.setState({ lastProcessedCard: processed, currentItem: null });
  dispatchRecentScan();
  await idbDelete(item.id);
}

async function uploadCapture(item: QueueItem): Promise<{ imageUrl: string; storagePath: string }> {
  const storagePath = `cards/${item.id}.jpg`;
  const file = new File([item.blob], item.filename || `${item.id}.jpg`, {
    type: item.mime || item.blob.type || "image/jpeg",
  });

  await withTimeout(
    withRetry(async () => {
      const response = await supabase.storage.from("card-images").upload(storagePath, file, { upsert: false });
      if (response.error) {
        // A retry after a successful upload can report an existing object. Treat that as success.
        if (!/already exists|duplicate/i.test(response.error.message || "")) throw new Error(response.error.message);
      }
    }, { retries: 2, baseMs: 700, maxMs: 3000 }),
    UPLOAD_TIMEOUT_MS,
    "Rapid image upload",
  );

  const { data } = supabase.storage.from("card-images").getPublicUrl(storagePath);
  if (!data.publicUrl) throw new Error("Image uploaded but no public URL was returned");
  return { imageUrl: data.publicUrl, storagePath };
}

async function getOwnership(userId: string, identity: IdentifiedCardData) {
  try {
    let query = supabase
      .from("cards")
      .select("id", { count: "exact" })
      .eq("user_id", userId)
      .ilike("card_name", identity.card_name);
    if (identity.card_number) query = query.ilike("card_number", identity.card_number);
    const { data, count } = await query.limit(1);
    return {
      ownedCount: count || 0,
      isInLibrary: (count || 0) > 0,
      existingId: data?.[0]?.id as string | undefined,
    };
  } catch {
    return { ownedCount: 0, isInLibrary: false, existingId: undefined as string | undefined };
  }
}

async function processSaveMode(item: QueueItem, identity: IdentifiedCardData, price: PriceResult, userId: string) {
  const [upload, ownership] = await Promise.all([
    uploadCapture(item),
    getOwnership(userId, identity),
  ]);

  const confidence = normalizeConfidence(identity.confidence);
  const confidencePercent = confidence * 100;
  const settings = getScannerSettings();
  const threshold = settings.autoConfirmThreshold ?? 75;
  const identityWithExtras = identity as IdentifiedCardData & {
    player_name?: string | null;
    team?: string | null;
  };

  let dbId = ownership.existingId;
  let inLibrary = ownership.isInLibrary;
  let quantity = ownership.ownedCount;

  if (confidencePercent >= threshold) {
    const inserted = await insertCardDual({
      user_id: userId,
      card_name: identity.card_name,
      card_set: identity.card_set,
      card_number: identity.card_number,
      rarity: identity.rarity,
      game_type: identity.game_type,
      sport_type: identity.sport_type,
      image_url: upload.imageUrl,
      image_storage_path: upload.storagePath,
      image_source: "scan",
      image_status: "stored",
      image_search_status: "found",
      current_price_raw: price.raw,
      suggested_price: price.raw,
      last_price_update: price.raw ? new Date().toISOString() : null,
      condition: "ungraded",
      year: identity.year ? parseInt(identity.year, 10) || null : null,
      player_name: identityWithExtras.player_name || (identity.sport_type ? identity.card_name : null),
      team: identityWithExtras.team || null,
      manufacturer: identity.manufacturer,
      raw_name: identity.card_name,
      raw_set: identity.card_set,
      raw_number: identity.card_number,
      raw_year: identity.year,
      raw_manufacturer: identity.manufacturer,
      ocr_confidence: confidence,
    } as any);
    dbId = inserted.id;
    inLibrary = true;
    quantity += 1;
  }

  const processed = makeProcessedCard({
    item,
    identity,
    price,
    imageUrl: upload.imageUrl,
    ownedCount: quantity,
    isInLibrary: inLibrary,
    dbId,
  });

  const recentStored = addRecentScan({
    id: item.id,
    card_name: identity.card_name,
    card_set: identity.card_set,
    card_number: identity.card_number,
    player_name: identityWithExtras.player_name || (identity.sport_type ? identity.card_name : null),
    image_url: upload.imageUrl,
    price: price.raw,
    psa10Price: price.psa10,
    confidence,
    rarity: identity.rarity,
    gameType: identity.game_type,
    sportType: identity.sport_type,
    dbId: dbId || null,
    isInLibrary: inLibrary,
    libraryQuantity: quantity,
    year: identity.year,
    team: identityWithExtras.team || null,
    manufacturer: identity.manufacturer,
  });

  if (!recentStored) throw new Error("Card was saved but could not be added to recent scans");
  useQueueProcessor.setState({ lastProcessedCard: processed, currentItem: null });
  dispatchRecentScan();
  await idbDelete(item.id);
}

async function processJob(item: QueueItem) {
  useQueueProcessor.setState({ currentItem: item.id });
  const settings = getScannerSettings();

  let userId: string | null = null;
  if (settings.scanMode === "SAVE") {
    userId = await getUserId();
    if (!userId) {
      if (!authWarned) {
        authWarned = true;
        try {
          const { toast } = await import("sonner");
          toast.error("Signed out — sign back in to process saved scans.");
        } catch {
          // Non-fatal.
        }
      }
      throw new Error("Signed out — capture preserved for retry");
    }
    authWarned = false;
  }

  const resolved = await identifyCard(item);
  const identity = {
    ...resolved.identity,
    card_name: resolved.identity.card_name?.trim() || "Unknown Card",
    game_type: normalizeGameType(resolved.identity.game_type),
    confidence: normalizeConfidence(resolved.identity.confidence),
  };

  if (identity.card_name === "Unknown Card" || normalizeConfidence(identity.confidence) < 0.60) {
    throw new Error(
      `Identification confidence ${Math.round(normalizeConfidence(identity.confidence) * 100)}% — capture preserved for review`,
    );
  }

  const anomaly = queueAnomalyDetector.trackIdentification(identity.card_name);
  if (anomaly.consecutiveCount >= 25) {
    writeAnomalyPauseFlag(true);
    useQueueProcessor.setState({ isPaused: true, isPausedByAnomaly: true });
    throw new Error(`Anomaly: ${identity.card_name} was identified 25 times consecutively`);
  }

  const price = await fetchPrice(identity);
  if (price.raw == null && price.psa10 == null) await warnMissingPrice(identity.card_name);

  if (settings.scanMode === "SAVE" && userId) {
    await processSaveMode(item, identity, price, userId);
  } else {
    // SCAN_ONLY is the UI's "Scan & Price" mode. It identifies and prices,
    // but intentionally does not upload or save to the collection.
    await processPreviewOnly(item, identity, price);
  }
}

function configuredWorkerCount(): number {
  const override = getScannerSettings().maxWorkersOverride || 0;
  // Local ONNX OCR is memory-heavy and the cloud endpoint is rate-limited.
  // Two workers is the reliable M-series Mac default; explicit overrides are capped at four.
  return override > 0 ? Math.max(1, Math.min(override, 4)) : 2;
}

async function recoverInterruptedItems() {
  const items = await idbListMetaFast(1000);
  await Promise.all(
    items
      .filter((item) => item.status === "processing" && !activeClaims.has(item.id))
      .map((item) => idbUpdateMeta(item.id, { status: "queued", error: undefined })),
  );
}

async function refreshQueueState() {
  const all = await idbListMetaFast(1000);
  const queueCount = all.filter((item) => item.status === "queued" || item.status === "processing").length;
  useQueueProcessor.setState({ queueCount, queueMeta: all });
  return all;
}

function isRateLimitError(error: unknown) {
  return /rate limit|429/i.test(String((error as Error)?.message || error));
}

async function workerLoop(workerId: number, generation: number) {
  while (useQueueProcessor.getState().isRunning && generation === runGeneration) {
    const state = useQueueProcessor.getState();
    if (state.isPaused || useGlobalProcessControl.getState().scannerActive) {
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    const item = await idbClaimNextQueued();
    if (!item) {
      const all = await refreshQueueState();
      const queued = all.some((entry) => entry.status === "queued");
      if (!queued && activeClaims.size === 0) {
        useQueueProcessor.setState({ isRunning: false, currentItem: null });
        break;
      }
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    // idbQueue can reclaim a long-running item after its legacy five-second lease.
    // The in-memory claim set prevents a second worker from processing that same capture.
    if (activeClaims.has(item.id)) {
      await idbUpdateMeta(item.id, {
        status: "processing",
        processingStartedAt: Date.now(),
        error: undefined,
      });
      await sleep(POLL_INTERVAL_MS);
      continue;
    }

    activeClaims.add(item.id);
    try {
      await processJob(item);
      useQueueProcessor.getState()._incrementProcessed();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error(`[RapidPipeline worker ${workerId}]`, error);
      if (isRateLimitError(error)) {
        await idbUpdateMeta(item.id, { status: "queued", error: "Rate limited — automatic retry pending" });
        await sleep(5000);
      } else {
        await idbUpdateMeta(item.id, { status: "error", error: message });
        useQueueProcessor.getState()._incrementError();
        dispatchJobError(item.id, message);
      }
      useQueueProcessor.setState({ currentItem: null });
    } finally {
      activeClaims.delete(item.id);
      await refreshQueueState();
    }
  }
}

async function beginProcessing(force: boolean, generation: number) {
  if (!force && useGlobalProcessControl.getState().scannerActive) {
    useQueueProcessor.setState({ isRunning: false });
    return;
  }

  await recoverInterruptedItems();
  const all = await refreshQueueState();
  if (!all.some((item) => item.status === "queued" || item.status === "processing")) {
    useQueueProcessor.setState({ isRunning: false, currentItem: null });
    return;
  }

  const workers = configuredWorkerCount();
  console.log(`[RapidPipeline] Starting ${workers} post-capture workers`);
  for (let index = 0; index < workers; index += 1) {
    void workerLoop(index, generation);
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

  start: (force = false) => {
    if (get().isRunning) return;
    if (!force && useGlobalProcessControl.getState().scannerActive) return;
    writeAnomalyPauseFlag(false);
    queueAnomalyDetector.resetSession();
    missingPriceWarned = false;
    const generation = ++runGeneration;
    set({ isRunning: true, isPaused: false, isPausedByAnomaly: false });
    void beginProcessing(force, generation);
  },

  stop: () => {
    runGeneration += 1;
    set({ isRunning: false, isPaused: false, currentItem: null });
  },

  pause: () => set({ isPaused: true }),

  resume: () => {
    writeAnomalyPauseFlag(false);
    queueAnomalyDetector.resetSession();
    set({ isPaused: false, isPausedByAnomaly: false });
    if (!get().isRunning) get().start(true);
  },

  refreshQueue: async () => {
    await refreshQueueState();
  },

  _incrementProcessed: () => set((state) => ({ processedCount: state.processedCount + 1 })),
  _incrementError: () => set((state) => ({ errorCount: state.errorCount + 1 })),
}));

let autoResumeChecked = false;

export async function checkAndResumeQueue(): Promise<void> {
  if (autoResumeChecked) return;
  autoResumeChecked = true;
  if (readAnomalyPauseFlag()) {
    useQueueProcessor.setState({ isPaused: true, isPausedByAnomaly: true });
    return;
  }
  if (useGlobalProcessControl.getState().scannerActive) return;
  await recoverInterruptedItems();
  const all = await refreshQueueState();
  if (all.some((item) => item.status === "queued")) useQueueProcessor.getState().start();
}

export { idbAdd, idbCount, idbCountQueued, idbClear, idbGetAll, idbDelete };

export async function retryAllErrors(): Promise<number> {
  const all = await idbListMetaFast(1000);
  const errors = all.filter((item) => item.status === "error");
  await Promise.all(
    errors.map((item) => idbUpdateMeta(item.id, { status: "queued", error: undefined })),
  );
  await refreshQueueState();
  return errors.length;
}

export async function clearScanQueue(): Promise<void> {
  runGeneration += 1;
  activeClaims.clear();
  await idbClear();
  useQueueProcessor.setState({
    isRunning: false,
    isPaused: false,
    queueCount: 0,
    currentItem: null,
    queueMeta: [],
  });
}
