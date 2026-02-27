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
