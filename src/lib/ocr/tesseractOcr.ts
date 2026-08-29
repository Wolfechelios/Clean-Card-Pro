// src/lib/ocr/tesseractOcr.ts
// Tesseract.js fallback OCR. Used when PaddleOCR fails to initialize (WASM/model
// issues) or returns no usable text. Shares the PaddleOCRResult shape so callers
// need no branching.

import { createWorker, type Worker } from "tesseract.js";
import type { PaddleOCRResult } from "@/lib/paddleOCR";

let workerPromise: Promise<Worker> | null = null;

async function getWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = createWorker("eng").catch((error) => {
      workerPromise = null;
      throw error;
    });
  }
  return workerPromise;
}

/** True when Tesseract can run in this environment. */
export function isTesseractSupported(): boolean {
  return typeof window !== "undefined" && typeof WebAssembly !== "undefined";
}

export async function warmupTesseract(): Promise<boolean> {
  try {
    await getWorker();
    return true;
  } catch {
    return false;
  }
}

export async function runTesseractOCR(imageDataUrl: string): Promise<PaddleOCRResult> {
  const worker = await getWorker();
  const startTime = performance.now();
  const { data } = await worker.recognize(imageDataUrl);
  console.log(`[TesseractOCR] Detection completed in ${Math.round(performance.now() - startTime)}ms`);

  const rawLines = Array.isArray((data as { lines?: unknown[] }).lines)
    ? ((data as { lines: Array<{ text?: string; confidence?: number; bbox?: { x0: number; y0: number; x1: number; y1: number } }> }).lines)
    : [];

  const lines = rawLines
    .map((line) => ({
      text: (line.text || "").trim(),
      confidence: Number.isFinite(line.confidence) ? (line.confidence as number) / 100 : 0,
      boundingBox: {
        x: line.bbox?.x0 ?? 0,
        y: line.bbox?.y0 ?? 0,
        width: (line.bbox?.x1 ?? 0) - (line.bbox?.x0 ?? 0),
        height: (line.bbox?.y1 ?? 0) - (line.bbox?.y0 ?? 0),
      },
    }))
    .filter((line) => line.text.length > 0);

  const text = lines.length
    ? lines.map((line) => line.text).join("\n")
    : (data.text || "").trim();

  return { text, lines, rawResult: data };
}

export async function terminateTesseract(): Promise<void> {
  const pending = workerPromise;
  workerPromise = null;
  if (!pending) return;
  try {
    const worker = await pending;
    await worker.terminate();
  } catch {
    /* ignore */
  }
}
