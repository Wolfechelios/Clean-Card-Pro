import { BUNDLED_YUGIOH_SETS } from "./bundledYugiohSets.generated";

export type BundledYugiohSet = { id: string; name: string };

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function listBundledYugiohSets(
  importedLocalSets: readonly BundledYugiohSet[] = [],
): BundledYugiohSet[] {
  const sets = new Map<string, string>(
    BUNDLED_YUGIOH_SETS.map((set) => [set.id, set.name]),
  );
  for (const set of importedLocalSets) {
    const id = set.id.trim();
    const name = set.name.trim().replace(/\s+/g, " ");
    if (id && name) sets.set(id, name);
  }
  return Array.from(sets, ([id, name]) => ({ id, name })).sort(
    (left, right) =>
      compareText(left.name.toLowerCase(), right.name.toLowerCase()) ||
      compareText(left.name, right.name) ||
      compareText(left.id, right.id),
  );
}
