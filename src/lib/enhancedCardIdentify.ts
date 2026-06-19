import { supabase } from "@/integrations/supabase/client";
import { 
  EnhancedCardIdentifyResponseSchema, 
  type EnhancedCardData 
} from "./schemas/api-schemas";
import { handleApiError, safeValidate, AppError } from "./errors";

// Re-export the type for backwards compatibility
export type { EnhancedCardData } from "./schemas/api-schemas";

export async function enhancedCardIdentify(
  imageUrl: string,
  ocrText?: string
): Promise<EnhancedCardData> {
  const { data, error } = await supabase.functions.invoke("enhanced-card-identify", {
    body: {
      imageUrl,
      ocrText,
    },
  });

  if (error) {
    // supabase.functions.invoke returns an error for non-2xx responses (e.g. 400).
    // Try to extract the JSON body so noCardDetected / error messages surface properly
    // instead of being thrown as a generic edge-function failure.
    let parsedBody: any = null;
    try {
      const ctx: any = (error as any).context;
      if (ctx && typeof ctx.json === "function") {
        parsedBody = await ctx.json();
      } else if (ctx && typeof ctx.text === "function") {
        const txt = await ctx.text();
        try { parsedBody = JSON.parse(txt); } catch { /* ignore */ }
      }
    } catch { /* ignore */ }

    if (parsedBody && parsedBody.success === false) {
      throw new AppError(
        parsedBody.error || "Could not identify card",
        parsedBody.noCardDetected ? "NOT_FOUND" : "API_ERROR"
      );
    }
    throw handleApiError(error);
  }

  // Validate response structure
  const validation = safeValidate(EnhancedCardIdentifyResponseSchema, data);
  
  if (validation.success === false) {
    console.warn("Response validation failed, attempting fallback parse:", data);
    // Fallback for legacy responses - extract primary if available
    if (data?.cardData?.primary) {
      return data.cardData.primary as EnhancedCardData;
    }
    if (data?.cardData) {
      return data.cardData as EnhancedCardData;
    }
    throw validation.error;
  }

  const response = validation.data;
  
  if (!response.success) {
    throw new AppError(
      response.error || "Failed to identify card",
      response.noCardDetected ? "NOT_FOUND" : "API_ERROR"
    );
  }

  if (!response.cardData?.primary) {
    throw new AppError("No card data in response", "API_ERROR");
  }

  return response.cardData.primary;
}
