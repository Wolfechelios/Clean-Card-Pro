import type {
  BrandLayoutProfile,
  CardRegion,
  CardVisionResult,
  LocalOcrLine,
  LocalVisionMatchCandidate,
} from "./cardVisionTypes";
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
      const text = line.text.trim();
      if (!text) return false;
      const key = `${text.toLowerCase()}|${Math.round((line.region?.x || 0) * 100)}|${Math.round((line.region?.y || 0) * 100)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => b.confidence - a.confidence);
}

async function readRegion(image: ImageData, region: CardRegion): Promise<LocalOcrLine[]> {
  try {
    const crop = cropNormalizedRegion(image, region);
    const lines = await readLocalText(crop);
    return lines.map((line) => ({ ...line, region }));
  } catch (error) {
    console.warn("[LocalCardVision] Region OCR failed", error);
    return [];
  }
}

const NUMBER_PATTERN = /(?:[a-z]{1,6}[-_ ]?\d{1,5}|\d{1,4}\s*\/\s*\d{1,4})/i;
const NON_NAME_PATTERN = /^(?:hp|atk|def|stage|basic|energy|trainer|illustrator|©|www\.)/i;

function bestLine(lines: LocalOcrLine[], predicate: (text: string) => boolean): LocalOcrLine | undefined {
  return [...lines]
    .filter((line) => predicate(line.text.trim()))
    .sort((a, b) => b.confidence - a.confidence)[0];
}

function buildCandidate(args: {
  layout: BrandLayoutProfile;
  nameLines: LocalOcrLine[];
  numberLines: LocalOcrLine[];
  setLines: LocalOcrLine[];
  editionLines: LocalOcrLine[];
  allLines: LocalOcrLine[];
  qualityScore: number;
}): LocalVisionMatchCandidate[] {
  const { layout, nameLines, numberLines, setLines, editionLines, allLines, qualityScore } = args;

  const number = bestLine([...numberLines, ...setLines, ...allLines], (text) => NUMBER_PATTERN.test(text));
  const set = bestLine([...setLines, ...editionLines], (text) => {
    if (!text || text === number?.text) return false;
    return text.length <= 50 && /[a-z0-9]/i.test(text);
  });
  const name = bestLine([...nameLines, ...allLines], (text) => {
    if (!/[a-z]{2}/i.test(text)) return false;
    if (text.length < 2 || text.length > 80) return false;
    if (text === number?.text || text === set?.text) return false;
    if (NUMBER_PATTERN.test(text) && text.replace(NUMBER_PATTERN, "").trim().length < 3) return false;
    return !NON_NAME_PATTERN.test(text);
  });

  if (!name) return [];

  const nameScore = Math.max(0, Math.min(1, Number(name.confidence) || 0));
  const numberScore = Math.max(0, Math.min(1, Number(number?.confidence) || 0));
  const setScore = Math.max(0, Math.min(1, Number(set?.confidence) || 0));
  const identifierScore = Math.max(numberScore, setScore);
  const layoutScore = layout.brand === "unknown" ? 0.45 : 1;
  const score = Math.max(
    0,
    Math.min(0.99, nameScore * 0.48 + identifierScore * 0.32 + layoutScore * 0.10 + qualityScore * 0.10),
  );

  return [{
    id: `ocr:${layout.brand}:${name.text}:${number?.text || set?.text || ""}`,
    name: name.text.trim(),
    set: set?.text.trim() || null,
    number: number?.text.trim() || null,
    brand: layout.brand,
    score,
    signals: {
      name: nameScore,
      setNumber: identifierScore,
      visual: qualityScore,
      layout: layoutScore,
    },
  }];
}

export async function runLocalCardVision(imageData: ImageData): Promise<CardVisionResult> {
  const frameQuality = scoreFrameQuality(imageData);
  const detected = detectPrimaryCard(imageData);
  const initialLines = await readLocalText(detected.image).catch((error) => {
    console.warn("[LocalCardVision] Full-card OCR failed", error);
    return [] as LocalOcrLine[];
  });
  const brand = inferBrandFromLines(initialLines);
  const layout = pickLayout(brand);
  const correctedImage = normalizeCardImage(detected.image, brand);

  const [nameLines, numberLines, setLines, editionLines] = await Promise.all([
    readRegion(correctedImage, layout.nameRegion),
    readRegion(correctedImage, layout.numberRegion),
    readRegion(correctedImage, layout.setRegion),
    layout.editionRegion ? readRegion(correctedImage, layout.editionRegion) : Promise.resolve([]),
  ]);

  const ocrLines = mergeLines(initialLines, nameLines, numberLines, setLines, editionLines);
  const combinedQuality = Math.max(
    0,
    Math.min(1, frameQuality.score * 0.8 + detected.confidence * 0.2),
  );
  const candidates = buildCandidate({
    layout,
    nameLines,
    numberLines,
    setLines,
    editionLines,
    allLines: ocrLines,
    qualityScore: combinedQuality,
  });

  return {
    brand,
    layout,
    quality: {
      ...frameQuality,
      score: combinedQuality,
      ready: frameQuality.ready && detected.confidence >= 0.55,
      reason: frameQuality.ready
        ? `Card detected at ${Math.round(detected.confidence * 100)}%`
        : frameQuality.reason,
    },
    ocrLines,
    candidates,
    correctedImage,
  };
}
