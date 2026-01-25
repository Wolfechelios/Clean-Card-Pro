// src/lib/rapid-scan-core.ts

export class RapidScanGate {
  private locked = false;

  enter(): boolean {
    if (this.locked) return false;
    this.locked = true;
    return true;
  }

  exit(): void {
    this.locked = false;
  }

  isLocked(): boolean {
    return this.locked;
  }
}

export class FrameLoopGuard {
  private running = false;

  async run(fn: () => Promise<void>) {
    if (this.running) return;
    this.running = true;
    try {
      await fn();
    } finally {
      this.running = false;
    }
  }
}

export class StabilityGate {
  private since: number | null = null;

  constructor(private readonly ms = 900) {}

  update(isStable: boolean): boolean {
    const now = performance.now();

    if (!isStable) {
      this.since = null;
      return false;
    }

    if (this.since === null) {
      this.since = now;
      return false;
    }

    return now - this.since >= this.ms;
  }

  reset(): void {
    this.since = null;
  }
}

export async function captureFrame(
  video: HTMLVideoElement
): Promise<ImageBitmap> {
  return await createImageBitmap(video);
}

export function destroyFrame(bitmap?: ImageBitmap | null): void {
  try {
    bitmap?.close();
  } catch {
    // swallow safely
  }
}
