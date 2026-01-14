// src/components/scanner/QueueStatusIndicator.tsx
// Floating indicator showing queue processing status.
// Displays when there are items in the queue being processed.

import { useQueueProcessor } from "@/lib/queueProcessor";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import {
  Loader2,
  Pause,
  Play,
  X,
  CheckCircle2,
  AlertCircle,
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

  const [minimized, setMinimized] = useState(false);

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

  if (minimized) {
    return (
      <div className="fixed bottom-4 right-4 z-50">
        <Button
          size="sm"
          variant="secondary"
          className="shadow-lg"
          onClick={() => setMinimized(false)}
        >
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          {queueCount} in queue
        </Button>
      </div>
    );
  }

  return (
    <Card className="fixed bottom-4 right-4 z-50 w-80 p-4 shadow-xl border-primary/20">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          {isRunning && !isPaused ? (
            <Loader2 className="h-4 w-4 animate-spin text-primary" />
          ) : isPaused ? (
            <Pause className="h-4 w-4 text-warning" />
          ) : (
            <CheckCircle2 className="h-4 w-4 text-success" />
          )}
          <span className="font-semibold text-sm">Queue Processor</span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => setMinimized(true)}
          >
            <X className="h-3 w-3" />
          </Button>
        </div>
      </div>

      <Progress value={progress} className="h-2 mb-3" />

      <div className="flex items-center justify-between text-xs text-muted-foreground mb-3">
        <span>{queueCount} queued</span>
        <span className="flex items-center gap-1">
          <CheckCircle2 className="h-3 w-3 text-success" />
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
        <div className="text-xs mb-3 p-2 bg-muted/50 rounded">
          <span className="text-muted-foreground">Last: </span>
          <span className="font-medium">{lastProcessedCard.cardName}</span>
          {lastProcessedCard.value != null && (
            <Badge variant="secondary" className="ml-2 text-xs">
              ${lastProcessedCard.value.toFixed(2)}
            </Badge>
          )}
        </div>
      )}

      <div className="flex gap-2">
        {!isRunning && queueCount > 0 && (
          <Button size="sm" onClick={start} className="flex-1">
            <Play className="h-3 w-3 mr-1" />
            Resume
          </Button>
        )}
        {isRunning && !isPaused && (
          <Button size="sm" variant="secondary" onClick={pause} className="flex-1">
            <Pause className="h-3 w-3 mr-1" />
            Pause
          </Button>
        )}
        {isRunning && isPaused && (
          <Button size="sm" onClick={resume} className="flex-1">
            <Play className="h-3 w-3 mr-1" />
            Resume
          </Button>
        )}
        {isRunning && (
          <Button size="sm" variant="destructive" onClick={stop}>
            <X className="h-3 w-3 mr-1" />
            Stop
          </Button>
        )}
      </div>
    </Card>
  );
}
