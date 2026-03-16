// src/lib/yugioh/zoneSegmenter.ts
// Segments a Yu-Gi-Oh card image into analysis zones using canvas

export interface CardZones {
  /** Full card pixel data (RGBA) */
  full: ImageData;
  /** Name plate region (~top 8%) */
  nameplate: ImageData;
  /** Artwork region (~8-55% vertically, inset 8% horizontally) */
  artwork: ImageData;
  /** Border strips (left, right, top, bottom edges ~8% each) */
  border: ImageData;
  /** Lower card area below artwork (~55-100%) */
  lower: ImageData;
  /** Original canvas dimensions */
  width: number;
  height: number;
}

// Internal reusable offscreen canvas
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

/**
 * Load an image source (HTMLImageElement, ImageBitmap, Blob, or data URL)
 * and return the drawn ImageData at a normalized size.
 * Target: max 400px wide for speed (~10-40ms budget).
 */
export async function loadAndNormalize(
  source: HTMLImageElement | ImageBitmap | Blob | string,
  maxWidth = 400
): Promise<{ imageData: ImageData; width: number; height: number }> {
  let img: HTMLImageElement | ImageBitmap;

  if (source instanceof Blob) {
    img = await createImageBitmap(source);
  } else if (typeof source === "string") {
    // data URL or regular URL
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
  const imageData = ctx.getImageData(0, 0, w, h);

  return { imageData, width: w, height: h };
}

/**
 * Extract a rectangular sub-region from ImageData.
 */
function extractRegion(
  src: ImageData,
  x: number,
  y: number,
  rw: number,
  rh: number
): ImageData {
  const out = new ImageData(rw, rh);
  for (let row = 0; row < rh; row++) {
    const srcOffset = ((y + row) * src.width + x) * 4;
    const dstOffset = row * rw * 4;
    out.data.set(
      src.data.subarray(srcOffset, srcOffset + rw * 4),
      dstOffset
    );
  }
  return out;
}

/**
 * Segment a card image into analysis zones.
 * Zone proportions based on standard Yu-Gi-Oh card layout.
 */
export function segmentCardZones(imageData: ImageData, width: number, height: number): CardZones {
  const borderPct = 0.08; // 8% border on each edge
  const nameplateEnd = 0.08; // top 8% = nameplate
  const artworkEnd = 0.55; // artwork ends at ~55%

  const bx = Math.round(width * borderPct);
  const by = Math.round(height * borderPct);
  const innerW = width - bx * 2;

  // Nameplate: top strip
  const npH = Math.max(1, Math.round(height * nameplateEnd));
  const nameplate = extractRegion(imageData, bx, 0, innerW, npH);

  // Artwork: from nameplate to ~55%
  const artY = npH;
  const artH = Math.max(1, Math.round(height * artworkEnd) - artY);
  const artwork = extractRegion(imageData, bx, artY, innerW, artH);

  // Lower: below artwork
  const lowerY = Math.round(height * artworkEnd);
  const lowerH = Math.max(1, height - lowerY);
  const lower = extractRegion(imageData, bx, lowerY, innerW, lowerH);

  // Border: composite of all 4 edge strips
  const borderW = width;
  const borderH = height;
  const border = new ImageData(borderW, borderH);
  // Copy only edge pixels (within borderPct from any edge)
  for (let row = 0; row < borderH; row++) {
    for (let col = 0; col < borderW; col++) {
      const isEdge =
        col < bx || col >= width - bx || row < by || row >= height - by;
      if (isEdge) {
        const srcIdx = (row * width + col) * 4;
        const dstIdx = (row * borderW + col) * 4;
        border.data[dstIdx] = imageData.data[srcIdx];
        border.data[dstIdx + 1] = imageData.data[srcIdx + 1];
        border.data[dstIdx + 2] = imageData.data[srcIdx + 2];
        border.data[dstIdx + 3] = imageData.data[srcIdx + 3];
      }
    }
  }

  return { full: imageData, nameplate, artwork, border, lower, width, height };
}
