import { imageCanvasToBlob, type ImageCanvas } from "../imageCompressor.ts";
import type { CaptureProfileId } from "./contracts";
import { getCaptureProfile, type CaptureProfile } from "./captureProfiles.ts";
import { analyzeLumaFrame, type FrameMetrics } from "./frameAnalysis.ts";

export type CaptureRotation = 0 | 90 | 180 | 270;

export type PreparedCaptureImages = {
  originalBlob: Blob;
  libraryBlob: Blob;
  ocrBlob: Blob;
  metrics: FrameMetrics;
};

type DecodedImage = CanvasImageSource & {
  width: number;
  height: number;
  close?: () => void;
};

type ImageContext =
  | CanvasRenderingContext2D
  | OffscreenCanvasRenderingContext2D;

function createCanvas(width: number, height: number): ImageCanvas {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }
  if (typeof document === "undefined") {
    throw new Error("Canvas image processing is unavailable");
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function requireContext(canvas: ImageCanvas): ImageContext {
  const context = canvas.getContext("2d", { alpha: false });
  if (!context) throw new Error("Canvas image processing is unavailable");
  return context as ImageContext;
}

async function decodeImage(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === "function") {
    return createImageBitmap(blob);
  }
  if (typeof Image === "undefined") {
    throw new Error("Browser image decoding is unavailable");
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = new Image();
    image.decoding = "async";
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Image decoding failed"));
      image.src = objectUrl;
    });
    return image;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function drawRotated(
  source: DecodedImage,
  rotation: CaptureRotation,
): { canvas: ImageCanvas; context: ImageContext } {
  const sideways = rotation === 90 || rotation === 270;
  const width = sideways ? source.height : source.width;
  const height = sideways ? source.width : source.height;
  const canvas = createCanvas(width, height);
  const context = requireContext(canvas);

  context.save();
  if (rotation === 90) {
    context.translate(width, 0);
    context.rotate(Math.PI / 2);
  } else if (rotation === 180) {
    context.translate(width, height);
    context.rotate(Math.PI);
  } else if (rotation === 270) {
    context.translate(0, height);
    context.rotate(-Math.PI / 2);
  }
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  context.drawImage(source, 0, 0, source.width, source.height);
  context.restore();

  return { canvas, context };
}

function lumaFromImageData(imageData: ImageData): Uint8Array {
  const luma = new Uint8Array(imageData.width * imageData.height);
  for (let pixel = 0; pixel < luma.length; pixel++) {
    const offset = pixel * 4;
    luma[pixel] = Math.round(
      imageData.data[offset] * 0.299 +
        imageData.data[offset + 1] * 0.587 +
        imageData.data[offset + 2] * 0.114,
    );
  }
  return luma;
}

function localAverage(
  luma: Uint8Array,
  width: number,
  height: number,
  x: number,
  y: number,
): number {
  let total = 0;
  let count = 0;
  for (let offsetY = -1; offsetY <= 1; offsetY++) {
    const sampleY = y + offsetY;
    if (sampleY < 0 || sampleY >= height) continue;
    for (let offsetX = -1; offsetX <= 1; offsetX++) {
      const sampleX = x + offsetX;
      if (sampleX < 0 || sampleX >= width) continue;
      total += luma[sampleY * width + sampleX];
      count++;
    }
  }
  return count ? total / count : luma[y * width + x];
}

function applyOcrEnhancement(
  imageData: ImageData,
  luma: Uint8Array,
  profile: Readonly<CaptureProfile>,
): void {
  const highlightStart = 192;
  for (let y = 0; y < imageData.height; y++) {
    for (let x = 0; x < imageData.width; x++) {
      const pixel = y * imageData.width + x;
      const average = localAverage(luma, imageData.width, imageData.height, x, y);
      let value = average + (luma[pixel] - average) * profile.contrast;
      if (value > highlightStart) {
        value -= (value - highlightStart) * profile.highlightCompression;
      }
      const grayscale = Math.max(0, Math.min(255, Math.round(value)));
      const offset = pixel * 4;
      imageData.data[offset] = grayscale;
      imageData.data[offset + 1] = grayscale;
      imageData.data[offset + 2] = grayscale;
    }
  }
}

export async function prepareCaptureImages(
  originalBlob: Blob,
  profileId: CaptureProfileId,
  rotation: CaptureRotation,
): Promise<PreparedCaptureImages> {
  const profile = getCaptureProfile(profileId);
  const decoded = await decodeImage(originalBlob);

  try {
    const library = drawRotated(decoded, rotation);
    const imageData = library.context.getImageData(
      0,
      0,
      library.canvas.width,
      library.canvas.height,
    );
    const luma = lumaFromImageData(imageData);
    const metrics = analyzeLumaFrame(
      luma,
      library.canvas.width,
      library.canvas.height,
    );
    const libraryBlob = await imageCanvasToBlob(
      library.canvas,
      "image/jpeg",
      0.92,
    );

    const ocrCanvas = createCanvas(library.canvas.width, library.canvas.height);
    const ocrContext = requireContext(ocrCanvas);
    ocrContext.drawImage(library.canvas, 0, 0);
    const ocrImageData = ocrContext.getImageData(
      0,
      0,
      ocrCanvas.width,
      ocrCanvas.height,
    );
    applyOcrEnhancement(ocrImageData, luma, profile);
    ocrContext.putImageData(ocrImageData, 0, 0);
    const ocrBlob = await imageCanvasToBlob(ocrCanvas, "image/jpeg", 0.9);

    return { originalBlob, libraryBlob, ocrBlob, metrics };
  } finally {
    decoded.close?.();
  }
}
