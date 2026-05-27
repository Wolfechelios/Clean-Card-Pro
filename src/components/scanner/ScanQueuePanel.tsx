// src/components/scanner/ScanQueuePanel.tsx
// Always-visible scan queue control: start/stop the lookup pipeline,
// see pending captures immediately, and tune worker concurrency.

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Slider } from "@/components/ui/slider";
import { Loader2, Play, Pause, Square, RotateCcw, Trash2, Cpu } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

import {
  useQueueProcessor,
  retryAllErrors,
  clearScanQueue,
} from "@/lib/queueProcessor";
import { idbListMetaFast, idbGet, type QueueItemMeta } from "@/lib/idbQueue";
import { useScannerSettings } from "@/hooks/use-scanner-settings";
import { useGlobalProcessControl } from "@/hooks/use-global-process-control";

export function ScanQueuePanel() {
  const {
    isRunning,
    isPaused,
    queueCount,
    processedCount,
    errorCount,
    currentItem,
    start,
    stop,
    pause,
    resume,
    refreshQueue,
  } = useQueueProcessor();

  const { settings, updateSettings } = useScannerSettings();
  const scannerActive = useGlobalProcessControl((s) => s.scannerActive);
  const workerSetting = settings.maxWorkersOverride || 0; // 0 = auto

  const [pending, setPending] = useState<QueueItemMeta[]>([]);
  const [thumbs, setThumbs] = useState<Record<string, string>>({});

  // Poll IndexedDB queue meta so newly-snapped photos appear immediately.
  useEffect(() => {
    let alive = true;

    const tick = async () => {
      try {
        const all = await idbListMetaFast(50);
        if (!alive) return;
        setPending(all);
        refreshQueue();

        // Lazily build object-URL thumbnails for new items
        setThumbs((prev) => {
          const next = { ...prev };
          for (const m of all) {
            if (!next[m.id]) {
              idbGet(m.id).then((full) => {
                if (!full || !alive) return;
                try {
                  const url = URL.createObjectURL(full.blob);
                  setThumbs((t) => (t[m.id] ? t : { ...t, [m.id]: url }));
                } catch {
                  /* ignore */
                }
              });
            }
          }
          return next;
        });
      } catch {
        /* ignore */
      }
    };

    tick();
    const int = setInterval(tick, 1000);
    const onScan = () => tick();
    window.addEventListener("recent-scan-added", onScan);
    return () => {
      alive = false;
      clearInterval(int);
      window.removeEventListener("recent-scan-added", onScan);
      Object.values(thumbs).forEach((u) => {
        try { URL.revokeObjectURL(u); } catch {}
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const totals = useMemo(() => {
    let queued = 0, processing = 0, error = 0;
    for (const m of pending) {
      if (m.status === "queued") queued++;
      else if (m.status === "processing") processing++;
      else if (m.status === "error") error++;
    }
    return { queued, processing, error };
  }, [pending]);

  // Hide the entire panel only when there's truly nothing to show.
  if (!isRunning && pending.length === 0 && processedCount === 0) {
    return null;
  }

  const handleStart = () => {
    start(true);
    toast.success("Lookup started");
  };
  const handleStop = () => {
    stop();
    toast("Lookup stopped — captures kept in queue", { icon: "⏹️" });
  };
  const handleRetry = async () => {
    const n = await retryAllErrors();
    toast.success(n > 0 ? `Re-queued ${n} failed scans` : "No failed scans to retry");
    if (!isRunning) start(true);
  };
  const handleClear = async () => {
    if (!confirm("Clear ALL queued scans? Captures not yet identified will be lost.")) return;
    await clearScanQueue();
    setThumbs({});
    toast.success("Scan queue cleared");
  };

  const statusLabel = isRunning
    ? isPaused ? "Paused" : "Running"
    : pending.length > 0 ? "Stopped" : "Idle";

  const statusColor = isRunning && !isPaused
    ? "bg-primary/20 text-primary border-primary/40"
    : isPaused
    ? "bg-amber-500/20 text-amber-400 border-amber-500/40"
    : "bg-muted text-muted-foreground border-border";

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium flex items-center gap-2 flex-wrap">
          {isRunning && !isPaused ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : (
            <Cpu className="h-4 w-4 text-muted-foreground" />
          )}
          Scan Queue
          <Badge variant="outline" className={cn("text-[10px]", statusColor)}>
            {statusLabel}
          </Badge>
          <Badge variant="secondary" className="ml-auto text-[10px]">
            {totals.queued} queued
          </Badge>
          {totals.processing > 0 && (
            <Badge variant="secondary" className="text-[10px]">
              {totals.processing} processing
            </Badge>
          )}
          {totals.error > 0 && (
            <Badge variant="destructive" className="text-[10px]">
              {totals.error} failed
            </Badge>
          )}
          {processedCount > 0 && (
            <Badge variant="outline" className="text-[10px]">
              {processedCount} done
            </Badge>
          )}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-3">
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-2">
          {!isRunning && (
            <Button size="sm" onClick={handleStart} disabled={pending.length === 0 && queueCount === 0}>
              <Play className="h-3.5 w-3.5 mr-1" />
              Start lookup
            </Button>
          )}
          {isRunning && !isPaused && (
            <Button size="sm" variant="secondary" onClick={pause}>
              <Pause className="h-3.5 w-3.5 mr-1" />
              Pause
            </Button>
          )}
          {isRunning && isPaused && (
            <Button size="sm" onClick={resume}>
              <Play className="h-3.5 w-3.5 mr-1" />
              Resume
            </Button>
          )}
          {isRunning && (
            <Button size="sm" variant="destructive" onClick={handleStop}>
              <Square className="h-3.5 w-3.5 mr-1" />
              Stop
            </Button>
          )}
          {totals.error > 0 && (
            <Button size="sm" variant="outline" onClick={handleRetry}>
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Retry failed ({totals.error})
            </Button>
          )}
          {pending.length > 0 && (
            <Button size="sm" variant="outline" onClick={handleClear}>
              <Trash2 className="h-3.5 w-3.5 mr-1" />
              Clear queue
            </Button>
          )}
        </div>

        {/* Worker slider */}
        <div className="space-y-1.5 rounded-md border border-border bg-muted/20 p-2.5">
          <div className="flex items-center justify-between text-xs">
            <span className="font-medium">Workers</span>
            <span className="text-muted-foreground">
              {workerSetting === 0 ? "Auto (device tier)" : `${workerSetting} parallel`}
            </span>
          </div>
          <Slider
            min={0}
            max={8}
            step={1}
            value={[workerSetting]}
            onValueChange={([v]) => updateSettings({ maxWorkersOverride: v })}
          />
          <div className="flex items-center gap-1 text-[10px]">
            {[0, 1, 3, 6, 8].map((n) => (
              <button
                key={n}
                onClick={() => updateSettings({ maxWorkersOverride: n })}
                className={cn(
                  "px-1.5 py-0.5 rounded border border-border hover:border-primary/60 transition-colors",
                  workerSetting === n && "border-primary bg-primary/10 text-primary"
                )}
              >
                {n === 0 ? "Auto" : n}
              </button>
            ))}
          </div>
        </div>

        {/* Pending captures (visible immediately after photo) */}
        {pending.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[11px] font-medium text-muted-foreground">
              Pending captures ({pending.length})
            </div>
            <div className="grid grid-cols-6 sm:grid-cols-8 md:grid-cols-10 gap-1.5">
              {pending.slice(0, 24).map((m) => (
                <div
                  key={m.id}
                  className={cn(
                    "relative aspect-[3/4] rounded overflow-hidden border bg-muted",
                    m.status === "error" && "border-destructive",
                    m.status === "processing" && "border-primary",
                    m.status === "queued" && "border-border"
                  )}
                  title={m.error || m.status}
                >
                  {thumbs[m.id] ? (
                    <img
                      src={thumbs[m.id]}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center">
                      <Loader2 className="h-3 w-3 animate-spin text-muted-foreground" />
                    </div>
                  )}
                  <div className="absolute inset-x-0 bottom-0 text-[8px] text-center py-0.5 bg-background/70 backdrop-blur-sm">
                    {m.status === "processing" ? "…" : m.status === "error" ? "!" : "queue"}
                  </div>
                  {currentItem === m.id && (
                    <div className="absolute inset-0 ring-2 ring-primary pointer-events-none" />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
