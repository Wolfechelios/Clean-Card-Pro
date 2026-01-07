// src/components/scanner/RapidScanCamera.tsx
"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import {
  Camera,
  CameraOff,
  Flashlight,
  FlashlightOff,
  ZoomIn,
  ZoomOut,
  Trash2,
  RefreshCcw,
  Pause,
  Play,
  Focus,
} from "lucide-react"
import { supabase } from "@/integrations/supabase/client"
import {
  getVideoTrack,
  detectSupport,
  setTorch,
  setFocusPoint,
  type MediaSupport,
} from "@/lib/mediaControls"
import {
  rgbaToGray,
  meanAbsDiff,
  nextAutoCaptureState,
  DEFAULT_TUNING,
  type AutoCaptureState,
  type AutoCaptureTuning,
} from "@/lib/visionAutoCapture"
import {
  idbAdd,
  idbDelete,
  idbGetAll,
  idbGetNextQueued,
  idbUpdateMeta,
  idbGet,
  idbClear,
  idbCount,
  type QueueItem,
  type QueueItemMeta,
} from "@/lib/idbQueue"
import { withRetry } from "@/lib/retry"
import { cn } from "@/lib/utils"

// ────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ────────────────────────────────────────────────────────────────────────────
const QUEUE_MAX = 100
const THUMB_MAX = 20
const WORKER_THREADS = 2
const BASE_BETWEEN_JOBS_MS = 150
const RATE_LIMIT_PAUSE_MS = 12_000

type Thumb = { id: string; url: string; createdAt: number }

type FlowState =
  | "READY_FOR_ENTRY" // waiting for a new card
  | "CARD_PRESENT" // seeing card, waiting for stability
  | "CAPTURED" // captured, waiting for card to leave

// ────────────────────────────────────────────────────────────────────────────
// HELPERS
// ────────────────────────────────────────────────────────────────────────────
function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms))
}

function safeUUID() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID()
  }
  return "xxxx-xxxx-xxxx".replace(/x/g, () => ((Math.random() * 16) | 0).toString(16))
}

// ────────────────────────────────────────────────────────────────────────────
// COMPONENT
// ────────────────────────────────────────────────────────────────────────────
export default function RapidScanCamera() {
  // Camera refs
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const trackRef = useRef<MediaStreamTrack | null>(null)

  // Analysis loop
  const rafRef = useRef<number>(0)
  const prevGrayRef = useRef<Uint8Array | null>(null)
  const autoStateRef = useRef<AutoCaptureState>({
    phase: "idle",
    stableFrames: 0,
    lastCaptureAt: 0,
    lastDiff: 0,
  })
  const flowStateRef = useRef<FlowState>("READY_FOR_ENTRY")

  // State
  const [cameraOn, setCameraOn] = useState(false)
  const [support, setSupport] = useState<MediaSupport>({ torch: false, focus: false, zoom: false })
  const [torchOn, setTorchOn] = useState(false)
  const [paused, setPaused] = useState(false)
  const [lastDiff, setLastDiff] = useState(0)
  const [statusLine, setStatusLine] = useState("Tap Start to begin")
  const [rectResult, setRectResult] = useState<{ x: number; y: number; w: number; h: number } | null>(null)

  // Thumbnails
  const [thumbs, setThumbs] = useState<Thumb[]>([])

  // Queue metadata (refreshes periodically)
  const [queueMeta, setQueueMeta] = useState<QueueItemMeta[]>([])
  const [pausedUntil, setPausedUntil] = useState(0)

  // Tuning prefs (persisted in localStorage)
  const [prefs, setPrefs] = useState<{
    autoCapture: boolean
    torchWanted: boolean
    tuning: AutoCaptureTuning
  }>(() => {
    try {
      const s = localStorage.getItem("rapid_scan_prefs")
      if (s) return JSON.parse(s)
    } catch {}
    return { autoCapture: true, torchWanted: true, tuning: { ...DEFAULT_TUNING } }
  })

  // Workers
  const workersRunning = useRef(false)
  const stopWorkers = useRef(false)

  // ──────────────────────────────────────────────────────────────────────────
  // PERSIST PREFS
  // ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem("rapid_scan_prefs", JSON.stringify(prefs))
  }, [prefs])

  // ──────────────────────────────────────────────────────────────────────────
  // QUEUE REFRESH
  // ──────────────────────────────────────────────────────────────────────────
  const refreshMeta = useCallback(async () => {
    const all = await idbGetAll()
    setQueueMeta(all.map(({ blob, ...rest }) => rest))
  }, [])

  useEffect(() => {
    refreshMeta()
  }, [refreshMeta])

  // ──────────────────────────────────────────────────────────────────────────
  // WORKERS
  // ──────────────────────────────────────────────────────────────────────────
  function ensureWorkersRunning() {
    if (workersRunning.current) return
    workersRunning.current = true
    stopWorkers.current = false

    for (let i = 0; i < WORKER_THREADS; i++) {
      workerLoop()
    }
  }

  async function workerLoop() {
    while (!stopWorkers.current) {
      const pauseMs = pausedUntil - Date.now()
      if (pauseMs > 0) {
        await sleep(Math.min(pauseMs, 900))
        continue
      }

      const next = await idbGetNextQueued()
      if (!next) {
        await sleep(220)
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

        // domino-failure killer: pause after rate limit so everything doesn't fail
        if (/429|rate limit|too many/i.test(msg)) {
          setPausedUntil(Date.now() + RATE_LIMIT_PAUSE_MS)
        }
      }

      await refreshMeta()
      await sleep(BASE_BETWEEN_JOBS_MS)
    }
  }

  async function processOne(id: string) {
    const item = await idbGet(id)
    if (!item) throw new Error("Queue item missing")

    const filePath = `cards/${item.id}.jpg`
    const file = new File([item.blob], item.filename, { type: item.mime })

    // upload
    await withRetry(async () => {
      const res = await supabase.storage.from("card-images").upload(filePath, file, { upsert: false })
      if (res.error) throw new Error(res.error.message)
      return res.data
    })

    // signed URL
    const imageUrl = await withRetry(async () => {
      const res = await supabase.storage.from("card-images").createSignedUrl(filePath, 60 * 60 * 24)
      if (res.error) throw new Error(res.error.message)
      if (!res.data?.signedUrl) throw new Error("Signed URL missing")
      return res.data.signedUrl
    })

    // identify
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

  // ──────────────────────────────────────────────────────────────────────────
  // ENQUEUE
  // ──────────────────────────────────────────────────────────────────────────
  async function enqueueBlob(blob: Blob, filename = "card.jpg") {
    const current = await idbCount()
    if (current >= QUEUE_MAX) {
      setStatusLine(`Queue full (${QUEUE_MAX}). Let it process or clear.`)
      return
    }

    const id = safeUUID()
    await idbAdd({
      id,
      createdAt: Date.now(),
      status: "queued",
      blob,
      mime: blob.type || "image/jpeg",
      filename,
    })

    // local thumb
    const url = URL.createObjectURL(blob)
    setThumbs((prev) => {
      const next = [{ id, url, createdAt: Date.now() }, ...prev]
      while (next.length > THUMB_MAX) {
        const last = next.pop()
        if (last) URL.revokeObjectURL(last.url)
      }
      return next
    })

    await refreshMeta()
    ensureWorkersRunning()
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CAMERA
  // ──────────────────────────────────────────────────────────────────────────
  async function startCamera() {
    if (cameraOn) return

    try {
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

      // apply torch preference
      if (prefs.torchWanted) {
        const ok = await setTorch(trackRef.current, true)
        setTorchOn(ok)
      } else {
        setTorchOn(false)
      }

      // reset analysis
      prevGrayRef.current = null
      autoStateRef.current = { phase: "idle", stableFrames: 0, lastCaptureAt: 0, lastDiff: 0 }
      flowStateRef.current = "READY_FOR_ENTRY"
      setRectResult(null)
      setLastDiff(0)
      setStatusLine("Camera live — feed cards")

      startAnalysisLoop()
    } catch (err: any) {
      setStatusLine(`Camera error: ${err?.message ?? err}`)
    }
  }

  async function stopCamera() {
    stopAnalysisLoop()

    // torch off (best-effort)
    if (torchOn) {
      await setTorch(trackRef.current, false)
      setTorchOn(false)
    }

    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    trackRef.current = null
    setCameraOn(false)
    setStatusLine("Camera stopped")
  }

  // ──────────────────────────────────────────────────────────────────────────
  // TORCH / FOCUS
  // ──────────────────────────────────────────────────────────────────────────
  async function toggleTorch() {
    const next = !torchOn
    const ok = await setTorch(trackRef.current, next)
    if (ok) {
      setTorchOn(next)
      setPrefs((p) => ({ ...p, torchWanted: next }))
    }
  }

  const handleVideoTap = useCallback(
    async (e: React.MouseEvent<HTMLVideoElement>) => {
      if (!support.focus) return
      const rect = (e.target as HTMLVideoElement).getBoundingClientRect()
      const x = (e.clientX - rect.left) / rect.width
      const y = (e.clientY - rect.top) / rect.height
      await setFocusPoint(trackRef.current, { x, y })
    },
    [support.focus]
  )

  // ──────────────────────────────────────────────────────────────────────────
  // ANALYSIS LOOP (auto-capture)
  // ──────────────────────────────────────────────────────────────────────────
  function startAnalysisLoop() {
    if (rafRef.current) return
    const loop = () => {
      if (!paused) analyzeFrame()
      rafRef.current = requestAnimationFrame(loop)
    }
    rafRef.current = requestAnimationFrame(loop)
  }

  function stopAnalysisLoop() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = 0
    }
  }

  function analyzeFrame() {
    const video = videoRef.current
    const canvas = canvasRef.current
    if (!video || !canvas || video.readyState < 2) return

    const ctx = canvas.getContext("2d", { willReadFrequently: true })
    if (!ctx) return

    const { sampleW, sampleH } = prefs.tuning
    canvas.width = sampleW
    canvas.height = sampleH
    ctx.drawImage(video, 0, 0, sampleW, sampleH)
    const imgData = ctx.getImageData(0, 0, sampleW, sampleH)
    const gray = rgbaToGray(imgData.data)

    if (!prevGrayRef.current) {
      prevGrayRef.current = gray
      return
    }

    const diff = meanAbsDiff(prevGrayRef.current, gray)
    prevGrayRef.current = gray
    setLastDiff(diff)

    if (!prefs.autoCapture) return

    const { state, shouldCapture } = nextAutoCaptureState(
      autoStateRef.current,
      diff,
      Date.now(),
      prefs.tuning
    )
    autoStateRef.current = state

    if (shouldCapture) {
      captureNow()
    }
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CAPTURE
  // ──────────────────────────────────────────────────────────────────────────
  async function captureNow() {
    const video = videoRef.current
    if (!video || video.readyState < 2) return

    const w = video.videoWidth
    const h = video.videoHeight
    const offscreen = document.createElement("canvas")
    offscreen.width = w
    offscreen.height = h
    const ctx = offscreen.getContext("2d")
    if (!ctx) return

    ctx.drawImage(video, 0, 0, w, h)

    offscreen.toBlob(
      async (blob) => {
        if (!blob) return
        await enqueueBlob(blob, `card_${Date.now()}.jpg`)
        setStatusLine(`Captured! ${queueMeta.length + 1} in queue`)
      },
      "image/jpeg",
      0.92
    )
  }

  // ──────────────────────────────────────────────────────────────────────────
  // CLEAR QUEUE
  // ──────────────────────────────────────────────────────────────────────────
  async function handleClearQueue() {
    await idbClear()
    thumbs.forEach((t) => URL.revokeObjectURL(t.url))
    setThumbs([])
    await refreshMeta()
    setStatusLine("Queue cleared")
  }

  // ──────────────────────────────────────────────────────────────────────────
  // RENDER
  // ──────────────────────────────────────────────────────────────────────────
  const queuedCount = queueMeta.filter((m) => m.status === "queued").length
  const processingCount = queueMeta.filter((m) => m.status === "processing").length
  const errorCount = queueMeta.filter((m) => m.status === "error").length

  return (
    <Card className="p-4 space-y-4">
      {/* Video */}
      <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
        <video
          ref={videoRef}
          className="w-full h-full object-cover"
          playsInline
          muted
          onClick={handleVideoTap}
        />
        {!cameraOn && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/80">
            <span className="text-muted-foreground">Camera Off</span>
          </div>
        )}
        <canvas ref={canvasRef} className="hidden" />
      </div>

      {/* Status */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{statusLine}</span>
        <Badge variant="outline">Diff: {lastDiff.toFixed(1)}</Badge>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-2">
        {!cameraOn ? (
          <Button onClick={startCamera}>
            <Camera className="mr-2 h-4 w-4" />
            Start
          </Button>
        ) : (
          <Button variant="destructive" onClick={stopCamera}>
            <CameraOff className="mr-2 h-4 w-4" />
            Stop
          </Button>
        )}

        {cameraOn && support.torch && (
          <Button variant={torchOn ? "secondary" : "outline"} onClick={toggleTorch}>
            {torchOn ? <Flashlight className="h-4 w-4" /> : <FlashlightOff className="h-4 w-4" />}
          </Button>
        )}

        {cameraOn && (
          <Button variant="outline" onClick={captureNow}>
            Manual Capture
          </Button>
        )}

        <Button variant="ghost" onClick={() => setPaused((p) => !p)}>
          {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </Button>

        <Button variant="ghost" onClick={handleClearQueue}>
          <Trash2 className="h-4 w-4 mr-1" />
          Clear
        </Button>
      </div>

      {/* Auto-capture toggle */}
      <div className="flex items-center gap-2">
        <Switch
          checked={prefs.autoCapture}
          onCheckedChange={(v) => setPrefs((p) => ({ ...p, autoCapture: v }))}
        />
        <span className="text-sm">Auto-capture</span>
      </div>

      {/* Queue status */}
      <div className="flex gap-2 text-sm">
        <Badge>Queued: {queuedCount}</Badge>
        <Badge variant="secondary">Processing: {processingCount}</Badge>
        {errorCount > 0 && <Badge variant="destructive">Errors: {errorCount}</Badge>}
      </div>

      {/* Thumbs */}
      {thumbs.length > 0 && (
        <div className="flex gap-2 overflow-x-auto py-2">
          {thumbs.map((t) => (
            <img
              key={t.id}
              src={t.url}
              alt="thumb"
              className="h-16 w-auto rounded border object-cover"
            />
          ))}
        </div>
      )}
    </Card>
  )
}
