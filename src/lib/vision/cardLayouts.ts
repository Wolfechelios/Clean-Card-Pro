import type { BrandLayoutProfile, CardBrand } from "./cardVisionTypes";

const topName = { x: 0.07, y: 0.04, width: 0.74, height: 0.1 };
const bottomNumber = { x: 0.56, y: 0.84, width: 0.36, height: 0.09 };
const bottomSet = { x: 0.06, y: 0.84, width: 0.42, height: 0.09 };

export const CARD_LAYOUTS: Record<CardBrand, BrandLayoutProfile> = {
  pokemon: { brand: "pokemon", label: "Pokemon-style card", nameRegion: topName, numberRegion: bottomNumber, setRegion: bottomSet, colorProfileId: "light-border" },
  yugioh: { brand: "yugioh", label: "Yu-Gi-Oh-style card", nameRegion: topName, numberRegion: bottomNumber, setRegion: { x: 0.58, y: 0.58, width: 0.34, height: 0.075 }, editionRegion: { x: 0.05, y: 0.83, width: 0.34, height: 0.075 }, colorProfileId: "gold-foil" },
  mtg: { brand: "mtg", label: "MTG-style card", nameRegion: topName, numberRegion: bottomNumber, setRegion: bottomSet, colorProfileId: "frame-neutral" },
  sports: { brand: "sports", label: "Sports card", nameRegion: { x: 0.08, y: 0.72, width: 0.78, height: 0.13 }, numberRegion: bottomNumber, setRegion: bottomSet, colorProfileId: "photo-card" },
  "one-piece": { brand: "one-piece", label: "Anime TCG card", nameRegion: { x: 0.08, y: 0.68, width: 0.76, height: 0.12 }, numberRegion: bottomNumber, setRegion: bottomSet, colorProfileId: "vivid-card" },
  lorcana: { brand: "lorcana", label: "Story TCG card", nameRegion: { x: 0.08, y: 0.58, width: 0.76, height: 0.1 }, numberRegion: bottomNumber, setRegion: bottomSet, colorProfileId: "ink-card" },
  unknown: { brand: "unknown", label: "Generic card", nameRegion: topName, numberRegion: bottomNumber, setRegion: bottomSet, colorProfileId: "generic" },
};

export function pickLayout(brand: CardBrand): BrandLayoutProfile {
  return CARD_LAYOUTS[brand] ?? CARD_LAYOUTS.unknown;
}
