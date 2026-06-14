// Best-effort 4-corner page detection + perspective warp.
// Pure-JS, canvas-based. No native deps.
//
// Strategy:
// 1. Downsample the source frame.
// 2. Sobel edge detection -> binarize.
// 3. Find the largest contiguous edge cluster's bounding quad by scanning
//    rows/columns for the outermost edge pixels (a robust approximation when
//    the binder page is the dominant subject and roughly aligned with the frame).
// 4. Refine corners by walking inward until edge density falls off.
// 5. Apply 4-point perspective warp to a target rectangle.
//
// If detection confidence is low the caller should fall back to manual corners.

export type Point = { x: number; y: number };

export type DetectedQuad = {
  // Source-image pixel coordinates, clockwise from top-left.
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
  confidence: number; // 0..1
};

const WORK_SIZE = 480; // downsample longest side to this

function toGray(image: ImageData): Float32Array {
  const { data, width, height } = image;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p += 1) {
    out[p] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
  }
  return out;
}

function sobelEdges(gray: Float32Array, w: number, h: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx =
        -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] +
        gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
      const gy =
        -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] +
        gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      const m = Math.hypot(gx, gy);
      out[i] = m > 60 ? 255 : 0;
    }
  }
  return out;
}

function findExtremes(edges: Uint8Array, w: number, h: number) {
  // For each row find leftmost and rightmost edge pixel.
  // For each column find topmost and bottommost edge pixel.
  // Use these to build a robust outer envelope.
  const rowL = new Int32Array(h).fill(-1);
  const rowR = new Int32Array(h).fill(-1);
  const colT = new Int32Array(w).fill(-1);
  const colB = new Int32Array(w).fill(-1);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (edges[y * w + x]) {
        if (rowL[y] === -1) rowL[y] = x;
        rowR[y] = x;
        if (colT[x] === -1) colT[x] = y;
        colB[x] = y;
      }
    }
  }
  return { rowL, rowR, colT, colB };
}

export async function detectBinderPage(source: HTMLCanvasElement): Promise<DetectedQuad | null> {
  const longest = Math.max(source.width, source.height);
  const scale = WORK_SIZE / longest;
  const w = Math.max(1, Math.round(source.width * scale));
  const h = Math.max(1, Math.round(source.height * scale));

  const work = document.createElement("canvas");
  work.width = w;
  work.height = h;
  const ctx = work.getContext("2d", { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(source, 0, 0, w, h);
  const img = ctx.getImageData(0, 0, w, h);

  const gray = toGray(img);
  const edges = sobelEdges(gray, w, h);

  // Trim border noise — ignore outermost 2% pixels.
  const padX = Math.round(w * 0.02);
  const padY = Math.round(h * 0.02);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (x < padX || x > w - padX || y < padY || y > h - padY) edges[y * w + x] = 0;
    }
  }

  const { rowL, rowR, colT, colB } = findExtremes(edges, w, h);

  // Top edge: scan top 40% for the row with the longest edge run width.
  let topY = -1;
  let topRun = 0;
  for (let y = padY; y < h * 0.4; y++) {
    if (rowL[y] !== -1 && rowR[y] - rowL[y] > topRun) {
      topRun = rowR[y] - rowL[y];
      topY = y;
    }
  }

  // Bottom edge.
  let botY = -1;
  let botRun = 0;
  for (let y = h - padY - 1; y > h * 0.6; y--) {
    if (rowL[y] !== -1 && rowR[y] - rowL[y] > botRun) {
      botRun = rowR[y] - rowL[y];
      botY = y;
    }
  }

  // Left/right column similarly.
  let leftX = -1;
  let leftRun = 0;
  for (let x = padX; x < w * 0.4; x++) {
    if (colT[x] !== -1 && colB[x] - colT[x] > leftRun) {
      leftRun = colB[x] - colT[x];
      leftX = x;
    }
  }
  let rightX = -1;
  let rightRun = 0;
  for (let x = w - padX - 1; x > w * 0.6; x--) {
    if (colT[x] !== -1 && colB[x] - colT[x] > rightRun) {
      rightRun = colB[x] - colT[x];
      rightX = x;
    }
  }

  if (topY < 0 || botY < 0 || leftX < 0 || rightX < 0) return null;
  if (botY - topY < h * 0.3 || rightX - leftX < w * 0.3) return null;

  // Corner refinement: intersect the row-extreme and column-extreme readings.
  const tl: Point = { x: leftX, y: topY };
  const tr: Point = { x: rightX, y: topY };
  const br: Point = { x: rightX, y: botY };
  const bl: Point = { x: leftX, y: botY };

  // Confidence = how close the detected box covers the central area
  // and how dense the perimeter is.
  const area = (rightX - leftX) * (botY - topY);
  const coverage = area / (w * h);
  const confidence = Math.max(0, Math.min(1, (coverage - 0.2) / 0.6));

  // Map back to source coordinates.
  const inv = 1 / scale;
  const map = (p: Point): Point => ({ x: p.x * inv, y: p.y * inv });

  return {
    topLeft: map(tl),
    topRight: map(tr),
    bottomRight: map(br),
    bottomLeft: map(bl),
    confidence,
  };
}

// 4-point perspective warp implemented with bilinear sampling.
// Solves for the homography H mapping target rect (0,0)-(W,H) -> source quad.
function solveHomography(src: Point[], dst: Point[]): number[] | null {
  // Solve 8x8 linear system.
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const { x: X, y: Y } = src[i];
    const { x: u, y: v } = dst[i];
    A.push([X, Y, 1, 0, 0, 0, -u * X, -u * Y]);
    b.push(u);
    A.push([0, 0, 0, X, Y, 1, -v * X, -v * Y]);
    b.push(v);
  }
  // Gaussian elimination.
  const n = 8;
  for (let i = 0; i < n; i++) {
    let pivot = i;
    for (let r = i + 1; r < n; r++) if (Math.abs(A[r][i]) > Math.abs(A[pivot][i])) pivot = r;
    if (Math.abs(A[pivot][i]) < 1e-9) return null;
    [A[i], A[pivot]] = [A[pivot], A[i]];
    [b[i], b[pivot]] = [b[pivot], b[i]];
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const k = A[r][i] / A[i][i];
      for (let c = i; c < n; c++) A[r][c] -= k * A[i][c];
      b[r] -= k * b[i];
    }
  }
  const h = new Array(9);
  for (let i = 0; i < n; i++) h[i] = b[i] / A[i][i];
  h[8] = 1;
  return h;
}

export function warpQuadToRect(
  source: HTMLCanvasElement,
  quad: { topLeft: Point; topRight: Point; bottomRight: Point; bottomLeft: Point },
  outW: number,
  outH: number
): HTMLCanvasElement | null {
  const dst: Point[] = [
    { x: 0, y: 0 },
    { x: outW, y: 0 },
    { x: outW, y: outH },
    { x: 0, y: outH },
  ];
  const src: Point[] = [quad.topLeft, quad.topRight, quad.bottomRight, quad.bottomLeft];

  // We solve dst -> src so we can sample backward from each output pixel.
  const H = solveHomography(dst, src);
  if (!H) return null;

  const out = document.createElement("canvas");
  out.width = outW;
  out.height = outH;
  const outCtx = out.getContext("2d", { willReadFrequently: true });
  if (!outCtx) return null;

  const srcCtx = source.getContext("2d", { willReadFrequently: true });
  if (!srcCtx) return null;
  const srcData = srcCtx.getImageData(0, 0, source.width, source.height);
  const dstData = outCtx.createImageData(outW, outH);

  const sw = source.width;
  const sh = source.height;

  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const denom = H[6] * x + H[7] * y + H[8];
      const sx = (H[0] * x + H[1] * y + H[2]) / denom;
      const sy = (H[3] * x + H[4] * y + H[5]) / denom;

      const x0 = Math.floor(sx);
      const y0 = Math.floor(sy);
      const x1 = x0 + 1;
      const y1 = y0 + 1;
      if (x0 < 0 || y0 < 0 || x1 >= sw || y1 >= sh) {
        const di = (y * outW + x) * 4;
        dstData.data[di] = 0;
        dstData.data[di + 1] = 0;
        dstData.data[di + 2] = 0;
        dstData.data[di + 3] = 255;
        continue;
      }
      const dx = sx - x0;
      const dy = sy - y0;
      const i00 = (y0 * sw + x0) * 4;
      const i10 = (y0 * sw + x1) * 4;
      const i01 = (y1 * sw + x0) * 4;
      const i11 = (y1 * sw + x1) * 4;
      const di = (y * outW + x) * 4;
      for (let c = 0; c < 3; c++) {
        const v00 = srcData.data[i00 + c];
        const v10 = srcData.data[i10 + c];
        const v01 = srcData.data[i01 + c];
        const v11 = srcData.data[i11 + c];
        const v0 = v00 * (1 - dx) + v10 * dx;
        const v1 = v01 * (1 - dx) + v11 * dx;
        dstData.data[di + c] = v0 * (1 - dy) + v1 * dy;
      }
      dstData.data[di + 3] = 255;
    }
  }
  outCtx.putImageData(dstData, 0, 0);
  return out;
}
