// src/lib/analyzeCardFull.ts
import { supabase } from "@/integrations/supabase/client";

export type VisionLabel = {
  description: string;
  score: number;
  topicality: number;
};

export type VisionLogo = {
  description: string;
  score: number;
};

export type WebEntity = {
  entityId?: string;
  description: string;
  score: number;
};

export type FullCardAnalysis = {
  image_url: string;
  card_id: string | null;
  game: string | null;
  set_code: string | null;
  card_name: string | null;
  vision: {
    ocr_text: string;
    ocr_locale: string | null;
    crop_hint: {
      importanceFraction: number | null;
      boundingPoly: any;
    } | null;
    image_properties: any;
    labels: VisionLabel[];
    logos: VisionLogo[];
    web_detection: {
      entities: WebEntity[];
      similar_images: string[];
      matching_images: string[];
    };
    raw_vision_response: any;
  };
  condition_estimate: {
    card_id: string | null;
    game: string | null;
    set_code: string | null;
    card_name: string | null;
    raw_grade_estimate: { min: number; max: number; confidence: number };
    condition_notes: string[];
    defect_flags: {
      centering: string;
      corners: string;
      edges: string;
      surface: string;
      structural_damage: string;
    };
    recommended_action: string;
    analyzed_at: string;
  };
};

export async function analyzeCardFull(
  imageUrl: string,
  opts?: {
    cardId?: string;
    game?: string;
    setCode?: string;
    cardName?: string;
  }
): Promise<FullCardAnalysis> {
  const { data, error } = await supabase.functions.invoke("analyze-card-full", {
    body: {
      image_url: imageUrl,
      card_id: opts?.cardId,
      game: opts?.game,
      set_code: opts?.setCode,
      card_name: opts?.cardName,
    },
  });

  if (error) {
    throw new Error(`analyze-card-full failed: ${error.message}`);
  }

  return data as FullCardAnalysis;
}
