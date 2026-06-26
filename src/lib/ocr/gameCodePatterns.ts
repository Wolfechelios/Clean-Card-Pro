// src/lib/ocr/gameCodePatterns.ts
// Shared printed-code regex + normalization across Yu-Gi-Oh, Pokémon, MTG, and sports.
// Identification is set/collector-code FIRST. Image AI is only ever a fallback.

export type DetectedGame = "yugioh" | "pokemon" | "mtg" | "sports" | "unknown";

export type DetectedCode = {
  game: DetectedGame;
  setCode: string | null;        // e.g. LOB, MP25, NEO, SV
  cardNumber: string | null;     // e.g. 001, EN318, 234, 4/102
  fullCode: string | null;       // canonical normalized "SET-NUMBER"
  edition: string | null;        // "1st Edition", "Unlimited", null
  rawMatch: string | null;       // exactly what matched in the OCR text
  confidence: number;            // 0..1 heuristic
};

// Allow only real Yu-Gi-Oh printed-code shapes. Do not accept stat text like ATK-2500.
const YGO_MODERN_RE = /\b(?!ATK\b|DEF\b|HP\b|LP\b)([A-Z0-9]{2,6})-((?:EN|JP|KR|DE|FR|IT|SP|PT|JE|AE)\d{3,5})\b/;
const YGO_LEGACY_RE = /\b(?!ATK\b|DEF\b|HP\b|LP\b)([A-Z]{2,4})-(\d{3})\b/;
const POKEMON_FRACTION_RE = /\b((?:SV)?\d{1,4})\s*\/\s*((?:SV)?\d{1,4})\b/i;
const POKEMON_PROMO_RE = /\b(SWSH|SM|XY|BW|HGSS|DP|PR|SVP)\s*-?\s*(\d{1,3}[A-Z]?)\b/i;
const MTG_COLLECTOR_RE = /\b([A-Z0-9]{3,5})\s+(\d{1,4})(?:\s*\/\s*\d{1,4})?\s*[•·]?\s*[A-Z]?\b/;
const SPORTS_RE = /\b(19[5-9]\d|20[0-3]\d)\b[\s\S]{0,80}?#\s*(\d{1,4})/i;

// Common OCR confusions — applied INSIDE the number section only.
const NUMBER_FIX: Record<string, string> = {
  O: "0", o: "0",
  I: "1", l: "1",
  S: "5",
  B: "8",
};

function fixNumberSection(num: string): string {
  return num.replace(/[OoIlSB]/g, (ch) => NUMBER_FIX[ch] ?? ch);
}

function looksLikeYgo(text: string): boolean {
  return /konami|yu-?gi-?oh|atk\b|def\b|spell card|trap card|monster card|effect monster/i.test(text);
}
function looksLikePokemon(text: string): boolean {
  return /pokemon|pokémon|trainer|energy|hp\s*\d+|illus\.|©.*pokemon|©.*nintendo/i.test(text);
}
function looksLikeMtg(text: string): boolean {
  return /wizards of the coast|magic: the gathering|planeswalker|instant|sorcery|enchantment/i.test(text);
}
function looksLikeSports(text: string): boolean {
  return /topps|panini|upper deck|fleer|donruss|bowman|score|rookie\b|\brc\b/i.test(text);
}

/**
 * Extract the strongest printed code in the OCR text and tag the game.
 * Strategy: try each game's regex; pick the highest-confidence match.
 */
export function extractPrintedCode(rawText: string): DetectedCode {
  const text = (rawText || "").replace(/\s+/g, " ").trim();
  const upper = text.toUpperCase();

  const candidates: DetectedCode[] = [];

  // ── Yu-Gi-Oh ───────────────────────────────────────────────────────
  const ygo = upper.match(YGO_MODERN_RE) ?? upper.match(YGO_LEGACY_RE);
  if (ygo) {
    const setCode = ygo[1];
    const num = fixNumberSection(ygo[2]);
    candidates.push({
      game: "yugioh",
      setCode,
      cardNumber: num,
      fullCode: `${setCode}-${num}`,
      edition: detectEdition(text),
      rawMatch: ygo[0],
      confidence: 0.7 + (looksLikeYgo(text) ? 0.2 : 0),
    });
  }

  // ── Pokémon (fraction or promo) ────────────────────────────────────
  const pkmFrac = upper.match(POKEMON_FRACTION_RE);
  if (pkmFrac) {
    const num = fixNumberSection(pkmFrac[1]);
    const total = fixNumberSection(pkmFrac[2]);
    candidates.push({
      game: "pokemon",
      setCode: null,
      cardNumber: `${num}/${total}`,
      fullCode: `${num}/${total}`,
      edition: null,
      rawMatch: pkmFrac[0],
      confidence: 0.6 + (looksLikePokemon(text) ? 0.25 : 0),
    });
  } else {
    const pkmPromo = upper.match(POKEMON_PROMO_RE);
    if (pkmPromo) {
      const setCode = pkmPromo[1].toUpperCase();
      const num = fixNumberSection(pkmPromo[2]);
      candidates.push({
        game: "pokemon",
        setCode,
        cardNumber: num,
        fullCode: `${setCode}${num}`,
        edition: null,
        rawMatch: pkmPromo[0],
        confidence: 0.6 + (looksLikePokemon(text) ? 0.25 : 0),
      });
    }
  }

  // ── MTG ────────────────────────────────────────────────────────────
  if (looksLikeMtg(text)) {
    const mtg = upper.match(MTG_COLLECTOR_RE);
    if (mtg) {
      const setCode = mtg[1];
      const num = fixNumberSection(mtg[2]);
      candidates.push({
        game: "mtg",
        setCode,
        cardNumber: num,
        fullCode: `${setCode}-${num}`,
        edition: null,
        rawMatch: mtg[0],
        confidence: 0.55,
      });
    }
  }

  // ── Sports (year + #) ──────────────────────────────────────────────
  const sports = upper.match(SPORTS_RE);
  if (sports) {
    candidates.push({
      game: "sports",
      setCode: null,
      cardNumber: `#${fixNumberSection(sports[2])}`,
      fullCode: `${sports[1]} #${fixNumberSection(sports[2])}`,
      edition: null,
      rawMatch: sports[0],
      confidence: 0.45 + (looksLikeSports(text) ? 0.25 : 0),
    });
  }

  if (!candidates.length) {
    return {
      game: "unknown",
      setCode: null,
      cardNumber: null,
      fullCode: null,
      edition: detectEdition(text),
      rawMatch: null,
      confidence: 0,
    };
  }
  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates[0];
}

export function detectEdition(text: string): string | null {
  if (/1st\s*edition|first\s*edition/i.test(text)) return "1st Edition";
  if (/unlimited/i.test(text)) return "Unlimited";
  if (/limited\s*edition/i.test(text)) return "Limited Edition";
  return null;
}

/**
 * Normalize a raw OCR token like "MP25 EN318" / "SDY 006" → "MP25-EN318" / "SDY-006".
 * Fixes OCR confusions inside the number section only.
 */
export function normalizeSetCodeToken(token: string): string | null {
  if (!token) return null;
  const cleaned = token.toUpperCase().replace(/[–—]/g, "-").replace(/\s+/g, "-").replace(/-+/g, "-");
  const m = cleaned.match(/^(?!ATK-|DEF-|HP-|LP-)([A-Z0-9]{2,6})-((?:EN|JP|KR|DE|FR|IT|SP|PT|JE|AE)\d{3,5}|\d{3})$/);
  if (!m) return null;
  return `${m[1]}-${fixNumberSection(m[2])}`;
}
