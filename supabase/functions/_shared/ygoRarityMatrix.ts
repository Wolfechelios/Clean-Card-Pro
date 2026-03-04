// supabase/functions/_shared/ygoRarityMatrix.ts
// Yu-Gi-Oh! 5-Zone Rarity Detection Matrix
// Each rarity is defined by its signature across 5 physical card zones.

export type ZoneProfile = {
  nameplate_foil: "none" | "silver" | "gold" | "rainbow";
  art_pattern: "none" | "rainbow" | "diagonal_lines" | "horizontal_vertical_grid" | "embossed_3d" | "speckled_varnish";
  border_state: "standard" | "holographic_lattice" | "textured" | "gold";
  icon_foil: boolean;
  watermark: string | null;
};

export type RarityEntry = {
  rarity: string;
  zones: ZoneProfile;
  scanner_marker: string;
  false_positive_notes: string | null;
};

export const YGO_RARITY_MATRIX: RarityEntry[] = [
  {
    rarity: "Common",
    zones: {
      nameplate_foil: "none",
      art_pattern: "none",
      border_state: "standard",
      icon_foil: false,
      watermark: null,
    },
    scanner_marker: "No foil detected in any zone; high-speed OCR set code only",
    false_positive_notes: null,
  },
  {
    rarity: "Rare",
    zones: {
      nameplate_foil: "silver",
      art_pattern: "none",
      border_state: "standard",
      icon_foil: false,
      watermark: null,
    },
    scanner_marker: "Reflective silver name plate only; art and border are flat",
    false_positive_notes: null,
  },
  {
    rarity: "Super Rare",
    zones: {
      nameplate_foil: "none",
      art_pattern: "rainbow",
      border_state: "standard",
      icon_foil: false,
      watermark: null,
    },
    scanner_marker: "Art zone reflectivity >50%; name plate is NOT foiled",
    false_positive_notes: "Holo bleed misprints can mimic this; check for structured rainbow vs random bleed",
  },
  {
    rarity: "Ultra Rare",
    zones: {
      nameplate_foil: "gold",
      art_pattern: "rainbow",
      border_state: "standard",
      icon_foil: false,
      watermark: null,
    },
    scanner_marker: "Dual detection: gold name + rainbow art foil",
    false_positive_notes: null,
  },
  {
    rarity: "Secret Rare",
    zones: {
      nameplate_foil: "rainbow",
      art_pattern: "diagonal_lines",
      border_state: "standard",
      icon_foil: false,
      watermark: null,
    },
    scanner_marker: "Parallel foil lines at 45° angle across entire card surface",
    false_positive_notes: "Holo bleed can mimic; verify diagonal line pattern is structured, not random",
  },
  {
    rarity: "Starlight Rare",
    zones: {
      nameplate_foil: "rainbow",
      art_pattern: "horizontal_vertical_grid",
      border_state: "holographic_lattice",
      icon_foil: true,
      watermark: null,
    },
    scanner_marker: "Full-card grid/lattice pattern; holographic border; foiled icons",
    false_positive_notes: "Holo bleed produces random shine not grid; Starlight has structured lattice across ALL zones",
  },
  {
    rarity: "Ultimate Rare",
    zones: {
      nameplate_foil: "gold",
      art_pattern: "embossed_3d",
      border_state: "standard",
      icon_foil: true,
      watermark: null,
    },
    scanner_marker: "Low-angle light detects raised/embossed surfaces on art, attribute, and stars",
    false_positive_notes: null,
  },
  {
    rarity: "Ghost Rare",
    zones: {
      nameplate_foil: "silver",
      art_pattern: "rainbow",
      border_state: "standard",
      icon_foil: false,
      watermark: null,
    },
    scanner_marker: "Silvery-white washed-out name + high-contrast 'blank' pale art zone",
    false_positive_notes: "Ghost Rares are pale/washed out; standard image recognition fails. Look for silvery-white name combined with near-blank art",
  },
  {
    rarity: "Collector's Rare",
    zones: {
      nameplate_foil: "rainbow",
      art_pattern: "speckled_varnish",
      border_state: "textured",
      icon_foil: false,
      watermark: null,
    },
    scanner_marker: "Fingerprint/speckled texture pattern visible on borders and card surface",
    false_positive_notes: null,
  },
  {
    rarity: "Gold Rare",
    zones: {
      nameplate_foil: "gold",
      art_pattern: "rainbow",
      border_state: "gold",
      icon_foil: true,
      watermark: null,
    },
    scanner_marker: "Gold-colored borders; border reflectivity matches name plate gold foil",
    false_positive_notes: "Gold Series variants have gold borders; flag any card where border reflectivity matches name plate gold",
  },
  {
    rarity: "Quarter Century Secret Rare",
    zones: {
      nameplate_foil: "rainbow",
      art_pattern: "diagonal_lines",
      border_state: "standard",
      icon_foil: false,
      watermark: "25th Anniversary",
    },
    scanner_marker: "Secret Rare pattern + 25th Anniversary stamp watermark in text box",
    false_positive_notes: null,
  },
];

/**
 * Build the rarity detection prompt section for AI vision models.
 * This injects the full 5-zone matrix and false-positive rules into
 * any card identification prompt.
 */
export function buildYgoRarityPromptSection(): string {
  const matrixRows = YGO_RARITY_MATRIX.map((entry) => {
    const z = entry.zones;
    return `| ${entry.rarity} | ${z.nameplate_foil} | ${z.art_pattern} | ${z.border_state} | ${z.icon_foil ? "Yes" : "No"} | ${z.watermark || "None"} | ${entry.scanner_marker} |`;
  }).join("\n");

  const falsePositiveRules = YGO_RARITY_MATRIX
    .filter((e) => e.false_positive_notes)
    .map((e) => `- ${e.rarity}: ${e.false_positive_notes}`)
    .join("\n");

  return `
YU-GI-OH! 5-ZONE RARITY DETECTION PROTOCOL:

Analyze these 5 physical zones on the card to determine rarity:
- Zone A (Name Plate): Detect foil color — Silver, Gold, Rainbow, or None. Check texture.
- Zone B (Artwork Frame): Check for holographic patterns — rainbow goop, diagonal lines, grid/lattice, embossed 3D depth, or speckled varnish.
- Zone C (Attribute/Level Icons): Check if FIRE symbol or Level Stars are foiled or embossed.
- Zone D (Borders): Analyze if grey/black border is flat standard, holographic lattice, textured, or gold-colored.
- Zone E (Text Box): Scan for watermarks such as 25th Anniversary stamp.

RARITY MATRIX (use hierarchical elimination — match ALL zone signatures):

| Rarity | Name Foil | Art Pattern | Border State | Icons Foiled | Watermark | Scanner Marker |
|--------|-----------|-------------|--------------|--------------|-----------|----------------|
${matrixRows}

FALSE POSITIVE ELIMINATION RULES:
${falsePositiveRules}
- Holo Bleed vs Starlight/Secret: If shine is RANDOM with no structured pattern → it is a misprint (Holo Bleed), NOT a high rarity.
- Ghost Rare Null-Point: Ghost Rares are pale and washed out. Standard image recognition fails. Look for silvery-white name + high-contrast blank art zone.
- Gold Series Variants: Flag any card where border reflectivity matches name plate gold foil → likely Gold Rare variant.

RETURN the detected rarity using the exact name from the matrix above. Also return a "rarity_zones" object:
{
  "rarity_zones": {
    "nameplate_foil": "none|silver|gold|rainbow",
    "art_pattern": "none|rainbow|diagonal_lines|horizontal_vertical_grid|embossed_3d|speckled_varnish",
    "border_state": "standard|holographic_lattice|textured|gold",
    "icons_foiled": true/false,
    "watermark": "string or null",
    "false_positive_check": "description of any holo bleed / misprint ruling"
  }
}`;
}
