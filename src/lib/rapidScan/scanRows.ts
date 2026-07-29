import type { CaptureJobStatus } from "./contracts";

export type ReaderScanStatus =
  | CaptureJobStatus
  | "queued"
  | "processing"
  | "completed"
  | "error";

export type ScanRowState = {
  id: string;
  imageUrl: string;
  status: ReaderScanStatus;
  cardName?: string;
  cardSet?: string;
  cardNumber?: string;
  value?: number | null;
  error?: string;
};

export type QueueRowMeta = {
  id: string;
  status: "queued" | "processing" | "success" | "error";
  captureStatus?: CaptureJobStatus;
  error?: string;
};

export function isRetryableScanStatus(status: ReaderScanStatus): boolean {
  return (
    status === "needs_review" ||
    status === "identification_error" ||
    status === "error"
  );
}

export function countReaderCaptureStates(
  queueMeta: readonly QueueRowMeta[],
): Record<CaptureJobStatus, number> {
  const counts: Record<CaptureJobStatus, number> = {
    captured: 0,
    processing_ocr: 0,
    identified: 0,
    saved: 0,
    needs_review: 0,
    identification_error: 0,
  };
  const legacyStatus: Record<QueueRowMeta["status"], CaptureJobStatus> = {
    queued: "captured",
    processing: "processing_ocr",
    success: "saved",
    error: "identification_error",
  };
  for (const item of queueMeta) {
    counts[item.captureStatus ?? legacyStatus[item.status]] += 1;
  }
  return counts;
}

export function reconcileScanRows<T extends ScanRowState>(
  rows: T[],
  queueMeta: QueueRowMeta[],
): T[] {
  if (rows.length === 0 || queueMeta.length === 0) return rows;
  const byId = new Map(queueMeta.map((item) => [item.id, item]));

  return rows.map((row) => {
    const meta = byId.get(row.id);
    if (!meta || row.status === "completed") return row;

    if (meta.captureStatus) {
      return {
        ...row,
        status: meta.captureStatus,
        error:
          meta.captureStatus === "needs_review" ||
          meta.captureStatus === "identification_error"
            ? meta.error || "Scan identification failed"
            : undefined,
      };
    }

    if (meta.status === "error") {
      return { ...row, status: "error", error: meta.error || "Scan processing failed" };
    }

    if (meta.status === "processing") {
      return { ...row, status: "processing", error: undefined };
    }

    if (meta.status === "queued") {
      return { ...row, status: "queued", error: undefined };
    }

    return row;
  });
}

export function mergeRecentScanRows<T extends ScanRowState>(
  current: T[],
  recent: T[],
): T[] {
  const completedIds = new Set(recent.map((row) => row.id));
  return [
    ...recent,
    ...current.filter(
      (row) => row.status !== "completed" && !completedIds.has(row.id),
    ),
  ];
}
