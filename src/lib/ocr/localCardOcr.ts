// src/lib/ocr/localCardOcr.ts
// Multi-game, ROI-aware browser OCR. Reads the printed set/collector code FIRST.
// Returns structured fields; image AI is invoked only when no code is found.

import { createWorker, type Worker } from "tesseract.js";
import { extractPrintedCode, normalizeSetCodeToken, type DetectedGame } from "./gameCodePatterns";

export type LocalCardOcrResult = {
  rawText: string;
  title?: string;
  setCode?: string;
  cardNumber?: string;
  fullCode?: string;
  game?: DetectedGame;
  edition?: string;
  confidence: number;
  source: "local-browser-ocr";
};

let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) workerPromise = createWorker("eng");
  return workerPromise;
}

function cleanLine(line: string): string {
  return line.replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
}

function extractTitle(text: string, codeRaw: string | null): string | undefined {
  const junk = /^(limited edition|1st edition|edition|common|rare|secret rare|ultra rare|super rare|effect|spell|trap|monster|password|konami|yugioh|yu-?gi-?oh|pokemon|pokémon|trainer|energy|hp\s*\d+|atk|def|illus\.|©)/i;
  const lines = text
    .split(/\r?\n/)
    .map(cleanLine)
    .filter((line) => line.length >= 3 && line.length <= 80)
    .filter((line) => !junk.test(line))
    .filter((line) => !codeRaw || !line.toUpperCase().includes(codeRaw.toUpperCase()))
    .filter((line) => !/^\d+\s*\/\s*\d+$/.test(line));
  return lines.find((line) => /[A-Za-z]/.test(line) && !/[.!?]{2,}/.test(line));
}

/**
 * Decode a Blob into an ImageBitmap-backed canvas so we can crop ROIs.
 */
async function blobToCanvas(image: Blob): Promise<HTMLCanvasElement | null> {
  try {
    const bitmap = await createImageBitmap(image);
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);
    bitmap.close?.();
    return canvas;
  } catch {
    return null;
  }
}

/**
 * Crop a region (normalized 0..1 coords) and upscale 2x with light contrast bump.
 */
function cropAndEnhance(
  source: HTMLCanvasElement,
  x: number, y: number, w: number, h: number,
  scale = 2,
): HTMLCanvasElement {
  const sx = Math.max(0, Math.floor(source.width * x));
  const sy = Math.max(0, Math.floor(source.height * y));
  const sw = Math.min(source.width - sx, Math.floor(source.width * w));
  const sh = Math.min(source.height - sy, Math.floor(source.height * h));
  const out = document.createElement("canvas");
  out.width = Math.max(64, sw * scale);
  out.height = Math.max(32, sh * scale);
  const ctx = out.getContext("2d")!;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(source, sx, sy, sw, sh, 0, 0, out.width, out.height);

  // Light contrast boost (grayscale + linear stretch).
  const img = ctx.getImageData(0, 0, out.width, out.height);
  const data = img.data;
  for (let i = 0; i < data.length; i += 4) {
    const g = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    const stretched = Math.min(255, Math.max(0, (g - 80) * 1.6 + 80));
    data[i] = data[i + 1] = data[i + 2] = stretched;
  }
  ctx.putImageData(img, 0, 0);
  return out;
}

async function recognize(worker: Worker, src: HTMLCanvasElement | Blob | string): Promise<{ text: string; confidence: number }> {
  const { data } = await worker.recognize(src as any);
  return {
    text: data.text || "",
    confidence: Math.max(0, Math.min(1, Number(data.confidence || 0) / 100)),
  };
}

export async function runLocalCardOcr(image: Blob | File | string): Promise<LocalCardOcrResult> {
  const worker = await getWorker();

  // Full-card OCR (always run).
  const full = await recognize(worker, image as any);

  // ROI OCR — only if we have a Blob we can decode into a canvas.
  let codeRoiText = "";
  let titleRoiText = "";
  if (image instanceof Blob) {
    const canvas = await blobToCanvas(image);
    if (canvas) {
      try {
        // Bottom strip (set/collector code) and top strip (title).
        const codeCanvas = cropAndEnhance(canvas, 0.0, 0.85, 0.55, 0.15, 2.5);
        const titleCanvas = cropAndEnhance(canvas, 0.0, 0.02, 1.0, 0.20, 2);
        const [codeRoi, titleRoi] = await Promise.all([
          recognize(worker, codeCanvas).catch(() => ({ text: "", confidence: 0 })),
          recognize(worker, titleCanvas).catch(() => ({ text: "", confidence: 0 })),
        ]);
        codeRoiText = codeRoi.text;
        titleRoiText = titleRoi.text;
      } catch (e) {
        console.warn("[localCardOcr] ROI OCR failed:", e);
      }
    }
  }

  const merged = [codeRoiText, titleRoiText, full.text].filter(Boolean).join("\n");

  // Code ROI gets priority — try it first, then fall back to full text.
  let detected = extractPrintedCode(codeRoiText);
  if (!detected.fullCode) detected = extractPrintedCode(merged);

  const normalizedSet = detected.setCode && detected.cardNumber
    ? normalizeSetCodeToken(`${detected.setCode}-${detected.cardNumber}`)
    : null;

  const title = extractTitle(titleRoiText || full.text, detected.rawMatch);

  return {
    rawText: merged,
    title,
    setCode: normalizedSet ?? detected.fullCode ?? undefined,
    cardNumber: detected.cardNumber ?? undefined,
    fullCode: detected.fullCode ?? undefined,
    game: detected.game,
    edition: detected.edition ?? undefined,
    confidence: Math.max(full.confidence, detected.confidence),
    source: "local-browser-ocr",
  };
}

export async function shutdownLocalCardOcr(): Promise<void> {
  if (!workerPromise) return;
  const worker = await workerPromise;
  await worker.terminate();
  workerPromise = null;
}
