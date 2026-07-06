// Foil Trainer — Correction Store (local-first stub)
// The scanner is offline-first; foil correction telemetry no longer syncs
// to a cloud database. These functions now no-op locally and return empty
// data so existing callers keep working without touching the network.

import type { FoilCorrectionPayload, FoilLearningEntry } from "./types";

export async function saveFoilCorrection(
  _userId: string,
  _correction: FoilCorrectionPayload,
): Promise<{ success: boolean; error?: string }> {
  return { success: true };
}

export async function updateFoilLearningMemory(
  _userId: string,
  _keyType: string,
  _keyValue: string,
  _game: string | null,
  _correctedFinish: string | null,
  _correctedRarity: string | null,
  _wasCorrect: boolean,
): Promise<void> {
  /* no-op — local-first */
}

export async function queryFoilLearningEvidence(
  _userId: string,
  _keyType: string,
  _keyValue: string,
): Promise<FoilLearningEntry[]> {
  return [];
}

export async function getFoilCorrectionsForCard(
  _userId: string,
  _cardName: string,
  _limit = 20,
): Promise<any[]> {
  return [];
}

export async function getPendingFoilReviews(
  _userId: string,
): Promise<any[]> {
  return [];
}
