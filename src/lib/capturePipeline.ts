// src/lib/capturePipeline.ts
// Centralized capture pipeline for RAPID vs GRADING modes
// Designed to reduce memory pressure and improve sharpness quality

export type CaptureQualityMode = "rapid" | "grading";

export interface RapidCaptureOptions {
  maxLongEdge: number; // e.g. 1600
  preferWebp: boolean;
}

export interface GradingCaptureOptions {
  burstFrames: number; // e.g. 7–12
  minSharpness: number; // Laplacian variance threshold
  outputFormat: "jpeg" | "png" | "webp";
  jpegQuality: number; // 0.9–1.0
}

export interface CaptureSettings {
  mode: CaptureQualityMode;
  rapid: RapidCaptureOptions;
  grading: GradingCaptureOptions;
}

export interface CaptureResult {
  blob: Blob;
  width: number;
  height: number;
  sharpnessScore?: number;
}

/* ----------------------------- Utilities ----------------------------- */

function clamp(v: number, min: number, max: number) {
  return Math.min(max, Math.max(min, v));
}

async function bitmapFromVideo(video: HTMLVideoElement): Promise<ImageBitmap> {
  return await createImageBitmap(video);
}

function computeSharpness(bitmap: ImageBitmap): number {
  // Downscale for speed
  const size = 128;
  const canvas = new OffscreenCanvas(size, size);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0, size, size);

  const img = ctx.getImageData(0, 0, size, size);
  const d = img.data;

  let variance = 0;
  let count = 0;

  // Simple Laplacian approximation
  for (let y = 1; y < size - 1; y++) {
    for (let x = 1; x < size - 1; x++) {
      const i = (y * size + x) * 4;
      const center = d[i];
      const up = d[i - size * 4];
      const down = d[i + size * 4];
      const left = d[i - 4];
      const right = d[i + 4];

      const lap = Math.abs(4 * center - up - down - left - right);
      variance += lap;
      count++;
    }
  }

  return variance / count;
}

function resizeDimensions(
  width: number,
  height: number,
  maxLongEdge: number
) {
  const longEdge = Math.max(width, height);
  if (longEdge <= maxLongEdge) return { width, height };

  const scale = maxLongEdge / longEdge;
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  };
}

async function encodeBitmap(
  bitmap: ImageBitmap,
  format: "jpeg" | "png" | "webp",
  quality = 0.95
): Promise<Blob> {
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(bitmap, 0, 0);

  const type =
    format === "png"
      ? "image/png"
      : format === "webp"
      ? "image/webp"
      : "image/jpeg";

  return await canvas.convertToBlob({
    type,
    quality: format === "png" ? undefined : quality,
  });
}

/* -------------------------- Capture Pipeline -------------------------- */

export async function captureFrame(
  video: HTMLVideoElement,
  settings: CaptureSettings
): Promise<CaptureResult | null> {
  if (settings.mode === "rapid") {
    const bitmap = await bitmapFromVideo(video);

    const resized = resizeDimensions(
      bitmap.width,
      bitmap.height,
      settings.rapid.maxLongEdge
    );

    const canvas = new OffscreenCanvas(resized.width, resized.height);
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0, resized.width, resized.height);

    const format = settings.rapid.preferWebp ? "webp" : "jpeg";
    const blob = await canvas.convertToBlob({
      type: format === "webp" ? "image/webp" : "image/jpeg",
      quality: 0.85,
    });

    bitmap.close();

    return {
      blob,
      width: resized.width,
      height: resized.height,
    };
  }

  // ---------------------- GRADING MODE ----------------------

  let bestBitmap: ImageBitmap | null = null;
  let bestScore = -Infinity;

  for (let i = 0; i < settings.grading.burstFrames; i++) {
    const bitmap = await bitmapFromVideo(video);
    const sharpness = computeSharpness(bitmap);

    if (sharpness > bestScore) {
      bestBitmap?.close();
      bestBitmap = bitmap;
      bestScore = sharpness;
    } else {
      bitmap.close();
    }

    // tiny delay so frames differ
    await new Promise((r) => setTimeout(r, 40));
  }

  if (!bestBitmap) return null;
  if (bestScore < settings.grading.minSharpness) {
    bestBitmap.close();
    return null;
  }

  const blob = await encodeBitmap(
    bestBitmap,
    settings.grading.outputFormat,
    clamp(settings.grading.jpegQuality, 0.9, 1.0)
  );

  const result: CaptureResult = {
    blob,
    width: bestBitmap.width,
    height: bestBitmap.height,
    sharpnessScore: bestScore,
  };

  bestBitmap.close();
  return result;
}
