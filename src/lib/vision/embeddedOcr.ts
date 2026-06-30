import { createWorker } from "tesseract.js";
import {
  extractEditionFromOcrText,
  extractYugiohSetCode,
  inferCardNameFromOcrText,
  normalizeOcrText,
} from "./yugiohOcr";

export type EmbeddedOcrEngine = "native-glm-ocr" | "browser-tesseract";

export type EmbeddedOcrResult = {
  engine: EmbeddedOcrEngine;
  rawText: string;
  cardName: string | null;
  setCode: string | null;
  edition: string | null;
  confidence: number;
};

type NativeOcrBridge = {
  scanImageDataUrl?: (imageDataUrl: string) => Promise<Partial<EmbeddedOcrResult> | string>;
  scanCardImage?: (imageDataUrl: string) => Promise<Partial<EmbeddedOcrResult> | string>;
};

type EmbeddedOcrWindow = Window & {
  cleanCardEmbeddedOcr?: NativeOcrBridge;
  CleanCardEmbeddedOcr?: NativeOcrBridge;
  Capacitor?: {
    Plugins?: {
      GlmOcr?: NativeOcrBridge;
    };
  };
};

function getNativeBridge(): NativeOcrBridge | null {
  if (typeof window === "undefined") return null;

  const w = window as EmbeddedOcrWindow;
  return (
    w.cleanCardEmbeddedOcr ||
    w.CleanCardEmbeddedOcr ||
    w.Capacitor?.Plugins?.GlmOcr ||
    null
  );
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("Failed to read image file"));
    reader.readAsDataURL(blob);
  });
}

function finalizeResult(
  raw: Partial<EmbeddedOcrResult> | string,
  engine: EmbeddedOcrEngine,
  fallbackConfidence = 70
): EmbeddedOcrResult {
  const rawText = normalizeOcrText(typeof raw === "string" ? raw : raw.rawText || "");

  return {
    engine,
    rawText,
    cardName: typeof raw === "string" ? inferCardNameFromOcrText(rawText) : raw.cardName || inferCardNameFromOcrText(rawText),
    setCode: typeof raw === "string" ? extractYugiohSetCode(rawText) : raw.setCode || extractYugiohSetCode(rawText),
    edition: typeof raw === "string" ? extractEditionFromOcrText(rawText) : raw.edition || extractEditionFromOcrText(rawText),
    confidence: typeof raw === "string" ? fallbackConfidence : Math.round(raw.confidence || fallbackConfidence),
  };
}

async function runNativeGlmOcr(imageDataUrl: string): Promise<EmbeddedOcrResult | null> {
  const bridge = getNativeBridge();
  if (!bridge) return null;

  const runner = bridge.scanImageDataUrl || bridge.scanCardImage;
  if (!runner) return null;

  const result = await runner(imageDataUrl);
  return finalizeResult(result, "native-glm-ocr", 85);
}

async function runBrowserTesseract(imageDataUrl: string): Promise<EmbeddedOcrResult> {
  const worker = await createWorker("eng");

  try {
    const { data } = await worker.recognize(imageDataUrl);
    return finalizeResult(
      {
        rawText: data.text || "",
        confidence: Number.isFinite(data.confidence) ? data.confidence : 65,
      },
      "browser-tesseract",
      65
    );
  } finally {
    await worker.terminate();
  }
}

export async function performEmbeddedCardOcr(image: Blob): Promise<EmbeddedOcrResult> {
  const imageDataUrl = await blobToDataUrl(image);

  const nativeResult = await runNativeGlmOcr(imageDataUrl);
  if (nativeResult) return nativeResult;

  return runBrowserTesseract(imageDataUrl);
}

export async function performEmbeddedCardOcrFromUrl(imageUrl: string): Promise<EmbeddedOcrResult> {
  const response = await fetch(imageUrl);
  if (!response.ok) {
    throw new Error(`Could not load image for embedded OCR: ${response.status}`);
  }

  const blob = await response.blob();
  return performEmbeddedCardOcr(blob);
}
