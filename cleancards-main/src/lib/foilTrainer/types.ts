// Foil Trainer — shared types

export type FinishType =
  | "normal"
  | "holo"
  | "reverse_holo"
  | "etched"
  | "rainbow"
  | "secret"
  | "textured"
  | "metallic"
  | "stamped"
  | "prizm"
  | "cracked_ice"
  | "shimmer"
  | "refractor"
  | "showcase"
  | "foil"
  | "gold"
  | "silver"
  | "unknown";

export type FoilIssueTag =
  | "glare"
  | "reflection"
  | "too_dark"
  | "blurry"
  | "bad_crop"
  | "foil_pattern_missed"
  | "wrong_set"
  | "wrong_angle";

export const FOIL_ISSUE_TAGS: { value: FoilIssueTag; label: string }[] = [
  { value: "glare", label: "Glare" },
  { value: "reflection", label: "Reflection" },
  { value: "too_dark", label: "Too Dark" },
  { value: "blurry", label: "Blurry" },
  { value: "bad_crop", label: "Bad Crop" },
  { value: "foil_pattern_missed", label: "Foil Pattern Missed" },
  { value: "wrong_set", label: "Wrong Set" },
  { value: "wrong_angle", label: "Wrong Angle" },
];

export interface FoilScanResult {
  rarity: string | null;
  finish: FinishType;
  foilConfidence: number; // 0–1
  parallelConfidence: number; // 0–1
  cardSupportsFoilVariants: boolean;
  rarityDependsOnSurfaceFinish: boolean;
  reflectivePatternMatch: "strong" | "weak" | "conflicting" | "none";
  debug?: Record<string, unknown>;
}

export interface FoilCorrectionPayload {
  scanId: string;
  cardId?: string;
  imageHash?: string;
  perceptualHash?: string;
  game: string | null;
  setId?: string;
  setName?: string;
  cardNumber?: string;
  predictedCardName?: string;
  predictedRarity?: string;
  correctedRarity?: string;
  predictedFinish?: FinishType;
  correctedFinish?: FinishType;
  foilConfidence?: number;
  parallelConfidence?: number;
  wasCorrect: boolean;
  issueTags: FoilIssueTag[];
  originalImageUri?: string;
  processedImageUri?: string;
  reconditionedImageUri?: string;
  roiMetadata?: Record<string, unknown>;
  lightingMetadata?: Record<string, unknown>;
  reflectionMetadata?: Record<string, unknown>;
  ocrSnapshot?: Record<string, unknown>;
}

export interface FoilLearningEntry {
  id: string;
  keyType: string;
  keyValue: string;
  game: string | null;
  correctedFinish: string | null;
  correctedRarity: string | null;
  supportCount: number;
  rejectCount: number;
  confidenceWeight: number;
  lastSeenAt: string;
}

/** Thresholds for the foil trainer gating */
export interface FoilTrainerThresholds {
  autoAccept: number;   // >= this → no prompt (default 0.90)
  subtlePrompt: number; // >= this → subtle correction option (default 0.70)
  // below subtlePrompt → prominent "Unsure" prompt
}

export const DEFAULT_FOIL_THRESHOLDS: FoilTrainerThresholds = {
  autoAccept: 0.90,
  subtlePrompt: 0.70,
};
