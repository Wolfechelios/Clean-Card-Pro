// src/lib/yugioh/zoneSegmenter.ts
// Segments a Yu-Gi-Oh card image into analysis zones using canvas
// Includes CLAHE-like lighting normalization for robust foil detection

export interface CardZones {
  /** Full card pixel data (RGBA), lighting-normalized */
  full: ImageData;
  /** Name plate region (~top 12%) */
  nameplate: ImageData;
  /** Artwork region (~12-62% vertically, inset 7% horizontally) */
  artwork: ImageData;
  /** Border strips (left, right, top, bottom edges ~7% each) */
  border: ImageData;
  /** Lower card area below artwork (~62-100%) */
  lower: ImageData;
  /** Original canvas dimensions */
  width: number;
  height: number;
}

// ─── Canvas management ──────────────────────────────────

let _canvas: OffscreenCanvas | HTMLCanvasElement | null = null;
let _ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null = null;

function getCanvas(w: number, h: number) {
  if (!_canvas || _canvas.width !== w || _canvas.height !== h) {
    if (typeof OffscreenCanvas !== "undefined") {
      _canvas = new OffscreenCanvas(w, h);
    } else {
      _canvas = document.createElement("canvas");
      _canvas.width = w;
      _canvas.height = h;
    }
    _ctx = _canvas.getContext("2d", { willReadFrequently: true })!;
  }
  return { canvas: _canvas, ctx: _ctx! };
}

// ─── CLAHE-like Lighting Normalization ──────────────────

/**
 * Normalize lighting across the card image using tile-based histogram equalization.
 * This approximates CLAHE (Contrast Limited Adaptive Histogram Equalization)
 * using pure canvas pixel manipulation — no OpenCV required.
 *
 * Dramatically improves detection of:
 * - Secret foil lines under uneven lighting
 * - Starlight sparkle points washed out by glare
 * - Gold foil borders in dim lighting
 */
function normalizeLighting(imageData: ImageData): ImageData {
  const d = imageData.data;
  const w = imageData.width;
  const h = imageData.height;
  const out = new ImageData(new Uint8ClampedArray(d), w, h);
  const od = out.data;

  // Tile-based adaptive equalization
  const tilesX = 4;
  const tilesY = 6; // more vertical tiles for card aspect ratio
  const tileW = Math.ceil(w / tilesX);
  const tileH = Math.ceil(h / tilesY);
  const clipLimit = 3.0; // contrast clip limit

  // Build per-tile lookup tables
  const luts: Uint8Array[][] = [];

  for (let ty = 0; ty < tilesY; ty++) {
    luts[ty] = [];
    for (let tx = 0; tx < tilesX; tx++) {
      const x0 = tx * tileW;
      const y0 = ty * tileH;
      const x1 = Math.min(x0 + tileW, w);
      const y1 = Math.min(y0 + tileH, h);

      // Build luminance histogram for this tile
      const hist = new Uint32Array(256);
      let count = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const idx = (y * w + x) * 4;
          // Use V channel of HSV (max of RGB)
          const v = Math.max(d[idx], d[idx + 1], d[idx + 2]);
          hist[v]++;
          count++;
        }
      }

      // Clip histogram (CLAHE clip)
      const maxCount = Math.max(1, Math.round((clipLimit * count) / 256));
      let excess = 0;
      for (let i = 0; i < 256; i++) {
        if (hist[i] > maxCount) {
          excess += hist[i] - maxCount;
          hist[i] = maxCount;
        }
      }
      // Redistribute excess
      const perBin = Math.floor(excess / 256);
      for (let i = 0; i < 256; i++) {
        hist[i] += perBin;
      }

      // Build CDF → LUT
      const lut = new Uint8Array(256);
      let cumSum = 0;
      for (let i = 0; i < 256; i++) {
        cumSum += hist[i];
        lut[i] = Math.round((cumSum * 255) / count);
      }

      luts[ty][tx] = lut;
    }
  }

  // Apply with bilinear interpolation between tiles
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const idx = (y * w + x) * 4;
      const r = d[idx], g = d[idx + 1], b = d[idx + 2];
      const v = Math.max(r, g, b);

      // Find tile center coords for interpolation
      const ftx = (x + 0.5) / tileW - 0.5;
      const fty = (y + 0.5) / tileH - 0.5;
      const tx0 = Math.max(0, Math.floor(ftx));
      const ty0 = Math.max(0, Math.floor(fty));
      const tx1 = Math.min(tilesX - 1, tx0 + 1);
      const ty1 = Math.min(tilesY - 1, ty0 + 1);
      const fx = ftx - tx0;
      const fy = fty - ty0;

      // Bilinear interpolation of LUT values
      const v00 = luts[ty0][tx0][v];
      const v10 = luts[ty0][tx1][v];
      const v01 = luts[ty1][tx0][v];
      const v11 = luts[ty1][tx1][v];
      const newV = v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) +
                   v01 * (1 - fx) * fy + v11 * fx * fy;

      // Scale RGB proportionally
      const scale = v > 0 ? newV / v : 1;
      od[idx] = Math.min(255, Math.round(r * scale));
      od[idx + 1] = Math.min(255, Math.round(g * scale));
      od[idx + 2] = Math.min(255, Math.round(b * scale));
      od[idx + 3] = d[idx + 3];
    }
  }

  return out;
}

// ─── Glare Reduction ────────────────────────────────────

/**
 * Reduce specular glare from scanner lights / flash.
 * Clamps overly bright pixels to reduce false-positive sparkle detection.
 */
function reduceGlare(imageData: ImageData): ImageData {
  const d = imageData.data;
  const out = new ImageData(new Uint8ClampedArray(d), imageData.width, imageData.height);
  const od = out.data;

  // Find the 98th percentile luminance
  const lumHist = new Uint32Array(256);
  const total = imageData.width * imageData.height;
  for (let i = 0; i < d.length; i += 4) {
    const l = Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]);
    lumHist[Math.min(255, l)]++;
  }
  let cumul = 0;
  let p98 = 255;
  for (let i = 0; i < 256; i++) {
    cumul += lumHist[i];
    if (cumul >= total * 0.98) { p98 = i; break; }
  }

  // Soft-clamp pixels above p98
  if (p98 < 245) {
    const cap = p98 + 10;
    for (let i = 0; i < od.length; i += 4) {
      const l = 0.299 * od[i] + 0.587 * od[i + 1] + 0.114 * od[i + 2];
      if (l > cap) {
        const scale = cap / l;
        od[i] = Math.round(od[i] * scale);
        od[i + 1] = Math.round(od[i + 1] * scale);
        od[i + 2] = Math.round(od[i + 2] * scale);
      }
    }
  }

  return out;
}

// ─── Image Loading ──────────────────────────────────────

/**
 * Load an image source and return lighting-normalized ImageData.
 * Target: max 400px wide for ~15-40ms budget.
 */
export async function loadAndNormalize(
  source: HTMLImageElement | ImageBitmap | Blob | string,
  maxWidth = 400
): Promise<{ imageData: ImageData; width: number; height: number }> {
  let img: HTMLImageElement | ImageBitmap;

  if (source instanceof Blob) {
    img = await createImageBitmap(source);
  } else if (typeof source === "string") {
    img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.crossOrigin = "anonymous";
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = source;
    });
  } else {
    img = source;
  }

  const origW = img instanceof HTMLImageElement ? img.naturalWidth : img.width;
  const origH = img instanceof HTMLImageElement ? img.naturalHeight : img.height;
  const scale = Math.min(1, maxWidth / origW);
  const w = Math.round(origW * scale);
  const h = Math.round(origH * scale);

  const { ctx } = getCanvas(w, h);
  ctx.drawImage(img as any, 0, 0, w, h);
  let imageData = ctx.getImageData(0, 0, w, h);

  // Stage 1: Reduce glare
  imageData = reduceGlare(imageData);
  // Stage 2: CLAHE lighting normalization
  imageData = normalizeLighting(imageData);

  return { imageData, width: w, height: h };
}

// ─── Region Extraction ──────────────────────────────────

function extractRegion(
  src: ImageData,
  x: number,
  y: number,
  rw: number,
  rh: number
): ImageData {
  const clamped_rw = Math.min(rw, src.width - x);
  const clamped_rh = Math.min(rh, src.height - y);
  const out = new ImageData(Math.max(1, clamped_rw), Math.max(1, clamped_rh));
  for (let row = 0; row < clamped_rh; row++) {
    const srcOffset = ((y + row) * src.width + x) * 4;
    const dstOffset = row * clamped_rw * 4;
    out.data.set(
      src.data.subarray(srcOffset, srcOffset + clamped_rw * 4),
      dstOffset
    );
  }
  return out;
}

// ─── Zone Segmentation ──────────────────────────────────

/**
 * Segment a card image into analysis zones.
 * Ratios tuned for standard Yu-Gi-Oh card layout:
 * - Nameplate: top 12% (name text area)
 * - Artwork: 12-62% (art frame)
 * - Lower: 62-100% (text box, stats)
 * - Border: outer 7% edges
 */
export function segmentCardZones(imageData: ImageData, width: number, height: number): CardZones {
  const borderPct = 0.07;
  const nameplateEnd = 0.12; // top 12% = nameplate (wider for better name foil detection)
  const artworkEnd = 0.62;   // artwork ends at ~62%

  const bx = Math.round(width * borderPct);
  const by = Math.round(height * borderPct);
  const innerW = Math.max(1, width - bx * 2);

  // Nameplate: top strip (includes card name text)
  const npH = Math.max(1, Math.round(height * nameplateEnd));
  const nameplate = extractRegion(imageData, bx, 0, innerW, npH);

  // Artwork: from nameplate end to 62%
  const artY = npH;
  const artH = Math.max(1, Math.round(height * artworkEnd) - artY);
  const artwork = extractRegion(imageData, bx, artY, innerW, artH);

  // Lower: below artwork
  const lowerY = Math.round(height * artworkEnd);
  const lowerH = Math.max(1, height - lowerY);
  const lower = extractRegion(imageData, bx, lowerY, innerW, lowerH);

  // Border: composite of all 4 edge strips
  const border = new ImageData(width, height);
  for (let row = 0; row < height; row++) {
    for (let col = 0; col < width; col++) {
      const isEdge = col < bx || col >= width - bx || row < by || row >= height - by;
      if (isEdge) {
        const srcIdx = (row * width + col) * 4;
        const dstIdx = srcIdx; // same dimensions
        border.data[dstIdx] = imageData.data[srcIdx];
        border.data[dstIdx + 1] = imageData.data[srcIdx + 1];
        border.data[dstIdx + 2] = imageData.data[srcIdx + 2];
        border.data[dstIdx + 3] = imageData.data[srcIdx + 3];
      }
    }
  }

  return { full: imageData, nameplate, artwork, border, lower, width, height };
}
