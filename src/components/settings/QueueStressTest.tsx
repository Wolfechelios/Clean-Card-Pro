// src/components/settings/QueueStressTest.tsx
// Stress test utility to find the maximum queue capacity before crash.

import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  PlayCircle,
  StopCircle,
  Trash2,
  AlertTriangle,
  CheckCircle2,
  Loader2,
  MemoryStick,
  Cpu,
} from "lucide-react";
import { idbAdd, idbCount, idbClear, idbGetAll } from "@/lib/idbQueue";
import { toast } from "sonner";

type TestResult = {
  cardsAdded: number;
  peakMemoryMB: number | null;
  duration: number;
  errors: string[];
  crashed: boolean;
  finalQueueCount: number;
};

// Generate a fake card image blob (small colored square)
function generateFakeImageBlob(index: number): Blob {
  const canvas = document.createElement("canvas");
  canvas.width = 200;
  canvas.height = 280;
  const ctx = canvas.getContext("2d")!;
  
  // Random color based on index
  const hue = (index * 37) % 360;
  ctx.fillStyle = `hsl(${hue}, 70%, 50%)`;
  ctx.fillRect(0, 0, 200, 280);
  
  // Add text
  ctx.fillStyle = "white";
  ctx.font = "bold 24px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`Card #${index}`, 100, 140);
  
  // Convert to blob synchronously via data URL
  const dataUrl = canvas.toDataURL("image/jpeg", 0.5);
  const binary = atob(dataUrl.split(",")[1]);
  const array = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    array[i] = binary.charCodeAt(i);
  }
  return new Blob([array], { type: "image/jpeg" });
}

function getMemoryUsage(): number | null {
  if ("memory" in performance) {
    const mem = (performance as any).memory;
    return Math.round(mem.usedJSHeapSize / 1024 / 1024);
  }
  return null;
}

function safeUUID() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return "xxxx-xxxx-xxxx".replace(/x/g, () => ((Math.random() * 16) | 0).toString(16));
}

export function QueueStressTest() {
  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentCount, setCurrentCount] = useState(0);
  const [targetCount, setTargetCount] = useState(100);
  const [batchSize, setBatchSize] = useState(10);
  const [result, setResult] = useState<TestResult | null>(null);
  const [memorySnapshots, setMemorySnapshots] = useState<number[]>([]);
  const stopRef = useRef(false);

  const runTest = useCallback(async () => {
    setIsRunning(true);
    setProgress(0);
    setCurrentCount(0);
    setResult(null);
    setMemorySnapshots([]);
    stopRef.current = false;

    const startTime = Date.now();
    const errors: string[] = [];
    let peakMemory = getMemoryUsage();
    let cardsAdded = 0;

    toast.info(`Starting stress test: ${targetCount} cards in batches of ${batchSize}`);

    try {
      // Clear existing queue first
      await idbClear();

      for (let batch = 0; batch < Math.ceil(targetCount / batchSize); batch++) {
        if (stopRef.current) break;

        const batchStart = batch * batchSize;
        const batchEnd = Math.min(batchStart + batchSize, targetCount);

        // Add batch of cards
        const promises: Promise<void>[] = [];
        for (let i = batchStart; i < batchEnd; i++) {
          const id = safeUUID();
          const blob = generateFakeImageBlob(i);

          promises.push(
            idbAdd({
              id,
              createdAt: Date.now(),
              status: "queued",
              blob,
              mime: "image/jpeg",
              filename: `stress-test-${i}.jpg`,
            }).catch((err) => {
              errors.push(`Card ${i}: ${err.message}`);
            })
          );
        }

        await Promise.all(promises);
        cardsAdded = batchEnd;
        setCurrentCount(cardsAdded);
        setProgress((cardsAdded / targetCount) * 100);

        // Memory snapshot
        const mem = getMemoryUsage();
        if (mem !== null) {
          setMemorySnapshots((prev) => [...prev.slice(-19), mem]);
          if (peakMemory === null || mem > peakMemory) {
            peakMemory = mem;
          }
        }

        // Small delay between batches to let UI breathe
        await new Promise((r) => setTimeout(r, 50));
      }

      const finalCount = await idbCount();
      const duration = Date.now() - startTime;

      setResult({
        cardsAdded,
        peakMemoryMB: peakMemory,
        duration,
        errors,
        crashed: false,
        finalQueueCount: finalCount,
      });

      toast.success(`Test complete: ${cardsAdded} cards added in ${(duration / 1000).toFixed(1)}s`);
    } catch (err: any) {
      const duration = Date.now() - startTime;
      const finalCount = await idbCount().catch(() => 0);

      setResult({
        cardsAdded,
        peakMemoryMB: peakMemory,
        duration,
        errors: [...errors, err.message],
        crashed: true,
        finalQueueCount: finalCount,
      });

      toast.error(`Test crashed at ${cardsAdded} cards: ${err.message}`);
    } finally {
      setIsRunning(false);
    }
  }, [targetCount, batchSize]);

  const stopTest = useCallback(() => {
    stopRef.current = true;
    toast.info("Stopping test...");
  }, []);

  const clearQueue = useCallback(async () => {
    await idbClear();
    setCurrentCount(0);
    setProgress(0);
    setResult(null);
    toast.success("Queue cleared");
  }, []);

  const currentMemory = getMemoryUsage();

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Cpu className="h-5 w-5" />
          Queue Stress Test
        </CardTitle>
        <CardDescription>
          Test the maximum queue capacity before performance degrades or crashes
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            This test adds fake cards to the queue. Make sure to clear the queue after testing!
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="target">Target Cards</Label>
            <Input
              id="target"
              type="number"
              value={targetCount}
              onChange={(e) => setTargetCount(parseInt(e.target.value) || 100)}
              disabled={isRunning}
              min={10}
              max={10000}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="batch">Batch Size</Label>
            <Input
              id="batch"
              type="number"
              value={batchSize}
              onChange={(e) => setBatchSize(parseInt(e.target.value) || 10)}
              disabled={isRunning}
              min={1}
              max={100}
            />
          </div>
        </div>

        {currentMemory !== null && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <MemoryStick className="h-4 w-4" />
            Current Memory: {currentMemory} MB
          </div>
        )}

        <div className="flex gap-2">
          {!isRunning ? (
            <Button onClick={runTest} className="flex-1">
              <PlayCircle className="h-4 w-4 mr-2" />
              Run Test
            </Button>
          ) : (
            <Button onClick={stopTest} variant="destructive" className="flex-1">
              <StopCircle className="h-4 w-4 mr-2" />
              Stop
            </Button>
          )}
          <Button onClick={clearQueue} variant="outline" disabled={isRunning}>
            <Trash2 className="h-4 w-4 mr-2" />
            Clear Queue
          </Button>
        </div>

        {isRunning && (
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span>Progress</span>
              <span>{currentCount} / {targetCount}</span>
            </div>
            <Progress value={progress} className="h-2" />
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              Adding cards...
            </div>
          </div>
        )}

        {memorySnapshots.length > 0 && (
          <div className="space-y-1">
            <Label className="text-xs">Memory Usage (last 20 snapshots)</Label>
            <div className="flex items-end gap-0.5 h-12 bg-muted rounded p-1">
              {memorySnapshots.map((mem, i) => {
                const max = Math.max(...memorySnapshots, 100);
                const height = (mem / max) * 100;
                return (
                  <div
                    key={i}
                    className="flex-1 bg-primary rounded-t"
                    style={{ height: `${height}%` }}
                    title={`${mem} MB`}
                  />
                );
              })}
            </div>
          </div>
        )}

        {result && (
          <Card className={result.crashed ? "border-destructive" : "border-green-500"}>
            <CardContent className="pt-4 space-y-3">
              <div className="flex items-center gap-2">
                {result.crashed ? (
                  <AlertTriangle className="h-5 w-5 text-destructive" />
                ) : (
                  <CheckCircle2 className="h-5 w-5 text-green-500" />
                )}
                <span className="font-semibold">
                  {result.crashed ? "Test Crashed" : "Test Completed"}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-sm">
                <div>
                  <span className="text-muted-foreground">Cards Added:</span>
                  <Badge variant="secondary" className="ml-2">{result.cardsAdded}</Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Final Queue:</span>
                  <Badge variant="secondary" className="ml-2">{result.finalQueueCount}</Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Duration:</span>
                  <Badge variant="secondary" className="ml-2">
                    {(result.duration / 1000).toFixed(1)}s
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Peak Memory:</span>
                  <Badge variant="secondary" className="ml-2">
                    {result.peakMemoryMB ?? "N/A"} MB
                  </Badge>
                </div>
              </div>

              {result.errors.length > 0 && (
                <div className="text-xs text-destructive">
                  {result.errors.length} error(s): {result.errors[0]}
                  {result.errors.length > 1 && ` (+${result.errors.length - 1} more)`}
                </div>
              )}

              <div className="text-xs text-muted-foreground">
                Rate: {((result.cardsAdded / result.duration) * 1000).toFixed(1)} cards/sec
              </div>
            </CardContent>
          </Card>
        )}
      </CardContent>
    </Card>
  );
}
