// src/lib/idbQueue.ts
// Minimal IndexedDB-backed persistent queue for Rapid Scan jobs.

export type QueueStatus = "queued" | "processing" | "success" | "error"

export type QueueItem = {
  id: string
  createdAt: number
  processingStartedAt?: number // Track when processing started for stuck detection
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
const PROCESSING_STALE_MS = 60_000

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

    t.oncomplete = () => resolve(request ? (request.result as T) : undefined)
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
      // Track when processing started for stuck detection
      const next: QueueItem = { 
        ...current, 
        ...patch,
        ...(patch.status === "processing" ? { processingStartedAt: Date.now() } : {})
      }
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

export async function idbRetry(id: string): Promise<void> {
  await idbUpdateMeta(id, {
    status: "queued",
    error: undefined,
    processingStartedAt: undefined,
  })
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
  })

  db.close()
  return items.sort((a, b) => b.createdAt - a.createdAt)
}

/**
 * Fast version of idbListMeta that only reads metadata, not blobs.
 * This is much faster for UI updates as it doesn't load large image blobs.
 */
export async function idbListMetaFast(limit = 500): Promise<QueueItemMeta[]> {
  const db = await openDB()
  const items: QueueItemMeta[] = []

  await new Promise<void>((resolve, reject) => {
    const t = db.transaction(STORE, "readonly")
    const store = t.objectStore(STORE)
    const idx = store.index("createdAt")
    
    // Use cursor to iterate but only extract meta fields
    const req = idx.openCursor(null, "prev") // newest first
    
    req.onsuccess = () => {
      const cursor = req.result as IDBCursorWithValue | null
      if (!cursor || items.length >= limit) {
        resolve()
        return
      }
      
      const v = cursor.value as QueueItem
      // Extract only meta fields, skip blob
      items.push({
        id: v.id,
        createdAt: v.createdAt,
        processingStartedAt: v.processingStartedAt,
        status: v.status,
        error: v.error,
        mime: v.mime,
        filename: v.filename,
      })
      cursor.continue()
    }
    req.onerror = () => reject(req.error)
    t.onerror = () => reject(t.error)
  })

  db.close()
  return items
}

/**
 * Get the next queued item FIFO (oldest first).
 * Also picks up stale "processing" items orphaned by crashes or reloads.
 * Returns full item (includes blob).
 */
export async function idbGetNextQueued(): Promise<QueueItem | null> {
  const db = await openDB()

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

      // No queued items - check for stuck "processing" items using processingStartedAt
      const stuckCutoff = Date.now() - PROCESSING_STALE_MS
      // Scan all processing items and check processingStartedAt
      const processingRange = IDBKeyRange.bound(["processing", 0], ["processing", Number.MAX_SAFE_INTEGER])
      const processingReq = idx.openCursor(processingRange, "next")

      processingReq.onsuccess = () => {
        const pCursor = processingReq.result as IDBCursorWithValue | null
        if (pCursor) {
          const item = pCursor.value as QueueItem
          // Check if stuck based on processingStartedAt (or createdAt as fallback)
          const startedAt = item.processingStartedAt || item.createdAt
          if (startedAt < stuckCutoff) {
            resolve(item)
          } else {
            // Not stuck yet, check next
            pCursor.continue()
          }
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
 * Atomically select and mark the next queue item as processing.
 * A read-only selection followed by a separate update lets parallel workers
 * select the same card, so claiming must happen inside one read/write transaction.
 */
export async function idbClaimNextQueued(): Promise<QueueItem | null> {
  const db = await openDB()
  const stuckCutoff = Date.now() - PROCESSING_STALE_MS
  let claimed: QueueItem | null = null

  await new Promise<void>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readwrite")
    const store = transaction.objectStore(STORE)
    const index = store.index("status_createdAt")

    const claimCursor = (cursor: IDBCursorWithValue): void => {
      const current = cursor.value as QueueItem
      claimed = {
        ...current,
        status: "processing",
        processingStartedAt: Date.now(),
        error: undefined,
      }
      cursor.update(claimed)
    }

    const queuedRange = IDBKeyRange.bound(
      ["queued", 0],
      ["queued", Number.MAX_SAFE_INTEGER],
    )
    const queuedRequest = index.openCursor(queuedRange, "next")

    queuedRequest.onsuccess = () => {
      const cursor = queuedRequest.result as IDBCursorWithValue | null
      if (cursor) {
        claimCursor(cursor)
        return
      }

      const processingRange = IDBKeyRange.bound(
        ["processing", 0],
        ["processing", Number.MAX_SAFE_INTEGER],
      )
      const processingRequest = index.openCursor(processingRange, "next")
      processingRequest.onsuccess = () => {
        const processingCursor = processingRequest.result as IDBCursorWithValue | null
        if (!processingCursor) return

        const item = processingCursor.value as QueueItem
        const startedAt = item.processingStartedAt || item.createdAt
        if (startedAt < stuckCutoff) {
          claimCursor(processingCursor)
          return
        }
        processingCursor.continue()
      }
      processingRequest.onerror = () => reject(processingRequest.error)
    }

    queuedRequest.onerror = () => reject(queuedRequest.error)
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })

  db.close()
  return claimed
}

/**
 * Count only items that are actually processable (queued or stuck processing)
 */
export async function idbCountQueued(): Promise<number> {
  const db = await openDB()
  const stuckCutoff = Date.now() - PROCESSING_STALE_MS
  
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

      // Count stuck "processing" items by scanning and checking processingStartedAt
      const processingRange = IDBKeyRange.bound(["processing", 0], ["processing", Number.MAX_SAFE_INTEGER])
      const processingReq = idx.openCursor(processingRange)
      let stuckCount = 0

      processingReq.onsuccess = () => {
        const cursor = processingReq.result as IDBCursorWithValue | null
        if (cursor) {
          const item = cursor.value as QueueItem
          const startedAt = item.processingStartedAt || item.createdAt
          if (startedAt < stuckCutoff) {
            stuckCount++
          }
          cursor.continue()
        } else {
          total += stuckCount
          resolve(total)
        }
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

export async function idbCountPending(): Promise<number> {
  const db = await openDB()

  const count = await new Promise<number>((resolve, reject) => {
    const transaction = db.transaction(STORE, "readonly")
    const index = transaction.objectStore(STORE).index("status_createdAt")
    const queuedRange = IDBKeyRange.bound(
      ["queued", 0],
      ["queued", Number.MAX_SAFE_INTEGER],
    )
    const processingRange = IDBKeyRange.bound(
      ["processing", 0],
      ["processing", Number.MAX_SAFE_INTEGER],
    )
    let queued = 0
    let processing = 0

    const queuedRequest = index.count(queuedRange)
    queuedRequest.onsuccess = () => {
      queued = queuedRequest.result
      const processingRequest = index.count(processingRange)
      processingRequest.onsuccess = () => {
        processing = processingRequest.result
      }
      processingRequest.onerror = () => reject(processingRequest.error)
    }
    queuedRequest.onerror = () => reject(queuedRequest.error)
    transaction.oncomplete = () => resolve(queued + processing)
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
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
  })

  db.close()
  return items.sort((a, b) => b.createdAt - a.createdAt)
}

export async function idbClear(): Promise<void> {
  const db = await openDB()
  await tx(db, "readwrite", (store) => store.clear())
  db.close()
}
