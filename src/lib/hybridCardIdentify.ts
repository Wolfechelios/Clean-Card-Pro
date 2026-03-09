// src/lib/hybridCardIdentify.ts
// Unified hybrid routing layer for card identification
// Supports offline Ollama and online cloud functions
// Optional PaddleOCR preprocessing for enhanced accuracy

import { supabase } from "@/integrations/supabase/client";
import { isLocalLLMAvailable, isOnline } from "./inferenceMode";
import { callLocalVisionLLM } from "./localLLM";
import { withRetry } from "./retry";
import { runPaddleOCR, isPaddleOCRReady } from "./paddleOCR";
import { getScannerSettings } from "@/hooks/use-scanner-settings";
import { checkGpuServerAvailable } from "@/lib/gpuOffload/gpuAvailability";
import { gpuIdentifyByImageUrl } from "@/lib/gpuOffload/gpuHttpClient";
import { checkOrinAvailable, orinIdentifyByUrl } from "@/lib/orinScanner";

export interface IdentifiedCardData {
  card_name: string;
  card_set: string | null;
  card_number: string | null;
  rarity: string | null;
  edition: string | null;
  game_type: string | null;
  sport_type: string | null;
  year: string | null;
  manufacturer: string | null;
  confidence: number;
  description?: string;
}

export interface HybridIdentifyResult {
  success: boolean;
  cardData: IdentifiedCardData;
  source: "local" | "cloud" | "gpu";
  error?: string;
}

// Track offline mode attempts to prevent duplicate requeue loops
const offlineAttempts = new Map<string, number>();
const MAX_OFFLINE_ATTEMPTS = 1;

function getOfflineAttemptKey(imageUrl: string): string {
  // Use last part of URL as key to avoid memory bloat
  return imageUrl.split("/").pop() || imageUrl.slice(-50);
}

export function markOfflineAttempt(imageUrl: string): boolean {
  const key = getOfflineAttemptKey(imageUrl);
  const attempts = offlineAttempts.get(key) || 0;
  
  if (attempts >= MAX_OFFLINE_ATTEMPTS) {
    return false; // Already attempted max times
  }
  
  offlineAttempts.set(key, attempts + 1);
  
  // Clean up old entries (keep max 100)
  if (offlineAttempts.size > 100) {
    const firstKey = offlineAttempts.keys().next().value;
    if (firstKey) offlineAttempts.delete(firstKey);
  }
  
  return true;
}

export function clearOfflineAttempt(imageUrl: string): void {
  const key = getOfflineAttemptKey(imageUrl);
  offlineAttempts.delete(key);
}

const CARD_IDENTIFICATION_PROMPT = `You are a trading card identification expert. Analyze this card image and extract the following information in JSON format:

{
  "card_name": "Full card name",
  "card_set": "Set or expansion name",
  "card_number": "Card number if visible",
  "rarity": "common/uncommon/rare/ultra rare/secret rare/etc",
  "edition": "1st Edition, Unlimited, etc",
  "game_type": "Pokemon/Yu-Gi-Oh!/MTG/Sports/etc",
  "sport_type": "Basketball/Baseball/Football/Hockey/Soccer or null",
  "year": "Year if identifiable",
  "manufacturer": "Topps/Panini/Upper Deck/Konami/etc",
  "confidence": 0-100
}

Be precise. Only include information you can clearly identify. Return ONLY valid JSON.`;

async function identifyWithLocalLLM(imageUrl: string): Promise<IdentifiedCardData> {
  const response = await callLocalVisionLLM(imageUrl, CARD_IDENTIFICATION_PROMPT);
  
  // Parse JSON from response
  try {
    // Try to extract JSON from response (may have text around it)
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("No JSON found in response");
    
    const parsed = JSON.parse(jsonMatch[0]);
    
    return {
      card_name: parsed.card_name || "Unknown Card",
      card_set: parsed.card_set || null,
      card_number: parsed.card_number || null,
      rarity: parsed.rarity || null,
      edition: parsed.edition || null,
      game_type: parsed.game_type || null,
      sport_type: parsed.sport_type || null,
      year: parsed.year || null,
      manufacturer: parsed.manufacturer || null,
      confidence: parsed.confidence || 70,
    };
  } catch (e) {
    console.error("Failed to parse local LLM response:", e);
    throw new Error("Local LLM returned invalid response format");
  }
}

async function identifyWithCloud(
  imageUrl: string,
  functionName: string = "rapid-card-identify",
  ocrText?: string
): Promise<IdentifiedCardData> {
  const { data, error } = await supabase.functions.invoke(functionName, {
    body: { imageUrl, ocrText },
  });

  if (error) throw new Error(error.message);
  if (!data?.success) throw new Error(data?.error || "Cloud identification failed");

  const cardData = data.cardData;
  
  return {
    card_name: cardData?.card_name || "Unknown Card",
    card_set: cardData?.card_set || null,
    card_number: cardData?.card_number || null,
    rarity: cardData?.rarity || null,
    edition: cardData?.edition || null,
    game_type: cardData?.game_type || null,
    sport_type: cardData?.sport_type || null,
    year: cardData?.year || null,
    manufacturer: cardData?.manufacturer || null,
    confidence: cardData?.confidence || 80,
    description: cardData?.description,
  };
}

async function identifyWithGpuServer(imageUrl: string): Promise<IdentifiedCardData> {
  const result = await gpuIdentifyByImageUrl(imageUrl, { wantPricing: false });
  if (!result?.success) {
    throw new Error(result?.error || "GPU server identification failed");
  }
  return {
    card_name: result.cardData.card_name || "Unknown Card",
    card_set: result.cardData.card_set || null,
    card_number: result.cardData.card_number || null,
    rarity: result.cardData.rarity || null,
    edition: result.cardData.edition || null,
    game_type: result.cardData.game_type || null,
    sport_type: result.cardData.sport_type || null,
    year: result.cardData.year || null,
    manufacturer: result.cardData.manufacturer || null,
    confidence: result.cardData.confidence || 80,
    description: result.cardData.description,
  };
}

/**
 * Run PaddleOCR preprocessing on an image URL
 * Returns extracted text or null if OCR fails/unavailable
 */
async function runPaddleOCRPreprocess(imageUrl: string): Promise<string | null> {
  try {
    console.log("[HybridIdentify] Running PaddleOCR preprocessing...");
    const result = await runPaddleOCR(imageUrl);
    if (result.text && result.text.trim().length > 0) {
      console.log(`[HybridIdentify] PaddleOCR extracted ${result.lines.length} lines`);
      return result.text;
    }
    return null;
  } catch (e) {
    console.warn("[HybridIdentify] PaddleOCR preprocessing failed:", e);
    return null;
  }
}

/**
 * Hybrid card identification with automatic routing
 * Priority:
 * 1. If offline AND local LLM available → use local
 * 2. If online → try cloud
 * 3. If cloud fails AND local available → fallback to local
 * 4. If neither available → throw controlled error
 */
export async function hybridIdentifyCard(
  imageUrl: string,
  options: {
    cloudFunction?: string;
    forceLocal?: boolean;
    forceCloud?: boolean;
    forceGpu?: boolean;
    skipOfflineGuard?: boolean;
    usePaddleOCR?: boolean; // Enable PaddleOCR preprocessing for enhanced accuracy
  } = {}
): Promise<HybridIdentifyResult> {
  const {
    cloudFunction = "rapid-card-identify",
    forceLocal = false,
    forceCloud = false,
    forceGpu = false,
    skipOfflineGuard = false,
    usePaddleOCR = false,
  } = options;

  // Optional PaddleOCR preprocessing
  let ocrText: string | null = null;
  if (usePaddleOCR) {
    ocrText = await runPaddleOCRPreprocess(imageUrl);
  }

  const localAvailable = await isLocalLLMAvailable();
  const online = isOnline();

  const scanner = getScannerSettings() as any;
  const gpuEnabled = scanner.gpuOffloadEnabled === true && scanner.gpuPreferForQueue !== false;

  const gpuAvailable = (forceGpu || gpuEnabled) ? (await checkGpuServerAvailable()).ok : false;

  // Force GPU mode
  if (forceGpu && gpuAvailable) {
    const cardData = await identifyWithGpuServer(imageUrl);
    return { success: true, cardData, source: "gpu" };
  }

  // Priority 0: GPU server (if enabled)
  if (gpuEnabled && gpuAvailable) {
    try {
      const cardData = await identifyWithGpuServer(imageUrl);
      return { success: true, cardData, source: "gpu" };
    } catch (e) {
      console.warn("GPU server identification failed, falling back:", e);
    }
  }

  // Force local mode
  if (forceLocal && localAvailable) {
    const cardData = await identifyWithLocalLLM(imageUrl);
    return { success: true, cardData, source: "local" };
  }

  // Force cloud mode
  if (forceCloud && online) {
    const cardData = await withRetry(
      () => identifyWithCloud(imageUrl, cloudFunction, ocrText || undefined),
      { retries: 2, baseMs: 1000, maxMs: 5000 }
    );
    return { success: true, cardData, source: "cloud" };
  }

  // Priority 1: If offline AND local available → use local
  if (!online && localAvailable) {
    // Single-attempt guard for offline mode to prevent requeue loops
    if (!skipOfflineGuard && !markOfflineAttempt(imageUrl)) {
      throw new Error("Offline mode: max attempts reached for this card");
    }

    try {
      const cardData = await identifyWithLocalLLM(imageUrl);
      clearOfflineAttempt(imageUrl); // Success, clear the attempt tracker
      return { success: true, cardData, source: "local" };
    } catch (e) {
      throw new Error(`Offline identification failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  // Priority 2: If online → try cloud
  if (online) {
    try {
      const cardData = await withRetry(
        () => identifyWithCloud(imageUrl, cloudFunction, ocrText || undefined),
        { retries: 2, baseMs: 1000, maxMs: 5000 }
      );
      return { success: true, cardData, source: "cloud" };
    } catch (cloudError) {
      console.warn("Cloud identification failed, checking for local fallback:", cloudError);

      // Fallback to local if available
      if (localAvailable) {
        try {
          const cardData = await identifyWithLocalLLM(imageUrl);
          return { success: true, cardData, source: "local" };
        } catch (localError) {
          throw new Error(
            `Both cloud and local failed. Cloud: ${cloudError instanceof Error ? cloudError.message : String(cloudError)}. Local: ${localError instanceof Error ? localError.message : String(localError)}`
          );
        }
      }

      throw cloudError;
    }
  }

  // Final fallback: only local available but online status unknown
  if (localAvailable) {
    const cardData = await identifyWithLocalLLM(imageUrl);
    return { success: true, cardData, source: "local" };
  }

  throw new Error("No inference engine available: offline and no local LLM running");
}

/**
 * Check current inference mode status
 */
export async function getInferenceStatus(): Promise<{
  online: boolean;
  localAvailable: boolean;
  preferredMode: "cloud" | "local" | "none";
}> {
  const online = isOnline();
  const localAvailable = await isLocalLLMAvailable();

  let preferredMode: "cloud" | "local" | "none" = "none";
  if (online) {
    preferredMode = "cloud";
  } else if (localAvailable) {
    preferredMode = "local";
  }

  return { online, localAvailable, preferredMode };
}
