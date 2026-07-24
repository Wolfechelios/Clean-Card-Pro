export type ScanRowState = {
  id: string;
  imageUrl: string;
  status: "queued" | "processing" | "completed" | "error";
  cardName?: string;
  cardSet?: string;
  cardNumber?: string;
  value?: number | null;
  error?: string;
};

export type QueueRowMeta = {
  id: string;
  status: "queued" | "processing" | "success" | "error";
  error?: string;
};

export function reconcileScanRows<T extends ScanRowState>(
  rows: T[],
  queueMeta: QueueRowMeta[],
): T[] {
  if (rows.length === 0 || queueMeta.length === 0) return rows;
  const byId = new Map(queueMeta.map((item) => [item.id, item]));

  return rows.map((row) => {
    const meta = byId.get(row.id);
    if (!meta || row.status === "completed") return row;

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
