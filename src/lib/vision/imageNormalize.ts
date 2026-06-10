import type { CardBrand } from "./cardVisionTypes";

const PROFILES: Record<CardBrand, { contrast: number; sat: number; warm: number; white: number }> = {
  pokemon: { contrast: 1.08, sat: 0.98, warm: -2, white: 245 },
  yugioh: { contrast: 1.14, sat: 0.92, warm: -4, white: 232 },
  mtg: { contrast: 1.1, sat: 0.96, warm: -1, white: 240 },
  sports: { contrast: 1.06, sat: 1.02, warm: 1, white: 246 },
  "one-piece": { contrast: 1.08, sat: 1, warm: 0, white: 242 },
  lorcana: { contrast: 1.07, sat: 0.98, warm: 0, white: 242 },
  unknown: { contrast: 1.05, sat: 0.98, warm: 0, white: 244 },
};

const clamp = (value: number) => Math.max(0, Math.min(255, value));

export function normalizeCardImage(imageData: ImageData, brand: CardBrand): ImageData {
  const profile = PROFILES[brand] ?? PROFILES.unknown;
  const out = new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);
  const data = out.data;

  for (let i = 0; i < data.length; i += 4) {
    let r = Math.min(data[i], profile.white);
    let g = Math.min(data[i + 1], profile.white);
    let b = Math.min(data[i + 2], profile.white);
    const avg = (r + g + b) / 3;
    r = avg + (r - avg) * profile.sat;
    g = avg + (g - avg) * profile.sat;
    b = avg + (b - avg) * profile.sat;
    data[i] = clamp((r - 128) * profile.contrast + 128 + profile.warm);
    data[i + 1] = clamp((g - 128) * profile.contrast + 128);
    data[i + 2] = clamp((b - 128) * profile.contrast + 128 - profile.warm);
  }

  return out;
}
