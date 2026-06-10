import type { FrameQualityScore } from "./cardVisionTypes";

function clamp01(value: number) {
  return Math.max(0, Math.min(1, value));
}

export function scoreFrameQuality(imageData: ImageData): FrameQualityScore {
  const data = imageData.data;
  let brightPixels = 0;
  let darkPixels = 0;
  let edgeEnergy = 0;
  let lumaTotal = 0;
  const sampleStep = 16;

  for (let i = 0; i < data.length; i += 4 * sampleStep) {
    const luma = data[i] * 0.2126 + data[i + 1] * 0.7152 + data[i + 2] * 0.0722;
    lumaTotal += luma;
    if (luma > 238) brightPixels += 1;
    if (luma < 24) darkPixels += 1;
    const next = Math.min(i + 4 * sampleStep, data.length - 4);
    const nextLuma = data[next] * 0.2126 + data[next + 1] * 0.7152 + data[next + 2] * 0.0722;
    edgeEnergy += Math.abs(luma - nextLuma);
  }

  const samples = Math.max(1, Math.floor(data.length / (4 * sampleStep)));
  const brightness = clamp01((lumaTotal / samples) / 180);
  const glare = clamp01(1 - brightPixels / samples / 0.12);
  const contrast = clamp01(edgeEnergy / samples / 28);
  const blur = contrast;
  const score = clamp01(blur * 0.35 + glare * 0.25 + brightness * 0.2 + contrast * 0.2 - darkPixels / samples * 0.2);

  return {
    blur,
    glare,
    brightness,
    contrast,
    score,
    ready: score >= 0.72,
    reason: score >= 0.72 ? "Frame ready" : "Hold steady, reduce glare, and fill the guide box",
  };
}
