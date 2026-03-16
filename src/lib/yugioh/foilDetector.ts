// src/lib/yugioh/foilDetector.ts
// Local Yu-Gi-Oh foil rarity detector — runs entirely on CPU via canvas
// No network calls, no GPU inference, no external dependencies

import { loadAndNormalize, segmentCardZones } from "./zoneSegmenter";
import {
  analyzeBrightness,
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
    artSparkle: number;
    borderFoilPresence: number;
    borderMetalColor: MetalColor;
    processingMs: number;
  };
}

// ─── Thresholds (tunable) ───────────────────────────────

const T = {
  foilPresence: 0.25,      // min score to consider a zone "foiled"
  diagonalStrong: 0.35,    // diagonal line strength for Secret Rare
  latticeStrong: 0.4,      // lattice pattern strength for Collector's Rare
  ghostStrong: 0.45,       // ghost pattern strength
  embossStrong: 0.35,      // emboss texture strength for Ultimate Rare
  sparkleHigh: 0.008,      // sparkle density for Starlight Rare
  sparkleMod: 0.003,       // moderate sparkle (Secret Rare range)
  borderFoil: 0.2,         // border foil presence threshold
};

// ─── Rarity Classification ──────────────────────────────

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
      return 0.7 + (d.artSparkle > T.sparkleHigh ? 0.2 : 0) + (f.borderFoil ? 0.1 : 0);
    },
  },
  {
    rarity: "Ghost Rare",
    match: (f, d) => {
      if (f.artPattern !== "ghost") return 0;
      if (f.nameFoil !== "silver") return 0;
      return 0.7 + (d.artGhost > 0.6 ? 0.2 : 0) + (!f.borderFoil ? 0.1 : 0);
    },
  },
  {
    rarity: "Quarter Century Secret Rare",
    match: (f) => {
      if (f.artPattern !== "secretDiagonal") return 0;
      if (f.nameFoil !== "rainbow") return 0;
      // Would need watermark detection — give moderate confidence without it
      return 0.65 + (f.borderFoil ? 0.1 : 0);
    },
  },
  {
    rarity: "Ultimate Rare",
    match: (f, d) => {
      if (!f.embossTexture) return 0;
      if (f.nameFoil !== "gold") return 0;
      return 0.65 + (d.artEmboss > 0.5 ? 0.2 : 0) + (!f.borderFoil ? 0.1 : 0.05);
    },
  },
  {
    rarity: "Collector's Rare",
    match: (f, d) => {
      if (f.artPattern !== "lattice") return 0;
      return 0.6 + (f.nameFoil === "rainbow" ? 0.15 : 0) + (f.embossTexture ? 0.15 : 0) + (f.borderFoil ? 0.1 : 0);
    },
  },
  {
    rarity: "Gold Rare",
    match: (f, d) => {
      if (f.nameFoil !== "gold") return 0;
      if (!f.borderFoil) return 0;
      if (d.borderMetalColor !== "gold") return 0;
      return 0.7 + (d.artFoilPresence > T.foilPresence ? 0.15 : 0);
    },
  },
  {
    rarity: "Secret Rare",
    match: (f, d) => {
      if (f.artPattern !== "secretDiagonal") return 0;
      return 0.65 + (f.borderFoil ? 0.1 : 0) + (d.artDiagonal > 0.5 ? 0.15 : 0);
    },
  },
  {
    rarity: "Ultra Rare",
    match: (f) => {
      if (f.nameFoil !== "silver" && f.nameFoil !== "gold") return 0;
      if (!f.borderFoil) return 0;
      return 0.6 + (f.nameFoil === "gold" ? 0.1 : 0);
    },
  },
  {
    rarity: "Super Rare",
    match: (f, d) => {
      if (f.nameFoil !== "none") return 0;
      if (d.artFoilPresence < T.foilPresence) return 0;
      return 0.6 + Math.min(0.3, d.artFoilPresence);
    },
  },
  {
    rarity: "Rare",
    match: (f, d) => {
      if (f.nameFoil !== "silver") return 0;
      if (d.artFoilPresence > T.foilPresence) return 0; // has art foil → higher rarity
      if (f.borderFoil) return 0;
      return 0.7 + (d.nameFoilConfidence > 0.6 ? 0.2 : 0);
    },
  },
  {
    rarity: "Common",
    match: (f, d) => {
      if (f.nameFoil !== "none") return 0;
      if (d.artFoilPresence > T.foilPresence) return 0;
      if (f.borderFoil) return 0;
      return 0.85;
    },
  },
];

// ─── Main Pipeline ──────────────────────────────────────

/**
 * Detect Yu-Gi-Oh card rarity from foil characteristics.
 * Runs entirely locally using canvas pixel analysis.
 *
 * @param source - Image source (HTMLImageElement, ImageBitmap, Blob, or data URL string)
 * @returns Rarity classification with foil features and confidence
 */
export async function detectFoilRarity(
  source: HTMLImageElement | ImageBitmap | Blob | string
): Promise<FoilDetectionResult> {
  const t0 = performance.now();

  // 1. Load and normalize image (max 400px wide for speed)
  const { imageData, width, height } = await loadAndNormalize(source, 400);

  // 2. Segment into zones
  const zones = segmentCardZones(imageData, width, height);

  // 3. Extract foil features per zone (run all in parallel conceptually, but sync for speed)

  // Name plate analysis
  const nameMetalResult = classifyMetalColor(zones.nameplate);
  const nameFoil: MetalColor = nameMetalResult.color;

  // Artwork analysis
  const artFoilPresence = detectFoilPresence(zones.artwork);
  const artDiagonal = detectDiagonalLines(zones.artwork);
  const artLattice = detectLatticePattern(zones.artwork);
  const artGhost = detectGhostPattern(zones.artwork);
  const artEmboss = detectEmbossTexture(zones.artwork);
  const artSparkle = sparkleDensity(zones.artwork, 230);

  // Border analysis
  const borderFoilPresence = detectFoilPresence(zones.border);
  const borderMetalResult = classifyMetalColor(zones.border);

  // 4. Classify art pattern
  let artPattern: FoilFeatures["artPattern"] = "none";
  const artScores = [
    { pattern: "secretDiagonal" as const, score: artDiagonal, threshold: T.diagonalStrong },
    { pattern: "starlight" as const, score: artSparkle > T.sparkleHigh ? 0.6 : 0, threshold: 0.3 },
    { pattern: "lattice" as const, score: artLattice, threshold: T.latticeStrong },
    { pattern: "ghost" as const, score: artGhost, threshold: T.ghostStrong },
  ];

  // Pick the strongest pattern above its threshold
  let bestPatternScore = 0;
  for (const { pattern, score, threshold } of artScores) {
    if (score > threshold && score > bestPatternScore) {
      artPattern = pattern;
      bestPatternScore = score;
    }
  }

  // If no specific pattern but foil is present → general "foil"
  if (artPattern === "none" && artFoilPresence > T.foilPresence) {
    artPattern = "foil";
  }

  // 5. Build foil features
  const borderFoil = borderFoilPresence > T.borderFoil;
  const embossTexture = artEmboss > T.embossStrong;

  const foilFeatures: FoilFeatures & { sparkleDensity: number } = {
    nameFoil,
    artPattern,
    borderFoil,
    watermark: false, // Watermark detection would require OCR — not in scope for pixel analysis
    embossTexture,
    sparkleDensity: Math.round(artSparkle * 10000) / 10000,
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
    artSparkle,
    borderFoilPresence,
    borderMetalColor: borderMetalResult.color,
    processingMs: Math.round(processingMs * 100) / 100,
  };

  // 6. Classify rarity using rule-based matching
  let bestRarity = "Common";
  let bestConfidence = 0;

  for (const rule of RARITY_RULES) {
    const score = rule.match(foilFeatures, debug);
    if (score > bestConfidence) {
      bestConfidence = score;
      bestRarity = rule.rarity;
    }
  }

  return {
    rarity: bestRarity,
    confidence: Math.round(bestConfidence * 100) / 100,
    foilFeatures,
    debug,
  };
}
