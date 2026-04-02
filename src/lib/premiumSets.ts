export const PREMIUM_YUGIOH_SETS = [
  { code: "LOB", name: "Legend of Blue-Eyes White Dragon" },
  { code: "PGD", name: "Pharaonic Guardian" },
  { code: "IOC", name: "Invasion of Chaos" },
  { code: "DCR", name: "Dark Crisis" },
  { code: "MRD", name: "Metal Raiders" },
  { code: "BCTP", name: "Battle City Tournament Pack" },
  { code: "FET", name: "Flaming Eternity" },
  { code: "DB1", name: "Dark Beginning 1" },
  { code: "DB2", name: "Dark Beginning 2" },
  { code: "STOR", name: "Storm of Ragnarok" },
  { code: "SOI", name: "Shadow of Infinity" },
] as const;

/**
 * Returns true if the card set matches any premium Yu-Gi-Oh! set
 * via case-insensitive substring matching on code or name.
 */
export function isPremiumYugiohSet(cardSet: string | null | undefined): boolean {
  if (!cardSet) return false;
  const lower = cardSet.toLowerCase();
  return PREMIUM_YUGIOH_SETS.some(
    (ps) =>
      lower.includes(ps.code.toLowerCase()) ||
      lower.includes(ps.name.toLowerCase())
  );
}
