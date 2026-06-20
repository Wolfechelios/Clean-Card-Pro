// Foil Trainer — Image Reconditioning for Foil Scans
// Applies glare reduction, contrast normalization, white balance, local sharpening
// All processing runs on CPU via Canvas API

export interface ReconditionResult {
  reconditionedDataUrl: string;
  improvements: string[];
  originalBrightness: number;
  reconditionedBrightness: number;
}

/**
 * Apply foil-focused reconditioning to improve second-pass foil detection.
 * Only called for foil-triggered scans with issue tags or low finish confidence.
 */
export async function reconditionFoilImage(
  imageSource: string, // data URL or image URL
  issueTags: string[] = [],
): Promise<ReconditionResult> {
  const img = await loadImage(imageSource);
  const canvas = document.createElement("canvas");
  canvas.width = img.width;
  canvas.height = img.height;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;
  const improvements: string[] = [];

  const originalBrightness = computeAverageBrightness(pixels);

  // 1. Glare reduction (if tagged or default)
  if (issueTags.includes("glare") || issueTags.includes("reflection") || issueTags.length === 0) {
    reduceGlare(pixels, canvas.width, canvas.height);
    improvements.push("glare_reduction");
  }

  // 2. Contrast normalization
  normalizeContrast(pixels);
  improvements.push("contrast_normalization");

  // 3. White balance correction (if tagged)
  if (issueTags.includes("too_dark") || issueTags.length === 0) {
    applyWhiteBalance(pixels);
    improvements.push("white_balance");
  }

  // 4. Local sharpening (mild, only if blur is mild)
  if (issueTags.includes("blurry") || issueTags.length === 0) {
    applySharpen(ctx, imageData, canvas.width, canvas.height);
    improvements.push("mild_sharpening");
  } else {
    ctx.putImageData(imageData, 0, 0);
  }

  const finalData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const reconditionedBrightness = computeAverageBrightness(finalData.data);

  return {
    reconditionedDataUrl: canvas.toDataURL("image/jpeg", 0.92),
    improvements,
    originalBrightness,
    reconditionedBrightness,
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function computeAverageBrightness(pixels: Uint8ClampedArray): number {
  let sum = 0;
  const count = pixels.length / 4;
  for (let i = 0; i < pixels.length; i += 4) {
    sum += 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
  }
  return sum / count;
}

function reduceGlare(pixels: Uint8ClampedArray, w: number, h: number): void {
  // Soft-clamp specular highlights: pixels above 95th percentile get pulled down
  const brightnesses: number[] = [];
  for (let i = 0; i < pixels.length; i += 4) {
    brightnesses.push(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
  }
  brightnesses.sort((a, b) => a - b);
  const p95 = brightnesses[Math.floor(brightnesses.length * 0.95)];

  if (p95 < 220) return; // no glare

  for (let i = 0; i < pixels.length; i += 4) {
    const lum = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    if (lum > p95) {
      const scale = p95 / lum;
      pixels[i] = Math.round(pixels[i] * scale);
      pixels[i + 1] = Math.round(pixels[i + 1] * scale);
      pixels[i + 2] = Math.round(pixels[i + 2] * scale);
    }
  }
}

function normalizeContrast(pixels: Uint8ClampedArray): void {
  let min = 255, max = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    const lum = 0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2];
    if (lum < min) min = lum;
    if (lum > max) max = lum;
  }
  if (max - min < 30) return; // already good or flat image
  const range = max - min;
  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = Math.min(255, Math.round(((pixels[i] - min) / range) * 255));
    pixels[i + 1] = Math.min(255, Math.round(((pixels[i + 1] - min) / range) * 255));
    pixels[i + 2] = Math.min(255, Math.round(((pixels[i + 2] - min) / range) * 255));
  }
}

function applyWhiteBalance(pixels: Uint8ClampedArray): void {
  let rSum = 0, gSum = 0, bSum = 0;
  const count = pixels.length / 4;
  for (let i = 0; i < pixels.length; i += 4) {
    rSum += pixels[i];
    gSum += pixels[i + 1];
    bSum += pixels[i + 2];
  }
  const rAvg = rSum / count;
  const gAvg = gSum / count;
  const bAvg = bSum / count;
  const gray = (rAvg + gAvg + bAvg) / 3;

  const rScale = gray / (rAvg || 1);
  const gScale = gray / (gAvg || 1);
  const bScale = gray / (bAvg || 1);

  for (let i = 0; i < pixels.length; i += 4) {
    pixels[i] = Math.min(255, Math.round(pixels[i] * rScale));
    pixels[i + 1] = Math.min(255, Math.round(pixels[i + 1] * gScale));
    pixels[i + 2] = Math.min(255, Math.round(pixels[i + 2] * bScale));
  }
}

function applySharpen(
  ctx: CanvasRenderingContext2D,
  imageData: ImageData,
  w: number,
  h: number,
): void {
  // Mild unsharp mask
  ctx.putImageData(imageData, 0, 0);
  const blurCanvas = document.createElement("canvas");
  blurCanvas.width = w;
  blurCanvas.height = h;
  const blurCtx = blurCanvas.getContext("2d")!;
  blurCtx.filter = "blur(1px)";
  blurCtx.drawImage(ctx.canvas, 0, 0);

  const blurData = blurCtx.getImageData(0, 0, w, h);
  const sharpData = ctx.getImageData(0, 0, w, h);
  const amount = 0.3; // mild

  for (let i = 0; i < sharpData.data.length; i += 4) {
    sharpData.data[i] = Math.min(255, Math.max(0,
      sharpData.data[i] + amount * (sharpData.data[i] - blurData.data[i])));
    sharpData.data[i + 1] = Math.min(255, Math.max(0,
      sharpData.data[i + 1] + amount * (sharpData.data[i + 1] - blurData.data[i + 1])));
    sharpData.data[i + 2] = Math.min(255, Math.max(0,
      sharpData.data[i + 2] + amount * (sharpData.data[i + 2] - blurData.data[i + 2])));
  }

  ctx.putImageData(sharpData, 0, 0);
}
