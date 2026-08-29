// Local-first comic book collection storage (Dexie + OPFS covers).

import { db, newId, now, type ComicRecord } from "@/lib/local/db";
import { deleteImage, putImage } from "@/lib/local/images";

export type ComicInput = Omit<
  ComicRecord,
  "id" | "titleKey" | "createdAt" | "updatedAt" | "currency" | "quantity"
> & {
  currency?: string;
  quantity?: number;
};

export function comicTitleKey(title: string): string {
  return title.trim().toLowerCase().replace(/\s+/g, " ");
}

export function comicValue(comic: ComicRecord): number {
  const unit = comic.valueGraded ?? comic.valueRaw ?? 0;
  return unit * (comic.quantity || 1);
}

export async function listComics(): Promise<ComicRecord[]> {
  const all = await db.comics.orderBy("updatedAt").reverse().toArray();
  return all;
}

export async function getComic(id: string): Promise<ComicRecord | undefined> {
  return db.comics.get(id);
}

export async function saveComic(input: ComicInput): Promise<ComicRecord> {
  const timestamp = now();
  const record: ComicRecord = {
    ...input,
    id: newId("comic"),
    titleKey: comicTitleKey(input.title),
    currency: input.currency ?? "USD",
    quantity: input.quantity && input.quantity > 0 ? input.quantity : 1,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  await db.comics.put(record);
  return record;
}

export async function updateComic(
  id: string,
  patch: Partial<ComicInput>,
): Promise<ComicRecord | undefined> {
  const existing = await db.comics.get(id);
  if (!existing) return undefined;
  const next: ComicRecord = {
    ...existing,
    ...patch,
    titleKey: patch.title ? comicTitleKey(patch.title) : existing.titleKey,
    updatedAt: now(),
  };
  await db.comics.put(next);
  return next;
}

export async function deleteComic(id: string): Promise<void> {
  const existing = await db.comics.get(id);
  if (existing?.imageId) await deleteImage(existing.imageId);
  await db.comics.delete(id);
}

export async function storeComicCover(
  blob: Blob,
): Promise<{ imageId: string; thumbId?: string }> {
  return putImage(blob, { kind: "scan", makeThumbnail: true, thumbMaxSize: 400 });
}

/** Previously entered values for the same issue — the cheapest possible price source. */
export async function findPreviousComicValue(
  title: string,
  issueNumber?: string,
): Promise<ComicRecord | undefined> {
  const key = comicTitleKey(title);
  const matches = await db.comics.where("titleKey").equals(key).toArray();
  const scoped = issueNumber
    ? matches.filter((comic) => comic.issueNumber === issueNumber)
    : matches;
  return scoped
    .filter((comic) => comic.valueRaw != null || comic.valueGraded != null)
    .sort((a, b) => b.updatedAt - a.updatedAt)[0];
}

export async function comicCollectionStats(): Promise<{
  issues: number;
  copies: number;
  value: number;
  publishers: number;
}> {
  const comics = await listComics();
  return {
    issues: comics.length,
    copies: comics.reduce((sum, comic) => sum + (comic.quantity || 1), 0),
    value: comics.reduce((sum, comic) => sum + comicValue(comic), 0),
    publishers: new Set(comics.map((c) => c.publisher).filter(Boolean)).size,
  };
}
