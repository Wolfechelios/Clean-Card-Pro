// Local-first IndexedDB via Dexie. Phase 1 foundation for removing the
// backend from the scanner critical path. See .lovable/plan.md.

import Dexie, { type Table } from "dexie";

export interface ScannedCardRecord {
  id: string;
  game: string;
  name: string;
  setCode?: string;
  setName?: string;
  cardNumber?: string;
  rarity?: string;
  condition?: string;
  price?: number;
  currency?: string;
  quantity: number;
  imageId?: string;
  thumbId?: string;
  confidence?: number;
  meta?: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export type ScanQueueStatus = "queued" | "processing" | "complete" | "failed";

export interface ScanQueueItem {
  id: string;
  imageId: string;
  status: ScanQueueStatus;
  attempts: number;
  error?: string;
  resultCardId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ScanHistoryRecord {
  id: string;
  imageId?: string;
  outcome: "identified" | "unidentified" | "rejected" | "duplicate";
  cardId?: string;
  reason?: string;
  createdAt: number;
}

export interface CardCatalogRecord {
  id: string; // synthetic: `${game}:${setCode||setName}:${cardNumber||name}`
  game: string;
  name: string;
  setCode?: string;
  setName?: string;
  cardNumber?: string;
  rarity?: string;
  imageUrl?: string;
  attrs?: Record<string, unknown>;
  updatedAt: number;
}

export interface PriceRecord {
  id: string; // matches CardCatalogRecord.id (+ optional grade suffix)
  cardKey: string;
  grade?: string;
  price: number;
  currency: string;
  source: string;
  fetchedAt: number;
}

export interface ImageMetadataRecord {
  id: string;
  kind: "scan" | "card" | "thumbnail";
  mime: string;
  bytes: number;
  storage: "opfs" | "idb";
  parentId?: string; // scan → thumb linkage
  createdAt: number;
  /** Only populated when storage === "idb" (OPFS unavailable). */
  blob?: Blob;
}

export interface SyncQueueItem {
  id: string;
  kind: string;
  payload: unknown;
  attempts: number;
  createdAt: number;
}

export interface AppSettings {
  key: string;
  value: unknown;
  updatedAt: number;
}

class LocalDatabase extends Dexie {
  scannedCards!: Table<ScannedCardRecord, string>;
  scanQueue!: Table<ScanQueueItem, string>;
  scanHistory!: Table<ScanHistoryRecord, string>;
  cardCatalog!: Table<CardCatalogRecord, string>;
  priceCatalog!: Table<PriceRecord, string>;
  imageMetadata!: Table<ImageMetadataRecord, string>;
  syncQueue!: Table<SyncQueueItem, string>;
  settings!: Table<AppSettings, string>;

  constructor() {
    super("cleancards-local");
    this.version(1).stores({
      scannedCards:
        "id, game, name, setCode, setName, cardNumber, rarity, updatedAt, [game+setCode+cardNumber]",
      scanQueue: "id, status, createdAt",
      scanHistory: "id, outcome, createdAt, cardId",
      cardCatalog:
        "id, game, name, setCode, setName, cardNumber, [game+setCode+cardNumber], [game+name]",
      priceCatalog: "id, cardKey, grade, source, fetchedAt",
      imageMetadata: "id, kind, parentId, createdAt",
      syncQueue: "id, kind, createdAt",
      settings: "key, updatedAt",
    });
  }
}

export const db = new LocalDatabase();

export function newId(prefix = ""): string {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  return prefix ? `${prefix}_${id}` : id;
}

export function now(): number {
  return Date.now();
}
