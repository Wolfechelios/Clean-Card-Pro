// src/lib/orinScanner.ts
// Jetson Orin inference engine — sends card images to a local Orin device for identification

import type { IdentifiedCardData } from "./hybridCardIdentify";
import { getScannerSettings } from "@/hooks/use-scanner-settings";

const ORIN_TIMEOUT_MS = 15_000;
const AVAILABILITY_TIMEOUT_MS = 2_000;

function getOrinBaseUrl(): string {
  const settings = getScannerSettings() as any;
  return settings.orinServerUrl || "http://192.168.1.37:8000";
}

/**
 * Quick availability check — HEAD or GET to /health
 */
export async function checkOrinAvailable(): Promise<{ ok: boolean }> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), AVAILABILITY_TIMEOUT_MS);

    const res = await fetch(`${getOrinBaseUrl()}/health`, {
      method: "GET",
      signal: controller.signal,
    });
    clearTimeout(timer);
    return { ok: res.ok };
  } catch {
    return { ok: false };
  }
}

/**
 * Send an image blob to the Orin /scan endpoint for card identification.
 */
export async function scanWithOrin(imageBlob: Blob): Promise<IdentifiedCardData> {
  const formData = new FormData();
  formData.append("file", imageBlob, "frame.jpg");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ORIN_TIMEOUT_MS);

  const response = await fetch(`${getOrinBaseUrl()}/scan`, {
    method: "POST",
    body: formData,
    signal: controller.signal,
  });
  clearTimeout(timer);

  if (!response.ok) {
    throw new Error(`Orin server returned ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  return {
    card_name: data.card_name || data.name || "Unknown Card",
    card_set: data.card_set || data.set || null,
    card_number: data.card_number || data.number || null,
    rarity: data.rarity || null,
    edition: data.edition || null,
    game_type: data.game_type || null,
    sport_type: data.sport_type || null,
    year: data.year || null,
    manufacturer: data.manufacturer || null,
    confidence: data.confidence ?? 80,
    description: data.description,
  };
}

/**
 * Identify a card from a URL by fetching the image first, then sending to Orin.
 */
export async function orinIdentifyByUrl(imageUrl: string): Promise<IdentifiedCardData> {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Failed to fetch image for Orin: ${res.status}`);
  const blob = await res.blob();
  return scanWithOrin(blob);
}
