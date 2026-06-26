// src/lib/ocr/ocrQuality.ts
// Quality gate between raw OCR output and any identification / pricing call.
// Rule: if OCR output is garbage we DO NOT search, identify, name, or price.

const PRINTED_CODE_RE = /\b[A-Z0-9]{2,8}-[A-Z]{0,4}\d{1,5}\b/i;
const POKEMON_FRACTION_RE = /\b\d{1,4}\s*\/\s*\d{1,4}\b/;

function normalize(s: string): string {
  return (s || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** True if `s` contains a real-looking printed set/collector code. */
export function isValidPrintedCode(s: string | null | undefined): boolean {
  if (!s) return false;
  return PRINTED_CODE_RE.test(String(s)) || POKEMON_FRACTION_RE.test(String(s));
}

/**
 * True if the string looks like a readable card title:
 * - at least 3 letters
 * - at least 60% alphabetic characters (vs punctuation/symbols)
 * - contains at least one word with 4+ letters
 *
 * Rejects strings like ". L ¥. a", "o © 0", "| . B", "SPR os, ARR".
 */
export function isReadableTitle(s: string | null | undefined): boolean {
  if (!s) return false;
  const trimmed = String(s).trim();
  if (trimmed.length < 4) return false;

  const letters = (trimmed.match(/[A-Za-z]/g) ?? []).length;
  if (letters < 3) return false;

  const nonSpace = trimmed.replace(/\s/g, "");
  if (!nonSpace.length) return false;
  const alphaRatio = letters / nonSpace.length;
  if (alphaRatio < 0.6) return false;

  const hasRealWord = /[A-Za-z]{4,}/.test(trimmed);
  if (!hasRealWord) return false;

  return true;
}

/**
 * True if `title` actually appears (normalized) inside the raw OCR text.
 * Used to reject hallucinated names from fuzzy/Lens-only matches.
 */
export function validateTitleAgainstRaw(
  title: string | null | undefined,
  rawOcrText: string | null | undefined,
): boolean {
  const t = normalize(String(title ?? ""));
  const raw = normalize(String(rawOcrText ?? ""));
  if (!t || !raw) return false;
  if (t.length < 4) return false;
  if (raw.includes(t)) return true;
  // Allow partial: first long word of title must appear in raw text.
  const firstWord = String(title).match(/[A-Za-z]{4,}/);
  if (firstWord && raw.includes(firstWord[0].toLowerCase())) return true;
  return false;
}

/** Sources we trust without further title validation. */
export const AUTHORITATIVE_SOURCES = new Set([
  "cache",
  "ygoprodeck",
  "pokemontcg",
  "scryfall",
  "pricecharting-set-code",
]);
