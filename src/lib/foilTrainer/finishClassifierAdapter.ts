// Foil Trainer — Game-specific finish classifier adapters
// Modular architecture for per-game rarity/finish classification

import type { FinishType } from "./types";

export interface FinishClassification {
  finish: FinishType;
  confidence: number;
  alternativeFinishes: Array<{ finish: FinishType; confidence: number }>;
}

// ── Pokémon finish classifier ───────────────────────────────────────────

export function pokemonFinishClassifier(
  rarity: string | null,
  foilDetectorScore: number,
): FinishClassification {
  const r = (rarity || "").toLowerCase();

  if (r.includes("reverse holo") || r.includes("reverse")) {
    return {
      finish: "reverse_holo",
      confidence: Math.max(0.7, foilDetectorScore),
      alternativeFinishes: [{ finish: "holo", confidence: 0.2 }],
    };
  }
  if (r.includes("holo")) {
    return {
      finish: "holo",
      confidence: Math.max(0.75, foilDetectorScore),
      alternativeFinishes: [{ finish: "reverse_holo", confidence: 0.15 }],
    };
  }
  if (r.includes("rainbow") || r.includes("secret") || r.includes("hyper")) {
    return {
      finish: "rainbow",
      confidence: Math.max(0.8, foilDetectorScore),
      alternativeFinishes: [],
    };
  }
  if (r.includes("gold")) {
    return {
      finish: "gold",
      confidence: Math.max(0.8, foilDetectorScore),
      alternativeFinishes: [],
    };
  }
  if (r.includes("full art") || r.includes("alt art") || r.includes("illustration")) {
    return {
      finish: "foil",
      confidence: Math.max(0.7, foilDetectorScore),
      alternativeFinishes: [{ finish: "textured", confidence: 0.2 }],
    };
  }

  return {
    finish: foilDetectorScore > 0.5 ? "foil" : "normal",
    confidence: foilDetectorScore > 0.5 ? foilDetectorScore : 0.85,
    alternativeFinishes: [],
  };
}

// ── Yu-Gi-Oh finish classifier ──────────────────────────────────────────

export function yugiohRaritySurfaceClassifier(
  rarity: string | null,
  foilDetectorScore: number,
): FinishClassification {
  const r = (rarity || "").toLowerCase();

  if (r.includes("secret")) {
    return {
      finish: "secret",
      confidence: Math.max(0.75, foilDetectorScore),
      alternativeFinishes: [{ finish: "prismatic", confidence: 0.15 } as any],
    };
  }
  if (r.includes("ultra")) {
    return {
      finish: "foil",
      confidence: Math.max(0.8, foilDetectorScore),
      alternativeFinishes: [{ finish: "holo", confidence: 0.1 }],
    };
  }
  if (r.includes("super")) {
    return {
      finish: "holo",
      confidence: Math.max(0.75, foilDetectorScore),
      alternativeFinishes: [{ finish: "foil", confidence: 0.15 }],
    };
  }
  if (r.includes("starlight")) {
    return {
      finish: "shimmer",
      confidence: Math.max(0.7, foilDetectorScore),
      alternativeFinishes: [{ finish: "textured", confidence: 0.2 }],
    };
  }
  if (r.includes("ghost")) {
    return {
      finish: "metallic",
      confidence: Math.max(0.7, foilDetectorScore),
      alternativeFinishes: [],
    };
  }
  if (r.includes("ultimate")) {
    return {
      finish: "etched",
      confidence: Math.max(0.7, foilDetectorScore),
      alternativeFinishes: [{ finish: "textured", confidence: 0.2 }],
    };
  }
  if (r.includes("gold")) {
    return {
      finish: "gold",
      confidence: Math.max(0.8, foilDetectorScore),
      alternativeFinishes: [],
    };
  }

  return {
    finish: foilDetectorScore > 0.4 ? "foil" : "normal",
    confidence: foilDetectorScore > 0.4 ? foilDetectorScore : 0.85,
    alternativeFinishes: [],
  };
}

// ── Sports parallel classifier ──────────────────────────────────────────

export function sportsParallelClassifier(
  rarity: string | null,
  foilDetectorScore: number,
): FinishClassification {
  const r = (rarity || "").toLowerCase();

  if (r.includes("prizm") || r.includes("prism")) {
    return {
      finish: "prizm",
      confidence: Math.max(0.75, foilDetectorScore),
      alternativeFinishes: [{ finish: "refractor", confidence: 0.15 }],
    };
  }
  if (r.includes("refractor")) {
    return {
      finish: "refractor",
      confidence: Math.max(0.75, foilDetectorScore),
      alternativeFinishes: [{ finish: "prizm", confidence: 0.15 }],
    };
  }
  if (r.includes("cracked ice")) {
    return {
      finish: "cracked_ice",
      confidence: Math.max(0.8, foilDetectorScore),
      alternativeFinishes: [],
    };
  }
  if (r.includes("shimmer")) {
    return {
      finish: "shimmer",
      confidence: Math.max(0.75, foilDetectorScore),
      alternativeFinishes: [],
    };
  }
  if (r.includes("chrome") || r.includes("optic") || r.includes("mosaic")) {
    return {
      finish: "metallic",
      confidence: Math.max(0.7, foilDetectorScore),
      alternativeFinishes: [{ finish: "refractor", confidence: 0.2 }],
    };
  }

  return {
    finish: foilDetectorScore > 0.5 ? "foil" : "normal",
    confidence: foilDetectorScore > 0.5 ? foilDetectorScore : 0.85,
    alternativeFinishes: [],
  };
}

// ── MTG finish classifier ───────────────────────────────────────────────

export function mtgFinishClassifier(
  rarity: string | null,
  foilDetectorScore: number,
): FinishClassification {
  const r = (rarity || "").toLowerCase();

  if (r.includes("foil") || r.includes("etched")) {
    return {
      finish: r.includes("etched") ? "etched" : "foil",
      confidence: Math.max(0.8, foilDetectorScore),
      alternativeFinishes: r.includes("etched")
        ? [{ finish: "foil", confidence: 0.1 }]
        : [{ finish: "etched", confidence: 0.1 }],
    };
  }
  if (r.includes("showcase") || r.includes("borderless") || r.includes("extended")) {
    return {
      finish: "showcase",
      confidence: Math.max(0.75, foilDetectorScore),
      alternativeFinishes: [{ finish: "foil", confidence: 0.2 }],
    };
  }

  return {
    finish: foilDetectorScore > 0.5 ? "foil" : "normal",
    confidence: foilDetectorScore > 0.5 ? foilDetectorScore : 0.9,
    alternativeFinishes: [],
  };
}

// ── Adapter dispatcher ──────────────────────────────────────────────────

export function classifyFinishForGame(
  gameType: string | null,
  rarity: string | null,
  foilDetectorScore: number,
): FinishClassification {
  const g = (gameType || "").toLowerCase();

  if (g.includes("pokemon") || g.includes("pokémon")) {
    return pokemonFinishClassifier(rarity, foilDetectorScore);
  }
  if (g.includes("yugioh") || g.includes("yu-gi-oh")) {
    return yugiohRaritySurfaceClassifier(rarity, foilDetectorScore);
  }
  if (g.includes("mtg") || g.includes("magic")) {
    return mtgFinishClassifier(rarity, foilDetectorScore);
  }
  if (g.includes("sport") || g.includes("baseball") || g.includes("basketball") || g.includes("football") || g.includes("hockey")) {
    return sportsParallelClassifier(rarity, foilDetectorScore);
  }

  // Generic fallback
  return {
    finish: foilDetectorScore > 0.5 ? "foil" : "normal",
    confidence: foilDetectorScore > 0.5 ? foilDetectorScore : 0.85,
    alternativeFinishes: [],
  };
}
