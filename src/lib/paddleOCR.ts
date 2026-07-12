// src/lib/paddleOCR.ts
// PaddleOCR integration using @gutenye/ocr-browser (PP-OCRv4 via ONNX Runtime)

import * as ort from "onnxruntime-web";

// OCR binaries are copied from node_modules into public/ocr-assets by
// scripts/sync-ocr-assets.mjs. Loading them locally prevents CDN failures or
// SPA HTML fallbacks from being interpreted as WebAssembly/ONNX binaries.
const OCR_ASSET_ROOT = "/ocr-assets";
const ORT_DIST_URL = `${OCR_ASSET_ROOT}/ort/`;
const MODEL_BASE_URL = `${OCR_ASSET_ROOT}/models/`;

ort.env.wasm.wasmPaths = ORT_DIST_URL;
ort.env.wasm.numThreads = 1;
ort.env.wasm.proxy = false;

const MODEL_CONFIG = {
  detectionPath: `${MODEL_BASE_URL}ch_PP-OCRv4_det_infer.onnx`,
  recognitionPath: `${MODEL_BASE_URL}ch_PP-OCRv4_rec_infer.onnx`,
  dictionaryPath: `${MODEL_BASE_URL}ppocr_keys_v1.txt`,
};

const REQUIRED_BINARY_ASSETS = [
  {
    name: "ONNX Runtime WebAssembly",
    url: `${ORT_DIST_URL}ort-wasm-simd-threaded.wasm`,
    magic: [0x00, 0x61, 0x73, 0x6d],
  },
  {
    name: "PaddleOCR detection model",
    url: MODEL_CONFIG.detectionPath,
  },
  {
    name: "PaddleOCR recognition model",
    url: MODEL_CONFIG.recognitionPath,
  },
] as const;

type OcrModule = typeof import("@gutenye/ocr-browser");
type OcrInstance = Awaited<ReturnType<OcrModule["default"]["create"]>>;

let ocrInstance: OcrInstance | null = null;
let initPromise: Promise<void> | null = null;
let OcrClass: OcrModule["default"] | null = null;
let assetsVerified = false;

function beginsWith(bytes: Uint8Array, expected: readonly number[]): boolean {
  return expected.every((value, index) => bytes[index] === value);
}

function looksLikeHtml(bytes: Uint8Array): boolean {
  const prefix = new TextDecoder().decode(bytes.subarray(0, 64)).trimStart().toLowerCase();
  return prefix.startsWith("<!doctype") || prefix.startsWith("<html");
}

async function readAssetPrefix(url: string): Promise<{
  bytes: Uint8Array;
  contentType: string;
}> {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { Accept: "application/octet-stream,*/*" },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") || "unknown";
  const reader = response.body?.getReader();
  if (!reader) {
    const full = new Uint8Array(await response.arrayBuffer());
    return { bytes: full.subarray(0, 64), contentType };
  }

  const { value } = await reader.read();
  await reader.cancel();
  return { bytes: value?.subarray(0, 64) || new Uint8Array(), contentType };
}

async function verifyLocalOcrAssets(): Promise<void> {
  if (assetsVerified) return;

  for (const asset of REQUIRED_BINARY_ASSETS) {
    let result: Awaited<ReturnType<typeof readAssetPrefix>>;
    try {
      result = await readAssetPrefix(asset.url);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `${asset.name} could not be loaded from ${asset.url}: ${message}. ` +
          "Run npm install or npm run verify:ocr-assets, then rebuild the app.",
      );
    }

    if (result.bytes.length === 0) {
      throw new Error(`${asset.name} is empty at ${asset.url}`);
    }

    if (looksLikeHtml(result.bytes) || result.contentType.includes("text/html")) {
      throw new Error(
        `${asset.name} resolved to HTML instead of binary data at ${asset.url}. ` +
          "The OCR asset copy step did not run or the host rewrote the asset request.",
      );
    }

    if ("magic" in asset && !beginsWith(result.bytes, asset.magic)) {
      const header = Array.from(result.bytes.subarray(0, 8))
        .map((byte) => byte.toString(16).padStart(2, "0"))
        .join(" ");
      throw new Error(
        `${asset.name} has an invalid binary header at ${asset.url}: ${header}`,
      );
    }
  }

  assetsVerified = true;
}

/** Initialize the PaddleOCR engine. */
async function initPaddleOCR(): Promise<void> {
  if (ocrInstance) return;

  if (initPromise) {
    await initPromise;
    return;
  }

  initPromise = (async () => {
    console.log("[PaddleOCR] Verifying local OCR assets...");
    const startTime = performance.now();

    try {
      await verifyLocalOcrAssets();

      if (!OcrClass) {
        const module = await import("@gutenye/ocr-browser");
        OcrClass = module.default;
      }

      ocrInstance = await OcrClass.create({ models: MODEL_CONFIG });

      const elapsed = Math.round(performance.now() - startTime);
      console.log(`[PaddleOCR] Engine initialized in ${elapsed}ms`);
    } catch (error) {
      console.error("[PaddleOCR] Failed to initialize:", error);
      ocrInstance = null;
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

/** Convert supported browser image sources to a data URL. */
function toDataURL(
  source: string | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
): string {
  if (typeof source === "string") return source;

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

/** Run PaddleOCR on an image source. */
export async function runPaddleOCR(
  imageSource: string | HTMLImageElement | HTMLCanvasElement | HTMLVideoElement,
): Promise<PaddleOCRResult> {
  await initPaddleOCR();

  if (!ocrInstance) throw new Error("PaddleOCR engine not initialized");

  console.log("[PaddleOCR] Running OCR detection...");
  const startTime = performance.now();

  try {
    const imageUrl = toDataURL(imageSource);
    const result = await ocrInstance.detect(imageUrl);
    const elapsed = Math.round(performance.now() - startTime);
    console.log(`[PaddleOCR] Detection completed in ${elapsed}ms`);

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

    return {
      text: lines.map((line) => line.text).join("\n"),
      lines,
      rawResult: result,
    };
  } catch (error) {
    console.error("[PaddleOCR] Detection failed:", error);
    throw error;
  }
}

export function isPaddleOCRReady(): boolean {
  return ocrInstance !== null;
}

export async function warmupPaddleOCR(): Promise<boolean> {
  try {
    await initPaddleOCR();
    return true;
  } catch {
    return false;
  }
}

export async function runPaddleOCROnFile(file: File): Promise<PaddleOCRResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        resolve(await runPaddleOCR(reader.result as string));
      } catch (error) {
        reject(error);
      }
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export async function runPaddleOCROnCanvas(
  canvas: HTMLCanvasElement,
): Promise<PaddleOCRResult> {
  return runPaddleOCR(canvas);
}

export async function runPaddleOCROnVideo(
  video: HTMLVideoElement,
): Promise<PaddleOCRResult> {
  return runPaddleOCR(video);
}
