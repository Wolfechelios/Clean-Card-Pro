// src/lib/ocr/ocrQuality.ts
// Quality gate between OCR and lookup. Garbage OCR does not get priced.

const YGO_PRINTED_CODE_RE = /\b(?!ATK\b|DEF\b|HP\b|LP\b)(?:[A-Z0-9]{2,8}-(?:EN|JP|KR|DE|FR|IT|SP|PT|JE|AE)?\d{3,5}[A-Z]?|[A-Z]{2,4}-\d{3})\b/i;
const POKEMON_FRACTION_RE = /\b\d{1,4}\s*\/\s*\d{1,4}\b/;
const SPORTS_YEAR_NUMBER_RE = /\b(?:19[5-9]\d|20[0-3]\d)\s*#\s*\d{1,4}\b/i;
// Magic: 3-5 char set code plus collector number, e.g. "DMU-123" or bare "DMU".
const MTG_PRINTED_CODE_RE = /^[A-Z0-9]{3,5}(?:-\d{1,4})?$/i;

export function isValidMtgCode(s: string | null | undefined): boolean {
  if (!s) return false;
  return MTG_PRINTED_CODE_RE.test(String(s).trim());
}

export function isValidPrintedCode(s: string | null | undefined): boolean {
  if (!s) return false;
  const value = String(s).replace(/\s+/g, "").replace(/([A-Z0-9]{2,8})(EN|JP|KR|DE|FR|IT|SP|PT|JE|AE)(\d{3,5}[A-Z]?)/i, "$1-$2$3");
  return YGO_PRINTED_CODE_RE.test(value) || POKEMON_FRACTION_RE.test(value) || SPORTS_YEAR_NUMBER_RE.test(value);
}


export function isReadableTitle(s: string | null | undefined): boolean {
  if (!s) return false;
  const trimmed = String(s).trim();
  if (trimmed.length < 4) return false;
  const letters = (trimmed.match(/[A-Za-z]/g) ?? []).length;
  if (letters < 3) return false;
  const nonSpace = trimmed.replace(/\s/g, "");
  if (!nonSpace.length) return false;
  if (letters / nonSpace.length < 0.6) return false;
  return /[A-Za-z]{4,}/.test(trimmed);
}
