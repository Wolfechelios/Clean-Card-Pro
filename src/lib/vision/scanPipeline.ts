import type { CardRegion, CardVisionResult, LocalOcrLine } from "./cardVisionTypes";
import { pickLayout } from "./cardLayouts";
import { scoreFrameQuality } from "./frameQuality";
import { normalizeCardImage } from "./imageNormalize";
import { inferBrandFromLines, readLocalText } from "./localText";
import { cropNormalizedRegion, detectPrimaryCard } from "./cardDetector";

function mergeLines(...groups: LocalOcrLine[][]): LocalOcrLine[] {
  const seen = new Set<string>();
  return groups
    .flat()
    .filter((line) => {
      const key = `${line.text.toLowerCase()}|${Math.round((line.region?.x || 0) * 100)}|${Math.round((line.region?.y || 0) * 100)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.confidence - a.confidence);
}

async function readRegion(image: ImageData, region: CardRegion): Promise<LocalOcrLine[]> {
  const crop = cropNormalizedRegion(image, region);
  const lines = await readLocalText(crop);
  return lines.map((line) => ({ ...line, region }));
}

function inferredCandidate(lines: LocalOcrLine[], brand: CardVisionResult["brand"]): CardVisionResult["candidates"] {
  const number = lines.find((line) => /(?:[a-z]{1,5}-?\d{1,4}|\d{1,4}\/\d{1,4})/i.test(line.text));
  const set = lines.find((line) => /(?:set|series|edition|expansion)/i.test(line.text));
  const name = lines.find((line) => line !== number && line !== set && /[a-z]{3}/i.test(line.text));
  if (!name) return [];
  const nameScore = Math.max(0, Math.min(1, name.confidence));
  const setNumberScore = Math.max(set?.confidence || 0, number?.confidence || 0);
  const layoutScore = brand === "unknown" ? 0.5 : 1;
  const score = nameScore * 0.35 + setNumberScore * 0.30 + layoutScore * 0.10;
  return [{
    id: `ocr:${brand}:${name.text}:${number?.text || ""}`,
    name: name.text,
    set: set?.text || null,
    number: number?.text || null,
    brand,
    score,
    signals: { name: nameScore, setNumber: setNumberScore, visual: 0, layout: layoutScore },
  }];
}

export async function runLocalCardVision(imageData: ImageData): Promise<CardVisionResult> {
  const quality = scoreFrameQuality(imageData);
  const detected = detectPrimaryCard(imageData);
  const initialLines = await readLocalText(detected.image);
  const brand = inferBrandFromLines(initialLines);
  const layout = pickLayout(brand);
  const correctedImage = normalizeCardImage(detected.image, brand);

  const regionGroups = await Promise.all([
    readRegion(correctedImage, layout.nameRegion),
    readRegion(correctedImage, layout.numberRegion),
    readRegion(correctedImage, layout.setRegion),
    layout.editionRegion ? readRegion(correctedImage, layout.editionRegion) : Promise.resolve([]),
  ]);

  const ocrLines = mergeLines(initialLines, ...regionGroups);
  const candidates = inferredCandidate(ocrLines, brand);

  return {
    brand,
    layout,
    quality: {
      ...quality,
      score: Math.max(0, Math.min(1, quality.score * 0.8 + detected.confidence * 0.2)),
      ready: quality.ready && detected.confidence >= 0.55,
      reason: quality.ready ? `Card detected at ${Math.round(detected.confidence * 100)}%` : quality.reason,
    },
    ocrLines,
    candidates,
    correctedImage,
  };
}
