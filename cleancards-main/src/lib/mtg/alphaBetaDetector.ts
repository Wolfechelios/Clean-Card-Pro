export interface MtgCardLike {
  card_name?: string | null;
  card_set?: string | null;
  card_number?: string | null;
  rarity?: string | null;
  edition?: string | null;
  game_type?: string | null;
  year?: string | null;
  manufacturer?: string | null;
  description?: string | null;
}

export interface MtgSignal {
  label: string;
  value: string;
  confidence: number;
}

export interface AlphaBetaAssessment {
  status: "confirmed_alpha" | "confirmed_beta" | "candidate_alpha_beta" | "unlikely";
  confidence: number;
  reasons: string[];
  checks: string[];
}

export interface MtgIdentificationInsights {
  isMtg: boolean;
  confidence: number;
  likelyEra: string;
  vintageFrame: boolean;
  collectorNumberStyle: "modern" | "legacy" | "absent" | "unknown";
  languageHint: string | null;
  borderHint: "black-border-candidate" | "white-border-candidate" | "unknown";
  holoStampLikely: boolean;
  alphaBeta: AlphaBetaAssessment;
  signals: MtgSignal[];
  summary: string;
}

const BASIC_LANDS = new Set(["plains", "island", "swamp", "mountain", "forest"]);

function lower(v?: string | null): string {
  return String(v || "").toLowerCase().trim();
}

function normalizedText(card: MtgCardLike, ocrText?: string | null): string {
  return [
    card.card_name,
    card.card_set,
    card.card_number,
    card.rarity,
    card.edition,
    card.game_type,
    card.year,
    card.manufacturer,
    card.description,
    ocrText,
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

function detectMtg(card: MtgCardLike, ocrText?: string | null): boolean {
  const text = normalizedText(card, ocrText);
  return [
    "mtg",
    "magic: the gathering",
    "magic the gathering",
    "wizards of the coast",
    "deckmaster",
    "tap:",
    "instant",
    "sorcery",
    "creature",
    "planeswalker",
    "enchantment",
    "artifact",
    "basic land",
  ].some((token) => text.includes(token));
}

function detectCollectorNumberStyle(card: MtgCardLike, ocrText?: string | null): MtgIdentificationInsights["collectorNumberStyle"] {
  const text = normalizedText(card, ocrText);
  const explicitNumber = lower(card.card_number);

  if (/\b\d{1,3}\s*\/\s*\d{1,3}\b/.test(text) || /\b[a-z]?\d{1,4}[a-z]?\b/.test(explicitNumber)) {
    return "modern";
  }

  if (/illus\.?\s+[a-z]/.test(text) || /artist/.test(text)) {
    return "legacy";
  }

  if (!explicitNumber && !/\b\d{1,3}\s*\/\s*\d{1,3}\b/.test(text)) {
    return "absent";
  }

  return "unknown";
}

function detectLikelyEra(card: MtgCardLike, ocrText?: string | null): string {
  const text = normalizedText(card, ocrText);
  const set = lower(card.card_set);
  const edition = lower(card.edition);
  const year = lower(card.year);

  if (set.includes("alpha") || edition.includes("alpha")) return "1993 limited edition alpha";
  if (set.includes("beta") || edition.includes("beta")) return "1993 limited edition beta";
  if (set.includes("unlimited") || edition.includes("unlimited")) return "1993 unlimited";
  if (set.includes("revised") || set.includes("4th") || set.includes("fourth")) return "white-border core era";
  if (set.includes("collector") || text.includes("collector number")) return "modern collector-number era";
  if (year.includes("1993") || year.includes("1994")) return "early mtg vintage era";
  if (text.includes("1999") || text.includes("2000") || text.includes("2001")) return "pre-modern frame era";
  if (text.includes("2015") || text.includes("holo") || text.includes("foil stamp")) return "post-holo-stamp era";
  return "unknown era";
}

function detectBorderHint(card: MtgCardLike, ocrText?: string | null): MtgIdentificationInsights["borderHint"] {
  const text = normalizedText(card, ocrText);
  const set = lower(card.card_set);
  const edition = lower(card.edition);

  if (
    set.includes("alpha") ||
    set.includes("beta") ||
    edition.includes("alpha") ||
    edition.includes("beta") ||
    set.includes("arabian nights") ||
    set.includes("antiquities") ||
    set.includes("legends") ||
    set.includes("the dark")
  ) {
    return "black-border-candidate";
  }

  if (
    set.includes("unlimited") ||
    set.includes("revised") ||
    set.includes("fourth") ||
    set.includes("4th") ||
    set.includes("chronicles")
  ) {
    return "white-border-candidate";
  }

  if (text.includes("black border") || text.includes("dark border")) return "black-border-candidate";
  if (text.includes("white border")) return "white-border-candidate";

  return "unknown";
}

function detectLanguageHint(ocrText?: string | null): string | null {
  const text = lower(ocrText);
  if (!text) return null;
  if (/[àâçéèêëîïôûùüÿœ]/.test(text)) return "French-like OCR";
  if (/[äöüß]/.test(text)) return "German-like OCR";
  if (/[ñ¡¿]/.test(text)) return "Spanish-like OCR";
  if (/[\u3040-\u30ff\u4e00-\u9faf]/.test(text)) return "Japanese-like OCR";
  return "English-like OCR";
}

function detectHoloStampLikely(card: MtgCardLike, ocrText?: string | null): boolean {
  const text = normalizedText(card, ocrText);
  const rarity = lower(card.rarity);
  const yearNum = Number.parseInt(String(card.year || ""), 10);
  const nonBasic = !BASIC_LANDS.has(lower(card.card_name));
  return (
    nonBasic &&
    (rarity.includes("mythic") || rarity.includes("rare")) &&
    (text.includes("holo") || text.includes("foil stamp") || (!Number.isNaN(yearNum) && yearNum >= 2015))
  );
}

export function analyzeMtgIdentification(card: MtgCardLike, ocrText?: string | null): MtgIdentificationInsights {
  const isMtg = detectMtg(card, ocrText);
  const signals: MtgSignal[] = [];

  if (!isMtg) {
    return {
      isMtg: false,
      confidence: 0,
      likelyEra: "not mtg",
      vintageFrame: false,
      collectorNumberStyle: "unknown",
      languageHint: null,
      borderHint: "unknown",
      holoStampLikely: false,
      alphaBeta: {
        status: "unlikely",
        confidence: 0,
        reasons: ["Current scan does not look like MTG data."],
        checks: [],
      },
      signals,
      summary: "MTG-specific print analysis not applied.",
    };
  }

  const text = normalizedText(card, ocrText);
  const set = lower(card.card_set);
  const edition = lower(card.edition);
  const likelyEra = detectLikelyEra(card, ocrText);
  const collectorNumberStyle = detectCollectorNumberStyle(card, ocrText);
  const borderHint = detectBorderHint(card, ocrText);
  const languageHint = detectLanguageHint(ocrText);
  const holoStampLikely = detectHoloStampLikely(card, ocrText);
  const vintageFrame =
    likelyEra.includes("1993") ||
    likelyEra.includes("1994") ||
    likelyEra.includes("pre-modern") ||
    collectorNumberStyle === "absent" ||
    collectorNumberStyle === "legacy";

  signals.push({ label: "Likely era", value: likelyEra, confidence: 75 });
  signals.push({ label: "Collector number style", value: collectorNumberStyle, confidence: 70 });
  signals.push({ label: "Border hint", value: borderHint, confidence: 60 });
  if (languageHint) signals.push({ label: "Language hint", value: languageHint, confidence: 60 });
  if (holoStampLikely) signals.push({ label: "Authenticity cue", value: "Likely holo-stamp era", confidence: 65 });

  const reasons: string[] = [];
  const checks: string[] = [];
  let status: AlphaBetaAssessment["status"] = "unlikely";
  let confidence = 15;

  if (set.includes("alpha") || edition.includes("alpha")) {
    status = "confirmed_alpha";
    confidence = 98;
    reasons.push("Set or edition already identifies the card as Alpha.");
  } else if (set.includes("beta") || edition.includes("beta")) {
    status = "confirmed_beta";
    confidence = 98;
    reasons.push("Set or edition already identifies the card as Beta.");
  } else {
    const coreVintageCandidate =
      vintageFrame &&
      collectorNumberStyle !== "modern" &&
      borderHint !== "white-border-candidate" &&
      !holoStampLikely &&
      (text.includes("deckmaster") || text.includes("wizards of the coast") || likelyEra.includes("1993") || likelyEra.includes("1994") || !card.card_set);

    if (coreVintageCandidate) {
      status = "candidate_alpha_beta";
      confidence = 72;
      reasons.push("Vintage MTG cues detected with no modern collector-number signal.");
      reasons.push("Frame/border signals are compatible with an early black-border core print.");
      checks.push("Check corner radius: Alpha corners are visibly rounder than Beta.");
      checks.push("Confirm there is no white border and no expansion symbol mismatch.");
      checks.push("Compare the artist/copyright line against known Alpha/Beta scans.");
    } else {
      status = "unlikely";
      confidence = 22;
      reasons.push("Available cues do not strongly match Alpha/Beta-only characteristics.");
      if (borderHint === "white-border-candidate") {
        reasons.push("White-border cue points more toward Unlimited/Revised/Fourth-era prints.");
      }
      if (collectorNumberStyle === "modern") {
        reasons.push("Modern collector-number formatting points away from Alpha/Beta.");
      }
    }
  }

  const summary =
    status === "confirmed_alpha"
      ? "Confirmed Alpha from identified set/edition."
      : status === "confirmed_beta"
      ? "Confirmed Beta from identified set/edition."
      : status === "candidate_alpha_beta"
      ? "Vintage black-border core-set candidate. Use a corner crop to separate Alpha from Beta cleanly."
      : "Alpha/Beta is not strongly supported by the current cues.";

  return {
    isMtg,
    confidence: Math.max(60, confidence),
    likelyEra,
    vintageFrame,
    collectorNumberStyle,
    languageHint,
    borderHint,
    holoStampLikely,
    alphaBeta: {
      status,
      confidence,
      reasons,
      checks,
    },
    signals,
    summary,
  };
}

export function buildMtgNotes(insights: MtgIdentificationInsights): string | null {
  if (!insights.isMtg) return null;

  const parts = [
    `MTG forensic summary: ${insights.summary}`,
    `Likely era: ${insights.likelyEra}`,
    `Collector-number style: ${insights.collectorNumberStyle}`,
    `Border hint: ${insights.borderHint}`,
  ];

  if (insights.languageHint) parts.push(`Language hint: ${insights.languageHint}`);
  if (insights.alphaBeta.reasons.length) parts.push(`Why: ${insights.alphaBeta.reasons.join(" ")}`);

  return parts.join(" | ");
}
