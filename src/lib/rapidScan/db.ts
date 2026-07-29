import Dexie, { type EntityTable } from "dexie";
import {
  canTransitionCaptureJob,
  type CaptureJob,
  type CaptureJobStatus,
} from "./contracts";

export type InventoryCard = {
  id: string;
  fingerprint: string;
  quantity: number;
  card_name: string;
  card_set: string | null;
  card_number: string | null;
  game_type: string | null;
  rarity: string | null;
  image_url: string | null;
  pricing_status: "pending" | "priced" | "needs_source_page" | "pricing_error";
  current_price_raw: number | null;
  current_price_psa9: number | null;
  current_price_psa10: number | null;
  created_at: string;
  updated_at: string;
};

export type ScanEvent = {
  id: string;
  captureJobId: string;
  inventoryId: string;
  idempotencyKey: string;
  quantityAction: "created" | "incremented";
  sessionId: string;
  profileId: string;
  selectedSetCorrected: boolean;
  createdAt: number;
};

export type MigrationReceipt = {
  id: string;
  source: "legacy_queue" | "legacy_cards";
  sourceId: string;
  createdAt: number;
};

export type LegacyInventoryCardImport = {
  sourceId: string;
  card: InventoryCard;
};

export type CaptureJobMeta = Omit<
  CaptureJob,
  "originalBlob" | "libraryBlob" | "ocrBlob"
>;
export type CaptureStateCounts = Record<CaptureJobStatus, number>;

class CleanCardLocalDb extends Dexie {
  captureJobs!: EntityTable<CaptureJob, "id">;
  inventoryCards!: EntityTable<InventoryCard, "id">;
  scanEvents!: EntityTable<ScanEvent, "id">;
  migrationReceipts!: EntityTable<MigrationReceipt, "id">;

  constructor() {
    super("clean_card_local_v2");
    this.version(1).stores({
      captureJobs: "id, &idempotencyKey, status, createdAt, [status+createdAt]",
      inventoryCards: "id, &fingerprint, updated_at",
      scanEvents: "id, &idempotencyKey, captureJobId, inventoryId, createdAt",
    });
    this.version(2).stores({
      migrationReceipts: "id, source, sourceId, [source+sourceId]",
    });
  }
}

export const rapidScanDb = new CleanCardLocalDb();
const PROCESSING_LEASE_MS = 60_000;

const recordReceiptId = (
  source: MigrationReceipt["source"],
  sourceId: string,
) => `migration:${source}:record:${sourceId}`;
const completionReceiptId = (source: MigrationReceipt["source"]) =>
  `migration:${source}:complete`;

export async function hasCompletedLegacyMigration(
  source: MigrationReceipt["source"],
): Promise<boolean> {
  return Boolean(await rapidScanDb.migrationReceipts.get(completionReceiptId(source)));
}

export async function enqueueCapture(job: CaptureJob): Promise<void> {
  await rapidScanDb.transaction("rw", rapidScanDb.captureJobs, async () => {
    if (await rapidScanDb.captureJobs.get(job.id)) return;
    if (
      await rapidScanDb.captureJobs
        .where("idempotencyKey")
        .equals(job.idempotencyKey)
        .first()
    ) return;
    await rapidScanDb.captureJobs.add(job);
  });
}

export async function importCaptureJobsIfAbsent(
  jobs: readonly CaptureJob[],
  options: { importMissing?: boolean } = {},
): Promise<void> {
  const importMissing = options.importMissing ?? true;
  await rapidScanDb.transaction(
    "rw",
    rapidScanDb.captureJobs,
    rapidScanDb.migrationReceipts,
    async () => {
      for (const job of jobs) {
        const receiptId = recordReceiptId("legacy_queue", job.id);
        if (await rapidScanDb.migrationReceipts.get(receiptId)) continue;
        if (importMissing) {
          const byId = await rapidScanDb.captureJobs.get(job.id);
          const existing = byId ?? await rapidScanDb.captureJobs
            .where("idempotencyKey")
            .equals(job.idempotencyKey)
            .first();
          if (!existing) await rapidScanDb.captureJobs.add(job);
        }
        await rapidScanDb.migrationReceipts.add({
          id: receiptId,
          source: "legacy_queue",
          sourceId: job.id,
          createdAt: Date.now(),
        });
      }
      const complete = completionReceiptId("legacy_queue");
      if (!(await rapidScanDb.migrationReceipts.get(complete))) {
        await rapidScanDb.migrationReceipts.add({
          id: complete,
          source: "legacy_queue",
          sourceId: "__complete__",
          createdAt: Date.now(),
        });
      }
    },
  );
}

export async function importInventoryCardsIfAbsent(
  imports: readonly LegacyInventoryCardImport[],
  options: { importMissing?: boolean } = {},
): Promise<void> {
  const importMissing = options.importMissing ?? true;
  await rapidScanDb.transaction(
    "rw",
    rapidScanDb.inventoryCards,
    rapidScanDb.migrationReceipts,
    async () => {
      for (const { sourceId, card } of imports) {
        const receiptId = recordReceiptId("legacy_cards", sourceId);
        if (await rapidScanDb.migrationReceipts.get(receiptId)) continue;
        if (importMissing) {
          const byId = await rapidScanDb.inventoryCards.get(card.id);
          const existing = byId ?? await rapidScanDb.inventoryCards
            .where("fingerprint")
            .equals(card.fingerprint)
            .first();
          if (!existing) await rapidScanDb.inventoryCards.add(card);
        }
        await rapidScanDb.migrationReceipts.add({
          id: receiptId,
          source: "legacy_cards",
          sourceId,
          createdAt: Date.now(),
        });
      }
      const complete = completionReceiptId("legacy_cards");
      if (!(await rapidScanDb.migrationReceipts.get(complete))) {
        await rapidScanDb.migrationReceipts.add({
          id: complete,
          source: "legacy_cards",
          sourceId: "__complete__",
          createdAt: Date.now(),
        });
      }
    },
  );
}

export async function claimNextCapture(
  processingLeaseMs = PROCESSING_LEASE_MS,
): Promise<CaptureJob | null> {
  return rapidScanDb.transaction("rw", rapidScanDb.captureJobs, async () => {
    const captured = await rapidScanDb.captureJobs
      .where("[status+createdAt]")
      .between(["captured", Dexie.minKey], ["captured", Dexie.maxKey])
      .first();
    let next = captured;
    if (!next) {
      const cutoff = Date.now() - processingLeaseMs;
      next = await rapidScanDb.captureJobs
        .where("[status+createdAt]")
        .between(["processing_ocr", Dexie.minKey], ["processing_ocr", Dexie.maxKey])
        .filter((job) => (job.processingStartedAt ?? job.createdAt) < cutoff)
        .first();
    }
    if (!next) return null;
    const now = Date.now();
    const claimed: CaptureJob = {
      ...next,
      status: "processing_ocr",
      processingStartedAt: now,
      updatedAt: now,
      error: undefined,
    };
    await rapidScanDb.captureJobs.put(claimed);
    return claimed;
  });
}

export async function transitionCapture(
  id: string,
  status: CaptureJobStatus,
  patch: Partial<Omit<CaptureJob, "id" | "status">> = {},
): Promise<CaptureJob> {
  return rapidScanDb.transaction("rw", rapidScanDb.captureJobs, async () => {
    const current = await rapidScanDb.captureJobs.get(id);
    if (!current) throw new Error(`Capture job not found: ${id}`);
    if (!canTransitionCaptureJob(current.status, status)) {
      throw new Error(`Invalid capture transition: ${current.status} -> ${status}`);
    }
    const next = { ...current, ...patch, id, status, updatedAt: Date.now() };
    await rapidScanDb.captureJobs.put(next);
    return next;
  });
}

export async function retryCapture(id: string): Promise<CaptureJob> {
  return rapidScanDb.transaction("rw", rapidScanDb.captureJobs, async () => {
    const current = await rapidScanDb.captureJobs.get(id);
    if (!current) throw new Error(`Capture job not found: ${id}`);
    if (!canTransitionCaptureJob(current.status, "captured")) {
      throw new Error(`Capture job cannot be retried from ${current.status}`);
    }
    const next: CaptureJob = {
      ...current,
      status: "captured",
      processingStartedAt: undefined,
      retryCount: current.retryCount + 1,
      error: undefined,
      updatedAt: Date.now(),
    };
    await rapidScanDb.captureJobs.put(next);
    return next;
  });
}

export async function listCaptureMeta(limit = 500): Promise<CaptureJobMeta[]> {
  const jobs = await rapidScanDb.captureJobs.orderBy("createdAt").reverse().limit(limit).toArray();
  return jobs.map(({ originalBlob: _original, libraryBlob: _library, ocrBlob: _ocr, ...meta }) => meta);
}

export async function countCaptureStates(): Promise<CaptureStateCounts> {
  const counts: CaptureStateCounts = {
    captured: 0,
    processing_ocr: 0,
    identified: 0,
    saved: 0,
    needs_review: 0,
    identification_error: 0,
  };
  await rapidScanDb.captureJobs.each((job) => { counts[job.status] += 1; });
  return counts;
}
