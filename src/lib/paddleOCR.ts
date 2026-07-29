// src/lib/paddleOCR.ts
// PaddleOCR integration using @gutenye/ocr-browser (PP-OCRv4 model via ONNX Runtime)
// Uses dynamic import to avoid bloating the main bundle

import * as ort from "onnxruntime-web";

// Keep OCR fully same-origin. These assets are committed under public/ocr-assets
// so Safari and installed PWAs do not depend on a third-party CDN or CORS.
ort.env.wasm.wasmPaths = "/ocr-assets/ort/";
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

type OcrModule = typeof import("@gutenye/ocr-browser");
type OcrInstance = Awaited<ReturnType<OcrModule["default"]["create"]>>;

let ocrInstance: OcrInstance | null = null;
let initPromise: Promise<void> | null = null;
let OcrClass: OcrModule["default"] | null = null;

const MODEL_BASE_URL = "/ocr-assets/models/";

const MODEL_CONFIG = {
  detectionPath: `${MODEL_BASE_URL}ch_PP-OCRv4_det_infer.onnx`,
  recognitionPath: `${MODEL_BASE_URL}ch_PP-OCRv4_rec_infer.onnx`,
  dictionaryPath: `${MODEL_BASE_URL}ppocr_keys_v1.txt`,
};

/**
 * Initialize the PaddleOCR engine
 * Models are loaded from bundled same-origin assets on first use.
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
      // Dynamic import to avoid bundling into main chunk
      if (!OcrClass) {
        const module = await import("@gutenye/ocr-browser");
        OcrClass = module.default;
      }
      
      ocrInstance = await OcrClass.create({
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

export type PaddleOCRImageSource =
  | string
  | Blob
  | ImageBitmap
  | HTMLImageElement
  | HTMLCanvasElement
  | HTMLVideoElement;

function isImageBitmap(source: PaddleOCRImageSource): source is ImageBitmap {
  return (
    typeof ImageBitmap !== "undefined" &&
    source instanceof ImageBitmap
  );
}

/**
 * Convert browser image sources to the string input expected by the OCR engine.
 * Blob inputs are decoded without FileReader so Rapid Scan never allocates a
 * second base64 copy of the captured file.
 */
export async function paddleImageToDataURL(
  source: PaddleOCRImageSource,
): Promise<string> {
  if (typeof source === "string") {
    return source;
  }

  let drawable: Exclude<PaddleOCRImageSource, string | Blob>;
  let decodedBitmap: ImageBitmap | null = null;
  if (source instanceof Blob) {
    if (typeof createImageBitmap !== "function") {
      throw new Error("Browser image decoding is unavailable");
    }
    decodedBitmap = await createImageBitmap(source);
    drawable = decodedBitmap;
  } else {
    drawable = source;
  }

  try {
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Failed to get canvas context");

    if (
      typeof HTMLVideoElement !== "undefined" &&
      drawable instanceof HTMLVideoElement
    ) {
      canvas.width = drawable.videoWidth;
      canvas.height = drawable.videoHeight;
      ctx.drawImage(drawable, 0, 0);
    } else if (
      typeof HTMLImageElement !== "undefined" &&
      drawable instanceof HTMLImageElement
    ) {
      canvas.width = drawable.naturalWidth || drawable.width;
      canvas.height = drawable.naturalHeight || drawable.height;
      ctx.drawImage(drawable, 0, 0);
    } else if (
      typeof HTMLCanvasElement !== "undefined" &&
      drawable instanceof HTMLCanvasElement
    ) {
      return drawable.toDataURL("image/png");
    } else if (isImageBitmap(drawable)) {
      canvas.width = drawable.width;
      canvas.height = drawable.height;
      ctx.drawImage(drawable, 0, 0);
    } else {
      throw new Error("Unsupported OCR image source");
    }

    return canvas.toDataURL("image/png");
  } finally {
    decodedBitmap?.close();
  }
}

/**
 * Run PaddleOCR on an image
 * @param imageSource - Can be an image URL, data URL, HTMLImageElement, HTMLCanvasElement, or HTMLVideoElement
 * @returns OCR result with extracted text and line-by-line details
 */
export async function runPaddleOCR(
  imageSource: PaddleOCRImageSource
): Promise<PaddleOCRResult> {
  await initPaddleOCR();
  
  if (!ocrInstance) {
    throw new Error("PaddleOCR engine not initialized");
  }

  console.log("[PaddleOCR] Running OCR detection...");
  const startTime = performance.now();

  try {
    // Convert to data URL string for the OCR engine
    const imageUrl = await paddleImageToDataURL(imageSource);
    const result = await ocrInstance.detect(imageUrl);
    const elapsed = Math.round(performance.now() - startTime);
    console.log(`[PaddleOCR] Detection completed in ${elapsed}ms`);

    // Parse the result into a structured format
    const lines = (result || []).map((item: {
      text?: string;
      score?: number;
      box?: number[][];
    }) => ({
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
  return runPaddleOCR(file);
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
