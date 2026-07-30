// src/lib/ocr/gameCodePatterns.ts
// Printed-code first. Image AI is not used in Rapid Scan lookup.

export type DetectedGame = "yugioh" | "pokemon" | "mtg" | "sports" | "unknown";

export type DetectedCode = {
  game: DetectedGame;
  setCode: string | null;
  cardNumber: string | null;
  fullCode: string | null;
  edition: string | null;
  rawMatch: string | null;
  confidence: number;
};

const YGO_MODERN_RE = /\b(?!ATK\b|DEF\b|HP\b|LP\b)([A-Z0-9]{2,8})[-\s]?((?:EN|JP|KR|DE|FR|IT|SP|PT|JE|AE)?\d{3,5}[A-Z]?)\b/i;
const YGO_LEGACY_RE = /\b(?!ATK\b|DEF\b|HP\b|LP\b)([A-Z]{2,4})[-\s]?(\d{3})\b/i;
const POKEMON_FRACTION_RE = /\b((?:SV)?\d{1,4})\s*\/\s*((?:SV)?\d{1,4})\b/i;
const POKEMON_PROMO_RE = /\b(SWSH|SM|XY|BW|HGSS|DP|PR|SVP)\s*-?\s*(\d{1,3}[A-Z]?)\b/i;
const SPORTS_RE = /\b(19[5-9]\d|20[0-3]\d)\b[\s\S]{0,80}?#\s*(\d{1,4})/i;
// MTG bottom-left block: "0123/281 R  DMU" (number, optional total, rarity letter, 3-5 char set code)
const MTG_COLLECTOR_RE = /\b(\d{1,4})(?:\s*\/\s*\d{1,4})?\s*([CURMTLSB])?\s*[\s·•]\s*([A-Z0-9]{3,5})\b/;
const MTG_COMPACT_RE = /\b(\d{1,4})\s*\/\s*\d{1,4}\s+([CURM])\s+([A-Z0-9]{3,5})\b/;


const NUMBER_FIX: Record<string, string> = { O: "0", o: "0", I: "1", l: "1", S: "5", B: "8" };

function fixNumberSection(num: string): string {
  return String(num || "").replace(/[OoIlSB]/g, (ch) => NUMBER_FIX[ch] ?? ch).toUpperCase();
}

function looksLikeYgo(text: string): boolean {
  return /konami|yu-?gi-?oh|atk\b|def\b|spell card|trap card|monster card|effect monster/i.test(text);
}
function looksLikePokemon(text: string): boolean {
  return /pokemon|pokémon|trainer|energy|hp\s*\d+|illus\.|©.*pokemon|©.*nintendo/i.test(text);
}
function looksLikeSports(text: string): boolean {
  return /topps|panini|upper deck|fleer|donruss|bowman|score|rookie\b|\brc\b/i.test(text);
}
function looksLikeMtg(text: string): boolean {
  return /wizards of the coast|deckmaster|magic:? the gathering|\bmana cost\b|\binstant\b|\bsorcery\b|\bplaneswalker\b|\benchantment\b|\bartifact\b|legendary creature/i.test(text);
}


export function detectEdition(text: string): string | null {
  if (/1st\s*edition|first\s*edition/i.test(text)) return "1st Edition";
  if (/unlimited/i.test(text)) return "Unlimited";
  if (/limited\s*edition/i.test(text)) return "Limited Edition";
  return null;
}

export function normalizeSetCodeToken(token: string): string | null {
  if (!token) return null;
  const cleaned = token
    .toUpperCase()
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/([A-Z0-9]{2,8})-(EN|JP|KR|DE|FR|IT|SP|PT|JE|AE)-(\d{3,5}[A-Z]?)$/, "$1-$2$3");
  const m = cleaned.match(/^(?!ATK-|DEF-|HP-|LP-)([A-Z0-9]{2,8})-((?:EN|JP|KR|DE|FR|IT|SP|PT|JE|AE)?\d{3,5}[A-Z]?)$/);
  if (!m) return null;
  return `${m[1]}-${fixNumberSection(m[2])}`;
}

export function extractPrintedCode(rawText: string): DetectedCode {
  const text = String(rawText || "").replace(/[–—]/g, "-");
  const upper = text.toUpperCase().replace(/\s+/g, " ").trim();
  const candidates: DetectedCode[] = [];

  const ygo = upper.match(YGO_MODERN_RE) ?? upper.match(YGO_LEGACY_RE);
  if (ygo) {
    const setCode = ygo[1].toUpperCase();
    const num = fixNumberSection(ygo[2]);
    const fullCode = normalizeSetCodeToken(`${setCode}-${num}`) ?? `${setCode}-${num}`;
    candidates.push({
      game: "yugioh",
      setCode,
      cardNumber: num,
      fullCode,
      edition: detectEdition(text),
      rawMatch: ygo[0],
      confidence: 0.75 + (looksLikeYgo(text) ? 0.2 : 0),
    });
  }

  const pkmFrac = upper.match(POKEMON_FRACTION_RE);
  if (pkmFrac) {
    const num = fixNumberSection(pkmFrac[1]);
    const total = fixNumberSection(pkmFrac[2]);
    candidates.push({ game: "pokemon", setCode: null, cardNumber: `${num}/${total}`, fullCode: `${num}/${total}`, edition: null, rawMatch: pkmFrac[0], confidence: 0.6 + (looksLikePokemon(text) ? 0.25 : 0) });
  } else {
    const promo = upper.match(POKEMON_PROMO_RE);
    if (promo) {
      const setCode = promo[1].toUpperCase();
      const num = fixNumberSection(promo[2]);
      candidates.push({ game: "pokemon", setCode, cardNumber: num, fullCode: `${setCode}${num}`, edition: null, rawMatch: promo[0], confidence: 0.6 + (looksLikePokemon(text) ? 0.25 : 0) });
    }
  }

  const sports = upper.match(SPORTS_RE);
  if (sports) {
    candidates.push({ game: "sports", setCode: null, cardNumber: `#${fixNumberSection(sports[2])}`, fullCode: `${sports[1]} #${fixNumberSection(sports[2])}`, edition: null, rawMatch: sports[0], confidence: 0.45 + (looksLikeSports(text) ? 0.25 : 0) });
  }

  if (!candidates.length) return { game: "unknown", setCode: null, cardNumber: null, fullCode: null, edition: detectEdition(text), rawMatch: null, confidence: 0 };
  candidates.sort((a, b) => b.confidence - a.confidence);
  return candidates[0];
}
