// src/lib/ocr/glmOcr.ts
// Primary OCR: GLM-OCR via the `zai-ocr` Supabase edge function (Z.AI cloud).
// The edge function already extracts title / setCode / cardNumber and applies
// OCR-confusion fixes; we just normalize the response into our internal shape.

import { supabase } from "@/integrations/supabase/client";
import { extractPrintedCode, normalizeSetCodeToken, type DetectedGame } from "./gameCodePatterns";

export type GlmOcrResult = {
  rawText: string;
  title?: string;
  setCode?: string;
  cardNumber?: string;
  fullCode?: string;
  game?: DetectedGame;
  edition?: string;
  confidence: number;
  source: "local-glm-ocr";
};

async function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("Failed to read image for GLM OCR"));
    reader.readAsDataURL(blob);
  });
}

export async function runGlmOcr(image: Blob | File | string): Promise<GlmOcrResult | null> {
  try {
    const imageUrl = typeof image === "string" ? image : await blobToDataUrl(image);

    const { data, error } = await supabase.functions.invoke("zai-ocr", {
      body: { imageUrl, mode: "meta" },
    });

    if (error) {
      console.warn("[glmOcr] zai-ocr edge function error:", error.message);
      return null;
    }
    if (!data || typeof data !== "object") return null;
    if ((data as any).error) {
      console.warn("[glmOcr] zai-ocr returned error:", (data as any).error);
      return null;
    }

    const rawText = String((data as any).rawText ?? (data as any).text ?? "").trim();
    if (!rawText) return null;

    // Trust the edge function's structured fields first; fall back to local
    // regex extraction for cards (e.g. MTG, sports) the function doesn't tag.
    const detected = extractPrintedCode(rawText);
    const edgeSetCode = String((data as any).setCode ?? "").trim() || null;
    const edgeCardNumber = String((data as any).cardNumber ?? "").trim() || null;
    const edgeTitle = String((data as any).title ?? (data as any).name ?? "").trim() || undefined;

    const normalizedLocal =
      detected.setCode && detected.cardNumber
        ? normalizeSetCodeToken(`${detected.setCode}-${detected.cardNumber}`)
        : null;

    const setCode = edgeSetCode ?? normalizedLocal ?? detected.fullCode ?? undefined;
    const cardNumber = edgeCardNumber ?? detected.cardNumber ?? undefined;
    const fullCode = edgeSetCode ?? detected.fullCode ?? undefined;

    const confidence = Math.max(
      Number((data as any).confidence ?? 0) || 0,
      detected.confidence || 0,
      0.6,
    );

    return {
      rawText,
      title: edgeTitle,
      setCode,
      cardNumber,
      fullCode,
      game: detected.game,
      edition: detected.edition ?? undefined,
      confidence,
      source: "local-glm-ocr",
    };
  } catch (error) {
    console.warn("[glmOcr] GLM OCR call failed:", error);
    return null;
  }
}
