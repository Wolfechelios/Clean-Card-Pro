export function normalizeOcrText(text: string): string {
  return text
    .replace(/[\u2010\u2011\u2012\u2013\u2014\u2212]/g, "-")
    .replace(/\r/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

export function extractYugiohSetCode(text: string): string | null {
  const normalized = normalizeOcrText(text)
    .toUpperCase()
    .replace(/\s*-\s*/g, "-")
    .replace(/\b([A-Z]{2,8})\s+(EN|JP|KR|FR|DE|IT|SP|PT)(\d{3})\b/g, "$1-$2$3")
    .replace(/\b([A-Z]{2,8})(EN|JP|KR|FR|DE|IT|SP|PT)\s*(\d{3})\b/g, "$1-$2$3");

  const patterns = [
    /\b[A-Z]{2,8}-(?:EN|JP|KR|FR|DE|IT|SP|PT)\d{3}\b/,
    /\b[A-Z]{2,8}-\d{3}\b/,
    /\b[A-Z]{2,8}\d{3}\b/,
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    if (!match) continue;

    const value = match[0];
    const compactMatch = value.match(/^([A-Z]{2,8})(\d{3})$/);
    return compactMatch ? `${compactMatch[1]}-${compactMatch[2]}` : value;
  }

  return null;
}

export function inferCardNameFromOcrText(text: string): string | null {
  const ignored = [
    /^(SPELL|TRAP|MONSTER|CARD)$/i,
    /^\[(.*)\]$/,
    /^(ATK|DEF)\b/i,
    /\b[A-Z]{2,8}-(?:EN|JP|KR|FR|DE|IT|SP|PT)?\d{3}\b/i,
    /^\d+\/?\d*$/,
    /^(1ST EDITION|LIMITED EDITION|UNLIMITED)$/i,
  ];

  const lines = normalizeOcrText(text)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ""))
    .filter((line) => line.length >= 3 && line.length <= 80);

  const likelyName = lines.find((line) => !ignored.some((pattern) => pattern.test(line)));
  return likelyName || null;
}

export function extractEditionFromOcrText(text: string): string | null {
  const normalized = normalizeOcrText(text).toUpperCase();
  if (/\b1ST\s+EDITION\b/.test(normalized)) return "1st Edition";
  if (/\bLIMITED\s+EDITION\b/.test(normalized)) return "Limited Edition";
  if (/\bUNLIMITED\b/.test(normalized)) return "Unlimited";
  return null;
}
