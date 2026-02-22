import { getGpuStreamPrefs } from "./gpuSettings";

// Downscale a video frame to target width and return JPEG data URL.
// Uses an offscreen canvas to reduce GC pressure.
export function makeVideoFrameEncoder() {
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d", { alpha: false, desynchronized: true } as any) as CanvasRenderingContext2D | null;

  return function encode(videoEl: HTMLVideoElement): string | null {
    if (!ctx) return null;
    const vw = videoEl.videoWidth;
    const vh = videoEl.videoHeight;
    if (!vw || !vh) return null;

    const { targetWidth, jpegQuality } = getGpuStreamPrefs();

    const scale = targetWidth / vw;
    const w = Math.max(320, Math.round(vw * scale));
    const h = Math.round(vh * (w / vw));

    canvas.width = w;
    canvas.height = h;

    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(videoEl, 0, 0, w, h);

    try {
      return canvas.toDataURL("image/jpeg", jpegQuality);
    } catch {
      return null;
    }
  };
}
