export type CapturePipelineMode = "RAPID" | "GRADING";

export type CapturePipelineOptions = {
  mode: CapturePipelineMode;
  rapidMaxLongEdge: number;
  rapidJpegQuality: number;
  rapidPreferWebp: boolean;

  gradingBurstFrames: number;
  gradingMinSharpness: number;
  gradingOutputFormat: "jpeg" | "png" | "webp";
  gradingJpegQuality: number;
};

export async function captureWithPipeline(
  video: HTMLVideoElement,
  opts: CapturePipelineOptions
): Promise<{ blob: Blob; mime: string }>
{
  const w = video.videoWidth || 1280;
  const h = video.videoHeight || 720;

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  ctx.drawImage(video, 0, 0, w, h);

  // RAPID: optionally downscale
  let outCanvas = canvas;
  if (opts.mode === "RAPID" && opts.rapidMaxLongEdge > 0) {
    const longEdge = Math.max(w, h);
    if (longEdge > opts.rapidMaxLongEdge) {
      const scale = opts.rapidMaxLongEdge / longEdge;
      const tw = Math.round(w * scale);
      const th = Math.round(h * scale);
      const c2 = document.createElement("canvas");
      c2.width = tw;
      c2.height = th;
      const ctx2 = c2.getContext("2d");
      if (ctx2) {
        ctx2.drawImage(outCanvas, 0, 0, tw, th);
        outCanvas = c2;
      }
    }
  }

  const mime = (() => {
    if (opts.mode === "GRADING") {
      if (opts.gradingOutputFormat === "png") return "image/png";
      if (opts.gradingOutputFormat === "webp") return "image/webp";
      return "image/jpeg";
    }
    return opts.rapidPreferWebp ? "image/webp" : "image/jpeg";
  })();

  const quality = opts.mode === "GRADING" ? opts.gradingJpegQuality : opts.rapidJpegQuality;
  const blob = await new Promise<Blob>((resolve, reject) => {
    outCanvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Failed to encode image"))),
      mime,
      mime === "image/jpeg" || mime === "image/webp" ? quality : undefined
    );
  });

  return { blob, mime };
}
