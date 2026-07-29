import Dexie from "dexie";
import type {
  CaptureJob,
  CaptureJobStatus,
  RapidScanSession,
} from "@/lib/rapidScan/contracts";
import {
  claimNextCapture,
  enqueueCapture,
  hasCompletedLegacyMigration,
  importCaptureJobsIfAbsent,
  listCaptureMeta,
  rapidScanDb,
  retryCapture,
  type CaptureJobMeta,
} from "@/lib/rapidScan/db";

export type QueueStatus = "queued" | "processing" | "success" | "error";
export type QueueItem = {
  id: string;
  createdAt: number;
  processingStartedAt?: number;
  status: QueueStatus;
  error?: string;
  blob: Blob;
  mime: string;
  filename: string;
  rotation?: CaptureJob["rotation"];
  session?: RapidScanSession;
};
export type QueueItemMeta = Omit<QueueItem, "blob">;

const LEGACY_DB_NAME = "card_scout_pro";
const LEGACY_STORE = "rapid_scan_queue";
const MIGRATION_KEY = "rapid_scan_v2_queue_migrated";
const PROCESSING_STALE_MS = 60_000;

const legacyStatus = {
  captured: "queued",
  processing_ocr: "processing",
  identified: "processing",
  saved: "success",
  needs_review: "error",
  identification_error: "error",
} as const;
const captureStatus: Record<QueueStatus, CaptureJobStatus> = {
  queued: "captured",
  processing: "processing_ocr",
  success: "saved",
  error: "identification_error",
};
type StoredJob = CaptureJob & { legacyFilename?: string };
type StoredMeta = CaptureJobMeta & { legacyFilename?: string };

function toCapture(item: QueueItem): StoredJob {
  const session: RapidScanSession = item.session
    ? { ...item.session }
    : {
        id: `legacy-${item.id}`,
        game: "other",
        selectedSetId: null,
        selectedSetName: null,
        profileId: "standard",
        captureMode: "auto",
      };
  return {
    id: item.id,
    idempotencyKey: item.id,
    createdAt: item.createdAt,
    updatedAt: item.processingStartedAt ?? item.createdAt,
    rotation: item.rotation ?? 0,
    status: captureStatus[item.status],
    processingStartedAt: item.processingStartedAt,
    retryCount: 0,
    error: item.error,
    session,
    originalBlob: item.blob,
    mime: item.mime,
    legacyFilename: item.filename,
  };
}
function toQueue(job: StoredJob): QueueItem {
  return {
    id: job.id,
    createdAt: job.createdAt,
    processingStartedAt: job.processingStartedAt,
    status: legacyStatus[job.status],
    error: job.error,
    blob: job.originalBlob,
    mime: job.mime,
    filename: job.legacyFilename ?? "card.jpg",
    rotation: job.rotation,
    session: { ...job.session },
  };
}
function toMeta(job: StoredMeta): QueueItemMeta {
  return {
    id: job.id,
    createdAt: job.createdAt,
    processingStartedAt: job.processingStartedAt,
    status: legacyStatus[job.status],
    error: job.error,
    mime: job.mime,
    filename: job.legacyFilename ?? "card.jpg",
    rotation: job.rotation,
    session: { ...job.session },
  };
}

async function readLegacyQueue(): Promise<QueueItem[]> {
  if (typeof indexedDB === "undefined") return [];
  if (typeof indexedDB.databases === "function") {
    const databases = await indexedDB.databases();
    if (!databases.some((database) => database.name === LEGACY_DB_NAME)) return [];
  }
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(LEGACY_DB_NAME);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  if (!database.objectStoreNames.contains(LEGACY_STORE)) {
    database.close();
    return [];
  }
  try {
    return await new Promise<QueueItem[]>((resolve, reject) => {
      const transaction = database.transaction(LEGACY_STORE, "readonly");
      const request = transaction.objectStore(LEGACY_STORE).getAll();
      request.onsuccess = () => resolve(request.result as QueueItem[]);
      request.onerror = () => reject(request.error);
    });
  } finally {
    database.close();
  }
}

let migrationPromise: Promise<void> | null = null;
function ensureMigration(): Promise<void> {
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    if (typeof localStorage === "undefined" || typeof indexedDB === "undefined") return;
    const marked = localStorage.getItem(MIGRATION_KEY) === "1";
    if (marked && await hasCompletedLegacyMigration("legacy_queue")) return;
    const legacy = await readLegacyQueue();
    await importCaptureJobsIfAbsent(legacy.map(toCapture), { importMissing: !marked });
    localStorage.setItem(MIGRATION_KEY, "1");
  })();
  return migrationPromise;
}

async function nextAvailable(): Promise<StoredJob | null> {
  const captured = await rapidScanDb.captureJobs
    .where("[status+createdAt]")
    .between(["captured", Dexie.minKey], ["captured", Dexie.maxKey])
    .first();
  if (captured) return captured as StoredJob;
  const cutoff = Date.now() - PROCESSING_STALE_MS;
  const stale = await rapidScanDb.captureJobs
    .where("[status+createdAt]")
    .between(["processing_ocr", Dexie.minKey], ["processing_ocr", Dexie.maxKey])
    .filter((job) => (job.processingStartedAt ?? job.createdAt) < cutoff)
    .first();
  return (stale as StoredJob | undefined) ?? null;
}

export async function idbAdd(item: QueueItem): Promise<void> {
  await ensureMigration();
  await enqueueCapture(toCapture(item));
}
export async function idbGet(id: string): Promise<QueueItem | null> {
  await ensureMigration();
  const job = await rapidScanDb.captureJobs.get(id);
  return job ? toQueue(job as StoredJob) : null;
}
export async function idbUpdateMeta(id: string, patch: Partial<QueueItemMeta>): Promise<void> {
  await ensureMigration();
  await rapidScanDb.transaction("rw", rapidScanDb.captureJobs, async () => {
    const current = await rapidScanDb.captureJobs.get(id) as StoredJob | undefined;
    if (!current) return;
    const next: StoredJob = {
      ...current,
      createdAt: patch.createdAt ?? current.createdAt,
      status: patch.status ? captureStatus[patch.status] : current.status,
      processingStartedAt:
        patch.status === "processing" ? Date.now()
        : patch.status === "queued" ? undefined
        : patch.processingStartedAt ?? current.processingStartedAt,
      error: "error" in patch ? patch.error : current.error,
      mime: patch.mime ?? current.mime,
      legacyFilename: patch.filename ?? current.legacyFilename,
      updatedAt: Date.now(),
    };
    await rapidScanDb.captureJobs.put(next);
  });
}
export async function idbDelete(id: string): Promise<void> {
  await ensureMigration();
  await rapidScanDb.captureJobs.delete(id);
}
export async function idbRetry(id: string): Promise<void> {
  await ensureMigration();
  await retryCapture(id);
}
export async function idbListMeta(limit = 500): Promise<QueueItemMeta[]> {
  await ensureMigration();
  return (await listCaptureMeta(limit)).map((job) => toMeta(job as StoredMeta));
}
export async function idbListMetaFast(limit = 500): Promise<QueueItemMeta[]> {
  return idbListMeta(limit);
}
export async function idbGetNextQueued(): Promise<QueueItem | null> {
  await ensureMigration();
  const job = await nextAvailable();
  return job ? toQueue(job) : null;
}
export async function idbClaimNextQueued(): Promise<QueueItem | null> {
  await ensureMigration();
  const job = await claimNextCapture(PROCESSING_STALE_MS);
  return job ? toQueue(job as StoredJob) : null;
}
export async function idbCountQueued(): Promise<number> {
  await ensureMigration();
  const cutoff = Date.now() - PROCESSING_STALE_MS;
  return rapidScanDb.captureJobs.filter(
    (job) =>
      job.status === "captured" ||
      (job.status === "processing_ocr" &&
        (job.processingStartedAt ?? job.createdAt) < cutoff),
  ).count();
}
export async function idbCountPending(): Promise<number> {
  await ensureMigration();
  return rapidScanDb.captureJobs.filter(
    (job) =>
      job.status === "captured" ||
      job.status === "processing_ocr" ||
      job.status === "identified",
  ).count();
}
export async function idbCount(): Promise<number> {
  await ensureMigration();
  return rapidScanDb.captureJobs.count();
}
export async function idbGetAll(): Promise<QueueItem[]> {
  await ensureMigration();
  return (await rapidScanDb.captureJobs.orderBy("createdAt").reverse().toArray())
    .map((job) => toQueue(job as StoredJob));
}
export async function idbClear(): Promise<void> {
  await ensureMigration();
  await rapidScanDb.captureJobs.clear();
}
