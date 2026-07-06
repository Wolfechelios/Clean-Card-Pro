// Thin repository layer over the local Dexie DB. Components must talk to
// these repos, never to `db` directly, so the storage layer can evolve
// without touching the UI.

import {
  db,
  newId,
  now,
  type CardCatalogRecord,
  type PriceRecord,
  type ScanHistoryRecord,
  type ScanQueueItem,
  type ScanQueueStatus,
  type ScannedCardRecord,
} from "../db";

// ---------- Scanned cards (user's collection) ----------

export const cardsRepo = {
  async list(filter?: { game?: string }): Promise<ScannedCardRecord[]> {
    const coll = filter?.game
      ? db.scannedCards.where("game").equals(filter.game)
      : db.scannedCards.toCollection();
    return coll.reverse().sortBy("updatedAt");
  },
  get(id: string) {
    return db.scannedCards.get(id);
  },
  async save(
    input: Omit<ScannedCardRecord, "id" | "createdAt" | "updatedAt"> & {
      id?: string;
    },
  ): Promise<ScannedCardRecord> {
    const t = now();
    const existing = input.id ? await db.scannedCards.get(input.id) : undefined;
    const record: ScannedCardRecord = {
      ...input,
      id: input.id ?? newId("card"),
      quantity: input.quantity ?? 1,
      createdAt: existing?.createdAt ?? t,
      updatedAt: t,
    };
    await db.scannedCards.put(record);
    return record;
  },
  async update(id: string, patch: Partial<ScannedCardRecord>): Promise<void> {
    await db.scannedCards.update(id, { ...patch, updatedAt: now() });
  },
  async remove(id: string): Promise<void> {
    await db.scannedCards.delete(id);
  },
  async count(): Promise<number> {
    return db.scannedCards.count();
  },
};

// ---------- Scan queue ----------

export const queueRepo = {
  async enqueue(input: { imageId: string }): Promise<ScanQueueItem> {
    const t = now();
    const item: ScanQueueItem = {
      id: newId("q"),
      imageId: input.imageId,
      status: "queued",
      attempts: 0,
      createdAt: t,
      updatedAt: t,
    };
    await db.scanQueue.put(item);
    return item;
  },
  pending(): Promise<ScanQueueItem[]> {
    return db.scanQueue
      .where("status")
      .anyOf(["queued", "processing"])
      .sortBy("createdAt");
  },
  async setStatus(
    id: string,
    status: ScanQueueStatus,
    patch: Partial<ScanQueueItem> = {},
  ): Promise<void> {
    await db.scanQueue.update(id, { ...patch, status, updatedAt: now() });
  },
  async remove(id: string): Promise<void> {
    await db.scanQueue.delete(id);
  },
};

// ---------- Scan history ----------

export const historyRepo = {
  async log(
    entry: Omit<ScanHistoryRecord, "id" | "createdAt">,
  ): Promise<ScanHistoryRecord> {
    const rec: ScanHistoryRecord = {
      ...entry,
      id: newId("h"),
      createdAt: now(),
    };
    await db.scanHistory.put(rec);
    return rec;
  },
  recent(limit = 100): Promise<ScanHistoryRecord[]> {
    return db.scanHistory.orderBy("createdAt").reverse().limit(limit).toArray();
  },
  async clear(): Promise<void> {
    await db.scanHistory.clear();
  },
};

// ---------- Card catalog (reference data) ----------

function catalogKey(rec: {
  game: string;
  setCode?: string;
  setName?: string;
  cardNumber?: string;
  name: string;
}): string {
  const set = rec.setCode ?? rec.setName ?? "?";
  const num = rec.cardNumber ?? rec.name;
  return `${rec.game}:${set}:${num}`.toLowerCase();
}

export const catalogRepo = {
  key: catalogKey,
  async upsertMany(records: Omit<CardCatalogRecord, "id" | "updatedAt">[]) {
    const t = now();
    const rows: CardCatalogRecord[] = records.map((r) => ({
      ...r,
      id: catalogKey(r),
      updatedAt: t,
    }));
    await db.cardCatalog.bulkPut(rows);
  },
  /**
   * Exact-first lookup per the plan's match precedence:
   *   (setCode + cardNumber) → (setName + cardNumber) → (name + setCode) → fuzzy name.
   * Returns null when no confident local match exists — the caller decides
   * whether to consult a remote fallback (never on the scan critical path).
   */
  async lookup(input: {
    game: string;
    setCode?: string;
    setName?: string;
    cardNumber?: string;
    name?: string;
  }): Promise<CardCatalogRecord | null> {
    const { game, setCode, setName, cardNumber, name } = input;
    if (setCode && cardNumber) {
      const row = await db.cardCatalog
        .where("[game+setCode+cardNumber]")
        .equals([game, setCode, cardNumber])
        .first();
      if (row) return row;
    }
    if (setName && cardNumber) {
      const row = await db.cardCatalog
        .where({ game, setName, cardNumber })
        .first();
      if (row) return row;
    }
    if (name && setCode) {
      const row = await db.cardCatalog.where({ game, setCode, name }).first();
      if (row) return row;
    }
    if (name) {
      const lower = name.toLowerCase();
      const row = await db.cardCatalog
        .where("[game+name]")
        .equals([game, name])
        .first();
      if (row) return row;
      const scanRow = await db.cardCatalog
        .where("game")
        .equals(game)
        .filter((r) => r.name.toLowerCase() === lower)
        .first();
      if (scanRow) return scanRow;
    }
    return null;
  },
  count() {
    return db.cardCatalog.count();
  },
};

// ---------- Prices ----------

export const priceRepo = {
  async get(cardKey: string, grade?: string): Promise<PriceRecord | null> {
    const id = grade ? `${cardKey}#${grade}` : cardKey;
    return (await db.priceCatalog.get(id)) ?? null;
  },
  async put(rec: Omit<PriceRecord, "id" | "fetchedAt"> & { fetchedAt?: number }) {
    const id = rec.grade ? `${rec.cardKey}#${rec.grade}` : rec.cardKey;
    const record: PriceRecord = {
      ...rec,
      id,
      fetchedAt: rec.fetchedAt ?? now(),
    };
    await db.priceCatalog.put(record);
    return record;
  },
};

// ---------- Settings ----------

export const settingsRepo = {
  async get<T = unknown>(key: string): Promise<T | undefined> {
    const row = await db.settings.get(key);
    return row?.value as T | undefined;
  },
  async set<T = unknown>(key: string, value: T): Promise<void> {
    await db.settings.put({ key, value, updatedAt: now() });
  },
  async all(): Promise<Record<string, unknown>> {
    const rows = await db.settings.toArray();
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  },
};
