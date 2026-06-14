// Foil Trainer — gating logic + finish evaluation
// Determines whether to show the Foil Trainer UI after a scan

import type { FoilScanResult, FoilTrainerThresholds, FinishType } from "./types";
import { DEFAULT_FOIL_THRESHOLDS } from "./types";

// ── Foil-capable card detection ──────────────────────────────────────────

/** Known foil-capable rarity strings (case-insensitive partial match) */
const FOIL_RARITY_KEYWORDS = [
  "holo", "reverse", "foil", "etched", "rainbow", "secret", "textured",
  "metallic", "stamped", "prizm", "cracked ice", "shimmer", "refractor",
  "showcase", "gold rare", "starlight", "ghost", "ultimate", "collector",
  "ultra rare", "super rare", "parallel", "chrome", "optic", "mosaic",
  "select", "silver", "ice", "wave", "mojo", "hyper", "atomic",
];

const FOIL_FINISH_VALUES: FinishType[] = [
  "holo", "reverse_holo", "etched", "rainbow", "secret", "textured",
  "metallic", "stamped", "prizm", "cracked_ice", "shimmer", "refractor",
  "showcase", "foil", "gold", "silver",
];

/** Returns true if the card's rarity/finish implies it could be foil-variant */
export function cardSupportsFoilVariants(
  rarity: string | null,
  finish: string | null,
  gameType: string | null,
): boolean {
  const r = (rarity || "").toLowerCase();
  const f = (finish || "").toLowerCase();
  const g = (gameType || "").toLowerCase();

  // Any foil-keyword in rarity string
  if (FOIL_RARITY_KEYWORDS.some((kw) => r.includes(kw))) return true;

  // Finish is explicitly a foil type
  if (FOIL_FINISH_VALUES.includes(f as FinishType)) return true;

  // Yu-Gi-Oh — most rarities above Common are foil-sensitive
  if (g.includes("yugioh") || g.includes("yu-gi-oh")) {
    if (r && r !== "common") return true;
  }

  // Pokémon — holo and above
  if (g.includes("pokemon") || g.includes("pokémon")) {
    if (r && !["common", "uncommon"].includes(r)) return true;
  }

  // Sports — any parallel/refractor/prizm keyword
  if (g.includes("sport") || g.includes("baseball") || g.includes("basketball") || g.includes("football")) {
    if (FOIL_RARITY_KEYWORDS.some((kw) => r.includes(kw) || f.includes(kw))) return true;
  }

  return false;
}

/** Returns true if the card's value/version depends on surface finish */
export function rarityDependsOnSurfaceFinish(
  rarity: string | null,
  gameType: string | null,
): boolean {
  const r = (rarity || "").toLowerCase();
  const g = (gameType || "").toLowerCase();

  // Yu-Gi-Oh: Secret/Ultra/Super/Starlight/Ghost/Ultimate are finish-defined
  if (g.includes("yugioh") || g.includes("yu-gi-oh")) {
    return ["secret", "ultra", "super", "starlight", "ghost", "ultimate", "collector", "gold"].some(
      (kw) => r.includes(kw),
    );
  }

  // Pokémon: holo vs reverse holo = different prices
  if (g.includes("pokemon")) {
    return ["holo", "reverse", "full art", "rainbow", "secret", "alt art", "gold"].some(
      (kw) => r.includes(kw),
    );
  }

  // Sports: parallel detection is finish-based
  return ["prizm", "refractor", "cracked", "shimmer", "mosaic", "optic", "chrome", "parallel"].some(
    (kw) => r.includes(kw),
  );
}

// ── Main gating function ────────────────────────────────────────────────

export interface ScanResultForFoilGating {
  rarity: string | null;
  finish: string | null;
  gameType: string | null;
  foilConfidence: number; // 0–1, from foil detector or default
  confidence: number; // overall card identification confidence 0–100
}

export type FoilTrainerTriggerLevel = "none" | "subtle" | "prominent";

/**
 * Determine whether to show the Foil Trainer UI and at what prominence.
 */
export function shouldShowFoilTrainer(
  scanResult: ScanResultForFoilGating,
  thresholds: FoilTrainerThresholds = DEFAULT_FOIL_THRESHOLDS,
): FoilTrainerTriggerLevel {
  const isFoilCapable = cardSupportsFoilVariants(
    scanResult.rarity,
    scanResult.finish,
    scanResult.gameType,
  );

  const finishMatters = rarityDependsOnSurfaceFinish(
    scanResult.rarity,
    scanResult.gameType,
  );

  // Non-foil cards with no foil ambiguity → never show
  if (!isFoilCapable && !finishMatters) return "none";

  const fc = scanResult.foilConfidence;

  // High confidence → auto-accept, but user can still manually open
  if (fc >= thresholds.autoAccept) return "none";

  // Medium confidence → subtle option
  if (fc >= thresholds.subtlePrompt) return "subtle";

  // Low confidence → prominent prompt
  return "prominent";
}

// ── Evaluate foil scan result from existing detector output ──────────────

export function evaluateFoilScanResult(
  rarity: string | null,
  finish: string | null,
  gameType: string | null,
  foilDetectorConfidence?: number,
): FoilScanResult {
  const isFoilCapable = cardSupportsFoilVariants(rarity, finish, gameType);
  const finishMatters = rarityDependsOnSurfaceFinish(rarity, gameType);

  // Default foil confidence if no detector ran
  const foilConfidence = foilDetectorConfidence ?? (isFoilCapable ? 0.5 : 0.95);

  const normalizedFinish: FinishType =
    FOIL_FINISH_VALUES.includes((finish || "normal") as FinishType)
      ? ((finish || "normal") as FinishType)
      : isFoilCapable
        ? "unknown"
        : "normal";

  return {
    rarity,
    finish: normalizedFinish,
    foilConfidence,
    parallelConfidence: foilConfidence, // same signal for now
    cardSupportsFoilVariants: isFoilCapable,
    rarityDependsOnSurfaceFinish: finishMatters,
    reflectivePatternMatch: foilConfidence > 0.8 ? "strong" : foilConfidence > 0.5 ? "weak" : "none",
  };
}
