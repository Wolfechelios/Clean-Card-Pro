// Confidence normalization helpers.
// Some scanner paths return 0..1 while vision/edge functions often return 0..100.
// These helpers keep review/save gates from rejecting good scans like 80%.

export function normalizeConfidence01(value: unknown, fallback = 0): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  if (n <= 0) return 0;
  if (n <= 1) return Math.min(1, n);
  return Math.min(1, n / 100);
}

export function confidencePct(value: unknown, fallback = 0): number {
  return Math.round(normalizeConfidence01(value, fallback) * 100);
}
