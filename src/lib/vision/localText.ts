import type { CardBrand, LocalOcrLine } from "./cardVisionTypes";

export function inferBrandFromLines(lines: LocalOcrLine[]): CardBrand {
  const text = lines.map((line) => line.text.toLowerCase()).join(" ");
  if (text.includes("trainer") || text.includes("energy") || /hp\s?\d{2,3}/.test(text)) return "pokemon";
  if (text.includes("1st edition") || text.includes("atk/") || text.includes("def/")) return "yugioh";
  if (text.includes("planeswalker") || text.includes("sorcery") || text.includes("instant")) return "mtg";
  if (text.includes("rookie") || text.includes("topps") || text.includes("panini") || text.includes("bowman")) return "sports";
  if (text.includes("don!!") || text.includes("op-")) return "one-piece";
  if (text.includes("inkwell") || text.includes("glimmer")) return "lorcana";
  return "unknown";
}

export async function readLocalText(_image: ImageData): Promise<LocalOcrLine[]> {
  // Hook point for Apple Vision on iOS / Tesseract WASM / local CRNN later.
  // Keep this async so the scanner UI does not change when the engine is swapped.
  return [];
}
