// src/lib/paddleOCR.ts
// PaddleOCR integration using @gutenye/ocr-browser (PP-OCRv4 model via ONNX Runtime)

import Ocr from "@gutenye/ocr-browser";

let ocrInstance: Awaited<ReturnType<typeof Ocr.create>> | null = null;
let initPromise: Promise<void> | null = null;

// Model paths - these will be loaded from CDN
const MODEL_BASE_URL = "https://cdn.jsdelivr.net/npm/@aspect0/ppocr-onnx-models@latest/";

const MODEL_CONFIG = {
  detectionPath: `${MODEL_BASE_URL}ch_PP-OCRv4_det_infer.onnx`,
  recognitionPath: `${MODEL_BASE_URL}ch_PP-OCRv4_rec_infer.onnx`,
  dictionaryPath: `${MODEL_BASE_URL}ppocr_keys_v1.txt`,
};

/**
 * Initialize the PaddleOCR engine
 * Models are loaded from CDN on first use
 */
async function initPaddleOCR(): Promise<void> {
  if (ocrInstance) return;
  
  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    console.log("[PaddleOCR] Initializing OCR engine...");
    const startTime = performance.now();
    
    try {
      ocrInstance = await Ocr.create({
        models: MODEL_CONFIG,
      });
      
      const elapsed = Math.round(performance.now() - startTime);
      console.log(`[PaddleOCR] Engine initialized in ${elapsed}ms`);
    } catch (error) {
      console.error("[PaddleOCR] Failed to initialize:", error);
      initPromise = null;
      throw error;
    }
  })();

  await initPromise;
}

export type PaddleOCRResult = {
  text: string;
  lines: Array<{
    text: string;
    confidence: number;
    boundingBox: {
      x: number;
      y: number;
      width: number;
      height: number;
    };
  }>;
  rawResult: unknown;
};

/**
 * Convert various image sources to a data URL string
 */
function toDataURL(
  source: string | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement
): string {
  if (typeof source === "string") {
    return source;
  }

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Failed to get canvas context");

  if (source instanceof HTMLVideoElement) {
    canvas.width = source.videoWidth;
    canvas.height = source.videoHeight;
    ctx.drawImage(source, 0, 0);
  } else if (source instanceof HTMLImageElement) {
    canvas.width = source.naturalWidth || source.width;
    canvas.height = source.naturalHeight || source.height;
    ctx.drawImage(source, 0, 0);
  } else if (source instanceof HTMLCanvasElement) {
    return source.toDataURL("image/png");
  }

  return canvas.toDataURL("image/png");
}

/**
 * Run PaddleOCR on an image
 * @param imageSource - Can be an image URL, data URL, HTMLImageElement, HTMLCanvasElement, or HTMLVideoElement
 * @returns OCR result with extracted text and line-by-line details
 */
export async function runPaddleOCR(
  imageSource: string | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement
): Promise<PaddleOCRResult> {
  await initPaddleOCR();
  
  if (!ocrInstance) {
    throw new Error("PaddleOCR engine not initialized");
  }

  console.log("[PaddleOCR] Running OCR detection...");
  const startTime = performance.now();

  try {
    // Convert to data URL string for the OCR engine
    const imageUrl = toDataURL(imageSource);
    const result = await ocrInstance.detect(imageUrl);
    const elapsed = Math.round(performance.now() - startTime);
    console.log(`[PaddleOCR] Detection completed in ${elapsed}ms`);

    // Parse the result into a structured format
    const lines = (result || []).map((item: any) => ({
      text: item.text || "",
      confidence: item.score || 0,
      boundingBox: {
        x: item.box?.[0]?.[0] || 0,
        y: item.box?.[0]?.[1] || 0,
        width: (item.box?.[1]?.[0] || 0) - (item.box?.[0]?.[0] || 0),
        height: (item.box?.[2]?.[1] || 0) - (item.box?.[0]?.[1] || 0),
      },
    }));

    const fullText = lines.map((l) => l.text).join("\n");

    return {
      text: fullText,
      lines,
      rawResult: result,
    };
  } catch (error) {
    console.error("[PaddleOCR] Detection failed:", error);
    throw error;
  }
}

/**
 * Check if PaddleOCR is available and ready
 */
export function isPaddleOCRReady(): boolean {
  return ocrInstance !== null;
}

/**
 * Pre-initialize PaddleOCR (useful for warming up before first scan)
 */
export async function warmupPaddleOCR(): Promise<boolean> {
  try {
    await initPaddleOCR();
    return true;
  } catch {
    return false;
  }
}

/**
 * Extract text from an image file using PaddleOCR
 * @param file - Image file to process
 * @returns OCR result
 */
export async function runPaddleOCROnFile(file: File): Promise<PaddleOCRResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const dataUrl = reader.result as string;
        const result = await runPaddleOCR(dataUrl);
        resolve(result);
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Extract text from a canvas element using PaddleOCR
 * Useful for real-time camera scanning
 */
export async function runPaddleOCROnCanvas(
  canvas: HTMLCanvasElement
): Promise<PaddleOCRResult> {
  return runPaddleOCR(canvas);
}

/**
 * Extract text from a video frame using PaddleOCR
 * Useful for live video scanning
 */
export async function runPaddleOCROnVideo(
  video: HTMLVideoElement
): Promise<PaddleOCRResult> {
  return runPaddleOCR(video);
}
