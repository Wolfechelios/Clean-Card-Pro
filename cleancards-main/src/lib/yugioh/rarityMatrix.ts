// src/lib/yugioh/rarityMatrix.ts
// Client-side Yu-Gi-Oh! foil-rarity detection matrix

export type FoilFeatures = {
  nameFoil: "none" | "silver" | "gold" | "rainbow";
  artPattern: "none" | "secretDiagonal" | "starlight" | "lattice" | "ghost" | "foil";
  borderFoil: boolean;
  watermark: boolean;
  embossTexture: boolean;
};

export type YgoRarityDefinition = {
  rarity: string;
  foilFeatures: FoilFeatures;
  scannerMarker: string;
  falsePositiveNotes: string | null;
  /** Approximate relative value tier: 1 = lowest, 10 = highest */
  valueTier: number;
};

export const YGO_RARITIES: YgoRarityDefinition[] = [
  {
    rarity: "Common",
    foilFeatures: { nameFoil: "none", artPattern: "none", borderFoil: false, watermark: false, embossTexture: false },
    scannerMarker: "No foil detected in any zone",
    falsePositiveNotes: null,
    valueTier: 1,
  },
  {
    rarity: "Rare",
    foilFeatures: { nameFoil: "silver", artPattern: "none", borderFoil: false, watermark: false, embossTexture: false },
    scannerMarker: "Silver name foil only",
    falsePositiveNotes: null,
    valueTier: 2,
  },
  {
    rarity: "Super Rare",
    foilFeatures: { nameFoil: "none", artPattern: "foil", borderFoil: false, watermark: false, embossTexture: false },
    scannerMarker: "Foil artwork, non-foil name",
    falsePositiveNotes: "Holo bleed misprints can mimic; verify structured pattern vs random bleed",
    valueTier: 3,
  },
  {
    rarity: "Ultra Rare",
    foilFeatures: { nameFoil: "silver", artPattern: "foil", borderFoil: true, watermark: false, embossTexture: false },
    scannerMarker: "Silver name foil + foil border",
    falsePositiveNotes: null,
    valueTier: 5,
  },
  {
    rarity: "Secret Rare",
    foilFeatures: { nameFoil: "silver", artPattern: "secretDiagonal", borderFoil: true, watermark: false, embossTexture: false },
    scannerMarker: "Diagonal holographic foil lines across artwork",
    falsePositiveNotes: "Holo bleed can mimic; verify diagonal line pattern is structured, not random",
    valueTier: 6,
  },
  {
    rarity: "Quarter Century Secret Rare",
    foilFeatures: { nameFoil: "rainbow", artPattern: "secretDiagonal", borderFoil: true, watermark: true, embossTexture: false },
    scannerMarker: "Rainbow name foil + secret diagonal lines + 25th Anniversary watermark",
    falsePositiveNotes: null,
    valueTier: 9,
  },
  {
    rarity: "Collector's Rare",
    foilFeatures: { nameFoil: "rainbow", artPattern: "lattice", borderFoil: true, watermark: false, embossTexture: true },
    scannerMarker: "Lattice/grid foil artwork with embossed texture",
    falsePositiveNotes: null,
    valueTier: 7,
  },
  {
    rarity: "Gold Rare",
    foilFeatures: { nameFoil: "gold", artPattern: "foil", borderFoil: true, watermark: false, embossTexture: false },
    scannerMarker: "Gold name + gold foil border",
    falsePositiveNotes: "Flag if border reflectivity matches name plate gold",
    valueTier: 6,
  },
  {
    rarity: "Starlight Rare",
    foilFeatures: { nameFoil: "rainbow", artPattern: "starlight", borderFoil: true, watermark: false, embossTexture: false },
    scannerMarker: "Dense star sparkle foil across artwork and background",
    falsePositiveNotes: "Holo bleed is random; Starlight has structured star sparkle across ALL zones",
    valueTier: 10,
  },
  {
    rarity: "Ultimate Rare",
    foilFeatures: { nameFoil: "gold", artPattern: "foil", borderFoil: false, watermark: false, embossTexture: true },
    scannerMarker: "Embossed foil artwork with raised surfaces",
    falsePositiveNotes: null,
    valueTier: 8,
  },
  {
    rarity: "Ghost Rare",
    foilFeatures: { nameFoil: "silver", artPattern: "ghost", borderFoil: false, watermark: false, embossTexture: false },
    scannerMarker: "Ghost holographic artwork — faded, monochrome, mirror-like shine",
    falsePositiveNotes: "Ghost Rares are pale/washed out; standard recognition fails. Look for monochrome holographic reflection",
    valueTier: 9,
  },
];

/** Look up a rarity definition by name (case-insensitive) */
export function findRarityDefinition(rarity: string): YgoRarityDefinition | undefined {
  const normalized = rarity.toLowerCase().replace(/['']/g, "'").trim();
  return YGO_RARITIES.find((r) => r.rarity.toLowerCase() === normalized);
}

/** Get all rarity names sorted by value tier (highest first) */
export function getRaritiesByValue(): YgoRarityDefinition[] {
  return [...YGO_RARITIES].sort((a, b) => b.valueTier - a.valueTier);
}

/**
 * Match detected foil features against the rarity matrix.
 * Returns the best-matching rarity and a confidence score.
 */
export function matchRarityFromFeatures(features: Partial<FoilFeatures>): {
  matchedRarity: string;
  confidence: number;
  falsePositiveWarning: string | null;
} {
  let bestMatch: YgoRarityDefinition = YGO_RARITIES[0];
  let bestScore = 0;

  for (const entry of YGO_RARITIES) {
    let score = 0;
    let total = 0;

    if (features.nameFoil !== undefined) {
      total++;
      if (features.nameFoil === entry.foilFeatures.nameFoil) score++;
    }
    if (features.artPattern !== undefined) {
      total++;
      if (features.artPattern === entry.foilFeatures.artPattern) score++;
    }
    if (features.borderFoil !== undefined) {
      total++;
      if (features.borderFoil === entry.foilFeatures.borderFoil) score++;
    }
    if (features.watermark !== undefined) {
      total++;
      if (features.watermark === entry.foilFeatures.watermark) score++;
    }
    if (features.embossTexture !== undefined) {
      total++;
      if (features.embossTexture === entry.foilFeatures.embossTexture) score++;
    }

    const pct = total > 0 ? score / total : 0;
    if (pct > bestScore) {
      bestScore = pct;
      bestMatch = entry;
    }
  }

  return {
    matchedRarity: bestMatch.rarity,
    confidence: Math.round(bestScore * 100) / 100,
    falsePositiveWarning: bestMatch.falsePositiveNotes,
  };
}

// Backward compatibility alias
export type YgoZoneProfile = FoilFeatures;
export const matchRarityFromZones = matchRarityFromFeatures;
