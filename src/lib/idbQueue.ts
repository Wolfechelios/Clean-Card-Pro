// src/lib/idbQueue.ts
// IndexedDB-backed queue used by Rapid Scan.
// Design goal: NEVER load all blobs into memory (that is how mobile Safari dies).

export type QueueItemStatus = "queued" | "processing" | "done" | "error";

export type QueueItemMeta = {
  id: string;
  createdAt: number;
  status: QueueItemStatus;
  mime: string;
  filename: string;
  error?: string;
};

export type QueueItemWithBlob = QueueItemMeta & { blob: Blob };

const DB_NAME = "card_scout_queue";
const DB_VERSION = 2;

const STORE_META = "queue_meta";
const STORE_BLOBS = "queue_blobs";

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);

    req.onupgradeneeded = () => {
      const db = req.result;

      // Meta store: small objects only
      if (!db.objectStoreNames.contains(STORE_META)) {
        const meta = db.createObjectStore(STORE_META, { keyPath: "id" });
        meta.createIndex("by_status", "status", { unique: false });
        meta.createIndex("by_createdAt", "createdAt", { unique: false });
      } else {
        const meta = req.transaction?.objectStore(STORE_META);
        if (meta && !meta.indexNames.contains("by_status")) {
          meta.createIndex("by_status", "status", { unique: false });
        }
        if (meta && !meta.indexNames.contains("by_createdAt")) {
          meta.createIndex("by_createdAt", "createdAt", { unique: false });
        }
      }

      // Blob store: large binary objects only
      if (!db.objectStoreNames.contains(STORE_BLOBS)) {
        db.createObjectStore(STORE_BLOBS, { keyPath: "id" });
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function txDone(tx: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function idbAdd(item: QueueItemWithBlob) {
  const db = await openDB();
  const tx = db.transaction([STORE_META, STORE_BLOBS], "readwrite");
  tx.objectStore(STORE_META).put({
    id: item.id,
    createdAt: item.createdAt,
    status: item.status,
    mime: item.mime,
    filename: item.filename,
    error: item.error,
  } satisfies QueueItemMeta);
  tx.objectStore(STORE_BLOBS).put({ id: item.id, blob: item.blob });
  await txDone(tx);
  db.close();
}

export async function idbUpdateMeta(id: string, patch: Partial<QueueItemMeta>) {
  const db = await openDB();
  const tx = db.transaction([STORE_META], "readwrite");
  const store = tx.objectStore(STORE_META);
  const existing = await new Promise<QueueItemMeta | undefined>((resolve, reject) => {
    const r = store.get(id);
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });

  if (existing) {
    store.put({ ...existing, ...patch, id } as QueueItemMeta);
  }

  await txDone(tx);
  db.close();
}

export async function idbDelete(id: string) {
  const db = await openDB();
  const tx = db.transaction([STORE_META, STORE_BLOBS], "readwrite");
  tx.objectStore(STORE_META).delete(id);
  tx.objectStore(STORE_BLOBS).delete(id);
  await txDone(tx);
  db.close();
}

export async function idbClear() {
  const db = await openDB();
  const tx = db.transaction([STORE_META, STORE_BLOBS], "readwrite");
  tx.objectStore(STORE_META).clear();
  tx.objectStore(STORE_BLOBS).clear();
  await txDone(tx);
  db.close();
}

export async function idbCount() {
  const db = await openDB();
  const tx = db.transaction([STORE_META], "readonly");
  const store = tx.objectStore(STORE_META);
  const count = await new Promise<number>((resolve, reject) => {
    const r = store.count();
    r.onsuccess = () => resolve(r.result || 0);
    r.onerror = () => reject(r.error);
  });
  db.close();
  return count;
}

// Meta only (no blobs): safe to call frequently for UI.
export async function idbGetAllMeta(): Promise<QueueItemMeta[]> {
  const db = await openDB();
  const tx = db.transaction([STORE_META], "readonly");
  const store = tx.objectStore(STORE_META);
  const all = await new Promise<QueueItemMeta[]>((resolve, reject) => {
    const r = store.getAll();
    r.onsuccess = () => resolve((r.result as QueueItemMeta[]) ?? []);
    r.onerror = () => reject(r.error);
  });
  db.close();
  return all;
}

// Fetch ONE next queued item (meta + blob) without dragging the whole queue into RAM.
export async function idbTakeNextQueued(): Promise<QueueItemWithBlob | null> {
  const db = await openDB();
  const tx = db.transaction([STORE_META, STORE_BLOBS], "readwrite");
  const metaStore = tx.objectStore(STORE_META);
  const statusIdx = metaStore.index("by_status");

  const meta = await new Promise<QueueItemMeta | null>((resolve, reject) => {
    const r = statusIdx.openCursor(IDBKeyRange.only("queued"));
    r.onsuccess = () => {
      const cursor = r.result;
      resolve(cursor ? (cursor.value as QueueItemMeta) : null);
    };
    r.onerror = () => reject(r.error);
  });

  if (!meta) {
    await txDone(tx);
    db.close();
    return null;
  }

  // mark processing immediately so multiple tabs don't double-pick
  metaStore.put({ ...meta, status: "processing" } satisfies QueueItemMeta);

  const blobRec = await new Promise<{ id: string; blob: Blob } | undefined>((resolve, reject) => {
    const r = tx.objectStore(STORE_BLOBS).get(meta.id);
    r.onsuccess = () => resolve(r.result as any);
    r.onerror = () => reject(r.error);
  });

  await txDone(tx);
  db.close();

  if (!blobRec?.blob) {
    // corruption or partial write
    await idbUpdateMeta(meta.id, { status: "error", error: "Missing blob" });
    return null;
  }

  return { ...meta, status: "processing", blob: blobRec.blob };
}
