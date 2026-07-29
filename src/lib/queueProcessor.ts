// src/lib/queueProcessor.ts
// Browser-local Rapid Scan worker: claim -> image derivatives -> OCR -> resolve -> save.

import { create } from "zustand";
import { addRecentScan } from "@/lib/recentScans";
import { runLocalCardOcr } from "@/lib/ocr/localCardOcr";
import {
  idbAdd,
  idbClear,
  idbCount,
  idbCountQueued,
  idbDelete,
  idbGetAll,
  idbListMetaFast,
  type QueueItemMeta,
} from "@/lib/idbQueue";
import {
  claimNextCapture,
  transitionCapture,
} from "@/lib/rapidScan/db";
import type {
  CaptureJob,
  RapidScanSession,
  ResolveResult,
} from "@/lib/rapidScan/contracts";
import {
  prepareCaptureImages,
  type PreparedCaptureImages,
} from "@/lib/rapidScan/imagePipeline";
import {
  upsertIdentifiedCapture,
  type InventoryCaptureImages,
} from "@/lib/rapidScan/inventoryUpsert";
import type { CardResolver } from "@/lib/resolvers/contracts";
import { yugiohResolver } from "@/lib/resolvers/yugiohResolver";

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
  _setCurrentItem: (value: string | null) => void;
  _setLastProcessedCard: (value: ProcessedCard | null) => void;
  _incrementProcessed: () => void;
  _incrementError: () => void;
};

type IdentifiedResult = Extract<ResolveResult, { status: "identified" }>;

export type SavedScanPublication = {
  job: CaptureJob;
  identity: IdentifiedResult["identity"];
  inventoryId: string;
  quantity: number;
  action: "created" | "incremented";
  libraryBlob: Blob;
  pricingStatus: "pending";
};

export type CaptureProcessingDependencies = {
  prepareCaptureImages: (
    originalBlob: Blob,
    profileId: CaptureJob["session"]["profileId"],
    rotation: CaptureJob["rotation"],
  ) => Promise<PreparedCaptureImages>;
  runLocalCardOcr: typeof runLocalCardOcr;
  resolverFor: (game: RapidScanSession["game"]) => CardResolver;
  transitionCapture: typeof transitionCapture;
  upsertIdentifiedCapture: (
    job: CaptureJob,
    result: IdentifiedResult,
    images?: InventoryCaptureImages,
  ) => ReturnType<typeof upsertIdentifiedCapture>;
  publishSavedScan: (publication: SavedScanPublication) => void;
};

const QUEUE_REFRESH_INTERVAL_MS = 1000;
const MIN_JOB_DELAY_MS = 100;
const ANOMALY_PAUSE_STORAGE_KEY = "rapid-scan-anomaly-paused";
const WORKER_CONCURRENCY = 1;

let activeWorkers = 0;
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
    // A private browsing policy can deny storage without disabling scanning.
  }
}

function scheduleRefresh(): void {
  if (refreshTimer) return;
  refreshTimer = setTimeout(() => {
    refreshTimer = null;
    void useQueueProcessor.getState().refreshQueue();
  }, QUEUE_REFRESH_INTERVAL_MS);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : String(error);
}

function unsupportedResolver(game: RapidScanSession["game"]): CardResolver {
  return {
    game,
    listSets: async () => [],
    resolve: async () => ({
      status: "identification_error",
      reason: `${game} identification is not available yet.`,
    }),
  };
}

export function resolverFor(game: RapidScanSession["game"]): CardResolver {
  return game === "yugioh" ? yugiohResolver : unsupportedResolver(game);
}

function blobUrl(blob: Blob): string {
  return typeof URL?.createObjectURL === "function"
    ? URL.createObjectURL(blob)
    : "";
}

export function publishSavedScan(publication: SavedScanPublication): void {
  const { job, identity, inventoryId, quantity, libraryBlob } = publication;
  const imageUrl = blobUrl(libraryBlob);
  const processedCard: ProcessedCard = {
    id: job.id,
    cardName: identity.cardName,
    cardSet: identity.setName ?? undefined,
    cardNumber: identity.printedCode ?? undefined,
    rarity: identity.variant ?? undefined,
    gameType: identity.game,
    value: null,
    psa10Price: null,
    imageUrl,
    isInLibrary: true,
    libraryQuantity: quantity,
    dbId: inventoryId,
  };
  useQueueProcessor.getState()._setLastProcessedCard(processedCard);
  addRecentScan({
    id: job.id,
    card_name: identity.cardName,
    card_set: identity.setName,
    card_number: identity.printedCode,
    player_name: null,
    image_url: imageUrl,
    price: null,
    psa10Price: null,
    confidence: identity.confidence,
    rarity: identity.variant,
    gameType: identity.game,
    sportType: null,
    dbId: inventoryId,
    isInLibrary: true,
    libraryQuantity: quantity,
    year: null,
    team: null,
    manufacturer: null,
  });
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("recent-scan-added"));
    window.dispatchEvent(
      new CustomEvent("rapid-scan-saved", { detail: publication }),
    );
  }
}

const defaultDependencies: CaptureProcessingDependencies = {
  prepareCaptureImages,
  runLocalCardOcr,
  resolverFor,
  transitionCapture,
  upsertIdentifiedCapture,
  publishSavedScan,
};

export async function processClaimedCapture(
  job: CaptureJob,
  dependencies: CaptureProcessingDependencies = defaultDependencies,
): Promise<"processed" | "error"> {
  const images = await dependencies.prepareCaptureImages(
    job.originalBlob,
    job.session.profileId,
    job.rotation,
  );
  const ocr = await dependencies.runLocalCardOcr(images.ocrBlob);
  const result = await dependencies.resolverFor(job.session.game).resolve({
    session: job.session,
    ocr,
  });

  if (result.status !== "identified") {
    const status =
      result.status === "needs_review"
        ? "needs_review"
        : "identification_error";
    await dependencies.transitionCapture(job.id, status, {
      error: result.reason,
      libraryBlob: images.libraryBlob,
      ocrBlob: images.ocrBlob,
    });
    return "error";
  }

  const saved = await dependencies.upsertIdentifiedCapture(job, result, {
    libraryBlob: images.libraryBlob,
  });
  dependencies.publishSavedScan({
    job,
    identity: result.identity,
    ...saved,
    libraryBlob: images.libraryBlob,
    pricingStatus: "pending",
  });
  return "processed";
}

async function transitionUnexpectedFailure(
  job: CaptureJob,
  error: unknown,
): Promise<void> {
  const message = errorMessage(error);
  try {
    await transitionCapture(job.id, "identification_error", { error: message });
  } catch (transitionError) {
    console.error("[QueueProcessor] Failed to persist worker error:", transitionError);
  }
  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent("rapid-scan-item-error", {
        detail: { id: job.id, error: message },
      }),
    );
  }
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
    if (readAnomalyPauseFlag()) {
      set({ isPaused: true, isPausedByAnomaly: true });
      return;
    }
    if (!get().isRunning) {
      set({ isRunning: true, isPaused: false, isPausedByAnomaly: false });
    }
    startWorker();
  },
  stop: () => set({ isRunning: false, isPaused: false, currentItem: null }),
  pause: () => set({ isPaused: true }),
  resume: () => {
    writeAnomalyPauseFlag(false);
    set({ isPaused: false, isPausedByAnomaly: false, isRunning: true });
    startWorker();
  },
  refreshQueue: async () => {
    const [queueCount, queueMeta] = await Promise.all([
      idbCountQueued(),
      idbListMetaFast(),
    ]);
    set({ queueCount, queueMeta });
  },
  _setCurrentItem: (currentItem) => set({ currentItem }),
  _setLastProcessedCard: (lastProcessedCard) => set({ lastProcessedCard }),
  _incrementProcessed: () =>
    set((state) => ({ processedCount: state.processedCount + 1 })),
  _incrementError: () =>
    set((state) => ({ errorCount: state.errorCount + 1 })),
}));

function startWorker(): void {
  while (activeWorkers < WORKER_CONCURRENCY) {
    activeWorkers += 1;
    void workerLoop();
  }
}

async function workerLoop(): Promise<void> {
  try {
    while (true) {
      const state = useQueueProcessor.getState();
      if (!state.isRunning || state.isPaused) {
        scheduleRefresh();
        return;
      }

      const job = await claimNextCapture();
      if (!job) {
        scheduleRefresh();
        return;
      }
      state._setCurrentItem(job.id);

      try {
        const outcome = await processClaimedCapture(job);
        if (outcome === "processed") state._incrementProcessed();
        else state._incrementError();
      } catch (error) {
        console.error("[QueueProcessor] RapidScan item failed:", error);
        await transitionUnexpectedFailure(job, error);
        state._incrementError();
      } finally {
        state._setCurrentItem(null);
        scheduleRefresh();
        await sleep(MIN_JOB_DELAY_MS);
      }
    }
  } finally {
    activeWorkers = Math.max(0, activeWorkers - 1);
    if (activeWorkers === 0) {
      useQueueProcessor.setState({ isRunning: false, currentItem: null });
      void idbCountQueued().then((queuedCount) => {
        if (queuedCount > 0 && !useQueueProcessor.getState().isPaused) {
          useQueueProcessor.getState().start();
        }
      });
    }
  }
}

export async function checkAndResumeQueue(): Promise<void> {
  if (autoResumeChecked) return;
  autoResumeChecked = true;
  const state = useQueueProcessor.getState();
  if (state.isPausedByAnomaly || readAnomalyPauseFlag()) {
    useQueueProcessor.setState({ isPaused: true, isPausedByAnomaly: true });
    return;
  }
  if ((await idbCountQueued()) > 0) state.start();
}

export {
  idbAdd,
  idbCount,
  idbCountQueued,
  idbClear,
  idbGetAll,
  idbDelete,
} from "@/lib/idbQueue";
