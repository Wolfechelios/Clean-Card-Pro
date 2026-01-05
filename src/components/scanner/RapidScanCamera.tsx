"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { createClient } from "@supabase/supabase-js"
import { withRetry } from "@/lib/retry"
import {
  idbAdd,
  idbCount,
  idbDelete,
  idbGetNextQueued,
  idbListMeta,
  idbUpdateMeta,
  type QueueItemMeta,
} from "@/lib/idbQueue"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

/**
 * PERSISTENT COLLX-LIKE RAPID SCAN
 * - Queue is stored in IndexedDB (survives refresh/crash)
 * - Capture is decoupled from processing
 * - Controlled worker concurrency, retries, and rate-limit pause
 */

// Tuning knobs
const CONCURRENT_WORKERS = 2
const QUEUE_MAX = 120 // bigger because it's on disk now

// How to behave when queue is full:
const DROP_POLICY: "drop-oldest-success-first" | "reject-new" = "drop-oldest-success-first"

const BASE_BETWEEN_JOBS_MS = 250
const RATE_LIMIT_PAUSE_MS = 6000

export default function RapidScanCamera() {
  const [meta, setMeta] = useState<QueueItemMeta[]>([])
  const [pausedUntil, setPausedUntil] = useState<number>(0)
  const [loading, setLoading] = useState(true)

  const activeWorkers = useRef(0)
  const stopRef = useRef(false)

  const now = Date.now()
  const isPaused = pausedUntil > now

  const counts = useMemo(() => {
    const queued = meta.filter((j) => j.status === "queued").length
    const processing = meta.filter((j) => j.status === "processing").length
    const success = meta.filter((j) => j.status === "success").length
    const error = meta.filter((j) => j.status === "error").length
    return { queued, processing, success, error, total: meta.length }
  }, [meta])

  useEffect(() => {
    stopRef.current = false
    ;(async () => {
      setLoading(true)
      await refreshMeta()
      setLoading(false)
      ensureWorkersRunning()
    })()

    return () => {
      stopRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (loading) return
    ensureWorkersRunning()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, pausedUntil, loading])

  async function refreshMeta() {
    const list = await idbListMeta(500)
    setMeta(list)
  }

  function ensureWorkersRunning() {
    if (stopRef.current) return
    if (isPaused) return

    while (activeWorkers.current < CONCURRENT_WORKERS) {
      activeWorkers.current++
      workerLoop().finally(() => {
        activeWorkers.current--
      })
    }
  }

  async function workerLoop() {
    while (!stopRef.current) {
      const pauseMs = pausedUntil - Date.now()
      if (pauseMs > 0) {
        await sleep(Math.min(pauseMs, 1000))
        continue
      }

      const next = await idbGetNextQueued()
      if (!next) {
        await sleep(250)
        continue
      }

      await idbUpdateMeta(next.id, { status: "processing", error: undefined })
      await refreshMeta()

      try {
        await processOne(next.id)
        // Success: delete to keep DB clean (CollX-like)
        await idbDelete(next.id)
      } catch (err: any) {
        const msg = String(err?.message ?? err)
        await idbUpdateMeta(next.id, { status: "error", error: msg })

        if (/429|rate limit|too many/i.test(msg)) {
          setPausedUntil(Date.now() + RATE_LIMIT_PAUSE_MS)
        }
      }

      await refreshMeta()
      await sleep(BASE_BETWEEN_JOBS_MS)
    }
  }

  async function processOne(id: string) {
    const item = await importItem(id)
    if (!item) throw new Error("Queue item missing (maybe deleted)")

    const filePath = `cards/${item.id}.jpg`
    const file = new File([item.blob], item.filename, { type: item.mime })

    // Upload (retry transient)
    await withRetry(async () => {
      const res = await supabase.storage.from("card-images").upload(filePath, file, { upsert: false })
      if (res.error) throw new Error(res.error.message)
      return res.data
    })

    // Signed URL
    const imageUrl = await withRetry(async () => {
      const res = await supabase.storage.from("card-images").createSignedUrl(filePath, 60 * 60 * 24)
      if (res.error) throw new Error(res.error.message)
      if (!res.data?.signedUrl) throw new Error("Signed URL missing")
      return res.data.signedUrl
    })

    // Identify
    await withRetry(
      async () => {
        const res = await supabase.functions.invoke("rapid-card-identify", { body: { imageUrl } })
        if (res.error) throw new Error(res.error.message)
        return res.data
      },
      {
        retries: 5,
        baseMs: 900,
        maxMs: 12000,
        shouldRetry: (e) =>
          /429|rate limit|too many|timeout|network|502|503|504/i.test(String(e?.message ?? e)),
      }
    )
  }

  async function importItem(id: string) {
    // dynamic import avoids bundler whining if types shift
    const mod = await import("@/lib/idbQueue")
    return mod.idbGet(id)
  }

  async function enqueueFiles(files: FileList | null) {
    if (!files || files.length === 0) return

    // If queue full, enforce policy BEFORE adding
    const currentCount = await idbCount()
    const incomingCount = files.length
    const projected = currentCount + incomingCount

    if (projected > QUEUE_MAX) {
      if (DROP_POLICY === "reject-new") {
        // Just ignore new files if full
        return
      }

      // Drop oldest SUCCESS first (already processed), then oldest ERROR, then oldest QUEUED (last resort)
      // We'll drop from IDB by reading meta and deleting.
      const list = await idbListMeta(1000)
      let overflow = projected - QUEUE_MAX

      const dropOrder = [
        (m: QueueItemMeta) => m.status === "success",
        (m: QueueItemMeta) => m.status === "error",
        (m: QueueItemMeta) => m.status === "queued",
      ]

      for (const pred of dropOrder) {
        for (const m of list.slice().sort((a, b) => a.createdAt - b.createdAt)) {
          if (overflow <= 0) break
          if (pred(m)) {
            await idbDelete(m.id)
            overflow--
          }
        }
        if (overflow <= 0) break
      }
    }

    // Add incoming to IDB (persistent)
    for (const f of Array.from(files)) {
      const id = crypto.randomUUID()
      const blob = f.slice(0, f.size, f.type) // ensure real Blob
      await idbAdd({
        id,
        createdAt: Date.now(),
        status: "queued",
        blob,
        mime: f.type || "image/jpeg",
        filename: f.name || `${id}.jpg`,
      })
    }

    await refreshMeta()
    ensureWorkersRunning()
  }

  async function clearAll() {
    // Nuke everything by listing + deleting (simple + reliable)
    const list = await idbListMeta(2000)
    for (const m of list) await idbDelete(m.id)
    await refreshMeta()
  }

  async function clearErrors() {
    const list = await idbListMeta(2000)
    for (const m of list) {
      if (m.status === "error") await idbDelete(m.id)
    }
    await refreshMeta()
  }

  async function retryErrors() {
    const list = await idbListMeta(2000)
    for (const m of list) {
      if (m.status === "error") await idbUpdateMeta(m.id, { status: "queued", error: undefined })
    }
    await refreshMeta()
    ensureWorkersRunning()
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => enqueueFiles(e.target.files)}
        />

        <button
          className="px-3 py-1 rounded bg-slate-700 text-white"
          onClick={retryErrors}
          type="button"
        >
          Retry Errors
        </button>

        <button
          className="px-3 py-1 rounded bg-slate-700 text-white"
          onClick={clearErrors}
          type="button"
        >
          Clear Errors
        </button>

        <button
          className="px-3 py-1 rounded bg-slate-900 text-white"
          onClick={clearAll}
          type="button"
        >
          Clear All
        </button>
      </div>

      <div className="text-sm text-slate-200">
        {loading ? (
          <div>Loading queue…</div>
        ) : (
          <>
            <div>Persistent Buffer: {counts.total}/{QUEUE_MAX}</div>
            <div>
              Queued: {counts.queued} • Processing: {counts.processing} • Error: {counts.error}
            </div>
            {isPaused && (
              <div className="text-yellow-300 font-semibold">
                Rate limit hit — pausing for a moment…
              </div>
            )}
          </>
        )}
      </div>

      <ul className="space-y-2 text-sm">
        {meta.map((j) => (
          <li key={j.id} className="border border-slate-700 rounded p-2">
            <div className="flex items-center justify-between">
              <span className="font-mono">{j.id.slice(0, 8)}</span>
              <span className="uppercase">{j.status}</span>
            </div>
            {j.error && <div className="text-red-400 mt-1">{j.error}</div>}
          </li>
        ))}
      </ul>
    </div>
  )
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
