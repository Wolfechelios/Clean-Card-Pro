// Foil Trainer — Evidence Ranker
// Combines model score, historical corrections, pattern analysis, and photo quality
// into a unified foil confidence score

import type { FoilLearningEntry, FinishType } from "./types";
import { queryFoilLearningEvidence } from "./foilCorrectionStore";

export interface FoilInferenceInputs {
  modelFoilScore: number;       // 0–1 from foil detector
  reflectionPatternScore: number; // 0–1 from pattern analysis
  photoQualityScore: number;     // 0–1 (1 = perfect conditions)
  cardId?: string;
  cardName?: string;
  cardSet?: string;
  cardNumber?: string;
  game?: string;
}

export interface FoilInferenceResult {
  finalFoilScore: number;
  suggestedFinish: FinishType | null;
  suggestedRarity: string | null;
  historicalEvidence: FoilLearningEntry[];
  historicalEvidenceScore: number;
  breakdown: {
    modelWeight: number;
    historicalWeight: number;
    reflectionWeight: number;
    photoQualityWeight: number;
  };
}

/**
 * Fuse all foil evidence sources into a final confidence score.
 * 
 * Formula:
 * finalFoilScore =
 *   modelFoilScore * 0.60 +
 *   historicalEvidenceScore * 0.20 +
 *   reflectionPatternScore * 0.15 +
 *   photoQualityAdjustedScore * 0.05
 */
export async function fuseFoilEvidence(
  userId: string,
  inputs: FoilInferenceInputs,
): Promise<FoilInferenceResult> {
  // Query historical evidence using multiple key strategies
  let evidence: FoilLearningEntry[] = [];
  let historicalEvidenceScore = 0;
  let suggestedFinish: FinishType | null = null;
  let suggestedRarity: string | null = null;

  // Try cardId first, then set+number, then card name
  const lookupKeys: Array<{ type: string; value: string }> = [];
  if (inputs.cardId) lookupKeys.push({ type: "cardId", value: inputs.cardId });
  if (inputs.cardSet && inputs.cardNumber) {
    lookupKeys.push({ type: "setNumber", value: `${inputs.cardSet}|${inputs.cardNumber}` });
  }
  if (inputs.cardName) lookupKeys.push({ type: "cardName", value: inputs.cardName.toLowerCase() });

  for (const key of lookupKeys) {
    const entries = await queryFoilLearningEvidence(userId, key.type, key.value);
    if (entries.length > 0) {
      evidence = entries;
      // Use highest-confidence entry
      const best = entries[0];
      historicalEvidenceScore = best.confidenceWeight;
      suggestedFinish = best.correctedFinish as FinishType | null;
      suggestedRarity = best.correctedRarity;
      break;
    }
  }

  // If no historical evidence, use neutral score
  if (evidence.length === 0) {
    historicalEvidenceScore = 0.5; // neutral, no bias
  }

  const finalFoilScore = Math.min(
    1,
    inputs.modelFoilScore * 0.60 +
    historicalEvidenceScore * 0.20 +
    inputs.reflectionPatternScore * 0.15 +
    inputs.photoQualityScore * 0.05,
  );

  return {
    finalFoilScore,
    suggestedFinish: evidence.length > 0 ? suggestedFinish : null,
    suggestedRarity: evidence.length > 0 ? suggestedRarity : null,
    historicalEvidence: evidence,
    historicalEvidenceScore,
    breakdown: {
      modelWeight: inputs.modelFoilScore * 0.60,
      historicalWeight: historicalEvidenceScore * 0.20,
      reflectionWeight: inputs.reflectionPatternScore * 0.15,
      photoQualityWeight: inputs.photoQualityScore * 0.05,
    },
  };
}
