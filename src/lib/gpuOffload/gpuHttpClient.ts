import { getGpuServerBaseUrl } from "./gpuSettings";
import type { GpuIdentifyResult } from "./types";

function baseOrThrow(): string {
  const base = getGpuServerBaseUrl();
  if (!base) throw new Error("GPU server not configured");
  return base;
}

export async function gpuIdentifyByImageUrl(imageUrl: string, opts?: { wantPricing?: boolean }): Promise<GpuIdentifyResult> {
  const base = baseOrThrow();
  const res = await fetch(`${base}/identify`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl, wantPricing: opts?.wantPricing ?? true }),
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    return {
      success: false,
      source: "gpu",
      cardData: {
        card_name: "Unknown Card",
        card_set: null,
        card_number: null,
        rarity: null,
        edition: null,
        game_type: null,
        sport_type: null,
        year: null,
        manufacturer: null,
        confidence: 0,
      },
      error: (data as any)?.error || `GPU identify failed (${res.status})`,
    };
  }

  return data as GpuIdentifyResult;
}

export async function gpuOcrByImageUrl(imageUrl: string): Promise<{ success: boolean; text: string; error?: string }>
{
  const base = baseOrThrow();
  const res = await fetch(`${base}/ocr`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ imageUrl }),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) return { success: false, text: "", error: (data as any)?.error || `GPU ocr failed (${res.status})` };
  return data as any;
}
