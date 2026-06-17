import { findLearnedIdentity } from "@/lib/activeLearning";
import type { IdentifiedCardData } from "@/lib/hybridCardIdentify";
import { runLocalCardVision } from "@/lib/vision/scanPipeline";
import type { CardBrand, CardVisionResult } from "@/lib/vision/cardVisionTypes";

export type RapidVisionSource = "learned" | "local-ocr" | "local-insufficient";

export interface RapidLocalVisionResult {
  identity: IdentifiedCardData | null;
  accepted: boolean;
  source: RapidVisionSource;
  ocrText: string;
  qualityScore: number;
  detectionReady: boolean;
  brand: CardBrand;
  candidateConfidence: number;
  reason: string;
}

const BRAND_TO_GAME: Record<CardBrand, string | null> = {
  pokemon: "Pokemon",
  yugioh: "Yu-Gi-Oh!",
  mtg: "MTG",
  sports: "Sports",
  "one-piece": "One Piece",
  lorcana: "Lorcana",
  unknown: null,
};

function confidence01(value: number | null | undefined): number {
  const numeric = Number(value ?? 0);
  if (!Number.isFinite(numeric)) return 0;
  return Math.max(0, Math.min(1, numeric > 1 ? numeric / 100 : numeric));
}

function candidateConfidence(result: CardVisionResult): number {
  const candidate = result.candidates[0];
  if (!candidate) return 0;

  // The current local candidate formula tops out around 0.75. Rescale it
  // before blending it with frame/detection quality.
  const candidateScore = Math.max(0, Math.min(1, candidate.score / 0.75));
  const qualityScore = Math.max(0, Math.min(1, result.quality.score));
  return Math.max(0, Math.min(0.97, candidateScore * 0.82 + qualityScore * 0.18));
}

function gameTypeFor(result: CardVisionResult, gameTypeHint?: string): string | null {
  if (gameTypeHint && gameTypeHint !== "auto") {
    const map: Record<string, string> = {
      pokemon: "Pokemon",
      yugioh: "Yu-Gi-Oh!",
      mtg: "MTG",
      sports: "Sports",
      onepiece: "One Piece",
      lorcana: "Lorcana",
      gpk: "GPK",
      marvel: "Marvel",
    };
    return map[gameTypeHint.toLowerCase()] ?? gameTypeHint;
  }
  return BRAND_TO_GAME[result.brand];
}

function toIdentity(result: CardVisionResult, gameTypeHint?: string): IdentifiedCardData | null {
  const candidate = result.candidates[0];
  if (!candidate?.name?.trim()) return null;

  return {
    card_name: candidate.name.trim(),
    card_set: candidate.set?.trim() || null,
    card_number: candidate.number?.trim() || null,
    rarity: null,
    edition: null,
    game_type: gameTypeFor(result, gameTypeHint),
    sport_type: null,
    year: null,
    manufacturer: null,
    confidence: candidateConfidence(result),
    description: "Identified locally with card-region OCR",
  };
}

async function blobToImageData(blob: Blob): Promise<ImageData> {
  if (!blob || blob.size === 0) throw new Error("Rapid local vision received an empty image");

  if (typeof createImageBitmap === "function") {
    const bitmap = await createImageBitmap(blob);
    try {
      const canvas = document.createElement("canvas");
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new Error("Unable to create local-vision canvas context");
      context.drawImage(bitmap, 0, 0);
      return context.getImageData(0, 0, canvas.width, canvas.height);
    } finally {
      bitmap.close();
    }
  }

  const objectUrl = URL.createObjectURL(blob);
  try {
    const image = await new Promise<HTMLImageElement>((resolve, reject) => {
      const element = new Image();
      element.onload = () => resolve(element);
      element.onerror = () => reject(new Error("Unable to decode rapid-scan image"));
      element.src = objectUrl;
    });
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth || image.width;
    canvas.height = image.naturalHeight || image.height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new Error("Unable to create local-vision canvas context");
    context.drawImage(image, 0, 0);
    return context.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

function ocrTextFrom(result: CardVisionResult): string {
  return result.ocrLines
    .map((line) => line.text.trim())
    .filter(Boolean)
    .filter((line, index, all) => all.findIndex((value) => value.toLowerCase() === line.toLowerCase()) === index)
    .join("\n");
}

export async function resolveRapidLocalVision(
  blob: Blob,
  options: { gameTypeHint?: string } = {},
): Promise<RapidLocalVisionResult> {
  const imageData = await blobToImageData(blob);
  const vision = await runLocalCardVision(imageData);
  const ocrText = ocrTextFrom(vision);
  const learned = ocrText ? findLearnedIdentity(ocrText) : null;

  if (learned?.card_name && learned.card_name !== "Unknown Card") {
    return {
      identity: {
        ...learned,
        confidence: Math.max(0.96, confidence01(learned.confidence)),
      },
      accepted: true,
      source: "learned",
      ocrText,
      qualityScore: vision.quality.score,
      detectionReady: vision.quality.ready,
      brand: vision.brand,
      candidateConfidence: Math.max(0.96, confidence01(learned.confidence)),
      reason: "Matched a previously verified scan",
    };
  }

  const identity = toIdentity(vision, options.gameTypeHint);
  const confidence = confidence01(identity?.confidence);
  const hasIdentifier = Boolean(identity?.card_number || identity?.card_set);
  const accepted = Boolean(
    identity &&
    identity.card_name !== "Unknown Card" &&
    hasIdentifier &&
    confidence >= 0.82 &&
    vision.quality.score >= 0.55,
  );

  return {
    identity,
    accepted,
    source: accepted ? "local-ocr" : "local-insufficient",
    ocrText,
    qualityScore: vision.quality.score,
    detectionReady: vision.quality.ready,
    brand: vision.brand,
    candidateConfidence: confidence,
    reason: accepted
      ? "Local OCR resolved the card name and printing identifier"
      : !ocrText
        ? "Local OCR did not recover readable text"
        : !hasIdentifier
          ? "Local OCR needs a set or card number before auto-confirming"
          : `Local confidence ${Math.round(confidence * 100)}% requires cloud fallback`,
  };
}
