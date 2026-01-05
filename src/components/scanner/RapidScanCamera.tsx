"use client"

import React, { useEffect, useMemo, useRef, useState } from "react"
import { createClient } from "@supabase/supabase-js"
import { withRetry } from "@/lib/retry"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

/**
 * COLLX-LIKE BUFFERED RAPID SCAN
 * - Capture can run fast (producer)
 * - Processing runs at controlled pace (consumer)
 * - Queue buffers jobs so you don't overload APIs
 */

// Tuning knobs
const CONCURRENT_WORKERS = 2              // keep low; increase carefully
const QUEUE_MAX = 60                      // how many photos you can keep "buffered"
const DROP_POLICY: "drop-oldest" | "reject-new" = "drop-oldest"

const BASE_BETWEEN_JOBS_MS = 250          // slight spacing even when healthy
const RATE_LIMIT_PAUSE_MS = 6000          // when 429 happens, pause all workers

type ScanStatus = "queued" | "processing" | "success" | "error"

type ScanJob = {
  id: string
  file: File
  createdAt: number
  status: ScanStatus
  error?: string
  // Optional: store signed URL or result here later
}

export default function RapidScanCamera() {
  const [jobs, setJobs] = useState<ScanJob[]>([])
  const [pausedUntil, setPausedUntil] = useState<number>(0)

  // "worker loops" control
  const activeWorkers = useRef(0)
  const stopRef = useRef(false)

  const now = Date.now()
  const isPaused = pausedUntil > now

  const counts = useMemo(() => {
    const queued = jobs.filter((j) => j.status === "queued").length
    const processing = jobs.filter((j) => j.status === "processing").length
    const success = jobs.filter((j) => j.status === "success").length
    const error = jobs.filter((j) => j.status === "error").length
    return { queued, processing, success, error, total: jobs.length }
  }, [jobs])

  useEffect(() => {
    stopRef.current = false
    // Start worker loops
    ensureWorkersRunning()
    return () => {
      stopRef.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // if jobs change, make sure workers are running
    ensureWorkersRunning()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobs, pausedUntil])

  function ensureWorkersRunning() {
    if (stopRef.current) return
    if (activeWorkers.current >= CONCURRENT_WORKERS) return

    // Spin up as many workers as needed
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

      const next = getNextQueuedJob()
      if (!next) {
        await sleep(200) // idle wait
        continue
      }

      updateJob(next.id, { status: "processing", error: undefined })

      try {
        await processOne(next)
        updateJob(next.id, { status: "success" })
      } catch (err: any) {
        const msg = String(err?.message ?? err)
        updateJob(next.id, { status: "error", error: msg })

        // GLOBAL circuit-breaker pause on rate limiting
        if (/429|rate limit|too many/i.test(msg)) {
          setPausedUntil(Date.now() + RATE_LIMIT_PAUSE_MS)
        }
      }

      await sleep(BASE_BETWEEN_JOBS_MS)
    }
  }

  function getNextQueuedJob(): ScanJob | null {
    // pick oldest queued job first (FIFO)
    const queued = jobs
      .filter((j) => j.status === "queued")
      .sort((a, b) => a.createdAt - b.createdAt)
    return queued[0] ?? null
  }

  function updateJob(id: string, patch: Partial<ScanJob>) {
    setJobs((prev) =>
      prev.map((j) => (j.id === id ? { ...j, ...patch } : j))
    )
  }

  function enqueueFiles(files: FileList | null) {
    if (!files || files.length === 0) return

    const incoming: ScanJob[] = Array.from(files).map((f) => ({
      id: crypto.randomUUID(),
      file: f,
      createdAt: Date.now(),
      status: "queued",
    }))

    setJobs((prev) => {
      // if buffer would overflow, apply policy
      const next = [...prev, ...incoming]

      if (next.length <= QUEUE_MAX) return next

      const overflow = next.length - QUEUE_MAX

      if (DROP_POLICY === "reject-new") {
        // keep old, reject newest overflow
        return next.slice(0, QUEUE_MAX)
      }

      // drop oldest to make room (best for "keep shooting" feel)
      // Prefer dropping already-success items first, then oldest queued.
      const sorted = [...next].sort((a, b) => a.createdAt - b.createdAt)

      let toDrop = overflow
      const dropIds = new Set<string>()

      // Drop successes first (they're done, you probably don't need to keep them in memory)
      for (const j of sorted) {
        if (toDrop <= 0) break
        if (j.status === "success") {
          dropIds.add(j.id)
          toDrop--
        }
      }

      // Then drop oldest queued if still overflow
      for (const j of sorted) {
        if (toDrop <= 0) break
        if (j.status === "queued") {
          dropIds.add(j.id)
          toDrop--
        }
      }

      // Finally drop oldest errors if still overflow
      for (const j of sorted) {
        if (toDrop <= 0) break
        if (j.status === "error") {
          dropIds.add(j.id)
          toDrop--
        }
      }

      const filtered = next.filter((j) => !dropIds.has(j.id))
      return filtered.slice(-QUEUE_MAX) // hard clamp
    })
  }

  async function processOne(job: ScanJob) {
    const filePath = `cards/${job.id}.jpg`

    // Upload (retry transient failures)
    await withRetry(
      async () => {
        const res = await supabase.storage
          .from("card-images")
          .upload(filePath, job.file, { upsert: false })

        if (res.error) throw new Error(res.error.message)
        return res.data
      },
      { retries: 4, baseMs: 700, maxMs: 9000 }
    )

    // Signed URL
    const imageUrl = await withRetry(
      async () => {
        const res = await supabase.storage
          .from("card-images")
          .createSignedUrl(filePath, 60 * 60 * 24)

        if (res.error) throw new Error(res.error.message)
        if (!res.data?.signedUrl) throw new Error("Signed URL missing")
        return res.data.signedUrl
      },
      { retries: 4, baseMs: 700, maxMs: 9000 }
    )

    // Identify (edge function)
    await withRetry(
      async () => {
        const res = await supabase.functions.invoke("rapid-card-identify", {
          body: { imageUrl },
        })

        if (res.error) throw new Error(res.error.message)
        // optional: validate response payload if you expect something
        return res.data
      },
      {
        retries: 5,
        baseMs: 900,
        maxMs: 12000,
        shouldRetry: (e) =>
          /429|rate limit|too many|timeout|network|502|503|504/i.test(
            String(e?.message ?? e)
          ),
      }
    )
  }

  function clearDone() {
    setJobs((prev) => prev.filter((j) => j.status !== "success"))
  }

  function clearAll() {
    setJobs([])
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center gap-3">
        <input
          type="file"
          accept="image/*"
          multiple
          onChange={(e) => enqueueFiles(e.target.files)}
        />
        <button
          className="px-3 py-1 rounded bg-slate-700 text-white"
          onClick={clearDone}
          type="button"
        >
          Clear Done
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
        <div>Buffer: {counts.total}/{QUEUE_MAX}</div>
        <div>
          Queued: {counts.queued} • Processing: {counts.processing} • Success:{" "}
          {counts.success} • Error: {counts.error}
        </div>
        {isPaused && (
          <div className="text-yellow-300 font-semibold">
            Rate limit hit — pausing for a moment…
          </div>
        )}
      </div>

      <ul className="space-y-2 text-sm">
        {jobs
          .slice()
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((j) => (
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
