// Slice a perspective-corrected binder page into individual card crops.

export type SliceOptions = {
  rows: number;
  cols: number;
  /** Inner padding per cell as a fraction (0..0.4). Trims pocket plastic. */
  innerPadding: number;
  /** Output card aspect ratio width/height. Default 2.5/3.5. */
  cardAspect?: number;
  /** Per-cell rotation in 0/90/180/270 degrees. Index = row*cols + col. */
  rotations?: number[];
};

export type CellCrop = {
  index: number;
  row: number;
  col: number;
  canvas: HTMLCanvasElement;
};

const DEFAULT_ASPECT = 2.5 / 3.5;

function rotateCanvas(src: HTMLCanvasElement, deg: number): HTMLCanvasElement {
  if (deg % 360 === 0) return src;
  const rad = (deg * Math.PI) / 180;
  const swap = deg % 180 !== 0;
  const w = swap ? src.height : src.width;
  const h = swap ? src.width : src.height;
  const out = document.createElement("canvas");
  out.width = w;
  out.height = h;
  const ctx = out.getContext("2d");
  if (!ctx) return src;
  ctx.translate(w / 2, h / 2);
  ctx.rotate(rad);
  ctx.drawImage(src, -src.width / 2, -src.height / 2);
  return out;
}

/**
 * Tighten a cell crop by trimming uniform borders (pocket plastic / dark gaps)
 * using a brightness-edge threshold from each side.
 */
function tightenCell(cell: HTMLCanvasElement): HTMLCanvasElement {
  const w = cell.width;
  const h = cell.height;
  const ctx = cell.getContext("2d", { willReadFrequently: true });
  if (!ctx) return cell;
  const { data } = ctx.getImageData(0, 0, w, h);

  const rowEnergy = new Float32Array(h);
  const colEnergy = new Float32Array(w);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const lum = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      rowEnergy[y] += lum;
      colEnergy[x] += lum;
    }
  }
  for (let y = 0; y < h; y++) rowEnergy[y] /= w;
  for (let x = 0; x < w; x++) colEnergy[x] /= h;

  const meanRow = rowEnergy.reduce((s, v) => s + v, 0) / h;
  const meanCol = colEnergy.reduce((s, v) => s + v, 0) / w;

  // Walk inward from each side until we hit a row/col that diverges enough.
  const tol = 18;
  let top = 0;
  while (top < h * 0.2 && Math.abs(rowEnergy[top] - meanRow) < tol) top++;
  let bot = h - 1;
  while (bot > h * 0.8 && Math.abs(rowEnergy[bot] - meanRow) < tol) bot--;
  let left = 0;
  while (left < w * 0.2 && Math.abs(colEnergy[left] - meanCol) < tol) left++;
  let right = w - 1;
  while (right > w * 0.8 && Math.abs(colEnergy[right] - meanCol) < tol) right--;

  const cw = Math.max(1, right - left);
  const ch = Math.max(1, bot - top);
  if (cw === w && ch === h) return cell;

  const out = document.createElement("canvas");
  out.width = cw;
  out.height = ch;
  const outCtx = out.getContext("2d");
  if (!outCtx) return cell;
  outCtx.drawImage(cell, left, top, cw, ch, 0, 0, cw, ch);
  return out;
}

/**
 * Conform a tightened cell to the standard card aspect by letterboxing onto a
 * fresh canvas. Keeps full art visible (no further cropping).
 */
function conformAspect(cell: HTMLCanvasElement, aspect: number): HTMLCanvasElement {
  const targetW = 480;
  const targetH = Math.round(targetW / aspect);
  const out = document.createElement("canvas");
  out.width = targetW;
  out.height = targetH;
  const ctx = out.getContext("2d");
  if (!ctx) return cell;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, targetW, targetH);

  const srcAspect = cell.width / cell.height;
  let drawW = targetW;
  let drawH = targetH;
  if (srcAspect > aspect) {
    drawH = Math.round(targetW / srcAspect);
  } else {
    drawW = Math.round(targetH * srcAspect);
  }
  const dx = Math.round((targetW - drawW) / 2);
  const dy = Math.round((targetH - drawH) / 2);
  ctx.drawImage(cell, dx, dy, drawW, drawH);
  return out;
}

export function sliceGrid(warped: HTMLCanvasElement, options: SliceOptions): CellCrop[] {
  const { rows, cols, innerPadding, rotations } = options;
  const aspect = options.cardAspect ?? DEFAULT_ASPECT;
  const cellW = warped.width / cols;
  const cellH = warped.height / rows;
  const padX = cellW * innerPadding;
  const padY = cellH * innerPadding;

  const out: CellCrop[] = [];
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const sx = Math.round(c * cellW + padX);
      const sy = Math.round(r * cellH + padY);
      const sw = Math.round(cellW - padX * 2);
      const sh = Math.round(cellH - padY * 2);
      const cellCanvas = document.createElement("canvas");
      cellCanvas.width = sw;
      cellCanvas.height = sh;
      const ctx = cellCanvas.getContext("2d");
      if (!ctx) continue;
      ctx.drawImage(warped, sx, sy, sw, sh, 0, 0, sw, sh);

      let processed = tightenCell(cellCanvas);
      const idx = r * cols + c;
      const rot = rotations?.[idx] ?? 0;
      if (rot) processed = rotateCanvas(processed, rot);
      processed = conformAspect(processed, aspect);

      out.push({ index: idx, row: r, col: c, canvas: processed });
    }
  }
  return out;
}

export function canvasToBlob(canvas: HTMLCanvasElement, quality = 0.92): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
      "image/jpeg",
      quality
    );
  });
}
