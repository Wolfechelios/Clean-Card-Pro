// src/lib/yugioh/rarityMatrix.ts
// Client-side Yu-Gi-Oh! rarity matrix for display, validation, and zone analysis

export type YgoZoneProfile = {
  nameplate_foil: "none" | "silver" | "gold" | "rainbow";
  art_pattern: "none" | "rainbow" | "diagonal_lines" | "horizontal_vertical_grid" | "embossed_3d" | "speckled_varnish";
  border_state: "standard" | "holographic_lattice" | "textured" | "gold";
  icons_foiled: boolean;
  watermark: string | null;
  false_positive_check?: string | null;
};

export type YgoRarityDefinition = {
  rarity: string;
  zones: YgoZoneProfile;
  scannerMarker: string;
  falsePositiveNotes: string | null;
  /** Approximate relative value tier: 1 = lowest, 10 = highest */
  valueTier: number;
};

export const YGO_RARITIES: YgoRarityDefinition[] = [
  {
    rarity: "Common",
    zones: { nameplate_foil: "none", art_pattern: "none", border_state: "standard", icons_foiled: false, watermark: null },
    scannerMarker: "No foil in any zone",
    falsePositiveNotes: null,
    valueTier: 1,
  },
  {
    rarity: "Rare",
    zones: { nameplate_foil: "silver", art_pattern: "none", border_state: "standard", icons_foiled: false, watermark: null },
    scannerMarker: "Silver name plate only",
    falsePositiveNotes: null,
    valueTier: 2,
  },
  {
    rarity: "Super Rare",
    zones: { nameplate_foil: "none", art_pattern: "rainbow", border_state: "standard", icons_foiled: false, watermark: null },
    scannerMarker: "Rainbow art, non-foil name",
    falsePositiveNotes: "Holo bleed misprints can mimic; verify structured pattern",
    valueTier: 3,
  },
  {
    rarity: "Ultra Rare",
    zones: { nameplate_foil: "gold", art_pattern: "rainbow", border_state: "standard", icons_foiled: false, watermark: null },
    scannerMarker: "Gold name + rainbow art",
    falsePositiveNotes: null,
    valueTier: 5,
  },
  {
    rarity: "Secret Rare",
    zones: { nameplate_foil: "rainbow", art_pattern: "diagonal_lines", border_state: "standard", icons_foiled: false, watermark: null },
    scannerMarker: "45° diagonal foil lines",
    falsePositiveNotes: "Verify structured diagonal lines, not random holo bleed",
    valueTier: 6,
  },
  {
    rarity: "Starlight Rare",
    zones: { nameplate_foil: "rainbow", art_pattern: "horizontal_vertical_grid", border_state: "holographic_lattice", icons_foiled: true, watermark: null },
    scannerMarker: "Full-card lattice grid pattern",
    falsePositiveNotes: "Holo bleed is random; Starlight has structured lattice across ALL zones",
    valueTier: 10,
  },
  {
    rarity: "Ultimate Rare",
    zones: { nameplate_foil: "gold", art_pattern: "embossed_3d", border_state: "standard", icons_foiled: true, watermark: null },
    scannerMarker: "Embossed/raised surfaces",
    falsePositiveNotes: null,
    valueTier: 8,
  },
  {
    rarity: "Ghost Rare",
    zones: { nameplate_foil: "silver", art_pattern: "rainbow", border_state: "standard", icons_foiled: false, watermark: null },
    scannerMarker: "Pale/washed-out art, silvery-white name",
    falsePositiveNotes: "Ghost Rares fail standard recognition. Look for silvery-white name + blank art",
    valueTier: 9,
  },
  {
    rarity: "Collector's Rare",
    zones: { nameplate_foil: "rainbow", art_pattern: "speckled_varnish", border_state: "textured", icons_foiled: false, watermark: null },
    scannerMarker: "Fingerprint/speckled texture on borders",
    falsePositiveNotes: null,
    valueTier: 7,
  },
  {
    rarity: "Gold Rare",
    zones: { nameplate_foil: "gold", art_pattern: "rainbow", border_state: "gold", icons_foiled: true, watermark: null },
    scannerMarker: "Gold borders matching name plate foil",
    falsePositiveNotes: "Flag if border reflectivity matches name plate gold",
    valueTier: 6,
  },
  {
    rarity: "Quarter Century Secret Rare",
    zones: { nameplate_foil: "rainbow", art_pattern: "diagonal_lines", border_state: "standard", icons_foiled: false, watermark: "25th Anniversary" },
    scannerMarker: "Secret Rare + 25th Anniversary watermark",
    falsePositiveNotes: null,
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
 * Validate detected zone data against the rarity matrix.
 * Returns the best-matching rarity and a confidence score.
 */
export function matchRarityFromZones(zones: Partial<YgoZoneProfile>): {
  matchedRarity: string;
  confidence: number;
  falsePositiveWarning: string | null;
} {
  let bestMatch: YgoRarityDefinition = YGO_RARITIES[0]; // default Common
  let bestScore = 0;

  for (const entry of YGO_RARITIES) {
    let score = 0;
    let total = 0;

    if (zones.nameplate_foil !== undefined) {
      total++;
      if (zones.nameplate_foil === entry.zones.nameplate_foil) score++;
    }
    if (zones.art_pattern !== undefined) {
      total++;
      if (zones.art_pattern === entry.zones.art_pattern) score++;
    }
    if (zones.border_state !== undefined) {
      total++;
      if (zones.border_state === entry.zones.border_state) score++;
    }
    if (zones.icons_foiled !== undefined) {
      total++;
      if (zones.icons_foiled === entry.zones.icons_foiled) score++;
    }
    if (zones.watermark !== undefined) {
      total++;
      const hasWatermark = !!zones.watermark;
      const expectsWatermark = !!entry.zones.watermark;
      if (hasWatermark === expectsWatermark) score++;
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
