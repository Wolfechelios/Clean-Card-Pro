// src/lib/autoscan/ScanJobQueue.ts
// Failsafe job queue with concurrency control, timeouts, and backpressure.
// Never blocks the camera loop. One failed job doesn't kill the queue.

export type ScanJob = {
  id: string;
  imageBlob: Blob;
  createdAt: number;
  tries: number;
  filename?: string;
};

export type JobResult = {
  id: string;
  success: boolean;
  cardName?: string;
  cardSet?: string;
  cardNumber?: string;
  rarity?: string;
  gameType?: string;
  sportType?: string;
  imageUrl?: string;
  rawPrice?: number | null;
  error?: string;
  isInLibrary?: boolean;
  libraryQuantity?: number;
  dbId?: string;
};

export type JobProcessor = (job: ScanJob) => Promise<JobResult>;

export type QueueConfig = {
  maxQueue: number;
  maxConcurrent: number;
  maxRetries: number;
  stepTimeoutMs: number;
  jobDelayMs: number;
};

export const DEFAULT_QUEUE_CONFIG: QueueConfig = {
  maxQueue: 50,
  maxConcurrent: 1,
  maxRetries: 1,
  stepTimeoutMs: 15000,  // 15s per step (upload, OCR, pricing)
  jobDelayMs: 800,       // Delay between jobs to avoid rate limits
};

export type QueueStatus = {
  queueLength: number;
  running: number;
  hasCapacity: boolean;
};

export type JobStatusCallback = (
  id: string, 
  status: "queued" | "uploading" | "processing" | "completed" | "error",
  result?: Partial<JobResult>
) => void;

export class ScanJobQueue {
  private queue: ScanJob[] = [];
  private running = 0;
  private config: QueueConfig;
  private processor: JobProcessor;
  private statusCallback?: JobStatusCallback;
  private stopped = false;

  constructor(
    processor: JobProcessor, 
    config: Partial<QueueConfig> = {},
    statusCallback?: JobStatusCallback
  ) {
    this.processor = processor;
    this.config = { ...DEFAULT_QUEUE_CONFIG, ...config };
    this.statusCallback = statusCallback;
  }

  setStatusCallback(cb: JobStatusCallback) {
    this.statusCallback = cb;
  }

  hasCapacity(): boolean {
    return this.queue.length < this.config.maxQueue;
  }

  getStatus(): QueueStatus {
    return {
      queueLength: this.queue.length,
      running: this.running,
      hasCapacity: this.hasCapacity(),
    };
  }

  enqueue(job: ScanJob): boolean {
    if (this.queue.length >= this.config.maxQueue) {
      console.warn("[ScanJobQueue] Queue full, rejecting job", job.id);
      return false;
    }

    this.queue.push(job);
    this.statusCallback?.(job.id, "queued");
    this.pump();
    return true;
  }

  stop() {
    this.stopped = true;
  }

  resume() {
    this.stopped = false;
    this.pump();
  }

  clear() {
    this.queue = [];
  }

  private async pump() {
    if (this.stopped) return;

    while (this.running < this.config.maxConcurrent && this.queue.length > 0) {
      const job = this.queue.shift()!;
      this.running++;
      
      this.runJob(job)
        .catch((err) => {
          console.error("[ScanJobQueue] Unexpected error in runJob:", err);
        })
        .finally(() => {
          this.running--;
          // Small delay before processing next
          setTimeout(() => this.pump(), this.config.jobDelayMs);
        });
    }
  }

  private async runJob(job: ScanJob) {
    try {
      this.statusCallback?.(job.id, "processing");
      
      // Run with timeout
      const result = await this.withTimeout(
        this.processor(job),
        this.config.stepTimeoutMs * 3 // Give enough time for all steps
      );

      if (result.success) {
        this.statusCallback?.(job.id, "completed", result);
      } else {
        throw new Error(result.error || "Processing failed");
      }
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      console.error("[ScanJobQueue] Job failed:", job.id, msg);

      // Retry logic
      if (job.tries < this.config.maxRetries && this.isRetryable(err)) {
        job.tries++;
        console.log("[ScanJobQueue] Retrying job", job.id, "attempt", job.tries + 1);
        this.queue.unshift(job); // Add back to front
        this.statusCallback?.(job.id, "queued");
      } else {
        this.statusCallback?.(job.id, "error", { error: msg });
      }
    }
  }

  private isRetryable(err: any): boolean {
    const msg = String(err?.message ?? err).toLowerCase();
    return /timeout|network|502|503|504|econnreset|fetch/i.test(msg);
  }

  private withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Operation timed out after ${ms}ms`));
      }, ms);

      promise
        .then((val) => {
          clearTimeout(timer);
          resolve(val);
        })
        .catch((err) => {
          clearTimeout(timer);
          reject(err);
        });
    });
  }
}
