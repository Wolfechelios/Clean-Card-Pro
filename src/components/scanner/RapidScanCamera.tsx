// src/components/scanner/RapidScanCamera.tsx
"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import {
  Camera,
  CameraOff,
  Flashlight,
  FlashlightOff,
  Trash2,
  Pause,
  Play,
  Volume2,
  VolumeX,
  Aperture,
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
  type QueueItemMeta,
} from "@/lib/idbQueue"
import { withRetry } from "@/lib/retry"
import { cn } from "@/lib/utils"
import { useCameraDevices } from "@/hooks/use-camera-devices"
import { useCameraZoom } from "@/hooks/use-camera-zoom"
import { CameraDeviceSelector } from "./CameraDeviceSelector"
import { ZoomControls } from "./ZoomControls"

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
  const shutterAudioRef = useRef<HTMLAudioElement | null>(null)

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

  // Thumbnails
  const [thumbs, setThumbs] = useState<Thumb[]>([])

  // Queue metadata (refreshes periodically)
  const [queueMeta, setQueueMeta] = useState<QueueItemMeta[]>([])
  const [pausedUntil, setPausedUntil] = useState(0)

  // Camera devices
  const {
    devices,
    selectedDeviceId,
    setSelectedDeviceId,
    isLoading: devicesLoading,
    refreshDevices,
  } = useCameraDevices()

  // Camera zoom
  const {
    zoomLevel,
    zoomCapabilities,
    usingDigitalZoom,
    detectZoomCapabilities,
    setZoom,
    zoomIn,
    zoomOut,
    resetZoom,
  } = useCameraZoom({ streamRef })

  // Tuning prefs (persisted in localStorage)
  const [prefs, setPrefs] = useState<{
    autoCapture: boolean
    torchWanted: boolean
    soundEnabled: boolean
    tuning: AutoCaptureTuning
  }>(() => {
    try {
      const s = localStorage.getItem("rapid_scan_prefs")
      if (s) {
        const parsed = JSON.parse(s)
        return { soundEnabled: true, ...parsed }
      }
    } catch {}
    return { autoCapture: true, torchWanted: true, soundEnabled: true, tuning: { ...DEFAULT_TUNING } }
  })

  // Workers
  const workersRunning = useRef(false)
  const stopWorkers = useRef(false)

  // ──────────────────────────────────────────────────────────────────────────
  // INIT SHUTTER AUDIO
  // ──────────────────────────────────────────────────────────────────────────
  useEffect(() => {
    shutterAudioRef.current = new Audio("/sounds/shutter.mp3")
    shutterAudioRef.current.volume = 0.5
    return () => {
      shutterAudioRef.current = null
    }
  }, [])

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
      const constraints: MediaStreamConstraints = {
        video: selectedDeviceId
          ? { deviceId: { exact: selectedDeviceId }, width: { ideal: 1920 }, height: { ideal: 1080 } }
          : { facingMode: "environment", width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      }

      const stream = await navigator.mediaDevices.getUserMedia(constraints)

      streamRef.current = stream
      trackRef.current = getVideoTrack(stream)
      setSupport(detectSupport(trackRef.current))

      const v = videoRef.current
      if (!v) return

      v.srcObject = stream
      await v.play()
      setCameraOn(true)

      // Detect zoom capabilities
      detectZoomCapabilities()

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

  // Restart camera when device changes
  useEffect(() => {
    if (cameraOn && selectedDeviceId) {
      stopCamera().then(() => startCamera())
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDeviceId])

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

    // Play shutter sound
    if (prefs.soundEnabled && shutterAudioRef.current) {
      shutterAudioRef.current.currentTime = 0
      shutterAudioRef.current.play().catch(() => {})
    }

    const w = video.videoWidth
    const h = video.videoHeight
    const offscreen = document.createElement("canvas")
    offscreen.width = w
    offscreen.height = h
    const ctx = offscreen.getContext("2d")
    if (!ctx) return

    // Apply digital zoom crop if using digital zoom
    if (usingDigitalZoom && zoomLevel > 1) {
      const cropW = w / zoomLevel
      const cropH = h / zoomLevel
      const cropX = (w - cropW) / 2
      const cropY = (h - cropH) / 2
      ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, w, h)
    } else {
      ctx.drawImage(video, 0, 0, w, h)
    }

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
      {/* Camera Device Selector */}
      <CameraDeviceSelector
        devices={devices}
        selectedDeviceId={selectedDeviceId}
        onDeviceChange={setSelectedDeviceId}
        onRefresh={refreshDevices}
        isLoading={devicesLoading}
      />

      {/* Video */}
      <div className="relative aspect-video bg-black rounded-lg overflow-hidden">
        <video
          ref={videoRef}
          className={cn(
            "w-full h-full object-cover transition-transform duration-150",
            usingDigitalZoom && zoomLevel > 1 && `scale-[${zoomLevel}]`
          )}
          style={usingDigitalZoom && zoomLevel > 1 ? { transform: `scale(${zoomLevel})` } : undefined}
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

        {/* Zoom Controls Overlay */}
        {cameraOn && zoomCapabilities.supported && (
          <ZoomControls
            zoomLevel={zoomLevel}
            minZoom={zoomCapabilities.min}
            maxZoom={zoomCapabilities.max}
            supported={zoomCapabilities.supported}
            onZoomIn={zoomIn}
            onZoomOut={zoomOut}
            onZoomChange={setZoom}
            onReset={resetZoom}
            variant="overlay"
          />
        )}
      </div>

      {/* Status */}
      <div className="flex items-center justify-between">
        <span className="text-sm text-muted-foreground">{statusLine}</span>
        <div className="flex items-center gap-2">
          {usingDigitalZoom && zoomLevel > 1 && (
            <Badge variant="secondary" className="text-xs">Digital Zoom</Badge>
          )}
          <Badge variant="outline">Diff: {lastDiff.toFixed(1)}</Badge>
        </div>
      </div>

      {/* Controls */}
      <div className="flex flex-wrap gap-2">
        {!cameraOn ? (
          <Button onClick={startCamera} size="lg">
            <Camera className="mr-2 h-5 w-5" />
            Start Camera
          </Button>
        ) : (
          <>
            <Button 
              size="lg" 
              onClick={captureNow}
              className="bg-primary hover:bg-primary/90"
            >
              <Aperture className="mr-2 h-5 w-5" />
              Capture
            </Button>
            
            <Button variant="destructive" onClick={stopCamera}>
              <CameraOff className="mr-2 h-4 w-4" />
              Stop
            </Button>
          </>
        )}

        {cameraOn && support.torch && (
          <Button variant={torchOn ? "secondary" : "outline"} onClick={toggleTorch}>
            {torchOn ? <Flashlight className="h-4 w-4" /> : <FlashlightOff className="h-4 w-4" />}
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

      {/* Toggle Row */}
      <div className="flex items-center gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <Switch
            id="auto-capture"
            checked={prefs.autoCapture}
            onCheckedChange={(v) => setPrefs((p) => ({ ...p, autoCapture: v }))}
          />
          <Label htmlFor="auto-capture" className="text-sm">Auto-capture</Label>
        </div>

        <div className="flex items-center gap-2">
          <Switch
            id="sound-enabled"
            checked={prefs.soundEnabled}
            onCheckedChange={(v) => setPrefs((p) => ({ ...p, soundEnabled: v }))}
          />
          <Label htmlFor="sound-enabled" className="text-sm flex items-center gap-1">
            {prefs.soundEnabled ? <Volume2 className="h-3 w-3" /> : <VolumeX className="h-3 w-3" />}
            Sound
          </Label>
        </div>
      </div>

      {/* Queue status */}
      <div className="flex gap-2 text-sm flex-wrap">
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
