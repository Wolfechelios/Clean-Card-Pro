// src/lib/yugioh/foilDetector.ts
// High-accuracy local Yu-Gi-Oh foil rarity detector — CPU only
// 4-stage pipeline: normalize → segment → extract → classify
// Target: ~90-95% accuracy, 15-40ms per card

import { loadAndNormalize, segmentCardZones } from "./zoneSegmenter";
import {
  sparkleDensity,
  detectDiagonalLines,
  detectLatticePattern,
  detectGhostPattern,
  detectEmbossTexture,
  detectFoilPresence,
  classifyMetalColor,
  type MetalColor,
} from "./patternAnalysis";
import type { FoilFeatures } from "./rarityMatrix";

export interface FoilDetectionResult {
  rarity: string;
  confidence: number;
  foilFeatures: FoilFeatures & { sparkleDensity: number };
  /** Raw scores from each detector for debugging / tuning */
  debug: {
    nameFoilColor: MetalColor;
    nameFoilConfidence: number;
    artFoilPresence: number;
    artDiagonal: number;
    artLattice: number;
    artGhost: number;
    artEmboss: number;
    artSparkleDensity: number;
    artSparkleClusterCount: number;
    artSparkleAvgClusterSize: number;
    borderFoilPresence: number;
    borderMetalColor: MetalColor;
    /** Individual detector scores used in weighted confidence */
    patternScore: number;
    sparkleScore: number;
    foilScore: number;
    textureScore: number;
    processingMs: number;
  };
}

// ─── Tuned Thresholds ───────────────────────────────────

const T = {
  foilPresence: 0.22,       // min score to consider a zone "foiled"
  diagonalStrong: 0.30,     // diagonal line strength for Secret Rare
  latticeStrong: 0.35,      // lattice pattern for Collector's Rare
  ghostStrong: 0.40,        // ghost pattern
  embossStrong: 0.30,       // emboss texture for Ultimate Rare
  sparkleHighDensity: 0.006, // sparkle density for Starlight Rare
  sparkleHighClusters: 15,   // min cluster count for Starlight
  borderFoil: 0.18,         // border foil presence
};

// ─── Rarity Classification Rules ────────────────────────

interface RarityRule {
  rarity: string;
  match: (f: FoilFeatures & { sparkleDensity: number }, d: FoilDetectionResult["debug"]) => number;
}

const RARITY_RULES: RarityRule[] = [
  {
    rarity: "Starlight Rare",
    match: (f, d) => {
      if (f.artPattern !== "starlight") return 0;
      if (f.nameFoil !== "rainbow") return 0;
      // Dense small sparkle clusters + rainbow name = Starlight
      const clusterBonus = d.artSparkleAvgClusterSize < 8 ? 0.1 : 0;
      return 0.72 + (d.artSparkleDensity > T.sparkleHighDensity ? 0.15 : 0) + (f.borderFoil ? 0.08 : 0) + clusterBonus;
    },
  },
  {
    rarity: "Ghost Rare",
    match: (f, d) => {
      if (f.artPattern !== "ghost") return 0;
      if (f.nameFoil !== "silver") return 0;
      return 0.72 + (d.artGhost > 0.55 ? 0.18 : 0) + (!f.borderFoil ? 0.08 : 0);
    },
  },
  {
    rarity: "Quarter Century Secret Rare",
    match: (f) => {
      if (f.artPattern !== "secretDiagonal") return 0;
      if (f.nameFoil !== "rainbow") return 0;
      // Watermark detection is OCR-based; pixel analysis gives moderate confidence
      return 0.68 + (f.borderFoil ? 0.08 : 0);
    },
  },
  {
    rarity: "Ultimate Rare",
    match: (f, d) => {
      if (!f.embossTexture) return 0;
      if (f.nameFoil !== "gold") return 0;
      const embossBonus = d.artEmboss > 0.5 ? 0.15 : 0;
      return 0.68 + embossBonus + (!f.borderFoil ? 0.08 : 0.04);
    },
  },
  {
    rarity: "Collector's Rare",
    match: (f, d) => {
      if (f.artPattern !== "lattice") return 0;
      return 0.62 + (f.nameFoil === "rainbow" ? 0.12 : 0) + (f.embossTexture ? 0.12 : 0) + (f.borderFoil ? 0.08 : 0);
    },
  },
  {
    rarity: "Gold Rare",
    match: (f, d) => {
      if (f.nameFoil !== "gold") return 0;
      if (!f.borderFoil) return 0;
      if (d.borderMetalColor !== "gold") return 0;
      return 0.72 + (d.artFoilPresence > T.foilPresence ? 0.12 : 0);
    },
  },
  {
    rarity: "Secret Rare",
    match: (f, d) => {
      if (f.artPattern !== "secretDiagonal") return 0;
      return 0.67 + (f.borderFoil ? 0.08 : 0) + (d.artDiagonal > 0.5 ? 0.12 : 0) + (d.patternScore > 0.6 ? 0.08 : 0);
    },
  },
  {
    rarity: "Ultra Rare",
    match: (f, d) => {
      if (f.nameFoil !== "silver" && f.nameFoil !== "gold") return 0;
      if (!f.borderFoil) return 0;
      if (d.artFoilPresence < T.foilPresence) return 0; // needs foil art too
      return 0.65 + (f.nameFoil === "gold" ? 0.08 : 0) + (d.foilScore > 0.4 ? 0.08 : 0);
    },
  },
  {
    rarity: "Super Rare",
    match: (f, d) => {
      if (f.nameFoil !== "none") return 0;
      if (d.artFoilPresence < T.foilPresence) return 0;
      return 0.62 + Math.min(0.28, d.artFoilPresence * 0.5);
    },
  },
  {
    rarity: "Rare",
    match: (f, d) => {
      if (f.nameFoil !== "silver") return 0;
      if (d.artFoilPresence > T.foilPresence) return 0;
      if (f.borderFoil) return 0;
      return 0.75 + (d.nameFoilConfidence > 0.6 ? 0.15 : 0);
    },
  },
  {
    rarity: "Common",
    match: (f, d) => {
      if (f.nameFoil !== "none") return 0;
      if (d.artFoilPresence > T.foilPresence) return 0;
      if (f.borderFoil) return 0;
      return 0.88;
    },
  },
];

// ─── Weighted Confidence Scoring ────────────────────────

/**
 * Compute final confidence using weighted combination of detector scores.
 * Formula: 0.4 * patternScore + 0.3 * sparkleScore + 0.2 * foilScore + 0.1 * textureScore
 */
function computeWeightedConfidence(
  patternScore: number,
  sparkleScore: number,
  foilScore: number,
  textureScore: number,
  ruleConfidence: number
): number {
  const weighted =
    0.4 * patternScore +
    0.3 * sparkleScore +
    0.2 * foilScore +
    0.1 * textureScore;

  // Blend rule-based confidence with weighted detector confidence
  // Rule confidence provides the base, weighted score provides refinement
  return Math.min(1, ruleConfidence * 0.7 + weighted * 0.3);
}

// ─── Main Pipeline ──────────────────────────────────────

/**
 * Detect Yu-Gi-Oh card rarity from foil characteristics.
 *
 * Pipeline:
 * 1. Load + normalize lighting (CLAHE + glare reduction)
 * 2. Segment into zones (nameplate, artwork, border, lower)
 * 3. Extract foil features per zone
 * 4. Classify rarity via rule-based matching + weighted confidence
 *
 * @param source - HTMLImageElement, ImageBitmap, Blob, or data URL string
 * @returns Rarity classification with foil features, confidence, and debug data
 */
export async function detectFoilRarity(
  source: HTMLImageElement | ImageBitmap | Blob | string
): Promise<FoilDetectionResult> {
  const t0 = performance.now();

  // Stage 1: Load + normalize lighting (CLAHE + glare reduction happens in loadAndNormalize)
  const { imageData, width, height } = await loadAndNormalize(source, 400);

  // Stage 2: Segment into zones
  const zones = segmentCardZones(imageData, width, height);

  // Stage 3: Extract foil features per zone

  // Name plate analysis
  const nameMetalResult = classifyMetalColor(zones.nameplate);
  const nameFoil: MetalColor = nameMetalResult.color;

  // Artwork analysis
  const artFoilPresence = detectFoilPresence(zones.artwork);
  const artDiagonal = detectDiagonalLines(zones.artwork);
  const artLattice = detectLatticePattern(zones.artwork);
  const artGhost = detectGhostPattern(zones.artwork);
  const artEmboss = detectEmbossTexture(zones.artwork);
  const artSparkleResult = sparkleDensity(zones.artwork, 230);

  // Border analysis
  const borderFoilPresence = detectFoilPresence(zones.border);
  const borderMetalResult = classifyMetalColor(zones.border);

  // Stage 4: Classify art pattern
  let artPattern: FoilFeatures["artPattern"] = "none";
  const artScores = [
    { pattern: "secretDiagonal" as const, score: artDiagonal, threshold: T.diagonalStrong },
    {
      pattern: "starlight" as const,
      score: (artSparkleResult.density > T.sparkleHighDensity && artSparkleResult.clusterCount > T.sparkleHighClusters) ? 0.65 : 0,
      threshold: 0.3,
    },
    { pattern: "lattice" as const, score: artLattice, threshold: T.latticeStrong },
    { pattern: "ghost" as const, score: artGhost, threshold: T.ghostStrong },
  ];

  let bestPatternScore = 0;
  for (const { pattern, score, threshold } of artScores) {
    if (score > threshold && score > bestPatternScore) {
      artPattern = pattern;
      bestPatternScore = score;
    }
  }

  if (artPattern === "none" && artFoilPresence > T.foilPresence) {
    artPattern = "foil";
  }

  // Build foil features
  const borderFoil = borderFoilPresence > T.borderFoil;
  const embossTexture = artEmboss > T.embossStrong;

  // Compute individual detector scores for weighted confidence
  const patternScore = Math.max(artDiagonal, artLattice, artGhost, bestPatternScore);
  const sparkleScore = Math.min(1, artSparkleResult.density * 100);
  const foilScore = artFoilPresence;
  const textureScore = artEmboss;

  const foilFeatures: FoilFeatures & { sparkleDensity: number } = {
    nameFoil,
    artPattern,
    borderFoil,
    watermark: false,
    embossTexture,
    sparkleDensity: Math.round(artSparkleResult.density * 10000) / 10000,
  };

  const processingMs = performance.now() - t0;

  const debug: FoilDetectionResult["debug"] = {
    nameFoilColor: nameFoil,
    nameFoilConfidence: nameMetalResult.confidence,
    artFoilPresence,
    artDiagonal,
    artLattice,
    artGhost,
    artEmboss,
    artSparkleDensity: artSparkleResult.density,
    artSparkleClusterCount: artSparkleResult.clusterCount,
    artSparkleAvgClusterSize: artSparkleResult.avgClusterSize,
    borderFoilPresence,
    borderMetalColor: borderMetalResult.color,
    patternScore,
    sparkleScore,
    foilScore,
    textureScore,
    processingMs: Math.round(processingMs * 100) / 100,
  };

  // Rule-based rarity matching
  let bestRarity = "Common";
  let bestRuleConfidence = 0;

  for (const rule of RARITY_RULES) {
    const score = rule.match(foilFeatures, debug);
    if (score > bestRuleConfidence) {
      bestRuleConfidence = score;
      bestRarity = rule.rarity;
    }
  }

  // Weighted confidence blending
  const finalConfidence = computeWeightedConfidence(
    patternScore, sparkleScore, foilScore, textureScore, bestRuleConfidence
  );

  return {
    rarity: bestRarity,
    confidence: Math.round(finalConfidence * 100) / 100,
    foilFeatures,
    debug,
  };
}
