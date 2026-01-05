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
import { detectSupport, getVideoTrack, setFocusPoint, setTorch, type MediaSupport } from "@/lib/mediaControls"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
)

const CONCURRENT_WORKERS = 2
const QUEUE_MAX = 180
const BASE_BETWEEN_JOBS_MS = 250
const RATE_LIMIT_PAUSE_MS = 6000

// ROI is now draggable + resizable (not forced centered)
type Roi = {
  cxPct: number // 0..1 center x
  cyPct: number // 0..1 center y
  wPct: number  // 0..1 width
  hPct: number  // 0..1 height
}

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
  torchWanted: boolean
}

const DEFAULT_PREFS: UiPrefs = {
  autoOn: true,
  cropToRoi: true,
  showRoi: true,
  rectGateOn: true,
  roi: { cxPct: 0.5, cyPct: 0.5, wPct: 0.72, hPct: 0.62 },
  tuning: DEFAULT_TUNING,
  rectTuning: DEFAULT_CARD_RECT_TUNING,
  advancedPanel: true,
  debugOverlay: true,
  torchWanted: false,
}

type Thumb = { id: string; url: string; createdAt: number }

export default function RapidScanCamera() {
  const videoRef = useRef<HTMLVideoElement | null>(null)
  const previewWrapRef = useRef<HTMLDivElement | null>(null)
  const analysisCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const captureCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const rafRef = useRef<number | null>(null)

  const prefsLS = useLocalStorageState<UiPrefs>("rapid_scan_prefs_v2", DEFAULT_PREFS)
  const prefs = prefsLS.value
  const setPrefs = prefsLS.setValue

  const [meta, setMeta] = useState<QueueItemMeta[]>([])
  const [loadingQueue, setLoadingQueue] = useState(true)

  const activeWorkers = useRef(0)
  const stopWorkers = useRef(false)
  const [pausedUntil, setPausedUntil] = useState<number>(0)
  const isPaused = pausedUntil > Date.now()

  const [cameraOn, setCameraOn] = useState(false)
  const [statusLine, setStatusLine] = useState("Idle")

  // Track + device support (torch/focus)
  const streamRef = useRef<MediaStream | null>(null)
  const trackRef = useRef<MediaStreamTrack | null>(null)
  const [support, setSupport] = useState<MediaSupport>({ torch: false, focus: false, zoom: false })
  const [torchOn, setTorchOn] = useState(false)

  // Auto capture analysis state
  const prevGrayRef = useRef<Uint8Array | null>(null)
  const autoStateRef = useRef<AutoCaptureState>({
    phase: "idle",
    stableFrames: 0,
    lastCaptureAt: 0,
    lastDiff: 0,
  })

  // premium debug
  const [lastDiff, setLastDiff] = useState(0)
  const [loopHz, setLoopHz] = useState(0)
  const lastTickRef = useRef<number>(0)
  const hzWindowRef = useRef<number[]>([])
  const [rectResult, setRectResult] = useState<CardRectResult | null>(null)

  // thumbnails (local, instant feedback)
  const [thumbs, setThumbs] = useState<Thumb[]>([])

  // ROI drag state
  const dragRef = useRef<{
    mode: "move" | "nw" | "ne" | "sw" | "se" | null
    startX: number
    startY: number
    startRoi: Roi
  }>({ mode: null, startX: 0, startY: 0, startRoi: prefs.roi })

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
      // cleanup thumbnails
      setThumbs((t) => {
        t.forEach((x) => URL.revokeObjectURL(x.url))
        return []
      })
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

    // local thumbnail (instant feedback)
    const url = URL.createObjectURL(blob)
    setThumbs((prev) => {
      const next = [{ id, url, createdAt: Date.now() }, ...prev]
      // cap at 24
      while (next.length > 24) {
        const last = next.pop()
        if (last) URL.revokeObjectURL(last.url)
      }
      return next
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
    for (const m of list) if (m.status === "error") await idbDelete(m.id)
    await refreshMeta()
  }

  async function clearAll() {
    const list = await idbListMeta(5000)
    for (const m of list) await idbDelete(m.id)
    await refreshMeta()
  }

  // -------------------------
  // Camera start/stop + device controls
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

    streamRef.current = stream
    trackRef.current = getVideoTrack(stream)

    setSupport(detectSupport(trackRef.current))

    const v = videoRef.current
    if (!v) return

    v.srcObject = stream
    await v.play()
    setCameraOn(true)

    // apply torch preference if possible
    if (prefs.torchWanted) {
      const ok = await setTorch(trackRef.current, true)
      setTorchOn(ok)
    } else {
      setTorchOn(false)
    }

    prevGrayRef.current = null
    autoStateRef.current = { phase: "idle", stableFrames: 0, lastCaptureAt: 0, lastDiff: 0 }
    setRectResult(null)
    setLastDiff(0)
    setStatusLine("Camera live")
    startAnalysisLoop()
  }

  async function stopCamera() {
    stopAnalysisLoop()

    // torch off (best effort)
    if (torchOn) {
      await setTorch(trackRef.current, false)
      setTorchOn(false)
    }

    const v = videoRef.current
    if (v?.srcObject) {
      const stream = v.srcObject as MediaStream
      stream.getTracks().forEach((t) => t.stop())
      v.srcObject = null
    }
    streamRef.current = null
    trackRef.current = null
    setSupport({ torch: false, focus: false, zoom: false })
    setCameraOn(false)
    setStatusLine("Camera stopped")
  }

  async function toggleTorch() {
    const track = trackRef.current
    if (!track) return
    const target = !torchOn
    const ok = await setTorch(track, target)
    setTorchOn(ok ? target : torchOn)
    setPrefs((p) => ({ ...p, torchWanted: ok ? target : p.torchWanted }))
  }

  async function handleTapFocus(e: React.PointerEvent) {
    if (!support.focus) return
    const wrap = previewWrapRef.current
    if (!wrap) return
    const rect = wrap.getBoundingClientRect()
    const x = (e.clientX - rect.left) / rect.width
    const y = (e.clientY - rect.top) / rect.height

    // focus on tapped point (0..1)
    await setFocusPoint(trackRef.current, { x: clamp01(x), y: clamp01(y) })
    // quick status bump
    setStatusLine("Focus set")
  }

  // -------------------------
  // Analysis loop (ROI + rect gate + motion/stability)
  // -------------------------
  function startAnalysisLoop() {
    stopAnalysisLoop()
    rafRef.current = requestAnimationFrame(analysisTick)
  }
  function stopAnalysisLoop() {
    if (rafRef.current) cancelAnimationFrame(rafRef.current)
    rafRef.current = null
  }

  function getRoiRectPx(vw: number, vh: number, roi: Roi) {
    const rw = clampInt(Math.floor(vw * roi.wPct), 50, vw)
    const rh = clampInt(Math.floor(vh * roi.hPct), 50, vh)
    const cx = clampInt(Math.floor(vw * roi.cxPct), 0, vw)
    const cy = clampInt(Math.floor(vh * roi.cyPct), 0, vh)
    const rx = clampInt(Math.floor(cx - rw / 2), 0, vw - rw)
    const ry = clampInt(Math.floor(cy - rh / 2), 0, vh - rh)
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

      const { rx, ry, rw, rh } = getRoiRectPx(vw, vh, prefs.roi)

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
        prevGrayRef.current = gray
        if (autoStateRef.current.phase !== "idle") {
          autoStateRef.current = { ...autoStateRef.current, phase: "idle", stableFrames: 0 }
        }
        setLastDiff(0)
        setStatusLine("No card in ROI — put it inside the box")
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

        const phase = state.phase
        if (phase === "idle") setStatusLine(`Armed • card detected • diff ${diff.toFixed(1)}`)
        if (phase === "seeing-motion") setStatusLine(`Card moving in… • diff ${diff.toFixed(1)}`)
        if (phase === "waiting-stable") setStatusLine(`Hold… ${state.stableFrames}/${prefs.tuning.stableFramesRequired}`)
        if (phase === "captured") setStatusLine(`Captured ✅ • swap card`)

        if (shouldCapture) await captureFrameToQueue()
      } else {
        setStatusLine("Manual mode • card detected")
      }
    } catch {
      // keep alive
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
    const { rx, ry, rw, rh } = getRoiRectPx(vw, vh, prefs.roi)

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
  // ROI drag / resize (stupid smooth)
  // -------------------------
  function beginRoiDrag(mode: "move" | "nw" | "ne" | "sw" | "se") {
    return (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      dragRef.current = { mode, startX: e.clientX, startY: e.clientY, startRoi: prefs.roi }
      ;(e.target as HTMLElement).setPointerCapture?.(e.pointerId)
    }
  }

  function onRoiPointerMove(e: React.PointerEvent) {
    const drag = dragRef.current
    if (!drag.mode) return
    const wrap = previewWrapRef.current
    if (!wrap) return

    const rect = wrap.getBoundingClientRect()
    const dx = (e.clientX - drag.startX) / rect.width
    const dy = (e.clientY - drag.startY) / rect.height

    const minW = 0.35
    const minH = 0.30
    const maxW = 0.95
    const maxH = 0.95

    const r0 = drag.startRoi
    let next: Roi = { ...r0 }

    if (drag.mode === "move") {
      next.cxPct = clamp01(r0.cxPct + dx)
      next.cyPct = clamp01(r0.cyPct + dy)
    } else {
      // resize from corners: adjust width/height, keep center reasonably stable
      const sx = dx
      const sy = dy

      // for corner resize, we change size and also shift center half the delta so corner follows finger
      let dw = 0
      let dh = 0
      let dcx = 0
      let dcy = 0

      if (drag.mode === "nw") { dw = -sx; dh = -sy; dcx = sx / 2; dcy = sy / 2 }
      if (drag.mode === "ne") { dw =  sx; dh = -sy; dcx = sx / 2; dcy = sy / 2 }
      if (drag.mode === "sw") { dw = -sx; dh =  sy; dcx = sx / 2; dcy = sy / 2 }
      if (drag.mode === "se") { dw =  sx; dh =  sy; dcx = sx / 2; dcy = sy / 2 }

      next.wPct = clamp(r0.wPct + dw, minW, maxW)
      next.hPct = clamp(r0.hPct + dh, minH, maxH)
      next.cxPct = clamp01(r0.cxPct + dcx)
      next.cyPct = clamp01(r0.cyPct + dcy)
    }

    // keep ROI inside view bounds (soft clamp using size)
    const halfW = next.wPct / 2
    const halfH = next.hPct / 2
    next.cxPct = clamp(next.cxPct, halfW, 1 - halfW)
    next.cyPct = clamp(next.cyPct, halfH, 1 - halfH)

    setPrefs((p) => ({ ...p, roi: next }))
  }

  function endRoiDrag() {
    dragRef.current.mode = null
  }

  // -------------------------
  // UI bits
  // -------------------------
  const rectDebug = rectResult?.debug
  const rectOk = !!rectResult?.present

  const statusChip = (() => {
    if (!cameraOn) return { text: "OFF", cls: "bg-slate-800 text-slate-200" }
    if (isPaused) return { text: "PAUSED", cls: "bg-yellow-600 text-black" }
    if (counts.error > 0) return { text: "WARN", cls: "bg-orange-600 text-black" }
    return { text: "LIVE", cls: "bg-emerald-600 text-black" }
  })()

  // bbox overlay inside ROI box (analysis coords => percent)
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
      {/* Top bar */}
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

        <button
          className={`px-3 py-2 rounded text-white ${support.torch ? "bg-slate-700" : "bg-slate-800 opacity-60"}`}
          onClick={toggleTorch}
          type="button"
          disabled={!cameraOn || !support.torch}
          title={support.torch ? "Torch" : "Torch not supported on this device/browser"}
        >
          Torch: {torchOn ? "ON" : "OFF"}
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
            <div className="text-xs text-slate-500 mt-1">
              Tip: drag the ROI box. Tap the preview to focus (if supported).
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

      {/* Main */}
      <div className="grid gap-3 md:grid-cols-2">
        {/* Preview */}
        <div className="rounded border border-slate-800 overflow-hidden bg-black">
          <div
            ref={previewWrapRef}
            className="relative"
            onPointerDown={handleTapFocus}
            onPointerMove={onRoiPointerMove}
            onPointerUp={endRoiDrag}
            onPointerCancel={endRoiDrag}
          >
            <video ref={videoRef} className="w-full h-auto" playsInline muted />

            {/* ROI overlay (draggable/resizable) */}
            {prefs.showRoi && cameraOn && (
              <div className="absolute inset-0 pointer-events-none">
                <div
                  className="absolute pointer-events-auto"
                  style={{
                    left: `${(prefs.roi.cxPct - prefs.roi.wPct / 2) * 100}%`,
                    top: `${(prefs.roi.cyPct - prefs.roi.hPct / 2) * 100}%`,
                    width: `${prefs.roi.wPct * 100}%`,
                    height: `${prefs.roi.hPct * 100}%`,
                    border: `2px solid ${rectOk ? "rgba(0,255,200,0.85)" : "rgba(255,60,60,0.85)"}`,
                    borderRadius: 16,
                    boxShadow: "0 0 0 9999px rgba(0,0,0,0.28)",
                    position: "absolute",
                    touchAction: "none",
                  }}
                  onPointerDown={beginRoiDrag("move")}
                  title="Drag to move ROI"
                >
                  {/* bbox debug inside ROI */}
                  {prefs.debugOverlay && bboxStyle && (
                    <div
                      style={{
                        position: "absolute",
                        ...bboxStyle,
                        border: `2px solid ${rectOk ? "rgba(0,255,120,0.85)" : "rgba(255,160,0,0.85)"}`,
                        borderRadius: 12,
                        boxShadow: rectOk ? "0 0 14px rgba(0,255,120,0.25)" : "0 0 14px rgba(255,160,0,0.25)",
                      }}
                    />
                  )}

                  {/* center dot */}
                  <div
                    style={{
                      position: "absolute",
                      left: "50%",
                      top: "50%",
                      width: 8,
                      height: 8,
                      transform: "translate(-50%,-50%)",
                      borderRadius: 999,
                      background: "rgba(255,255,255,0.7)",
                    }}
                  />

                  {/* resize handles */}
                  <Handle pos="nw" onPointerDown={beginRoiDrag("nw")} />
                  <Handle pos="ne" onPointerDown={beginRoiDrag("ne")} />
                  <Handle pos="sw" onPointerDown={beginRoiDrag("sw")} />
                  <Handle pos="se" onPointerDown={beginRoiDrag("se")} />
                </div>
              </div>
            )}
          </div>

          {/* thumbnails */}
          {thumbs.length > 0 && (
            <div className="border-t border-slate-800 bg-slate-950/60 p-2">
              <div className="text-xs text-slate-400 mb-2">Recent captures</div>
              <div className="flex gap-2 overflow-x-auto pb-1">
                {thumbs.map((t) => (
                  <img
                    key={t.id}
                    src={t.url}
                    className="h-16 w-auto rounded border border-slate-700"
                    alt="capture"
                    draggable={false}
                  />
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="rounded border border-slate-800 bg-slate-950/40 p-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2 justify-between">
            <div className="text-slate-100 font-semibold">Controls</div>
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

          {prefs.advancedPanel && (
            <div className="space-y-3 pt-2 border-t border-slate-800">
              <div className="text-slate-200 font-semibold text-sm">Auto-capture</div>

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
                Rectangle gate
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
                If glossy sleeves fail: lower edge threshold, or make ROI a little bigger.
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Queue list */}
      <div className="rounded border border-slate-800 bg-slate-950/40 p-3">
        <div className="flex items-center justify-between">
          <div className="text-slate-100 font-semibold">Queue</div>
          <div className="text-xs text-slate-400">Newest first • showing 30</div>
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

      <canvas ref={analysisCanvasRef} className="hidden" />
      <canvas ref={captureCanvasRef} className="hidden" />
    </div>
  )
}

function Handle({
  pos,
  onPointerDown,
}: {
  pos: "nw" | "ne" | "sw" | "se"
  onPointerDown: (e: React.PointerEvent) => void
}) {
  const style: React.CSSProperties = {
    position: "absolute",
    width: 18,
    height: 18,
    borderRadius: 999,
    background: "rgba(255,255,255,0.85)",
    border: "1px solid rgba(0,0,0,0.25)",
    boxShadow: "0 2px 8px rgba(0,0,0,0.25)",
    touchAction: "none",
  }

  if (pos === "nw") Object.assign(style, { left: -8, top: -8 })
  if (pos === "ne") Object.assign(style, { right: -8, top: -8 })
  if (pos === "sw") Object.assign(style, { left: -8, bottom: -8 })
  if (pos === "se") Object.assign(style, { right: -8, bottom: -8 })

  return <div style={style} onPointerDown={onPointerDown} title="Resize ROI" />
}

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n))
}
function clamp(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}
function clampInt(n: number, a: number, b: number) {
  return Math.max(a, Math.min(b, n))
}
