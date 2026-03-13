// src/lib/orinScanner.ts
// Jetson/Orin inference — wraps jetsonClient for the hybrid pipeline interface

import type { IdentifiedCardData } from "./hybridCardIdentify";
import { jetsonHealth, jetsonInfer, jetsonRectify } from "./jetsonClient";

/**
 * Quick availability check via /health
 */
export async function checkOrinAvailable(): Promise<{ ok: boolean }> {
  try {
    const h = await jetsonHealth(2_000);
    return { ok: h.status === "ok" };
  } catch {
    return { ok: false };
  }
}

/**
 * Send an image blob to the Jetson for card identification.
 * Optionally rectifies first, then runs /infer.
 */
export async function scanWithOrin(imageBlob: Blob): Promise<IdentifiedCardData> {
  // Try perspective correction first
  let finalBlob = imageBlob;
  try {
    const rect = await jetsonRectify(imageBlob);
    if (rect.corrected_image) {
      const bin = atob(rect.corrected_image);
      const arr = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
      finalBlob = new Blob([arr], { type: "image/jpeg" });
    }
  } catch {
    // rectify not available — use original
  }

  const result = await jetsonInfer(finalBlob);
  const det = result.detections?.[0];

  return {
    card_name: result.ocr?.name || det?.label || "Unknown Card",
    card_set: result.ocr?.set || null,
    card_number: null,
    rarity: null,
    edition: null,
    game_type: null,
    sport_type: null,
    year: null,
    manufacturer: null,
    confidence: det?.confidence ? Math.round(det.confidence * 100) : 80,
    description: `Jetson inference (${result.latency_ms}ms)`,
  };
}

/**
 * Identify a card from a URL by fetching the image first.
 */
export async function orinIdentifyByUrl(imageUrl: string): Promise<IdentifiedCardData> {
  const res = await fetch(imageUrl);
  if (!res.ok) throw new Error(`Failed to fetch image: ${res.status}`);
  const blob = await res.blob();
  return scanWithOrin(blob);
}
