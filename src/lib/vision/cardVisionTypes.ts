export type CardBrand =
  | "pokemon"
  | "yugioh"
  | "mtg"
  | "sports"
  | "one-piece"
  | "lorcana"
  | "unknown";

export type ScanMode = "single-card" | "binder-page";

export interface CameraCaptureProfile {
  label: string;
  mode: ScanMode;
  facingMode: "environment";
  idealWidth: number;
  idealHeight: number;
  aspectRatio: number;
  zoomHint: number;
  advanced: Array<MediaTrackConstraintSet & Record<string, unknown>>;
}

export interface CardRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface BrandLayoutProfile {
  brand: CardBrand;
  label: string;
  nameRegion: CardRegion;
  numberRegion: CardRegion;
  setRegion: CardRegion;
  editionRegion?: CardRegion;
  colorProfileId: string;
}

export interface FrameQualityScore {
  blur: number;
  glare: number;
  brightness: number;
  contrast: number;
  score: number;
  ready: boolean;
  reason: string;
}

export interface LocalOcrLine {
  text: string;
  confidence: number;
  region?: CardRegion;
}

export interface LocalVisionMatchCandidate {
  id: string;
  name: string;
  set?: string | null;
  number?: string | null;
  brand: CardBrand;
  score: number;
  signals: {
    name: number;
    setNumber: number;
    visual: number;
    layout: number;
  };
}

export interface CardVisionResult {
  brand: CardBrand;
  layout: BrandLayoutProfile;
  quality: FrameQualityScore;
  ocrLines: LocalOcrLine[];
  candidates: LocalVisionMatchCandidate[];
  correctedImage?: ImageData;
}
