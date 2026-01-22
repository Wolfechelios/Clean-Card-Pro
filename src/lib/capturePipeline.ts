// src/lib/capturePipeline.ts
// High-throughput capture helpers for Rapid Scan and high-quality "grading" captures.
// Notes:
// - Browser camera controls vary wildly; we avoid relying on manual ISO/shutter.
// - We use burst capture + sharpness scoring to pick the best frame for grading.
// - We optionally downscale in RAPID mode to dramatically reduce queue size and processing time.

export type CaptureFormat = "image/jpeg" | "image/png" | "image/webp";

export type CapturePipelineOptions = {
  mode: "RAPID" | "GRADING";
  // RAPID
  rapidMaxLongEdge: number; // 0 = no resize
  rapidJpegQuality: number; // 0-1
  rapidPreferWebp: boolean;

  // GRADING
  gradingBurstFrames: number; // 1-12
  gradingMinSharpness: number; // 0-100 (scaled score)
  gradingOutputFormat: "jpeg" | "png" | "webp";
  gradingJpegQuality: number; // 0-1
};

type FrameScore = {
  sharpness: number; // 0-100-ish
};

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

/**
 * Quick sharpness metric: Laplacian variance on a small downscaled frame.
 * Returns a roughly 0-100 scaled score.
 */
export function computeSharpnessScore(imageData: ImageData): number {
  const { data, width, height } = imageData;
  // Convert to grayscale intensity into a rolling buffer to avoid extra allocs.
  const gray = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    // Rec. 601 luma
    gray[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }

  // Laplacian kernel variance
  let sum = 0;
  let sumSq = 0;
  let count = 0;
  for (let y = 1; y < height - 1; y++) {
    const row = y * width;
    for (let x = 1; x < width - 1; x++) {
      const idx = row + x;
      const v =
        -4 * gray[idx] +
        gray[idx - 1] +
        gray[idx + 1] +
        gray[idx - width] +
        gray[idx + width];
      sum += v;
      sumSq += v * v;
      count++;
    }
  }
  if (count <= 0) return 0;
  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  // Map to a 0-100-ish scale. This is heuristic.
  const score = Math.sqrt(Math.max(0, variance)) / 12;
  return clamp(score, 0, 100);
}

function getRequestVideoFrameCallback(video: HTMLVideoElement) {
  const anyV = video as any;
  return typeof anyV.requestVideoFrameCallback === "function"
    ? (cb: (now: number, meta: any) => void) => anyV.requestVideoFrameCallback(cb)
    : null;
}

async function waitNextFrame(video: HTMLVideoElement): Promise<void> {
  const rvfc = getRequestVideoFrameCallback(video);
  if (rvfc) {
    await new Promise<void>((resolve) => {
      rvfc(() => resolve());
    });
    return;
  }
  // Fallback. 2 frames at ~60fps.
  await new Promise((r) => setTimeout(r, 33));
}

function computeResize(w: number, h: number, maxLongEdge: number) {
  if (!maxLongEdge || maxLongEdge <= 0) return { w, h };
  const longEdge = Math.max(w, h);
  if (longEdge <= maxLongEdge) return { w, h };
  const scale = maxLongEdge / longEdge;
  return { w: Math.round(w * scale), h: Math.round(h * scale) };
}

async function bitmapToBlob(
  bitmap: ImageBitmap,
  outW: number,
  outH: number,
  format: CaptureFormat,
  quality?: number
): Promise<Blob> {
  // Prefer OffscreenCanvas if available to avoid layout/DOM overhead.
  const offscreen: any = typeof OffscreenCanvas !== "undefined" ? new (OffscreenCanvas as any)(outW, outH) : null;
  const canvas: HTMLCanvasElement | OffscreenCanvas = offscreen ?? Object.assign(document.createElement("canvas"), { width: outW, height: outH });
  const ctx = (canvas as any).getContext("2d", { alpha: false, desynchronized: true });
  if (!ctx) throw new Error("Canvas context not available");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(bitmap, 0, 0, outW, outH);

  // OffscreenCanvas.convertToBlob is faster and avoids some memory spikes.
  if (offscreen && typeof (canvas as any).convertToBlob === "function") {
    return await (canvas as any).convertToBlob({ type: format, quality });
  }
  return await new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Failed to encode image"))),
      format,
      quality
    );
  });
}

async function scoreCurrentFrame(video: HTMLVideoElement): Promise<FrameScore> {
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;

  // Use a small analysis canvas.
  const targetW = 320;
  const targetH = Math.max(1, Math.round((h / w) * targetW));
  const offscreen: any = typeof OffscreenCanvas !== "undefined" ? new (OffscreenCanvas as any)(targetW, targetH) : null;
  const canvas: HTMLCanvasElement | OffscreenCanvas = offscreen ?? Object.assign(document.createElement("canvas"), { width: targetW, height: targetH });
  const ctx = (canvas as any).getContext("2d", { willReadFrequently: true });
  if (!ctx) return { sharpness: 0 };
  ctx.drawImage(video, 0, 0, targetW, targetH);
  const img = ctx.getImageData(0, 0, targetW, targetH);
  return { sharpness: computeSharpnessScore(img) };
}

/**
 * Capture a blob from the live video stream according to the pipeline options.
 * - RAPID: downscale + encode webp/jpeg for speed
 * - GRADING: burst capture and pick sharpest frame, then encode high quality
 */
export async function captureWithPipeline(
  video: HTMLVideoElement,
  opts: CapturePipelineOptions
): Promise<{ blob: Blob; mime: string; sharpness?: number }>
{
  if (!video.videoWidth || !video.videoHeight) {
    // Wait a tick for metadata
    await waitNextFrame(video);
  }

  const w = video.videoWidth || 1920;
  const h = video.videoHeight || 1080;

  if (opts.mode === "GRADING") {
    const frames = clamp(opts.gradingBurstFrames || 1, 1, 12);
    let bestScore = -1;
    let bestSharpness = 0;
    let bestBitmap: ImageBitmap | null = null;

    for (let i = 0; i < frames; i++) {
      await waitNextFrame(video);
      const score = await scoreCurrentFrame(video);
      if (score.sharpness > bestScore) {
        bestScore = score.sharpness;
        bestSharpness = score.sharpness;
        // Replace best bitmap (full-res) only when we find a better frame.
        const nextBitmap = await createImageBitmap(video);
        try {
          (bestBitmap as any)?.close?.();
        } catch {
          // ignore
        }
        bestBitmap = nextBitmap;
      }
    }

    if (!bestBitmap) {
      // Fallback single frame.
      bestBitmap = await createImageBitmap(video);
    }

    // Reject if too soft
    if (bestSharpness < (opts.gradingMinSharpness ?? 0)) {
      try {
        (bestBitmap as any)?.close?.();
      } catch {
        // ignore
      }
      throw new Error(
        `Image too soft for grading (sharpness ${Math.round(bestSharpness)} < ${opts.gradingMinSharpness}). Hold steadier or add light.`
      );
    }

    const format: CaptureFormat =
      opts.gradingOutputFormat === "png"
        ? "image/png"
        : opts.gradingOutputFormat === "webp"
          ? "image/webp"
          : "image/jpeg";

    const blob = await bitmapToBlob(
      bestBitmap,
      w,
      h,
      format,
      format === "image/jpeg" ? clamp(opts.gradingJpegQuality ?? 0.98, 0.5, 1) : undefined
    );

    try {
      (bestBitmap as any)?.close?.();
    } catch {
      // ignore
    }

    return { blob, mime: format, sharpness: bestSharpness };
  }

  // RAPID mode
  const bitmap = await createImageBitmap(video);
  const resized = computeResize(w, h, opts.rapidMaxLongEdge);

  // Prefer webp if requested; otherwise jpeg.
  const format: CaptureFormat = opts.rapidPreferWebp ? "image/webp" : "image/jpeg";
  const q = clamp(opts.rapidJpegQuality ?? 0.88, 0.5, 1);
  let blob = await bitmapToBlob(bitmap, resized.w, resized.h, format, q);

  // Some Safari builds are weird with webp toBlob. Fallback to jpeg.
  if (format === "image/webp" && (!blob || blob.size === 0)) {
    blob = await bitmapToBlob(bitmap, resized.w, resized.h, "image/jpeg", q);
  }

  try {
    (bitmap as any)?.close?.();
  } catch {
    // ignore
  }

  return { blob, mime: blob.type || format };
}
