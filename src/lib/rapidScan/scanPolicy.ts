import { isValidPrintedCode } from "@/lib/ocr/ocrQuality";

export type LookupConfidence = {
  success?: boolean;
  cardData?: {
    confidence?: number | null;
  } | null;
} | null;

export function normalizeConfidence(value: number | null | undefined): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  const normalized = numeric > 1 ? numeric / 100 : numeric;
  return Math.min(1, Math.max(0, normalized));
}

export function fuseConfidence(
  ocrConfidence: number | null | undefined,
  lookup: LookupConfidence,
): number {
  const ocr = normalizeConfidence(ocrConfidence);
  if (!lookup?.success) return ocr;

  const matched = normalizeConfidence(lookup.cardData?.confidence);
  if (ocr > 0.85 && matched > 0.85) return 0.98;
  if (ocr > 0.95 || matched > 0.95) return 0.95;
  if (ocr > 0.7 && matched > 0.7) return (ocr + matched) / 2;
  return Math.min(ocr, matched);
}

export function selectPrintedIdentifier(
  ...parts: Array<string | null | undefined>
): string | null {
  for (const part of parts) {
    const value = String(part ?? "").trim();
    if (isValidPrintedCode(value)) return value;
  }
  return null;
}
