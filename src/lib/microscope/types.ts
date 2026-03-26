export type MicroscopeCaptureType = "foil_detail" | "surface_detail" | "corner_detail" | "text_detail";

export interface MicroscopeCapture {
  id: string;
  source: "microscope";
  captureType: MicroscopeCaptureType;
  parentScanId: string | null;
  deviceLabel: string;
  imageUrl: string;
  imageFile: File;
  sharpness: number;
  resolution: { width: number; height: number };
  capturedAt: string;
}

export interface MicroscopeDevice {
  deviceId: string;
  label: string;
  isMicroscope: boolean;
}

const MICROSCOPE_KEYWORDS = ["microscope", "usb camera", "uvc", "hvscam", "hayve", "digital microscope", "endoscope", "magnif"];

export function isMicroscopeDevice(label: string): boolean {
  const l = label.toLowerCase();
  return MICROSCOPE_KEYWORDS.some(kw => l.includes(kw));
}

export function measureSharpness(canvas: HTMLCanvasElement): number {
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return 0;

  // Sample center region for Laplacian variance
  const w = Math.min(canvas.width, 640);
  const h = Math.min(canvas.height, 480);
  const sx = Math.floor((canvas.width - w) / 2);
  const sy = Math.floor((canvas.height - h) / 2);

  const imageData = ctx.getImageData(sx, sy, w, h);
  const data = imageData.data;

  // Convert to grayscale and compute Laplacian variance
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const idx = i * 4;
    gray[i] = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
  }

  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const lap =
        gray[(y - 1) * w + x] +
        gray[(y + 1) * w + x] +
        gray[y * w + (x - 1)] +
        gray[y * w + (x + 1)] -
        4 * gray[y * w + x];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  if (count === 0) return 0;
  const mean = sum / count;
  const variance = sumSq / count - mean * mean;

  // Normalize to 0-100 scale
  return Math.min(100, Math.max(0, Math.sqrt(variance) / 2));
}
