// supabase/functions/_shared/ygoRarityMatrix.ts
// Yu-Gi-Oh! Foil-Based Rarity Detection Matrix

export type FoilFeatures = {
  nameFoil: "none" | "silver" | "gold" | "rainbow";
  artPattern: "none" | "secretDiagonal" | "starlight" | "lattice" | "ghost" | "foil";
  borderFoil: boolean;
  watermark: boolean;
  embossTexture: boolean;
};

export type RarityEntry = {
  rarity: string;
  foilFeatures: FoilFeatures;
  scanner_marker: string;
  false_positive_notes: string | null;
};

export const YGO_RARITY_MATRIX: RarityEntry[] = [
  {
    rarity: "Common",
    foilFeatures: { nameFoil: "none", artPattern: "none", borderFoil: false, watermark: false, embossTexture: false },
    scanner_marker: "No foil detected in any zone",
    false_positive_notes: null,
  },
  {
    rarity: "Rare",
    foilFeatures: { nameFoil: "silver", artPattern: "none", borderFoil: false, watermark: false, embossTexture: false },
    scanner_marker: "Silver name foil only; art and border are flat",
    false_positive_notes: null,
  },
  {
    rarity: "Super Rare",
    foilFeatures: { nameFoil: "none", artPattern: "foil", borderFoil: false, watermark: false, embossTexture: false },
    scanner_marker: "Foil artwork; name plate is NOT foiled",
    false_positive_notes: "Holo bleed misprints can mimic this; check for structured foil vs random bleed",
  },
  {
    rarity: "Ultra Rare",
    foilFeatures: { nameFoil: "silver", artPattern: "foil", borderFoil: true, watermark: false, embossTexture: false },
    scanner_marker: "Silver name foil + foil border",
    false_positive_notes: null,
  },
  {
    rarity: "Secret Rare",
    foilFeatures: { nameFoil: "silver", artPattern: "secretDiagonal", borderFoil: true, watermark: false, embossTexture: false },
    scanner_marker: "Diagonal holographic foil lines across artwork region",
    false_positive_notes: "Holo bleed can mimic; verify diagonal line pattern is structured, not random",
  },
  {
    rarity: "Quarter Century Secret Rare",
    foilFeatures: { nameFoil: "rainbow", artPattern: "secretDiagonal", borderFoil: true, watermark: true, embossTexture: false },
    scanner_marker: "Rainbow name foil + secret diagonal lines + 25th Anniversary watermark",
    false_positive_notes: null,
  },
  {
    rarity: "Collector's Rare",
    foilFeatures: { nameFoil: "rainbow", artPattern: "lattice", borderFoil: true, watermark: false, embossTexture: true },
    scanner_marker: "Lattice/grid foil artwork with embossed texture on borders",
    false_positive_notes: null,
  },
  {
    rarity: "Gold Rare",
    foilFeatures: { nameFoil: "gold", artPattern: "foil", borderFoil: true, watermark: false, embossTexture: false },
    scanner_marker: "Gold name + gold foil border",
    false_positive_notes: "Gold Series variants have gold borders; flag any card where border reflectivity matches name plate gold",
  },
  {
    rarity: "Starlight Rare",
    foilFeatures: { nameFoil: "rainbow", artPattern: "starlight", borderFoil: true, watermark: false, embossTexture: false },
    scanner_marker: "Dense star sparkle foil across artwork and background; high highlight density",
    false_positive_notes: "Holo bleed produces random shine not structured sparkle; Starlight has dense star-like points across ALL zones",
  },
  {
    rarity: "Ultimate Rare",
    foilFeatures: { nameFoil: "gold", artPattern: "foil", borderFoil: false, watermark: false, embossTexture: true },
    scanner_marker: "Embossed foil artwork with raised surfaces on art, attribute, and stars",
    false_positive_notes: null,
  },
  {
    rarity: "Ghost Rare",
    foilFeatures: { nameFoil: "silver", artPattern: "ghost", borderFoil: false, watermark: false, embossTexture: false },
    scanner_marker: "Ghost holographic artwork — faded, monochrome, mirror-like shine",
    false_positive_notes: "Ghost Rares are pale/washed out; standard image recognition fails. Look for monochrome holographic reflection + near-blank art",
  },
];

/**
 * Build the foil-rarity detection prompt section for AI vision models.
 */
export function buildYgoRarityPromptSection(): string {
  const matrixRows = YGO_RARITY_MATRIX.map((entry) => {
    const f = entry.foilFeatures;
    return `| ${entry.rarity} | ${f.nameFoil} | ${f.artPattern} | ${f.borderFoil ? "Yes" : "No"} | ${f.embossTexture ? "Yes" : "No"} | ${f.watermark ? "Yes" : "No"} | ${entry.scanner_marker} |`;
  }).join("\n");

  const falsePositiveRules = YGO_RARITY_MATRIX
    .filter((e) => e.false_positive_notes)
    .map((e) => `- ${e.rarity}: ${e.false_positive_notes}`)
    .join("\n");

  return `
YU-GI-OH! FOIL RARITY DETECTION PROTOCOL:

Analyze the card image for foil zones, reflective patterns, emboss textures, and border finishes to classify rarity.

DETECTION REGIONS:
- Card name text area: Detect foil color — Silver, Gold, Rainbow, or None
- Artwork foil pattern: Check for diagonal lines, star sparkle, lattice/grid, ghost holographic, or general foil
- Card border/frame: Check if border has foil finish (gold, silver, or none)
- Emboss texture: Detect raised/embossed surfaces on artwork, attribute, stars
- Watermark: Scan for 25th Anniversary stamp or other watermarks

FOIL RARITY MATRIX (match ALL foil features):

| Rarity | Name Foil | Art Pattern | Border Foil | Emboss | Watermark | Scanner Marker |
|--------|-----------|-------------|-------------|--------|-----------|----------------|
${matrixRows}

FALSE POSITIVE ELIMINATION RULES:
${falsePositiveRules}
- Holo Bleed vs Starlight/Secret: If shine is RANDOM with no structured pattern → it is a misprint (Holo Bleed), NOT a high rarity.
- Ghost Rare Null-Point: Ghost Rares are pale and washed out. Standard image recognition fails. Look for monochrome holographic reflection.
- Gold Series Variants: Flag any card where border reflectivity matches name plate gold foil → likely Gold Rare variant.

DETECTION PIPELINE:
1. Extract foil features from the image
2. Detect foil pattern types
3. Map features to rarity classification

RETURN the detected rarity using the exact name from the matrix above. Also return a "foilFeatures" object:
{
  "foilFeatures": {
    "nameFoil": "none|silver|gold|rainbow",
    "artPattern": "none|secretDiagonal|starlight|lattice|ghost|foil",
    "borderFoil": true/false,
    "watermark": true/false,
    "embossTexture": true/false
  }
}`;
}
