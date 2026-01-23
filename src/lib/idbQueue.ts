export type QueueItemMeta = {
  id: string;
  createdAt: number;
  status: "queued" | "processing" | "done" | "error";
  error?: string;
  mime?: string;
  filename?: string;
};

type QueueItem = QueueItemMeta & {
  blob: Blob;
};

const DB_NAME = "cleancards-rapid-queue";
const STORE = "items";
const DB_VERSION = 1;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => Promise<T>): Promise<T> {
  const db = await openDb();
  const t = db.transaction(STORE, mode);
  const store = t.objectStore(STORE);
  const out = await fn(store);
  await new Promise<void>((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
  db.close();
  return out;
}

export async function idbAdd(item: QueueItem): Promise<void> {
  await tx("readwrite", async (store) => {
    await new Promise<void>((resolve, reject) => {
      const req = store.put(item);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    return;
  });
}

export async function idbCount(): Promise<number> {
  return tx("readonly", async (store) =>
    new Promise<number>((resolve, reject) => {
      const req = store.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    })
  );
}

export async function idbGetAllMeta(): Promise<QueueItemMeta[]> {
  return tx("readonly", async (store) =>
    new Promise<QueueItemMeta[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => {
        const all = (req.result as QueueItem[]).map(({ blob, ...meta }) => meta);
        all.sort((a, b) => b.createdAt - a.createdAt);
        resolve(all);
      };
      req.onerror = () => reject(req.error);
    })
  );
}

export async function idbDelete(id: string): Promise<void> {
  await tx("readwrite", async (store) => {
    await new Promise<void>((resolve, reject) => {
      const req = store.delete(id);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    return;
  });
}

export async function idbClear(): Promise<void> {
  await tx("readwrite", async (store) => {
    await new Promise<void>((resolve, reject) => {
      const req = store.clear();
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
    return;
  });
}

export async function idbUpdateMeta(id: string, patch: Partial<QueueItemMeta>): Promise<void> {
  await tx("readwrite", async (store) => {
    const current = await new Promise<QueueItem | undefined>((resolve, reject) => {
      const req = store.get(id);
      req.onsuccess = () => resolve(req.result as QueueItem | undefined);
      req.onerror = () => reject(req.error);
    });
    if (!current) return;
    const next = { ...current, ...patch } as QueueItem;
    await new Promise<void>((resolve, reject) => {
      const req = store.put(next);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  });
}

export async function idbTakeNextQueued(): Promise<{ id: string; blob: Blob } | null> {
  return tx("readwrite", async (store) => {
    const all = await new Promise<QueueItem[]>((resolve, reject) => {
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result as QueueItem[]);
      req.onerror = () => reject(req.error);
    });
    const next = all
      .filter((x) => x.status === "queued")
      .sort((a, b) => a.createdAt - b.createdAt)[0];
    if (!next) return null;
    await idbUpdateMeta(next.id, { status: "processing" });
    return { id: next.id, blob: next.blob };
  });
}
