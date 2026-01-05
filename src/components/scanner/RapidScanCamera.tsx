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
import {
  detectCardRect,
  DEFAULT_CARD_RECT_TUNING,
  type CardRectTuning,
  type CardRectResult,
} from "@/lib/visionCardRect"
import { useLocalStorageState } from "@/lib/useLocalStorageState"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const CONCURRENT_WORKERS = 2
const QUEUE_MAX = 180
const BASE_BETWEEN_JOBS_MS = 250
const RATE_LIMIT_PAUSE_MS = 6000

type Roi = { wPct: number; hPct: number }

type UiPrefs = {
  autoOn: boolean
  cropToRoi: boolean
  showRoi: boolean
  rectGateOn: boolean
  roi: Roi
  tuning: AutoCaptureTuning
  rectTuning: CardRectTuning
  advancedPanel: boolean
  debugOverlay: boolean
}

const DEFAULT_PREFS: UiPrefs = {
  autoOn: true,
  cropToRoi: true,
  showRoi: true,
  rectGateOn: true,
  roi: { wPct: 0.72, hPct: 0.62 },
  tuning: DEFAULT_TUNING,
  rectTuning: DEFAULT_CARD_RECT_TUNING,
  advancedPanel: true,
  debugOverlay: true,
}

export default function RapidScanCamera() {
  // refs
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)

  // persisted prefs
  const prefsLS = useLocalStorageState<UiPrefs>("rapid_scan_prefs_v1", DEFAULT_PREFS)
  const prefs = prefsLS.value
  const setPrefs = prefsLS.setValue

  // queue meta
  const [meta, setMeta] = useState<QueueItemMeta[]>([])
  const [loadingQueue, setLoadingQueue] = useState(true)

  // workers
  const activeWorkers = useRef(0)
  const stopWorkers = useRef(false)
  const [pausedUntil, setPausedUntil] = useState<number>(0)
  const isPaused = pausedUntil > Date.now()

  // camera + analysis
  const [cameraOn, setCameraOn] = useState(false)
  const [statusLine, setStatusLine] = useState("Idle")
  const prevGrayRef = useRef<Uint8Array | null>(null)
  const autoStateRef = useRef<AutoCaptureState>({
    phase: "idle",
    stableFrames: 0,
    lastCaptureAt: 0,
    lastDiff: 0,
  })

  // premium debug / health
  const [lastDiff, setLastDiff] = useState(0)
  const [loopHz, setLoopHz] = useState(0)
  const lastTickRef = useRef<number>(0)
  const hzWindowRef = useRef<number[]>([])
  const [rectResult, setRectResult] = useState<CardRectResult | null>(null)

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
    const list = await idbListMeta(1000)
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
      setStatusLine(`Queue full (${QUEUE_MAX}). Let it process or clear.`)
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

  async function retryErrors() {
    const list = await idbListMeta(3000)
    for (const m of list) {
      if (m.status === "error") await idbUpdateMeta(m.id, { status: "queued", error: undefined })
    }
    await refreshMeta()
    ensureWorkersRunning()
  }

  async function clearErrors() {
    const list = await idbListMeta(3000)
    for (const m of list) {
      if (m.status === "error") await idbDelete(m.id)
    }
    await refreshMeta()
  }

  async function clearAll() {
    const list = await idbListMeta(5000)
    for (const m of list) await idbDelete(m.id)
    await refreshMeta()
  }

  // -------------------------
  // Camera
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

    prevGrayRef.current = null
    autoStateRef.current = { phase: "idle", stableFrames: 0, lastCaptureAt: 0, lastDiff: 0 }
    setRectResult(null)
    setLastDiff(0)
    setStatusLine("Camera live")

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

  function getCenterRoiRect(w: number, h: number, roiCfg: Roi) {
    const rw = Math.max(1, Math.floor(w * roiCfg.wPct))
    const rh = Math.max(1, Math.floor(h * roiCfg.hPct))
    const rx = Math.max(0, Math.floor((w - rw) / 2))
    const ry = Math.max(0, Math.floor((h - rh) / 2))
    return { rx, ry, rw, rh }
  }

  async function analysisTick() {
    try {
      // loop health stats
      const now = performance.now()
      if (lastTickRef.current > 0) {
        const dt = now - lastTickRef.current
        const hz = 1000 / Math.max(1, dt)
        const arr = hzWindowRef.current
        arr.push(hz)
        if (arr.length > 20) arr.shift()
        const avg = arr.reduce((a, b) => a + b, 0) / arr.length
        setLoopHz(avg)
      }
      lastTickRef.current = now

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

      const vw = v.videoWidth || 1280
      const vh = v.videoHeight || 720

      const { rx, ry, rw, rh } = getCenterRoiRect(vw, vh, prefs.roi)

      // ROI downscale for analysis
      c.width = prefs.tuning.sampleW
      c.height = prefs.tuning.sampleH
      ctx.drawImage(v, rx, ry, rw, rh, 0, 0, c.width, c.height)

      const img = ctx.getImageData(0, 0, c.width, c.height)
      const gray = rgbaToGray(img.data)

      // rectangle detect on ROI
      const rect = detectCardRect(gray, c.width, c.height, prefs.rectTuning)
      setRectResult(rect)

      const cardPresent = rect.present || !prefs.rectGateOn

      if (!cardPresent) {
        // no card => reset capture state to avoid “ghost capture”
        prevGrayRef.current = gray
        if (autoStateRef.current.phase !== "idle") {
          autoStateRef.current = { ...autoStateRef.current, phase: "idle", stableFrames: 0 }
        }
        setLastDiff(0)
        setStatusLine("No card detected in ROI — center the card in the box")
        rafRef.current = requestAnimationFrame(analysisTick)
        return
      }

      // motion diff ROI-only
      const prev = prevGrayRef.current
      let diff = 0
      if (prev) diff = meanAbsDiff(prev, gray)
      prevGrayRef.current = gray
      setLastDiff(diff)

      if (prefs.autoOn) {
        const { state, shouldCapture } = nextAutoCaptureState(
          autoStateRef.current,
          diff,
          Date.now(),
          prefs.tuning
        )
        autoStateRef.current = state

        // premium status
        const phase = state.phase
        if (phase === "idle") setStatusLine(`Armed • Card detected • diff ${diff.toFixed(1)}`)
        if (phase === "seeing-motion") setStatusLine(`New card entering… • diff ${diff.toFixed(1)}`)
        if (phase === "waiting-stable") setStatusLine(`Hold still… ${state.stableFrames}/${prefs.tuning.stableFramesRequired}`)
        if (phase === "captured") setStatusLine(`Captured ✅ • Swap card`)

        if (shouldCapture) {
          await captureFrameToQueue()
        }
      } else {
        setStatusLine(`Manual mode • Card detected`)
      }
    } catch {
      // keep loop alive
    } finally {
      rafRef.current = requestAnimationFrame(analysisTick)
    }
  }

  async function captureFrameToQueue() {
    const v = videoRef.current
    const cap = captureCanvasRef.current
    if (!v || !cap) return

    const vw = v.videoWidth || 1280
    const vh = v.videoHeight || 720
    const { rx, ry, rw, rh } = getCenterRoiRect(vw, vh, prefs.roi)

    const outW = prefs.cropToRoi ? rw : vw
    const outH = prefs.cropToRoi ? rh : vh
    cap.width = outW
    cap.height = outH

    const ctx = cap.getContext("2d")
    if (!ctx) return

    if (prefs.cropToRoi) ctx.drawImage(v, rx, ry, rw, rh, 0, 0, outW, outH)
    else ctx.drawImage(v, 0, 0, vw, vh, 0, 0, outW, outH)

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
  // UI helpers (premium)
  // -------------------------
  const rectDebug = rectResult?.debug
  const rectOk = !!rectResult?.present

  const statusChip = (() => {
    if (!cameraOn) return { text: "OFF", cls: "bg-slate-800 text-slate-200" }
    if (isPaused) return { text: "PAUSED", cls: "bg-yellow-600 text-black" }
    if (counts.error > 0) return { text: "WARN", cls: "bg-orange-600 text-black" }
    return { text: "LIVE", cls: "bg-emerald-600 text-black" }
  })()

  // map detected bbox (analysis canvas coords) into ROI overlay coords (percent of ROI)
  const bboxStyle = useMemo(() => {
    const bbox = rectResult?.bbox
    if (!bbox) return null
    const w = prefs.tuning.sampleW
    const h = prefs.tuning.sampleH
    const xPct = (bbox.x0 / w) * 100
    const yPct = (bbox.y0 / h) * 100
    const wPct = ((bbox.x1 - bbox.x0 + 1) / w) * 100
    const hPct = ((bbox.y1 - bbox.y0 + 1) / h) * 100
    return { left: `${xPct}%`, top: `${yPct}%`, width: `${wPct}%`, height: `${hPct}%` }
  }, [rectResult, prefs.tuning.sampleW, prefs.tuning.sampleH])

  return (
    <div className="p-4 space-y-4">
      {/* Header controls */}
      <div className="flex flex-wrap items-center gap-2">
        {!cameraOn ? (
          <button className="px-3 py-2 rounded bg-slate-800 text-white" onClick={startCamera} type="button">
            Start Camera
          </button>
        ) : (
          <button className="px-3 py-2 rounded bg-slate-950 text-white" onClick={stopCamera} type="button">
            Stop Camera
          </button>
        )}

        <span className={`px-2 py-1 rounded text-xs font-bold ${statusChip.cls}`}>{statusChip.text}</span>

        <button
          className="px-3 py-2 rounded bg-slate-700 text-white disabled:opacity-40"
          onClick={() => setPrefs((p) => ({ ...p, autoOn: !p.autoOn }))}
          type="button"
          disabled={!cameraOn}
        >
          Auto: {prefs.autoOn ? "ON" : "OFF"}
        </button>

        <button
          className="px-3 py-2 rounded bg-slate-700 text-white disabled:opacity-40"
          onClick={manualCapture}
          type="button"
          disabled={!cameraOn}
        >
          Capture
        </button>

        <button
          className="px-3 py-2 rounded bg-slate-700 text-white"
          onClick={() => setPrefs((p) => ({ ...p, rectGateOn: !p.rectGateOn }))}
          type="button"
        >
          Rect Gate: {prefs.rectGateOn ? "ON" : "OFF"}
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

      {/* Status + metrics */}
      <div className="rounded border border-slate-800 bg-slate-950/40 p-3">
        <div className="flex flex-wrap items-center gap-3 justify-between">
          <div className="text-sm text-slate-200">
            <div className="font-semibold">{statusLine}</div>
            <div className="text-xs text-slate-400">
              Queue {counts.total}/{QUEUE_MAX} • Queued {counts.queued} • Processing {counts.processing} • Errors {counts.error}
              {isPaused ? ` • Paused ${Math.ceil((pausedUntil - Date.now()) / 1000)}s` : ""}
            </div>
          </div>

          <div className="text-xs text-slate-300 flex gap-4">
            <div>
              <div className="text-slate-500">Loop</div>
              <div className="font-mono">{loopHz.toFixed(1)} Hz</div>
            </div>
            <div>
              <div className="text-slate-500">Diff</div>
              <div className="font-mono">{lastDiff.toFixed(1)}</div>
            </div>
            <div>
              <div className="text-slate-500">Card</div>
              <div className={`font-mono ${rectOk ? "text-emerald-400" : "text-red-400"}`}>
                {rectOk ? "YES" : "NO"}
              </div>
            </div>
          </div>
        </div>

        {prefs.debugOverlay && rectDebug && (
          <div className="mt-2 grid gap-2 md:grid-cols-4 text-xs text-slate-300">
            <div className="rounded bg-slate-900/60 p-2">
              <div className="text-slate-500">Edge density</div>
              <div className="font-mono">{rectDebug.edgeDensity.toFixed(3)}</div>
            </div>
            <div className="rounded bg-slate-900/60 p-2">
              <div className="text-slate-500">BBox coverage</div>
              <div className="font-mono">{rectDebug.bboxCoverage.toFixed(3)}</div>
            </div>
            <div className="rounded bg-slate-900/60 p-2">
              <div className="text-slate-500">Aspect (w/h)</div>
              <div className="font-mono">{rectDebug.aspect.toFixed(3)}</div>
            </div>
            <div className="rounded bg-slate-900/60 p-2">
              <div className="text-slate-500">Perimeter hit</div>
              <div className="font-mono">{rectDebug.perimeterHitRatio.toFixed(3)}</div>
            </div>
          </div>
        )}
      </div>

      {/* Main layout */}
      <div className="grid gap-3 md:grid-cols-2">
        {/* Camera preview */}
        <div className="rounded border border-slate-800 overflow-hidden bg-black relative">
          <video ref={videoRef} className="w-full h-auto" playsInline muted />

          {/* ROI overlay */}
          {prefs.showRoi && cameraOn && (
            <div className="absolute inset-0 pointer-events-none flex items-center justify-center">
              <div
                style={{
                  width: `${Math.round(prefs.roi.wPct * 100)}%`,
                  height: `${Math.round(prefs.roi.hPct * 100)}%`,
                  border: `2px solid ${rectOk ? "rgba(0,255,200,0.8)" : "rgba(255,60,60,0.85)"}`,
                  boxShadow: "0 0 0 9999px rgba(0,0,0,0.28)",
                  borderRadius: 14,
                  position: "relative",
                }}
              >
                {/* Premium: detected bbox overlay inside ROI */}
                {prefs.debugOverlay && bboxStyle && (
                  <div
                    style={{
                      position: "absolute",
                      ...bboxStyle,
                      border: `2px solid ${rectOk ? "rgba(0,255,120,0.85)" : "rgba(255,120,0,0.85)"}`,
                      borderRadius: 10,
                      boxShadow: rectOk ? "0 0 12px rgba(0,255,120,0.25)" : "0 0 12px rgba(255,120,0,0.25)",
                    }}
                  />
                )}

                {/* “Aim points” */}
                <div
                  style={{
                    position: "absolute",
                    left: "50%",
                    top: "50%",
                    width: 8,
                    height: 8,
                    transform: "translate(-50%,-50%)",
                    borderRadius: 999,
                    background: "rgba(255,255,255,0.65)",
                  }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Controls panel */}
        <div className="rounded border border-slate-800 bg-slate-950/40 p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div className="text-slate-100 font-semibold">Capture Controls</div>
            <div className="flex gap-2">
              <button
                className="px-3 py-2 rounded bg-slate-800 text-white"
                onClick={() => setPrefs((p) => ({ ...p, advancedPanel: !p.advancedPanel }))}
                type="button"
              >
                {prefs.advancedPanel ? "Hide Advanced" : "Show Advanced"}
              </button>
              <button
                className="px-3 py-2 rounded bg-slate-800 text-white"
                onClick={() => setPrefs((p) => ({ ...p, debugOverlay: !p.debugOverlay }))}
                type="button"
              >
                Debug: {prefs.debugOverlay ? "ON" : "OFF"}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              className="px-3 py-2 rounded bg-slate-800 text-white"
              onClick={() => setPrefs((p) => ({ ...p, showRoi: !p.showRoi }))}
              type="button"
            >
              ROI Overlay: {prefs.showRoi ? "ON" : "OFF"}
            </button>

            <button
              className="px-3 py-2 rounded bg-slate-800 text-white"
              onClick={() => setPrefs((p) => ({ ...p, cropToRoi: !p.cropToRoi }))}
              type="button"
            >
              Capture Crop: {prefs.cropToRoi ? "ROI" : "FULL"}
            </button>
          </div>

          {/* ROI sliders */}
          <div className="space-y-2">
            <div className="text-slate-200 font-semibold text-sm">ROI (center)</div>

            <label className="block text-xs text-slate-300">
              Width: {Math.round(prefs.roi.wPct * 100)}%
              <input
                type="range"
                min={40}
                max={95}
                value={Math.round(prefs.roi.wPct * 100)}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, roi: { ...p.roi, wPct: Number(e.target.value) / 100 } }))
                }
                className="w-full"
              />
            </label>

            <label className="block text-xs text-slate-300">
              Height: {Math.round(prefs.roi.hPct * 100)}%
              <input
                type="range"
                min={35}
                max={90}
                value={Math.round(prefs.roi.hPct * 100)}
                onChange={(e) =>
                  setPrefs((p) => ({ ...p, roi: { ...p.roi, hPct: Number(e.target.value) / 100 } }))
                }
                className="w-full"
              />
            </label>
          </div>

          {/* Advanced */}
          {prefs.advancedPanel && (
            <div className="space-y-3 pt-2 border-t border-slate-800">
              <div className="text-slate-200 font-semibold text-sm">Auto-capture (motion/stability)</div>

              <label className="block text-xs text-slate-300">
                Enter threshold: {prefs.tuning.motionEnterThreshold}
                <input
                  type="range"
                  min={4}
                  max={25}
                  value={prefs.tuning.motionEnterThreshold}
                  onChange={(e) =>
                    setPrefs((p) => ({
                      ...p,
                      tuning: { ...p.tuning, motionEnterThreshold: Number(e.target.value) },
                    }))
                  }
                  className="w-full"
                />
              </label>

              <label className="block text-xs text-slate-300">
                Exit threshold: {prefs.tuning.motionExitThreshold}
                <input
                  type="range"
                  min={4}
                  max={30}
                  value={prefs.tuning.motionExitThreshold}
                  onChange={(e) =>
                    setPrefs((p) => ({
                      ...p,
                      tuning: { ...p.tuning, motionExitThreshold: Number(e.target.value) },
                    }))
                  }
                  className="w-full"
                />
              </label>

              <label className="block text-xs text-slate-300">
                Stable threshold: {prefs.tuning.stableThreshold.toFixed(1)}
                <input
                  type="range"
                  min={1}
                  max={10}
                  step={0.1}
                  value={prefs.tuning.stableThreshold}
                  onChange={(e) =>
                    setPrefs((p) => ({
                      ...p,
                      tuning: { ...p.tuning, stableThreshold: Number(e.target.value) },
                    }))
                  }
                  className="w-full"
                />
              </label>

              <label className="block text-xs text-slate-300">
                Stable frames: {prefs.tuning.stableFramesRequired}
                <input
                  type="range"
                  min={4}
                  max={24}
                  value={prefs.tuning.stableFramesRequired}
                  onChange={(e) =>
                    setPrefs((p) => ({
                      ...p,
                      tuning: { ...p.tuning, stableFramesRequired: Number(e.target.value) },
                    }))
                  }
                  className="w-full"
                />
              </label>

              <div className="text-slate-200 font-semibold text-sm pt-2 border-t border-slate-800">
                Rectangle detector (premium gate)
              </div>

              <label className="block text-xs text-slate-300">
                Edge threshold: {prefs.rectTuning.edgeThreshold}
                <input
                  type="range"
                  min={10}
                  max={60}
                  value={prefs.rectTuning.edgeThreshold}
                  onChange={(e) =>
                    setPrefs((p) => ({
                      ...p,
                      rectTuning: { ...p.rectTuning, edgeThreshold: Number(e.target.value) },
                    }))
                  }
                  className="w-full"
                />
              </label>

              <label className="block text-xs text-slate-300">
                Min edge density: {prefs.rectTuning.minEdgeDensity.toFixed(3)}
                <input
                  type="range"
                  min={0.005}
                  max={0.08}
                  step={0.001}
                  value={prefs.rectTuning.minEdgeDensity}
                  onChange={(e) =>
                    setPrefs((p) => ({
                      ...p,
                      rectTuning: { ...p.rectTuning, minEdgeDensity: Number(e.target.value) },
                    }))
                  }
                  className="w-full"
                />
              </label>

              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs text-slate-300">
                  Min coverage: {prefs.rectTuning.minBboxCoverage.toFixed(2)}
                  <input
                    type="range"
                    min={0.05}
                    max={0.6}
                    step={0.01}
                    value={prefs.rectTuning.minBboxCoverage}
                    onChange={(e) =>
                      setPrefs((p) => ({
                        ...p,
                        rectTuning: { ...p.rectTuning, minBboxCoverage: Number(e.target.value) },
                      }))
                    }
                    className="w-full"
                  />
                </label>

                <label className="block text-xs text-slate-300">
                  Max coverage: {prefs.rectTuning.maxBboxCoverage.toFixed(2)}
                  <input
                    type="range"
                    min={0.6}
                    max={1.0}
                    step={0.01}
                    value={prefs.rectTuning.maxBboxCoverage}
                    onChange={(e) =>
                      setPrefs((p) => ({
                        ...p,
                        rectTuning: { ...p.rectTuning, maxBboxCoverage: Number(e.target.value) },
                      }))
                    }
                    className="w-full"
                  />
                </label>
              </div>

              <div className="grid grid-cols-2 gap-2">
                <label className="block text-xs text-slate-300">
                  Min aspect: {prefs.rectTuning.minAspect.toFixed(2)}
                  <input
                    type="range"
                    min={0.3}
                    max={0.8}
                    step={0.01}
                    value={prefs.rectTuning.minAspect}
                    onChange={(e) =>
                      setPrefs((p) => ({
                        ...p,
                        rectTuning: { ...p.rectTuning, minAspect: Number(e.target.value) },
                      }))
                    }
                    className="w-full"
                  />
                </label>

                <label className="block text-xs text-slate-300">
                  Max aspect: {prefs.rectTuning.maxAspect.toFixed(2)}
                  <input
                    type="range"
                    min={0.6}
                    max={1.2}
                    step={0.01}
                    value={prefs.rectTuning.maxAspect}
                    onChange={(e) =>
                      setPrefs((p) => ({
                        ...p,
                        rectTuning: { ...p.rectTuning, maxAspect: Number(e.target.value) },
                      }))
                    }
                    className="w-full"
                  />
                </label>
              </div>

              <label className="block text-xs text-slate-300">
                Min perimeter hit: {prefs.rectTuning.minPerimeterHitRatio.toFixed(2)}
                <input
                  type="range"
                  min={0.1}
                  max={0.75}
                  step={0.01}
                  value={prefs.rectTuning.minPerimeterHitRatio}
                  onChange={(e) =>
                    setPrefs((p) => ({
                      ...p,
                      rectTuning: { ...p.rectTuning, minPerimeterHitRatio: Number(e.target.value) },
                    }))
                  }
                  className="w-full"
                />
              </label>

              <div className="text-xs text-slate-400">
                If glossy sleeves break detection: lower **edge threshold**, or widen ROI a bit.
                If false positives happen: raise **min perimeter hit** and **min edge density**.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Queue list (premium-ish) */}
      <div className="rounded border border-slate-800 bg-slate-950/40 p-3">
        <div className="flex items-center justify-between">
          <div className="text-slate-100 font-semibold">Queue</div>
          <div className="text-xs text-slate-400">Newest first • only showing 30</div>
        </div>

        <div className="mt-3 grid gap-2">
          {meta.slice(0, 30).map((j) => (
            <div key={j.id} className="flex items-center justify-between rounded border border-slate-800 bg-slate-900/40 p-2">
              <div className="flex items-center gap-2">
                <span className="font-mono text-xs text-slate-300">{j.id.slice(0, 8)}</span>
                <span
                  className={`text-xs px-2 py-1 rounded ${
                    j.status === "queued"
                      ? "bg-blue-600 text-black"
                      : j.status === "processing"
                      ? "bg-purple-600 text-black"
                      : j.status === "error"
                      ? "bg-red-600 text-black"
                      : "bg-slate-700 text-slate-200"
                  }`}
                >
                  {j.status.toUpperCase()}
                </span>
              </div>

              {j.error ? (
                <div className="text-xs text-red-300 max-w-[60%] truncate">{j.error}</div>
              ) : (
                <div className="text-xs text-slate-400">—</div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* hidden canvases */}
      <canvas ref={analysisCanvasRef} className="hidden" />
      <canvas ref={captureCanvasRef} className="hidden" />
    </div>
  )
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}
