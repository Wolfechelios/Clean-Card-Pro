export type ScanIdentifier = {
  setCode?: string | null;
  cardNumber?: string | null;
  fullCode?: string | null;
};

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

function printedIdentifier(input: ScanIdentifier): string | null {
  const value = input.fullCode || input.setCode || input.cardNumber;
  if (!value) return null;
  const normalized = String(value).trim().toUpperCase().replace(/\s+/g, "");
  return normalized || null;
}

export function createSessionDuplicateTracker(initialSessionId = "session") {
  let sessionId = initialSessionId;
  const seen = new Set<string>();

  return {
    reserve(input: ScanIdentifier): { duplicate: boolean; token: string | null } {
      const identifier = printedIdentifier(input);
      if (!identifier) return { duplicate: false, token: null };

      const token = `${sessionId}:${identifier}`;
      if (seen.has(token)) return { duplicate: true, token: null };

      seen.add(token);
      return { duplicate: false, token };
    },

    release(token: string | null | undefined): void {
      if (token) seen.delete(token);
    },

    reset(nextSessionId = `${Date.now()}-${Math.random().toString(16).slice(2)}`): void {
      sessionId = nextSessionId;
      seen.clear();
    },
  };
}
