// Cloud OCR (Z.AI / GLM) is disabled in local-first mode.
// The scanner uses on-device OCR via `runLocalCardOcr`; this stub keeps
// existing imports working and always returns null so callers fall through
// to their local path.

import type { DetectedGame } from "./gameCodePatterns";

export type GlmOcrResult = {
  rawText: string;
  title?: string;
  setCode?: string;
  cardNumber?: string;
  fullCode?: string;
  game?: DetectedGame;
  edition?: string;
  confidence: number;
  source: "local-glm-ocr";
};

export async function runGlmOcr(
  _image: Blob | File | string,
): Promise<GlmOcrResult | null> {
  return null;
}
