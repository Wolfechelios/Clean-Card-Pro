// src/components/scanner/QueueStatusIndicator.tsx
// Floating indicator showing queue processing status.
// Semi-transparent, non-blocking, and minimized by default.

import { useQueueProcessor } from "@/lib/queueProcessor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Loader2,
  Pause,
  Play,
  X,
  CheckCircle2,
  AlertCircle,
  RotateCcw,
  ChevronUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffect, useState } from "react";

export function QueueStatusIndicator() {
  const {
    isRunning,
    isPaused,
    queueCount,
    processedCount,
    errorCount,
    currentItem,
    lastProcessedCard,
    start,
    stop,
    pause,
    resume,
    refreshQueue,
  } = useQueueProcessor();

  // Start minimized so it never pops up blocking the view
  const [expanded, setExpanded] = useState(false);
  const [restarting, setRestarting] = useState(false);

  const handleRestart = async () => {
    setRestarting(true);
    stop();
    await new Promise((r) => setTimeout(r, 300));
    start();
    setRestarting(false);
  };

  // Refresh queue count on mount
  useEffect(() => {
    refreshQueue();
  }, [refreshQueue]);

  // Don't show if nothing in queue and not running
  if (!isRunning && queueCount === 0) {
    return null;
  }

  const total = queueCount + processedCount + errorCount;
  const progress = total > 0 ? ((processedCount + errorCount) / total) * 100 : 0;

  // Minimized pill — always see-through, never blocks content
  if (!expanded) {
    return (
      <div className="fixed bottom-4 right-4 z-50 pointer-events-auto">
        <button
          onClick={() => setExpanded(true)}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-background/60 backdrop-blur-md border border-border/40 shadow-sm text-xs text-foreground/80 hover:bg-background/80 transition-colors"
        >
          {isRunning && !isPaused ? (
            <Loader2 className="h-3 w-3 animate-spin text-primary" />
          ) : (
            <Pause className="h-3 w-3 text-muted-foreground" />
          )}
          <span>{queueCount} queued</span>
          {processedCount > 0 && (
            <span className="flex items-center gap-0.5 text-muted-foreground">
              <CheckCircle2 className="h-3 w-3" />
              {processedCount}
            </span>
          )}
          <ChevronUp className="h-3 w-3 text-muted-foreground" />
        </button>
      </div>
    );
  }

  // Expanded panel — semi-transparent so content shows through
  return (
    <div className="fixed bottom-4 right-4 z-50 w-72 rounded-xl bg-background/70 backdrop-blur-xl border border-border/40 shadow-lg p-3 pointer-events-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {isRunning && !isPaused ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          ) : isPaused ? (
            <Pause className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <CheckCircle2 className="h-3.5 w-3.5 text-primary" />
          )}
          <span className="font-medium text-xs text-foreground/90">Queue</span>
        </div>
        <button
          onClick={() => setExpanded(false)}
          className="text-muted-foreground hover:text-foreground transition-colors p-0.5"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <Progress value={progress} className="h-1.5 mb-2" />

      <div className="flex items-center justify-between text-[11px] text-muted-foreground mb-2">
        <span>{queueCount} queued</span>
        <span className="flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3" />
          {processedCount}
        </span>
        {errorCount > 0 && (
          <span className="flex items-center gap-1 text-destructive">
            <AlertCircle className="h-3 w-3" />
            {errorCount}
          </span>
        )}
      </div>

      {lastProcessedCard && (
        <div className="text-[11px] mb-2 px-2 py-1.5 bg-muted/30 rounded-md">
          <span className="text-muted-foreground">Last: </span>
          <span className="font-medium text-foreground/90">{lastProcessedCard.cardName}</span>
          {lastProcessedCard.value != null && (
            <Badge variant="secondary" className="ml-1.5 text-[10px] px-1.5 py-0">
              ${lastProcessedCard.value.toFixed(2)}
            </Badge>
          )}
        </div>
      )}

      <div className="flex gap-1.5">
        {!isRunning && queueCount > 0 && (
          <Button size="sm" onClick={start} className="flex-1 h-7 text-xs">
            <Play className="h-3 w-3 mr-1" />
            Resume
          </Button>
        )}
        {isRunning && !isPaused && (
          <Button size="sm" variant="secondary" onClick={pause} className="flex-1 h-7 text-xs">
            <Pause className="h-3 w-3 mr-1" />
            Pause
          </Button>
        )}
        {isRunning && isPaused && (
          <Button size="sm" onClick={resume} className="flex-1 h-7 text-xs">
            <Play className="h-3 w-3 mr-1" />
            Resume
          </Button>
        )}
        {queueCount > 0 && (
          <Button size="sm" variant="outline" onClick={handleRestart} disabled={restarting} className="h-7 text-xs">
            <RotateCcw className={cn("h-3 w-3 mr-1", restarting && "animate-spin")} />
          </Button>
        )}
        {isRunning && (
          <Button size="sm" variant="destructive" onClick={stop} className="h-7 text-xs">
            <X className="h-3 w-3 mr-1" />
            Stop
          </Button>
        )}
      </div>
    </div>
  );
}
