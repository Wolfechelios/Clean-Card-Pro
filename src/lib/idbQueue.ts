// src/lib/idbQueue.ts
// Minimal IndexedDB-backed persistent queue for Rapid Scan jobs.

export type QueueStatus = "queued" | "processing" | "success" | "error"

export type QueueItem = {
  id: string
  createdAt: number
  status: QueueStatus
  error?: string

  // Stored image payload
  blob: Blob
  mime: string
  filename: string
}

export type QueueItemMeta = Omit<QueueItem, "blob">

const DB_NAME = "card_scout_pro"
const DB_VERSION = 1
const STORE = "rapid_scan_queue"

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)

    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: "id" })
        store.createIndex("status_createdAt", ["status", "createdAt"], { unique: false })
        store.createIndex("createdAt", "createdAt", { unique: false })
      }
    }

    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T> | void
): Promise<T | void> {
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode)
    const store = t.objectStore(STORE)

    let request: IDBRequest<T> | undefined
    try {
      const maybeReq = fn(store)
      if (maybeReq) request = maybeReq as IDBRequest<T>
    } catch (e) {
      reject(e)
      return
    }

    t.oncomplete = () => resolve(request ? (request.result as any) : undefined)
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })
}

export async function idbAdd(item: QueueItem): Promise<void> {
  const db = await openDB()
  await tx(db, "readwrite", (store) => store.put(item))
  db.close()
}

export async function idbGet(id: string): Promise<QueueItem | null> {
  const db = await openDB()
  const res = (await tx(db, "readonly", (store) => store.get(id))) as QueueItem | undefined
  db.close()
  return res ?? null
}

export async function idbUpdateMeta(id: string, patch: Partial<QueueItemMeta>): Promise<void> {
  const db = await openDB()
  await tx(db, "readwrite", (store) => {
    const req = store.get(id)
    req.onsuccess = () => {
      const current = req.result as QueueItem | undefined
      if (!current) return
      const next: QueueItem = { ...current, ...patch }
      store.put(next)
    }
  })
  db.close()
}

export async function idbDelete(id: string): Promise<void> {
  const db = await openDB()
  await tx(db, "readwrite", (store) => store.delete(id))
  db.close()
}

export async function idbListMeta(limit = 500): Promise<QueueItemMeta[]> {
  const db = await openDB()
  const items: QueueItemMeta[] = []

  await tx(db, "readonly", (store) => {
    const req = store.openCursor()
    req.onsuccess = () => {
      const cursor = req.result as IDBCursorWithValue | null
      if (!cursor) return
      const v = cursor.value as QueueItem
      const { blob: _blob, ...meta } = v
      items.push(meta)
      if (items.length >= limit) return
      cursor.continue()
    }
    return req as any
  })

  db.close()
  return items.sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * Get the next queued item FIFO (oldest first).
 * Also picks up stuck "processing" items older than 5s (orphaned from crashes/scaling).
 * Returns full item (includes blob).
 */
export async function idbGetNextQueued(): Promise<QueueItem | null> {
  const db = await openDB()
  const STUCK_THRESHOLD_MS = 5_000 // 5 seconds - reduced for faster recovery

  const next = await new Promise<QueueItem | null>((resolve, reject) => {
    const t = db.transaction(STORE, "readonly")
    const store = t.objectStore(STORE)
    const idx = store.index("status_createdAt")

    // First try "queued" items (oldest first)
    const queuedRange = IDBKeyRange.bound(["queued", 0], ["queued", Number.MAX_SAFE_INTEGER])
    const queuedReq = idx.openCursor(queuedRange, "next")

    queuedReq.onsuccess = () => {
      const cursor = queuedReq.result as IDBCursorWithValue | null
      if (cursor) {
        resolve(cursor.value as QueueItem)
        return
      }

      // No queued items - check for stuck "processing" items
      const stuckCutoff = Date.now() - STUCK_THRESHOLD_MS
      const processingRange = IDBKeyRange.bound(["processing", 0], ["processing", stuckCutoff])
      const processingReq = idx.openCursor(processingRange, "next")

      processingReq.onsuccess = () => {
        const pCursor = processingReq.result as IDBCursorWithValue | null
        if (pCursor) {
          // Found a stuck item - will be reset to processing by worker
          resolve(pCursor.value as QueueItem)
        } else {
          resolve(null)
        }
      }
      processingReq.onerror = () => reject(processingReq.error)
    }
    queuedReq.onerror = () => reject(queuedReq.error)

    t.oncomplete = () => {}
    t.onerror = () => reject(t.error)
    t.onabort = () => reject(t.error)
  })

  db.close()
  return next
}

/**
 * Count only items that are actually processable (queued or stuck processing)
 */
export async function idbCountQueued(): Promise<number> {
  const db = await openDB()
  const STUCK_THRESHOLD_MS = 5_000
  
  const count = await new Promise<number>((resolve, reject) => {
    const t = db.transaction(STORE, "readonly")
    const store = t.objectStore(STORE)
    const idx = store.index("status_createdAt")
    let total = 0

    // Count "queued" items
    const queuedRange = IDBKeyRange.bound(["queued", 0], ["queued", Number.MAX_SAFE_INTEGER])
    const queuedReq = idx.count(queuedRange)

    queuedReq.onsuccess = () => {
      total += queuedReq.result

      // Count stuck "processing" items
      const stuckCutoff = Date.now() - STUCK_THRESHOLD_MS
      const processingRange = IDBKeyRange.bound(["processing", 0], ["processing", stuckCutoff])
      const processingReq = idx.count(processingRange)

      processingReq.onsuccess = () => {
        total += processingReq.result
        resolve(total)
      }
      processingReq.onerror = () => reject(processingReq.error)
    }
    queuedReq.onerror = () => reject(queuedReq.error)

    t.oncomplete = () => {}
    t.onerror = () => reject(t.error)
  })

  db.close()
  return count
}

export async function idbCount(): Promise<number> {
  const db = await openDB()
  const n = (await tx(db, "readonly", (store) => store.count())) as number
  db.close()
  return n
}

export async function idbGetAll(): Promise<QueueItem[]> {
  const db = await openDB()
  const items: QueueItem[] = []

  await tx(db, "readonly", (store) => {
    const req = store.openCursor()
    req.onsuccess = () => {
      const cursor = req.result as IDBCursorWithValue | null
      if (!cursor) return
      items.push(cursor.value as QueueItem)
      cursor.continue()
    }
    return req as any
  })

  db.close()
  return items.sort((a, b) => b.createdAt - a.createdAt)
}

export async function idbClear(): Promise<void> {
  const db = await openDB()
  await tx(db, "readwrite", (store) => store.clear())
  db.close()
}
