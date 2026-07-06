// OPFS-backed image store with IndexedDB fallback.
// Never uploads. Never blocks. Called from the scanner critical path.

import { db, newId, now, type ImageMetadataRecord } from "./db";

const OPFS_DIR = "cleancards-images";

async function opfsRoot(): Promise<FileSystemDirectoryHandle | null> {
  try {
    // @ts-expect-error - storage.getDirectory is available in modern browsers
    const root: FileSystemDirectoryHandle = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle(OPFS_DIR, { create: true });
  } catch {
    return null;
  }
}

async function opfsWrite(id: string, blob: Blob): Promise<boolean> {
  const dir = await opfsRoot();
  if (!dir) return false;
  try {
    const handle = await dir.getFileHandle(id, { create: true });
    // @ts-expect-error - createWritable is standard on FileSystemFileHandle
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return true;
  } catch {
    return false;
  }
}

async function opfsRead(id: string): Promise<Blob | null> {
  const dir = await opfsRoot();
  if (!dir) return null;
  try {
    const handle = await dir.getFileHandle(id);
    const file = await handle.getFile();
    return file;
  } catch {
    return null;
  }
}

async function opfsDelete(id: string): Promise<void> {
  const dir = await opfsRoot();
  if (!dir) return;
  try {
    await dir.removeEntry(id);
  } catch {
    /* ignore */
  }
}

export interface PutImageOptions {
  kind?: ImageMetadataRecord["kind"];
  parentId?: string;
  makeThumbnail?: boolean;
  thumbMaxSize?: number;
}

export interface PutImageResult {
  imageId: string;
  thumbId?: string;
}

async function buildThumbnail(blob: Blob, maxSize: number): Promise<Blob | null> {
  try {
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxSize / Math.max(bitmap.width, bitmap.height));
    const w = Math.round(bitmap.width * scale);
    const h = Math.round(bitmap.height * scale);
    const canvas =
      typeof OffscreenCanvas !== "undefined"
        ? new OffscreenCanvas(w, h)
        : Object.assign(document.createElement("canvas"), { width: w, height: h });
    const ctx = (canvas as HTMLCanvasElement | OffscreenCanvas).getContext("2d");
    if (!ctx) return null;
    (ctx as CanvasRenderingContext2D).drawImage(bitmap, 0, 0, w, h);
    if ("convertToBlob" in canvas) {
      return await (canvas as OffscreenCanvas).convertToBlob({
        type: "image/webp",
        quality: 0.8,
      });
    }
    return await new Promise<Blob | null>((resolve) =>
      (canvas as HTMLCanvasElement).toBlob((b) => resolve(b), "image/webp", 0.8),
    );
  } catch {
    return null;
  }
}

async function persistBlob(
  blob: Blob,
  kind: ImageMetadataRecord["kind"],
  parentId?: string,
): Promise<string> {
  const id = newId("img");
  const wroteToOpfs = await opfsWrite(id, blob);
  const meta: ImageMetadataRecord = {
    id,
    kind,
    mime: blob.type || "application/octet-stream",
    bytes: blob.size,
    storage: wroteToOpfs ? "opfs" : "idb",
    parentId,
    createdAt: now(),
    blob: wroteToOpfs ? undefined : blob,
  };
  await db.imageMetadata.put(meta);
  return id;
}

export async function putImage(
  blob: Blob,
  options: PutImageOptions = {},
): Promise<PutImageResult> {
  const kind = options.kind ?? "scan";
  const imageId = await persistBlob(blob, kind);
  let thumbId: string | undefined;
  if (options.makeThumbnail !== false) {
    const thumb = await buildThumbnail(blob, options.thumbMaxSize ?? 320);
    if (thumb) {
      thumbId = await persistBlob(thumb, "thumbnail", imageId);
    }
  }
  return { imageId, thumbId };
}

export async function getImageBlob(id: string): Promise<Blob | null> {
  const meta = await db.imageMetadata.get(id);
  if (!meta) return null;
  if (meta.storage === "idb") return meta.blob ?? null;
  return opfsRead(id);
}

const urlCache = new Map<string, string>();

export async function getImageURL(id: string): Promise<string | null> {
  const cached = urlCache.get(id);
  if (cached) return cached;
  const blob = await getImageBlob(id);
  if (!blob) return null;
  const url = URL.createObjectURL(blob);
  urlCache.set(id, url);
  return url;
}

export function releaseImageURL(id: string): void {
  const url = urlCache.get(id);
  if (url) {
    URL.revokeObjectURL(url);
    urlCache.delete(id);
  }
}

export async function deleteImage(id: string): Promise<void> {
  const meta = await db.imageMetadata.get(id);
  releaseImageURL(id);
  if (!meta) return;
  if (meta.storage === "opfs") await opfsDelete(id);
  await db.imageMetadata.delete(id);
  // cascade thumbnails
  const children = await db.imageMetadata.where("parentId").equals(id).toArray();
  for (const child of children) await deleteImage(child.id);
}

export async function estimateStorage(): Promise<{
  usage: number;
  quota: number;
  images: number;
} | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    const images = await db.imageMetadata.count();
    return {
      usage: est?.usage ?? 0,
      quota: est?.quota ?? 0,
      images,
    };
  } catch {
    return null;
  }
}
