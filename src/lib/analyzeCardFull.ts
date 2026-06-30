// src/lib/analyzeCardFull.ts
import { performEmbeddedCardOcrFromUrl } from "@/lib/vision/embeddedOcr";

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
  const ocr = await performEmbeddedCardOcrFromUrl(imageUrl);
  const setCode = opts?.setCode || ocr.setCode;
  const cardName = opts?.cardName || ocr.cardName;
  const game = opts?.game || (setCode ? "Yu-Gi-Oh" : null);

  return {
    image_url: imageUrl,
    card_id: opts?.cardId || null,
    game,
    set_code: setCode || null,
    card_name: cardName || null,
    vision: {
      ocr_text: ocr.rawText,
      ocr_locale: "en",
      crop_hint: null,
      image_properties: null,
      labels: [
        {
          description: `embedded-ocr:${ocr.engine}`,
          score: Math.max(0, Math.min(1, ocr.confidence / 100)),
          topicality: 1,
        },
      ],
      logos: [],
      web_detection: {
        entities: [],
        similar_images: [],
        matching_images: [],
      },
      raw_vision_response: {
        engine: ocr.engine,
        confidence: ocr.confidence,
        set_code: setCode || null,
        card_name: cardName || null,
        edition: ocr.edition || null,
        offline_ocr: true,
      },
    },
    condition_estimate: {
      card_id: opts?.cardId || null,
      game,
      set_code: setCode || null,
      card_name: cardName || null,
      raw_grade_estimate: { min: 0, max: 0, confidence: 0 },
      condition_notes: ["Condition analysis skipped during embedded local OCR pass."],
      defect_flags: {
        centering: "unknown",
        corners: "unknown",
        edges: "unknown",
        surface: "unknown",
        structural_damage: "unknown",
      },
      recommended_action: "Use pricing/identification lookup after OCR, then confirm card manually if confidence is low.",
      analyzed_at: new Date().toISOString(),
    },
  };
}
