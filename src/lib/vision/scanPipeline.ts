import type { CardVisionResult } from "./cardVisionTypes";
import { pickLayout } from "./cardLayouts";
import { scoreFrameQuality } from "./frameQuality";
import { normalizeCardImage } from "./imageNormalize";
import { inferBrandFromLines, readLocalText } from "./localText";

export async function runLocalCardVision(imageData: ImageData): Promise<CardVisionResult> {
  const quality = scoreFrameQuality(imageData);
  const firstLines = await readLocalText(imageData);
  const brand = inferBrandFromLines(firstLines);
  const layout = pickLayout(brand);
  const correctedImage = normalizeCardImage(imageData, brand);

  return {
    brand,
    layout,
    quality,
    ocrLines: firstLines,
    candidates: [],
    correctedImage,
  };
}
