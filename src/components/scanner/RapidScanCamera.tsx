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
import {
  DEFAULT_TUNING,
  nextAutoCaptureState,
  rgbaToGray,
  meanAbsDiff,
  type AutoCaptureState,
  type AutoCaptureTuning,
} from "@/lib/visionAutoCapture"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const CONCURRENT_WORKERS = 2
const QUEUE_MAX = 150 // you said ~100 at a time; give it headroom
const BASE_BETWEEN_JOBS_MS = 250
const RATE_LIMIT_PAUSE_MS = 6000

export default function RapidScanCamera() {
  // Camera refs
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)

  // Persistent queue meta
  const [meta, setMeta] = useState<QueueItemMeta[]>([])
  const [loadingQueue, setLoadingQueue] = useState(true)

  // Worker loop control
  const activeWorkers = useRef(0)
  const stopWorkers = useRef(false)
  const [pausedUntil, setPausedUntil] = useState<number>(0)
  const isPaused = pausedUntil > Date.now()

  // Auto capture state
  const [cameraOn, setCameraOn] = useState(false)
  const [autoOn, setAutoOn] = useState(true)
  const [tuning, setTuning] = useState<AutoCaptureTuning>(DEFAULT_TUNING)
  const [statusLine, setStatusLine] = useState("Idle")
  const prevGrayRef = useRef<Uint8Array | null>(null)
  const autoStateRef = useRef<AutoCaptureState>({
    phase: "idle",
    stableFrames: 0,
    lastCaptureAt: 0,
    lastDiff: 0,
  })

  const counts = useMemo(() => {
    const queued = meta.filter((m) => m.status === "queued").length
    const processing = meta.filter((m) => m.status === "processing").length
    const error = meta.filter((m) => m.status === "error").length
    return { total: meta.length, queued, processing, error }
  }, [meta])

  // -------------------------
  // Queue + workers
  // -------------------------
  useEffect(() => {
    stopWorkers.current = false
    ;(async () => {
      setLoadingQueue(true)
      await refreshMeta()
      setLoadingQueue(false)
      ensureWorkersRunning()
    })()

    return () => {
      stopWorkers.current = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!loadingQueue) ensureWorkersRunning()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta, pausedUntil, loadingQueue])

  async function refreshMeta() {
    const list = await idbListMeta(800)
    setMeta(list)
  }

  function ensureWorkersRunning() {
    if (stopWorkers.current) return
    if (isPaused) return

    while (activeWorkers.current < CONCURRENT_WORKERS) {
      activeWorkers.current++
      workerLoop().finally(() => {
        activeWorkers.current--
      })
    }
  }

  async function workerLoop() {
    while (!stopWorkers.current) {
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
        // On success, delete to keep DB clean
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
    if (!item) throw new Error("Queue item missing")

    const filePath = `cards/${item.id}.jpg`
    const file = new File([item.blob], item.filename, { type: item.mime })

    await withRetry(async () => {
      const res = await supabase.storage.from("card-images").upload(filePath, file, { upsert: false })
      if (res.error) throw new Error(res.error.message)
      return res.data
    })

    const imageUrl = await withRetry(async () => {
      const res = await supabase.storage.from("card-images").createSignedUrl(filePath, 60 * 60 * 24)
      if (res.error) throw new Error(res.error.message)
      if (!res.data?.signedUrl) throw new Error("Signed URL missing")
      return res.data.signedUrl
    })

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
    const mod = await import("@/lib/idbQueue")
    return mod.idbGet(id)
  }

  async function enqueueBlob(blob: Blob, filename = "card.jpg") {
    const current = await idbCount()
    if (current >= QUEUE_MAX) {
      // simplest: reject new captures when full
      setStatusLine(`Queue full (${QUEUE_MAX}). Process or clear.`)
      return
    }

    const id = crypto.randomUUID()
    await idbAdd({
      id,
      createdAt: Date.now(),
      status: "queued",
      blob,
      mime: blob.type || "image/jpeg",
      filename,
    })

    await refreshMeta()
    ensureWorkersRunning()
  }

  async function clearErrors() {
    const list = await idbListMeta(2000)
    for (const m of list) if (m.status === "error") await idbDelete(m.id)
    await refreshMeta()
  }

  async function retryErrors() {
    const list = await idbListMeta(2000)
    for (const m of list) if (m.status === "error") await idbUpdateMeta(m.id, { status: "queued", error: undefined })
    await refreshMeta()
    ensureWorkersRunning()
  }

  async function clearAll() {
    const list = await idbListMeta(4000)
    for (const m of list) await idbDelete(m.id)
    await refreshMeta()
  }

  // -------------------------
  // Camera + auto capture
  // -------------------------
  async function startCamera() {
    if (cameraOn) return
    const stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "environment",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    })

    const v = videoRef.current
    if (!v) return

    v.srcObject = stream
    await v.play()
    setCameraOn(true)

    // Reset detection state
    prevGrayRef.current = null
    autoStateRef.current = {
      phase: "idle",
      stableFrames: 0,
      lastCaptureAt: 0,
      lastDiff: 0,
    }

    startAnalysisLoop()
  }

  function stopCamera() {
    const v = videoRef.current
    if (v?.srcObject) {
      const stream = v.srcObject as MediaStream
      stream.getTracks().forEach((t) => t.stop())
      v.srcObject = null
    }
    setCameraOn(false)
    stopAnalysisLoop()
    setStatusLine("Camera stopped")
  }

  function startAnalysisLoop() {
    stopAnalysisLoop()
    rafRef.current = requestAnimationFrame(analysisTick)
  }

  function stopAnalysisLoop() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }

  async function analysisTick() {
    try {
      const v = videoRef.current
      const c = analysisCanvasRef.current
      if (!v || !c || v.readyState < 2) {
        rafRef.current = requestAnimationFrame(analysisTick)
        return
      }

      const ctx = c.getContext("2d", { willReadFrequently: true })
      if (!ctx) {
        rafRef.current = requestAnimationFrame(analysisTick)
        return
      }

      // Downscale for analysis
      c.width = tuning.sampleW
      c.height = tuning.sampleH
      ctx.drawImage(v, 0, 0, c.width, c.height)

      const img = ctx.getImageData(0, 0, c.width, c.height)
      const gray = rgbaToGray(img.data)

      const prev = prevGrayRef.current
      let diff = 0
      if (prev) diff = meanAbsDiff(prev, gray)
      prevGrayRef.current = gray

      // Update state machine
      if (autoOn) {
        const { state, shouldCapture } = nextAutoCaptureState(
          autoStateRef.current,
          diff,
          Date.now(),
          tuning
        )
        autoStateRef.current = state

        // Status line
        const phase = state.phase
        if (phase === "idle") setStatusLine(`Idle • diff ${diff.toFixed(1)}`)
        if (phase === "seeing-motion") setStatusLine(`New card entering… • diff ${diff.toFixed(1)}`)
        if (phase === "waiting-stable") setStatusLine(`Hold still… ${state.stableFrames}/${tuning.stableFramesRequired}`)
        if (phase === "captured") setStatusLine(`Captured • waiting for card to leave…`)

        if (shouldCapture) {
          await captureFrameToQueue()
        }
      } else {
        setStatusLine(`Manual mode • diff ${diff.toFixed(1)}`)
      }
    } catch (e) {
      // swallow and keep loop alive
    } finally {
      rafRef.current = requestAnimationFrame(analysisTick)
    }
  }

  async function captureFrameToQueue() {
    const v = videoRef.current
    const cap = captureCanvasRef.current
    if (!v || !cap) return

    // Capture at video resolution for better OCR
    const w = v.videoWidth || 1280
    const h = v.videoHeight || 720

    cap.width = w
    cap.height = h

    const ctx = cap.getContext("2d")
    if (!ctx) return
    ctx.drawImage(v, 0, 0, w, h)

    const blob = await new Promise<Blob | null>((resolve) => {
      cap.toBlob((b) => resolve(b), "image/jpeg", 0.9)
    })

    if (!blob) return

    await enqueueBlob(blob, `card-${Date.now()}.jpg`)
  }

  async function manualCapture() {
    await captureFrameToQueue()
  }

  // -------------------------
  // UI
  // -------------------------
  return (
    <div className="p-4 space-y-4">
      <div className="flex gap-2 flex-wrap items-center">
        {!cameraOn ? (
          <button className="px-3 py-2 rounded bg-slate-800 text-white" onClick={startCamera} type="button">
            Start Camera
          </button>
        ) : (
          <button className="px-3 py-2 rounded bg-slate-900 text-white" onClick={stopCamera} type="button">
            Stop Camera
          </button>
        )}

        <button
          className="px-3 py-2 rounded bg-slate-700 text-white"
          onClick={() => setAutoOn((v) => !v)}
          type="button"
          disabled={!cameraOn}
        >
          Auto: {autoOn ? "ON" : "OFF"}
        </button>

        <button
          className="px-3 py-2 rounded bg-slate-700 text-white"
          onClick={manualCapture}
          type="button"
          disabled={!cameraOn}
        >
          Capture
        </button>

        <button className="px-3 py-2 rounded bg-slate-700 text-white" onClick={retryErrors} type="button">
          Retry Errors
        </button>

        <button className="px-3 py-2 rounded bg-slate-700 text-white" onClick={clearErrors} type="button">
          Clear Errors
        </button>

        <button className="px-3 py-2 rounded bg-slate-950 text-white" onClick={clearAll} type="button">
          Clear All
        </button>
      </div>

      <div className="text-sm text-slate-200 space-y-1">
        <div className="font-semibold">{statusLine}</div>
        {isPaused && <div className="text-yellow-300 font-semibold">Rate limit hit — pausing workers…</div>}
        {loadingQueue ? (
          <div>Loading persistent queue…</div>
        ) : (
          <div>
            Queue: {counts.total}/{QUEUE_MAX} • Queued: {counts.queued} • Processing: {counts.processing} • Errors:{" "}
            {counts.error}
          </div>
        )}
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded border border-slate-700 overflow-hidden bg-black">
          <video ref={videoRef} className="w-full h-auto" playsInline muted />
        </div>

        <div className="text-sm text-slate-200 space-y-2">
          <div className="font-semibold">Auto-capture tuning (live)</div>

          <label className="block">
            Enter threshold: {tuning.motionEnterThreshold}
            <input
              type="range"
              min={4}
              max={25}
              value={tuning.motionEnterThreshold}
              onChange={(e) => setTuning((t) => ({ ...t, motionEnterThreshold: Number(e.target.value) }))}
              className="w-full"
            />
          </label>

          <label className="block">
            Exit threshold: {tuning.motionExitThreshold}
            <input
              type="range"
              min={4}
              max={30}
              value={tuning.motionExitThreshold}
              onChange={(e) => setTuning((t) => ({ ...t, motionExitThreshold: Number(e.target.value) }))}
              className="w-full"
            />
          </label>

          <label className="block">
            Stable threshold: {tuning.stableThreshold.toFixed(1)}
            <input
              type="range"
              min={1}
              max={10}
              step={0.1}
              value={tuning.stableThreshold}
              onChange={(e) => setTuning((t) => ({ ...t, stableThreshold: Number(e.target.value) }))}
              className="w-full"
            />
          </label>

          <label className="block">
            Stable frames: {tuning.stableFramesRequired}
            <input
              type="range"
              min={4}
              max={24}
              value={tuning.stableFramesRequired}
              onChange={(e) => setTuning((t) => ({ ...t, stableFramesRequired: Number(e.target.value) }))}
              className="w-full"
            />
          </label>

          <div className="text-xs text-slate-400">
            Tip: If it captures too early, raise “Stable frames” or lower “Stable threshold”. If it never captures, lower
            “Enter threshold”.
          </div>
        </div>
      </div>

      {/* Hidden canvases */}
      <canvas ref={analysisCanvasRef} className="hidden" />
      <canvas ref={captureCanvasRef} className="hidden" />

      <div className="text-sm text-slate-200">
        <div className="font-semibold">Queue (latest)</div>
        <ul className="space-y-2 mt-2">
          {meta.slice(0, 20).map((j) => (
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
    </div>
  )
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
