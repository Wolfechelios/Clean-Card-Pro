// Binder Page Capture: best-possible 9-pocket photo + auto-crop + enqueue
// to the existing Rapid Scanner pipeline (idbAdd -> queueProcessor ->
// rapid-card-identify). No new identification logic.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  Camera,
  Flashlight,
  FlashlightOff,
  RotateCw,
  X,
  Send,
  Loader2,
  Sparkles,
  Crop,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { idbAdd } from "@/lib/idbQueue";
import { useQueueProcessor } from "@/lib/queueProcessor";
import { compressImageForQueue } from "@/lib/imageCompressor";
import { getMaxCameraConstraints } from "@/lib/camera-optimizations";
import { setTorch, getVideoTrack } from "@/lib/mediaControls";
import { sharpnessScore } from "@/lib/binder/sharpness";
import { detectBinderPage, warpQuadToRect, type Point, type DetectedQuad } from "@/lib/binder/pageDetect";
import { sliceGrid, canvasToBlob, type CellCrop } from "@/lib/binder/gridSlicer";

type Phase = "camera" | "review";

interface BinderPageCaptureProps {
  open: boolean;
  onClose: () => void;
  /** Visual context shown in header (e.g. selected set name) */
  setName?: string | null;
}

const WARP_W = 1500; // perspective-corrected output width
const ASPECT_3x3 = 1.05; // 9-pocket page is roughly square; tweak if needed
const CARDS_ASPECT = 2.5 / 3.5;

function uuid() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxx-xxxx-xxxx".replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));
}

export function BinderPageCapture({ open, onClose, setName }: BinderPageCaptureProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [phase, setPhase] = useState<Phase>("camera");
  const [torchOn, setTorchOn] = useState(false);
  const [steady, setSteady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [enqueuing, setEnqueuing] = useState(false);

  // Capture state
  const [sourceCanvas, setSourceCanvas] = useState<HTMLCanvasElement | null>(null);
  const [quad, setQuad] = useState<DetectedQuad | null>(null);
  const [warped, setWarped] = useState<HTMLCanvasElement | null>(null);

  // Slice config
  const [grid, setGrid] = useState<{ rows: number; cols: number }>({ rows: 3, cols: 3 });
  const [innerPadding, setInnerPadding] = useState<number>(0.06);
  const [cells, setCells] = useState<CellCrop[]>([]);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());
  const [rotations, setRotations] = useState<Record<number, number>>({});

  // Steady detection: motion check via frame diff
  const lastFrameRef = useRef<ImageData | null>(null);
  const steadyTickRef = useRef<number | null>(null);

  // Start the queue processor in the background while dialog is open so any
  // existing queued items keep moving.
  const startProcessor = useQueueProcessor((s) => s.start);

  // Boot camera when entering camera phase.
  useEffect(() => {
    if (!open || phase !== "camera") return;
    let cancelled = false;

    (async () => {
      try {
        const tries = getMaxCameraConstraints("environment");
        let stream: MediaStream | null = null;
        for (const c of tries) {
          try {
            stream = await navigator.mediaDevices.getUserMedia(c as MediaStreamConstraints);
            if (stream) break;
          } catch {
            // try next
          }
        }
        if (!stream) {
          toast.error("Could not access rear camera");
          return;
        }
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play().catch(() => {});
        }
        startProcessor?.();
      } catch (e: any) {
        toast.error(e?.message || "Failed to start camera");
      }
    })();

    return () => {
      cancelled = true;
      const s = streamRef.current;
      if (s) {
        s.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
      }
    };
  }, [open, phase, startProcessor]);

  // Steady / motion check loop while in camera phase.
  useEffect(() => {
    if (!open || phase !== "camera") return;
    const sample = document.createElement("canvas");
    sample.width = 96;
    sample.height = 72;
    const sctx = sample.getContext("2d", { willReadFrequently: true });
    if (!sctx) return;

    const tick = () => {
      const v = videoRef.current;
      if (v && v.videoWidth > 0) {
        sctx.drawImage(v, 0, 0, sample.width, sample.height);
        const cur = sctx.getImageData(0, 0, sample.width, sample.height);
        const prev = lastFrameRef.current;
        if (prev) {
          let diff = 0;
          const n = cur.data.length;
          for (let i = 0; i < n; i += 16) {
            diff += Math.abs(cur.data[i] - prev.data[i]);
          }
          const norm = diff / (n / 16);
          setSteady(norm < 6);
        }
        lastFrameRef.current = cur;
      }
      steadyTickRef.current = window.setTimeout(tick, 200);
    };
    tick();
    return () => {
      if (steadyTickRef.current) clearTimeout(steadyTickRef.current);
      lastFrameRef.current = null;
    };
  }, [open, phase]);

  const handleTorchToggle = useCallback(async () => {
    const next = !torchOn;
    const track = streamRef.current ? getVideoTrack(streamRef.current) : null;
    if (!track) {
      toast.message("Torch not available on this device");
      return;
    }
    const ok = await setTorch(track, next);
    setTorchOn(ok ? next : torchOn);
    if (!ok) toast.message("Torch not supported");
  }, [torchOn]);

  // Multi-frame capture: take 3 frames ~120ms apart, keep the sharpest.
  const captureBestFrame = useCallback(async (): Promise<HTMLCanvasElement | null> => {
    const v = videoRef.current;
    if (!v || v.videoWidth === 0) return null;
    const w = v.videoWidth;
    const h = v.videoHeight;
    const frames: HTMLCanvasElement[] = [];
    for (let i = 0; i < 3; i++) {
      const c = document.createElement("canvas");
      c.width = w;
      c.height = h;
      const ctx = c.getContext("2d");
      if (!ctx) continue;
      ctx.drawImage(v, 0, 0, w, h);
      frames.push(c);
      if (i < 2) await new Promise((r) => setTimeout(r, 120));
    }
    if (frames.length === 0) return null;
    let best = frames[0];
    let bestScore = sharpnessScore(best);
    for (let i = 1; i < frames.length; i++) {
      const s = sharpnessScore(frames[i]);
      if (s > bestScore) {
        best = frames[i];
        bestScore = s;
      }
    }
    return best;
  }, []);

  const handleCapture = useCallback(async () => {
    if (capturing) return;
    setCapturing(true);
    try {
      const best = await captureBestFrame();
      if (!best) {
        toast.error("Could not grab a frame");
        return;
      }
      const detected = await detectBinderPage(best);
      const fallbackQuad: DetectedQuad = {
        topLeft: { x: best.width * 0.05, y: best.height * 0.05 },
        topRight: { x: best.width * 0.95, y: best.height * 0.05 },
        bottomRight: { x: best.width * 0.95, y: best.height * 0.95 },
        bottomLeft: { x: best.width * 0.05, y: best.height * 0.95 },
        confidence: 0,
      };
      const finalQuad = detected ?? fallbackQuad;
      setSourceCanvas(best);
      setQuad(finalQuad);
      // Re-slice immediately
      const outH = Math.round(WARP_W / ASPECT_3x3);
      const w = warpQuadToRect(best, finalQuad, WARP_W, outH);
      if (!w) {
        toast.error("Perspective correction failed");
        return;
      }
      setWarped(w);
      const sliced = sliceGrid(w, { rows: grid.rows, cols: grid.cols, innerPadding });
      setCells(sliced);
      setSkipped(new Set());
      setRotations({});
      setPhase("review");
      if (!detected || detected.confidence < 0.4) {
        toast.message("Auto-detect was uncertain — adjust the grid if needed");
      }
    } catch (e: any) {
      toast.error(e?.message || "Capture failed");
    } finally {
      setCapturing(false);
    }
  }, [captureBestFrame, capturing, grid.rows, grid.cols, innerPadding]);

  // Re-slice when grid / padding / rotations change in review phase.
  useEffect(() => {
    if (phase !== "review" || !warped) return;
    const rotArray: number[] = [];
    for (let i = 0; i < grid.rows * grid.cols; i++) rotArray[i] = rotations[i] ?? 0;
    const sliced = sliceGrid(warped, {
      rows: grid.rows,
      cols: grid.cols,
      innerPadding,
      rotations: rotArray,
    });
    setCells(sliced);
  }, [phase, warped, grid.rows, grid.cols, innerPadding, rotations]);

  const handleReshoot = useCallback(() => {
    setSourceCanvas(null);
    setQuad(null);
    setWarped(null);
    setCells([]);
    setSkipped(new Set());
    setRotations({});
    setPhase("camera");
  }, []);

  const handleConfirm = useCallback(async () => {
    if (enqueuing) return;
    setEnqueuing(true);
    try {
      const toEnqueue = cells.filter((c) => !skipped.has(c.index));
      if (toEnqueue.length === 0) {
        toast.message("Nothing to send — all pockets skipped");
        return;
      }
      let ok = 0;
      for (const c of toEnqueue) {
        try {
          const blob = await canvasToBlob(c.canvas, 0.92);
          const compressed = await compressImageForQueue(blob);
          await idbAdd({
            id: uuid(),
            createdAt: Date.now(),
            status: "queued",
            blob: compressed,
            mime: compressed.type || "image/jpeg",
            filename: `binder-r${c.row}c${c.col}.jpg`,
          });
          ok++;
        } catch (e) {
          console.error("[BinderCapture] enqueue failed", e);
        }
      }
      // Kick the processor.
      startProcessor?.();
      toast.success(`Sent ${ok} card${ok === 1 ? "" : "s"} to the scan queue`);
      onClose();
    } catch (e: any) {
      toast.error(e?.message || "Failed to enqueue");
    } finally {
      setEnqueuing(false);
    }
  }, [cells, skipped, enqueuing, startProcessor, onClose]);

  const toggleSkip = useCallback((idx: number) => {
    setSkipped((prev) => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  }, []);

  const rotateCell = useCallback((idx: number) => {
    setRotations((prev) => ({ ...prev, [idx]: ((prev[idx] ?? 0) + 90) % 360 }));
  }, []);

  // Manual quad drag handles (in review phase, on the source canvas overlay).
  const dragRef = useRef<{ corner: keyof DetectedQuad | null; rect: DOMRect | null }>({
    corner: null,
    rect: null,
  });

  const onCornerPointerDown = (corner: keyof DetectedQuad, e: React.PointerEvent) => {
    const target = e.currentTarget as HTMLDivElement;
    const stage = target.parentElement;
    if (!stage) return;
    dragRef.current = { corner, rect: stage.getBoundingClientRect() };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onStagePointerMove = (e: React.PointerEvent) => {
    const { corner, rect } = dragRef.current;
    if (!corner || !rect || !sourceCanvas || !quad) return;
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    const nx = Math.max(0, Math.min(1, px)) * sourceCanvas.width;
    const ny = Math.max(0, Math.min(1, py)) * sourceCanvas.height;
    const nextQuad: DetectedQuad = { ...quad, [corner]: { x: nx, y: ny } as Point };
    setQuad(nextQuad);
    const outH = Math.round(WARP_W / ASPECT_3x3);
    const w = warpQuadToRect(sourceCanvas, nextQuad, WARP_W, outH);
    if (w) setWarped(w);
  };
  const onCornerPointerUp = (e: React.PointerEvent) => {
    dragRef.current = { corner: null, rect: null };
    try {
      (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }
  };

  // Render helpers
  const renderCornerHandles = () => {
    if (!sourceCanvas || !quad) return null;
    const corners: Array<{ key: keyof DetectedQuad; p: Point }> = [
      { key: "topLeft", p: quad.topLeft },
      { key: "topRight", p: quad.topRight },
      { key: "bottomRight", p: quad.bottomRight },
      { key: "bottomLeft", p: quad.bottomLeft },
    ];
    return corners.map(({ key, p }) => (
      <div
        key={key}
        onPointerDown={(e) => onCornerPointerDown(key, e)}
        onPointerUp={onCornerPointerUp}
        className="absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-primary/30 backdrop-blur cursor-grab active:cursor-grabbing touch-none"
        style={{
          left: `${(p.x / sourceCanvas.width) * 100}%`,
          top: `${(p.y / sourceCanvas.height) * 100}%`,
        }}
      />
    ));
  };

  // Convert each cell canvas to a stable preview URL (blob URL) for display.
  const [cellPreviews, setCellPreviews] = useState<Record<number, string>>({});
  useEffect(() => {
    if (cells.length === 0) {
      setCellPreviews({});
      return;
    }
    let cancelled = false;
    (async () => {
      const map: Record<number, string> = {};
      for (const c of cells) {
        try {
          const b = await canvasToBlob(c.canvas, 0.85);
          if (cancelled) return;
          map[c.index] = URL.createObjectURL(b);
        } catch {
          // ignore
        }
      }
      if (!cancelled) {
        setCellPreviews((prev) => {
          // revoke prior
          for (const k of Object.keys(prev)) URL.revokeObjectURL(prev[k as any]);
          return map;
        });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [cells]);

  // Cleanup preview URLs on unmount.
  useEffect(() => {
    return () => {
      for (const k of Object.keys(cellPreviews)) URL.revokeObjectURL(cellPreviews[k as any]);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-4xl p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 py-3 border-b border-border/60">
          <DialogTitle className="text-base flex items-center gap-2">
            <Camera className="h-4 w-4 text-primary" />
            Capture Binder Page
            {setName && <Badge variant="secondary" className="ml-2 text-[10px]">{setName}</Badge>}
          </DialogTitle>
          <DialogDescription className="text-xs">
            {phase === "camera"
              ? "Hold the binder page flat in the frame. The app will auto-crop into individual cards."
              : "Review the 9 cropped cards. Adjust the grid or skip empty pockets, then send to the scan queue."}
          </DialogDescription>
        </DialogHeader>

        {phase === "camera" && (
          <div className="relative bg-black aspect-[4/3] overflow-hidden">
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover"
              playsInline
              muted
            />
            {/* 3x3 alignment guide */}
            <div className="absolute inset-0 pointer-events-none">
              <div className="absolute inset-[6%] border-2 border-primary/70 rounded-md">
                {/* internal grid lines */}
                {[1, 2].map((i) => (
                  <div
                    key={`v${i}`}
                    className="absolute top-0 bottom-0 w-px bg-primary/40"
                    style={{ left: `${(i / 3) * 100}%` }}
                  />
                ))}
                {[1, 2].map((i) => (
                  <div
                    key={`h${i}`}
                    className="absolute left-0 right-0 h-px bg-primary/40"
                    style={{ top: `${(i / 3) * 100}%` }}
                  />
                ))}
                {/* corner marks */}
                {([
                  ["top-0 left-0", "border-t-2 border-l-2"],
                  ["top-0 right-0", "border-t-2 border-r-2"],
                  ["bottom-0 left-0", "border-b-2 border-l-2"],
                  ["bottom-0 right-0", "border-b-2 border-r-2"],
                ] as const).map(([pos, b], i) => (
                  <div key={i} className={cn("absolute h-6 w-6 border-primary", pos, b)} />
                ))}
              </div>
            </div>

            {/* Steady badge */}
            <div className="absolute top-3 left-3 flex items-center gap-2">
              <Badge
                variant="secondary"
                className={cn(
                  "text-[10px] backdrop-blur",
                  steady ? "bg-primary/20 text-primary border-primary/30" : "bg-amber-500/20 text-amber-300 border-amber-500/30"
                )}
              >
                {steady ? "Steady" : "Hold steady…"}
              </Badge>
            </div>

            {/* Controls */}
            <div className="absolute bottom-3 left-1/2 -translate-x-1/2 flex items-center gap-3">
              <Button
                variant="secondary"
                size="icon"
                className="rounded-full backdrop-blur bg-card/70"
                onClick={handleTorchToggle}
              >
                {torchOn ? <FlashlightOff className="h-4 w-4" /> : <Flashlight className="h-4 w-4" />}
              </Button>
              <Button
                size="lg"
                className="rounded-full h-16 w-16 p-0 shadow-lg"
                onClick={handleCapture}
                disabled={capturing}
              >
                {capturing ? <Loader2 className="h-6 w-6 animate-spin" /> : <Camera className="h-6 w-6" />}
              </Button>
              <Button
                variant="secondary"
                size="icon"
                className="rounded-full backdrop-blur bg-card/70"
                onClick={onClose}
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        {phase === "review" && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-0 max-h-[80vh] overflow-hidden">
            {/* Left: source with corner handles + cell previews */}
            <div className="overflow-y-auto p-4 space-y-4 bg-muted/20">
              {sourceCanvas && (
                <div
                  className="relative w-full bg-black rounded-lg overflow-hidden"
                  onPointerMove={onStagePointerMove}
                  style={{ aspectRatio: `${sourceCanvas.width} / ${sourceCanvas.height}` }}
                >
                  <img
                    src={sourceCanvas.toDataURL("image/jpeg", 0.7)}
                    alt="Captured binder page"
                    className="absolute inset-0 w-full h-full object-contain"
                  />
                  {/* Quad outline */}
                  {quad && (
                    <svg
                      className="absolute inset-0 w-full h-full pointer-events-none"
                      viewBox={`0 0 ${sourceCanvas.width} ${sourceCanvas.height}`}
                      preserveAspectRatio="none"
                    >
                      <polygon
                        points={[
                          quad.topLeft,
                          quad.topRight,
                          quad.bottomRight,
                          quad.bottomLeft,
                        ]
                          .map((p) => `${p.x},${p.y}`)
                          .join(" ")}
                        fill="hsl(var(--primary) / 0.1)"
                        stroke="hsl(var(--primary))"
                        strokeWidth={Math.max(2, sourceCanvas.width / 400)}
                      />
                    </svg>
                  )}
                  {renderCornerHandles()}
                </div>
              )}

              {/* Cells preview */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <Label className="text-xs text-muted-foreground">Detected Cards</Label>
                  <span className="text-[10px] text-muted-foreground">
                    {cells.length - skipped.size} of {cells.length} will be sent
                  </span>
                </div>
                <div
                  className="grid gap-2"
                  style={{ gridTemplateColumns: `repeat(${grid.cols}, minmax(0, 1fr))` }}
                >
                  {cells.map((c) => {
                    const url = cellPreviews[c.index];
                    const isSkipped = skipped.has(c.index);
                    return (
                      <div
                        key={c.index}
                        className={cn(
                          "relative rounded-md overflow-hidden border bg-card",
                          isSkipped ? "border-destructive/40 opacity-50" : "border-border/60"
                        )}
                        style={{ aspectRatio: `${CARDS_ASPECT}` }}
                      >
                        {url ? (
                          <img src={url} alt={`Card ${c.index + 1}`} className="absolute inset-0 w-full h-full object-cover" />
                        ) : (
                          <div className="absolute inset-0 flex items-center justify-center">
                            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                          </div>
                        )}
                        {/* per-cell controls */}
                        <div className="absolute inset-x-1 bottom-1 flex items-center justify-between gap-1">
                          <button
                            onClick={() => rotateCell(c.index)}
                            className="h-6 w-6 rounded bg-background/80 backdrop-blur flex items-center justify-center text-foreground hover:bg-background"
                            title="Rotate 90°"
                          >
                            <RotateCw className="h-3 w-3" />
                          </button>
                          <button
                            onClick={() => toggleSkip(c.index)}
                            className={cn(
                              "h-6 px-1.5 rounded text-[10px] font-medium backdrop-blur",
                              isSkipped
                                ? "bg-destructive text-destructive-foreground"
                                : "bg-background/80 text-foreground hover:bg-background"
                            )}
                          >
                            {isSkipped ? "Skipped" : "Skip"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Right: controls */}
            <div className="border-l border-border/60 p-4 space-y-5 overflow-y-auto bg-card">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Grid</Label>
                <Select
                  value={`${grid.rows}x${grid.cols}`}
                  onValueChange={(v) => {
                    const [r, c] = v.split("x").map(Number);
                    setGrid({ rows: r, cols: c });
                    setRotations({});
                    setSkipped(new Set());
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="3x3">3×3 (9-pocket)</SelectItem>
                    <SelectItem value="4x3">4×3 (12-pocket)</SelectItem>
                    <SelectItem value="3x4">3×4 (12-pocket horizontal)</SelectItem>
                    <SelectItem value="2x2">2×2 (4-pocket)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label className="text-xs text-muted-foreground">Inner Padding</Label>
                  <span className="text-[10px] text-muted-foreground">{Math.round(innerPadding * 100)}%</span>
                </div>
                <Slider
                  value={[innerPadding * 100]}
                  min={0}
                  max={20}
                  step={1}
                  onValueChange={(v) => setInnerPadding((v[0] ?? 0) / 100)}
                />
                <p className="text-[10px] text-muted-foreground leading-tight">
                  Trims plastic pocket edges from each crop. Increase if you see seams.
                </p>
              </div>

              {quad && (
                <div className="rounded-md border border-border/60 bg-muted/30 p-2 text-[11px] text-muted-foreground space-y-1">
                  <div className="flex items-center gap-1.5 text-foreground">
                    <Sparkles className="h-3 w-3 text-primary" />
                    <span className="font-medium">Auto-detect</span>
                    <Badge
                      variant="secondary"
                      className={cn(
                        "ml-auto text-[9px]",
                        quad.confidence > 0.6
                          ? "bg-primary/15 text-primary border-primary/30"
                          : "bg-amber-500/15 text-amber-300 border-amber-500/30"
                      )}
                    >
                      {Math.round(quad.confidence * 100)}%
                    </Badge>
                  </div>
                  <p className="leading-tight">
                    Drag the corner handles on the photo if the page edges aren't followed.
                  </p>
                </div>
              )}

              <div className="space-y-2 pt-2 border-t border-border/60">
                <Button onClick={handleConfirm} disabled={enqueuing} className="w-full">
                  {enqueuing ? (
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Send className="h-4 w-4 mr-2" />
                  )}
                  Send {cells.length - skipped.size} to Scan Queue
                </Button>
                <Button onClick={handleReshoot} variant="outline" className="w-full">
                  <Camera className="h-4 w-4 mr-2" />
                  Re-shoot Page
                </Button>
                <Button onClick={onClose} variant="ghost" className="w-full text-muted-foreground">
                  Cancel
                </Button>
              </div>

              <div className="rounded-md bg-muted/30 border border-border/60 p-2 text-[11px] text-muted-foreground flex items-start gap-1.5">
                <Crop className="h-3 w-3 mt-0.5 text-primary shrink-0" />
                <span className="leading-tight">
                  Each crop runs through the same identification pipeline as Rapid Scan — name,
                  set, rarity and price are filled in automatically.
                </span>
              </div>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
