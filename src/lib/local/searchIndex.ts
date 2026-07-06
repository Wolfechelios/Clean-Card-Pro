// Fuzzy search index over the local catalog + scanned cards.
// Rebuilt on demand; safe to call repeatedly.

import Fuse, { type IFuseOptions } from "fuse.js";
import { db, type CardCatalogRecord, type ScannedCardRecord } from "./db";

type Row =
  | ({ __kind: "catalog" } & CardCatalogRecord)
  | ({ __kind: "scanned" } & ScannedCardRecord);

const FUSE_OPTIONS: IFuseOptions<Row> = {
  keys: [
    { name: "name", weight: 0.6 },
    { name: "setName", weight: 0.2 },
    { name: "setCode", weight: 0.1 },
    { name: "cardNumber", weight: 0.1 },
  ],
  threshold: 0.34,
  ignoreLocation: true,
  includeScore: true,
};

let fuse: Fuse<Row> | null = null;
let building: Promise<void> | null = null;

async function build(): Promise<void> {
  const [catalog, scanned] = await Promise.all([
    db.cardCatalog.toArray(),
    db.scannedCards.toArray(),
  ]);
  const rows: Row[] = [
    ...catalog.map((r) => ({ ...r, __kind: "catalog" as const })),
    ...scanned.map((r) => ({ ...r, __kind: "scanned" as const })),
  ];
  fuse = new Fuse(rows, FUSE_OPTIONS);
}

export async function ensureSearchIndex(): Promise<void> {
  if (fuse) return;
  if (!building) building = build().finally(() => (building = null));
  await building;
}

export async function rebuildSearchIndex(): Promise<void> {
  fuse = null;
  await ensureSearchIndex();
}

export async function searchLocal(
  query: string,
  limit = 20,
): Promise<Array<{ row: Row; score: number }>> {
  await ensureSearchIndex();
  if (!fuse || !query.trim()) return [];
  return fuse
    .search(query, { limit })
    .map((r) => ({ row: r.item, score: r.score ?? 1 }));
}
